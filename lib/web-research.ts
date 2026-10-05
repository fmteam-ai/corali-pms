// Claude with web search (server tool) for staff features that need outside information, such as what similar
// properties in Piso Livadi / Paros currently ask per night. Handles pause_turn and collects the sources it used.
import Anthropic from "@anthropic-ai/sdk";

export type WebSource = { title: string; url: string };
export type WebAnswer = { text: string; sources: WebSource[]; searches: number; error?: string };

export const webSearchTool = (maxUses: number): Anthropic.Beta.BetaWebSearchTool20260209 => ({
  type: "web_search_20260209",
  name: "web_search",
  max_uses: maxUses,
  // No user_location: the API rejects country GR ("Country code GR is not supported"); the prompts name Paros instead.
});

/** Run one request with web search until Claude finishes (resuming paused server-tool turns a few times). */
export async function withWebSearch(client: Anthropic, params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "tools">, maxUses = 6): Promise<WebAnswer | null> {
  const messages = [...params.messages];
  const sources = new Map<string, WebSource>();
  let searches = 0, text = "";
  for (let round = 0; round < 4; round++) {
    const response = await client.beta.messages.create({ ...params, messages, tools: [webSearchTool(maxUses)] });
    for (const block of response.content) {
      if (block.type === "server_tool_use" && block.name === "web_search") searches++;
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) for (const r of block.content) if (!sources.has(r.url)) sources.set(r.url, { title: r.title, url: r.url });
      if (block.type === "text") text += block.text;
    }
    if (response.stop_reason === "refusal") return null;
    if (response.stop_reason !== "pause_turn") break;
    // Resume: send the paused assistant turn back as is; the API continues the server-side search loop.
    messages.push({ role: "assistant", content: response.content });
  }
  return { text: text.trim(), sources: [...sources.values()].slice(0, 15), searches };
}

/** A short, staff-readable reason from an Anthropic API error (status + the API's own message; no secrets). */
export function apiErrorText(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { error?: { message?: string } } | undefined;
    const message = body?.error?.message || error.message || "";
    return `${error.status ?? ""} ${message}`.replace(/\s+/g, " ").trim().slice(0, 240);
  }
  return error instanceof Error ? error.message.slice(0, 240) : "unknown error";
}

/** Text of a plain response (no tools). */
export function responseText(response: Anthropic.Beta.BetaMessage): string {
  return response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

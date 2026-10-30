import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_MODEL } from "@/lib/guest-assistant";
import { anthropicApiKey } from "@/lib/provider-connections";
import { cleanTranslations, TRANSLATE_RULES, translationPrompt, translationTool, type TranslateLang } from "@/lib/translate-core";

/** Translates several texts at once (e.g. a title and its body) from one language into the others with Claude. */
export async function translateFields(ownerId: string, from: TranslateLang, to: TranslateLang[], fields: Record<string, string>) {
  const apiKey = await anthropicApiKey(ownerId);
  if (!apiKey) throw Error("NO_AI");
  const keys = Object.keys(fields);
  const tool = translationTool(keys, to);
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 });
  const response = await client.messages.create({
    model: ASSISTANT_MODEL,
    max_tokens: 16_000,
    system: TRANSLATE_RULES,
    messages: [{ role: "user", content: translationPrompt(from, to, fields) }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
  });
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw Error("NO_TRANSLATION");
  return cleanTranslations(block.input, keys, to);
}

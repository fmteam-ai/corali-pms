import assert from "node:assert/strict";
import test from "node:test";
import { withWebSearch } from "../lib/web-research.ts";

test("web search resumes paused turns, joins the text and collects unique sources", async () => {
  const calls: unknown[] = [];
  const replies = [
    { stop_reason: "pause_turn", content: [{ type: "server_tool_use", name: "web_search" }, { type: "web_search_tool_result", content: [{ url: "https://a.example", title: "A" }, { url: "https://b.example", title: "B" }] }, { type: "text", text: "Studio A €90. " }] },
    { stop_reason: "end_turn", content: [{ type: "server_tool_use", name: "web_search" }, { type: "web_search_tool_result", content: [{ url: "https://a.example", title: "A" }] }, { type: "text", text: "Studio B €110." }] },
  ];
  const client = { beta: { messages: { create: async (p: unknown) => { calls.push(structuredClone(p)); return replies.shift(); } } } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await withWebSearch(client as any, { model: "m", max_tokens: 10, messages: [{ role: "user", content: "q" }] }, 3);
  assert.equal(r?.text, "Studio A €90. Studio B €110.");
  assert.equal(JSON.stringify(r?.sources), JSON.stringify([{ title: "A", url: "https://a.example" }, { title: "B", url: "https://b.example" }]));
  assert.equal(r?.searches, 2);
  assert.equal(calls.length, 2);
  const second = calls[1] as { messages: { role: string }[]; tools: { type: string; max_uses: number }[] };
  assert.deepEqual(second.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(second.tools[0].type, "web_search_20260209");
  assert.equal(second.tools[0].max_uses, 3);
});

test("web search returns null on refusal", async () => {
  const client = { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await withWebSearch(client as any, { model: "m", max_tokens: 10, messages: [{ role: "user", content: "q" }] }), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { assistantRequestKinds, speechLocale, trimHistory, tvActionSchema, tvAssistantTexts } from "../lib/tv-assistant-core.ts";
import { normalizeTvSettings, tvLanguages } from "../lib/tv-core.ts";

test("TV assistant proposals are validated (requests without taxi / problem; orders with an item id)", () => {
  assert.ok(!assistantRequestKinds.includes("taxi" as never) && !assistantRequestKinds.includes("problem" as never));
  assert.equal(tvActionSchema.safeParse({ type: "request", kind: "towels" }).success, true);
  assert.equal(tvActionSchema.safeParse({ type: "request", kind: "taxi" }).success, false);
  const o = tvActionSchema.safeParse({ type: "order", item_id: 7, quantity: 2 });
  assert.ok(o.success && o.data.type === "order" && o.data.quantity === 2 && o.data.note === "");
  assert.equal(tvActionSchema.safeParse({ type: "order", item_id: 7, quantity: 50 }).success, false);
  assert.equal(tvActionSchema.safeParse({ type: "order", item_id: 7, date: "2026-07-01", time: "25:00" }).success, false);
});

test("history keeps the latest turns and starts with the guest", () => {
  const turns = Array.from({ length: 15 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: String(i) }));
  const t = trimHistory(turns, 12);
  assert.equal(t[0].role, "user");
  assert.equal(t.at(-1)!.content, "14");
  assert.ok(t.length <= 12);
});

test("every screen language has texts, suggestions and a speech locale; the feature is off by default", () => {
  for (const l of tvLanguages) {
    assert.equal(tvAssistantTexts[l].suggestions.length, 6, l);
    assert.match(speechLocale[l], /^[a-z]{2}-[A-Z]{2}$/);
  }
  assert.equal(normalizeTvSettings({}).assistant, false);
  assert.equal(normalizeTvSettings({ assistant: true, assistantDailyLimit: 1000 }).assistantDailyLimit, 200);
  assert.equal(normalizeTvSettings({ assistantDailyLimit: 2 }).assistantDailyLimit, 5);
});

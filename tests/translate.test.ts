import assert from "node:assert/strict";
import test from "node:test";
import { cleanTranslations, targetLangs, translationPrompt, translationTool } from "../lib/translate-core.ts";

test("translation targets: all other languages, or only the empty ones", () => {
  const v = { el: "Καλώς ήρθατε", en: "Welcome", fr: "" };
  assert.deepEqual(targetLangs(v, "el", true), ["en", "fr", "de", "it", "es"]);
  assert.deepEqual(targetLangs(v, "el", false), ["fr", "de", "it", "es"]);
});

test("translation tool asks every key in every language; output keeps only those strings", () => {
  const tool = translationTool(["title", "body"], ["en", "fr"]);
  assert.deepEqual(tool.input_schema.required, ["en", "fr"]);
  assert.match(translationPrompt("el", ["en"], { title: "Πρωινό" }), /from Greek into English \(en\)/);
  const out = cleanTranslations({ en: { title: "Breakfast", body: 3, extra: "x" }, fr: "bad", de: { title: "Frühstück" } }, ["title", "body"], ["en", "fr"]);
  assert.deepEqual(out, { en: { title: "Breakfast" } });
});

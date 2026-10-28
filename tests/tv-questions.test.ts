import assert from "node:assert/strict";
import test from "node:test";
import { defaultTvQuestions, MAX_TV_QUESTIONS, normalizeTvQuestions, questionsFor } from "../lib/tv-questions.ts";

test("ready questions default to the built-in six", () => {
  assert.equal(normalizeTvQuestions(undefined).length, 6);
  assert.deepEqual(normalizeTvQuestions(undefined)[0], defaultTvQuestions[0]);
});

test("ready questions: trims, drops empty ones, keeps the order, caps count and length", () => {
  const qs = normalizeTvQuestions([{ el: "  Πού είναι το φαρμακείο; ", en: "" }, {}, { en: "x".repeat(200) }, { el: 5 }]);
  assert.deepEqual(qs, [{ el: "Πού είναι το φαρμακείο;" }, { en: "x".repeat(80) }]);
  assert.equal(normalizeTvQuestions(Array.from({ length: 30 }, (_, i) => ({ en: `Q${i}` }))).length, MAX_TV_QUESTIONS);
  assert.deepEqual(normalizeTvQuestions([]), []);
});

test("ready questions: the TV language, else English, else Greek", () => {
  const qs = [{ el: "Α", en: "A", de: "D" }, { el: "Μόνο ελληνικά" }];
  assert.deepEqual(questionsFor(qs, "de"), ["D", "Μόνο ελληνικά"]);
  assert.deepEqual(questionsFor(qs, "fr"), ["A", "Μόνο ελληνικά"]);
  assert.deepEqual(questionsFor(qs, "el"), ["Α", "Μόνο ελληνικά"]);
});

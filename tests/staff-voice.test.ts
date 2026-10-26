import assert from "node:assert/strict";
import test from "node:test";
import { cleanActions, parseVoiceRules } from "../lib/staff-voice-core.ts";

const rooms = ["101", "102", "103", "104", "201", "304"];

test("ready + defect in one sentence (Greek)", () => {
  const a = cleanActions(parseVoiceRules("Το δωμάτιο 304 είναι έτοιμο, αλλά η λάμπα στο μπαλκόνι είναι καμένη", rooms), rooms);
  assert.deepEqual(a.map((x) => [x.type, x.room]), [["complete_clean", "304"], ["report_issue", "304"]]);
  assert.equal(a[1].severity, "minor");
  assert.match(a[1].description!, /λάμπα στο μπαλκόνι/);
});

test("serious defects and linen (Greek / English)", () => {
  const a = cleanActions(parseVoiceRules("Στο 102 το κλιματιστικό στάζει. Άλλαξα σεντόνια και πετσέτες στο 103", rooms), rooms);
  assert.deepEqual(a.map((x) => [x.type, x.room, x.severity ?? x.service ?? null]), [["report_issue", "102", "major"], ["linen", "103", "sheets"], ["linen", "103", "towels"]]);
  const b = cleanActions(parseVoiceRules("Room 201 is ready but the shower is leaking, out of order", rooms), rooms);
  assert.deepEqual(b.map((x) => [x.type, x.room, x.severity ?? null]), [["complete_clean", "201", null], ["report_issue", "201", "out_of_order"]]);
});

test("unknown rooms and empty actions are dropped", () => {
  assert.deepEqual(cleanActions(parseVoiceRules("Το 999 είναι έτοιμο", rooms), rooms), []);
  assert.deepEqual(cleanActions([{ type: "report_issue", room: "101", description: "x" }], rooms), []);
});

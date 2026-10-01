import assert from "node:assert/strict";
import test from "node:test";
import { builtInAnswer, snapshotText, type PmsSnapshot } from "../lib/pms-assistant-core.ts";

const s: PmsSnapshot = {
  today: "2026-10-01", totalRooms: 8, financial: false, inHouse: 2,
  arrivalsToday: [{ reference: "CR-1", guest_name: "Anna Rossi", room_code: "102", check_in: "2026-10-01", check_out: "2026-10-04", status: "confirmed", balance_cents: 12000 }],
  arrivalsTomorrow: [], departuresToday: [], departuresTomorrow: [],
  occupancy: [{ date: "2026-10-01", occupied: 3 }, { date: "2026-10-02", occupied: 2 }],
  latest: [], balances: null, messages: [{ reference: "CR-1", guest_name: "Anna Rossi", body: "Can we arrive at 23:00?", created_at: 1 }],
  housekeeping: { todo: 2, inProgress: 0, ooo: 1, openDefects: 1 },
};

test("snapshot text hides money from users without financial permission", () => {
  const text = snapshotText(s);
  assert.match(text, /ARRIVALS TODAY \(1\)/);
  assert.doesNotMatch(text, /balance €120/);
  assert.match(snapshotText({ ...s, financial: true }), /balance €120\.00/);
});

test("built-in answers for common questions in Greek and English", () => {
  assert.match(builtInAnswer("Ποιοι έρχονται σήμερα;", s, "el"), /Αφίξεις σήμερα:\n• CR-1 · Anna Rossi · 102/);
  assert.match(builtInAnswer("occupancy?", s, "en"), /2026-10-01: 3\/8/);
  assert.match(builtInAnswer("Εκκρεμή υπόλοιπα;", s, "el"), /δικαίωμα/);
  assert.match(builtInAnswer("any messages?", s, "en"), /arrive at 23:00/);
  assert.match(builtInAnswer("write a poem", s, "en"), /Without an AI key/);
});

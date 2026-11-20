import { test } from "node:test";
import assert from "node:assert/strict";
import { instayDue, instayTexts, instayTopics } from "../lib/instay-core.ts";
import { requestDetailsSummary, tvRequestLabels, initialStatus } from "../lib/tv-requests-core.ts";
import { eligible, events, scheduleFor, whatsappVariables } from "../scripts/automation-core.mjs";

test("in-stay question: from the second day of a checked-in stay, never on the last day or for one night", () => {
  const stay = { status: "checked_in", check_in: "2026-07-01", check_out: "2026-07-05" };
  assert.equal(instayDue(stay, "2026-07-01"), false);
  assert.equal(instayDue(stay, "2026-07-02"), true);
  assert.equal(instayDue(stay, "2026-07-04"), true);
  assert.equal(instayDue(stay, "2026-07-05"), false);
  assert.equal(instayDue({ ...stay, status: "confirmed" }, "2026-07-02"), false);
  assert.equal(instayDue({ ...stay, check_out: "2026-07-02" }, "2026-07-02"), false);
});

test("in-stay answers: «no» is an open request with its topics, «yes» is information", () => {
  assert.equal(initialStatus("instay_bad"), "open");
  assert.equal(initialStatus("instay_good"), "info");
  assert.ok(tvRequestLabels.instay_bad.el.includes("ΔΕΝ"));
  assert.equal(requestDetailsSummary({ topics: ["noise", "ac"] }, "el"), "(Θόρυβος, Κλιματισμός)");
  for (const lang of ["el", "en", "fr", "de", "it", "es"] as const) for (const k of instayTopics) assert.ok(instayTexts[lang][k]);
});

test("in-stay message: on day 2 at 11:00 Athens for checked-in stays of 2+ nights, with the guest's name", () => {
  assert.ok(events.includes("instay"));
  const b = { status: "checked_in", check_in: "2026-07-01", check_out: "2026-07-04", created_at: 0, balance_cents: 0 };
  assert.equal(new Date(scheduleFor("instay", b, { review_days_after_checkout: 2, send_hour: 10 })).toISOString(), "2026-07-02T08:00:00.000Z");
  assert.equal(eligible("instay", b, new Date("2026-07-02T09:00:00Z")), true);
  assert.equal(eligible("instay", b, new Date("2026-07-03T09:00:00Z")), false);
  assert.equal(eligible("instay", { ...b, check_out: "2026-07-02" }, new Date("2026-07-02T09:00:00Z")), false);
  assert.deepEqual(whatsappVariables("instay", { name: "Maria" }), ["Maria"]);
});

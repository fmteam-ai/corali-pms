import assert from "node:assert/strict";
import test from "node:test";
import { actionPermission, actionSummary, actionTypes, parseAction, proposeActionsTool } from "../lib/assistant-actions-core.ts";

test("assistant actions: every type has a permission, a summary in both languages and is offered to Claude", () => {
  const samples: Record<string, unknown> = {
    guest_message: { reference: "CR-1", text: "Καλημέρα!" },
    tv_message: { rooms: ["all"], text_el: "Καλησπέρα" },
    guest_announcement: { kind: "happy_hour", title_el: "Happy hour", body_el: "18:00–20:00" },
    report_defect: { room: "102", description: "Καμένη λάμπα", severity: "minor" },
    folio_charge: { reference: "CR-1", description: "Μίνι μπαρ", amount_eur: 12.5 },
    season_price: { room_type: "Penthouse", from: "2026-07-01", to: "2026-07-31", price_eur: 180 },
    issue_access_card: { reference: "CR-1" },
  };
  assert.deepEqual(Object.keys(samples).sort(), [...actionTypes].sort());
  for (const type of actionTypes) {
    const p = parseAction(type, samples[type]);
    assert.ok(p.ok, `${type} parses`);
    if (!p.ok) continue;
    assert.ok(actionPermission[type]);
    assert.ok(actionSummary(type, p.payload, "el").length > 5);
    assert.ok(actionSummary(type, p.payload, "en").length > 5);
  }
  const enumTypes = (proposeActionsTool.input_schema.properties.actions.items.properties.type as { enum: string[] }).enum;
  assert.deepEqual(enumTypes, actionTypes);
});

test("assistant actions: invalid proposals are refused with a reason", () => {
  assert.equal(parseAction("delete_booking", {}).ok, false);
  assert.equal(parseAction("folio_charge", { reference: "CR-1", description: "x", amount_eur: -5 }).ok, false);
  assert.equal(parseAction("season_price", { from: "2026-08-01", to: "2026-07-01", price_eur: 100 }).ok, false);
  assert.equal(parseAction("tv_message", { rooms: ["101"] }).ok, false);
  const r = parseAction("report_defect", { room: "102", description: "x", severity: "catastrophic" });
  assert.ok(!r.ok && /severity/.test(r.error));
});

test("assistant actions: money and changes to prices need the matching permission", () => {
  assert.equal(actionPermission.folio_charge, "folios.write");
  assert.equal(actionPermission.season_price, "pricing.create");
  assert.equal(actionPermission.report_defect, "housekeeping.write");
  const s = parseAction("season_price", { rooms: ["101", "102"], from: "2026-07-01", to: "2026-07-15", price_eur: 95 });
  assert.ok(s.ok && actionSummary("season_price", s.payload, "el") === "Τιμή €95/νύχτα για δωμάτια 101, 102, 01/07/2026 → 15/07/2026");
});

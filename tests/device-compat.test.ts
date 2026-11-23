import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { allowedOperations, assignUnit, deviceRegistry, importProbeReport, provenLevel, recordEvidence, validateEvidence } from "../scripts/device-compat-core.mjs";

const o = "hotel-corali";
type Row = Record<string, unknown>;
async function fresh() {
  const db = new PGlite();
  await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
  const query = async (sql: string, params: unknown[] = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; };
  return { db, pool: { query } };
}
// A full (protected) AC Probe v4 report, as tools/ac-probe/ac_probe.py writes it.
const report = {
  tool: "corali-ac-probe", version: 4, at: "2026-11-20T10:00:00+0200",
  devices: [
    { ip: "192.168.10.21", mac: "10:d5:61:11:22:33", module_vendor: "Tuya Smart", tuya: { device_id: "bf1234567890abcdef", version: "3.3", product_key: "keyabc" }, tuya_read: { ok: true, version: "3.3", device_id: "bf1234567890abcdef", dps: { 1: true, 2: 24, 3: 27 }, candidates: { power: true, setpoint: 24, room_temperature: 27 } }, access: "AUTHENTICATED", access_reason: "Tuya v3.3: η κατάσταση διαβάστηκε τοπικά", level: "STATUS_READ" },
    { ip: "192.168.10.31", mac: "34:ea:34:01:02:03", module_vendor: "Hangzhou BroadLink", broadlink: { devtype: "0x4e2a", model: "AC", manufacturer: "AUX", locked: false }, access: "DISCOVERED_UNVERIFIED", access_reason: "BroadLink: απαντά στην ανακάλυψη", level: "DISCOVERED" },
    { ip: "192.168.10.33", mac: "78:0f:77:07:08:09", module_vendor: "Hangzhou BroadLink", broadlink: { devtype: "0x4e2a", model: "AC", manufacturer: "AUX", locked: false }, access: "NETWORK_ERROR", access_reason: "χωρίς απάντηση", level: "DISCOVERED" },
    { ip: "192.168.10.34", mac: "c8:f7:42:01:01:01", module_vendor: "Hangzhou BroadLink", broadlink: { devtype: "0x4e2a", model: "AC", manufacturer: "AUX", locked: false }, access: "AUTH_FAILED", access_reason: "απέρριψε", level: "DISCOVERED" },
  ],
};

test("v198 compatibility ladder: each level by its own test, in order; FAIL lowers, INCONCLUSIVE never decides", () => {
  const e = (level: string, result: string, at: number) => ({ level, result, at });
  assert.equal(provenLevel([]), "NONE");
  assert.equal(provenLevel([e("DISCOVERED", "PASS", 1), e("AUTHENTICATED", "PASS", 2), e("STATUS_READ", "PASS", 3)]), "STATUS_READ");
  assert.equal(provenLevel([e("AUTHENTICATED", "PASS", 2), e("STATUS_READ", "PASS", 3)]), "NONE", "no discovery → nothing above counts");
  assert.equal(provenLevel([e("DISCOVERED", "PASS", 1), e("AUTHENTICATED", "PASS", 2), e("AUTHENTICATED", "FAIL", 5), e("STATUS_READ", "PASS", 3)]), "DISCOVERED", "a later failed auth lowers it");
  assert.equal(provenLevel([e("DISCOVERED", "PASS", 1), e("AUTHENTICATED", "PASS", 2), e("AUTHENTICATED", "INCONCLUSIVE", 5)]), "AUTHENTICATED", "no answer changes nothing");
  assert.deepEqual(allowedOperations("AUTHENTICATED"), { read: false, command: false });
  assert.deepEqual(allowedOperations("STATUS_READ"), { read: true, command: false });
  assert.deepEqual(allowedOperations("COMMAND_CONFIRMED"), { read: true, command: true });
  // COMMAND_CONFIRMED: the change itself, read back, is the proof.
  const cmd = (before: unknown, after: unknown) => validateEvidence({ level: "COMMAND_CONFIRMED", result: "PASS", method: "manual-test", manual: true, detail: "εντολή από το τοπικό API, η οθόνη έδειξε 24", functions: { command: { name: "setpoint", value: 24 }, before: { setpoint: before }, after: { setpoint: after } } }, "STATUS_READ");
  assert.equal(cmd(22, 24), null);
  assert.equal(cmd(24, 24), "NO_CHANGE_OBSERVED");
  assert.equal(cmd(22, 22), "READBACK_DOES_NOT_MATCH");
  assert.equal(validateEvidence({ level: "COMMAND_CONFIRMED", result: "PASS", method: "m", functions: { command: { name: "setpoint", value: 24 } } }, "STATUS_READ"), "READBACK_REQUIRED");
  assert.equal(validateEvidence({ level: "COMMAND_CONFIRMED", result: "PASS", method: "m", functions: {} }, "AUTHENTICATED"), "PREVIOUS_LEVEL_NOT_PROVEN");
  assert.equal(validateEvidence({ level: "STATUS_READ", result: "PASS", method: "m", functions: { read: {} } }, "AUTHENTICATED"), "VALUES_REQUIRED");
});

test("v198 registry: probe import (idempotent, shareable copy refused), per-unit levels, models split by firmware, protected identifiers", async () => {
  const { db, pool } = await fresh();
  try {
    const now = Date.parse("2026-11-23T10:00:00Z");
    const r1 = await importProbeReport({ pool, owner: o, report, by: "Maria", now });
    assert.deepEqual([r1.ok, r1.units], [true, 4]);
    assert.equal((await importProbeReport({ pool, owner: o, report, by: "Maria", now })).evidence, 0, "re-import adds nothing");
    const share = { ...report, devices: report.devices.map((d, i) => ({ label: `dev-${i + 1}`, level: d.level, access: d.access })) };
    assert.equal((await importProbeReport({ pool, owner: o, report: share, by: "Maria", now })).error, "SHAREABLE_REPORT_HAS_NO_IDENTIFIERS");
    assert.equal((await importProbeReport({ pool, owner: o, report: { ...report, version: 3 }, by: "M", now })).error, "NOT_AN_AC_PROBE_REPORT_V4");
    let reg = await deviceRegistry({ pool, owner: o, includeRefs: true });
    const by = (ip: string) => reg.units.find((u) => u.refs!.ip === ip)!;
    assert.equal(by("192.168.10.21").level, "STATUS_READ");
    assert.equal(by("192.168.10.31").level, "DISCOVERED", "discovery is not a local session");
    assert.equal(by("192.168.10.33").level, "DISCOVERED", "a timeout lowers nothing and proves nothing");
    assert.equal(by("192.168.10.34").level, "DISCOVERED");
    assert.equal(by("192.168.10.21").allowed.command, false, "the probe never proves commands");
    // Identifiers only for those who manage rooms.
    const ro = await deviceRegistry({ pool, owner: o, includeRefs: false });
    assert.ok(ro.units.every((u) => u.refs === null));
    assert.ok(!JSON.stringify(ro).includes("192.168.10."), "no IP in the read-only view");
    // Two AUX units with the same module but different firmware are two models: nothing is inherited.
    const aux31 = by("192.168.10.31").id, aux34 = by("192.168.10.34").id, inv = by("192.168.10.21").id;
    assert.equal((await assignUnit({ pool, owner: o, unitId: aux31, model: { acBrand: "AUX", acModel: "ASW-H12", wifiModule: "CTTG-40X24-WIFI-AKS2", app: "AC Freedom", firmware: "1.0.1" } })).ok, true);
    await assignUnit({ pool, owner: o, unitId: aux34, model: { acBrand: "AUX", acModel: "ASW-H12", wifiModule: "CTTG-40X24-WIFI-AKS2", app: "AC Freedom", firmware: "1.2.0" } });
    await assignUnit({ pool, owner: o, unitId: inv, model: { acBrand: "Inventor", acModel: "Comfort", wifiModule: "EU-ODZ104", app: "Inventor Control" } });
    assert.equal((await assignUnit({ pool, owner: o, unitId: inv, model: { acBrand: "Inventor", acModel: "", wifiModule: "x" } })).error, "MODEL_REQUIRED");
    // A command test on the Inventor unit, with read-back.
    assert.equal((await recordEvidence({ pool, owner: o, unitId: aux31, level: "COMMAND_CONFIRMED", result: "PASS", method: "manual-test", detail: "δοκιμή εντολής χωρίς ανάγνωση", functions: {}, by: "N", now })).error, "PREVIOUS_LEVEL_NOT_PROVEN");
    assert.equal((await recordEvidence({ pool, owner: o, unitId: inv, level: "COMMAND_CONFIRMED", result: "PASS", method: "manual-test", detail: "εντολή setpoint 24 από τοπικό API, η μονάδα έδειξε 24", functions: { command: { name: "setpoint", value: 24 }, before: { setpoint: 26 }, after: { setpoint: 24 } }, by: "Nikos", now: now + 1000 })).ok, true);
    reg = await deviceRegistry({ pool, owner: o, includeRefs: true });
    assert.equal(reg.models.length, 3, "firmware 1.0.1 and 1.2.0 are separate models");
    const invModel = reg.models.find((m) => m.acBrand === "Inventor")!;
    assert.deepEqual(invModel.confirmedCommands, ["setpoint"]);
    assert.ok(invModel.confirmedRead.includes("setpoint (υποψήφιο)"), "probe DP mappings stay candidates");
    assert.equal(reg.units.find((u) => u.id === inv)!.level, "COMMAND_CONFIRMED");
    assert.ok(reg.models.filter((m) => m.acBrand === "AUX").every((m) => m.confirmedCommands.length === 0));
  } finally { await db.close(); }
});

// v198/v199 Device Compatibility Registry. The PMS never assumes that every AUX or every Inventor speaks the same
// protocol, nor that one working function means the others work: what it may do with an air conditioner is decided
// per installed UNIT and per FUNCTION, from current evidence recorded for that unit.
//
// Unit ladder — each level proven by its OWN test, in order:
//   DISCOVERED         the module answered a discovery on the hotel network;
//   AUTHENTICATED      a local session succeeded (BroadLink auth, Tuya local key accepted);
//   STATUS_READ        raw state was read from the unit (e.g. Tuya datapoints) — raw values, not yet their meaning;
//   COMMAND_CONFIRMED  at least one FUNCTION has a confirmed command (see below).
// Per function (power · setpoint · mode · fan; room_temperature is read-only):
//   read     the mapping of a raw value to the function is confirmed (e.g. DP 2 = setpoint, the unit showed 24 when
//            DP 2 read 24) — the probe only proposes candidates, it never confirms a mapping;
//   command  a command for THAT function was sent and a read-back showed the change; it can be REVOKED.
// Verification of every record: PROBE (AC Probe import) · MANUALLY_ATTESTED (a person entered what was observed) ·
// AUTOMATIC_READBACK_VERIFIED (the PMS itself recorded the command, the device's answer and a new read). Automatic use
// (e.g. a Temperature Guard) requires AUTOMATIC_READBACK_VERIFIED for that function; a manual attestation documents a
// pilot test but never authorises automatic control.
// Evidence expires (EVIDENCE_TTL_DAYS) and a firmware / module / model change forces revalidation: older successes stay
// in the history but no longer allow anything today. Results: PASS · FAIL · INCONCLUSIVE (no answer — never decides) ·
// REVOKED (a function permission withdrawn).
import { createHmac, createHash, randomUUID, timingSafeEqual } from "node:crypto";

export const LEVELS = ["DISCOVERED", "AUTHENTICATED", "STATUS_READ", "COMMAND_CONFIRMED"];
export const RESULTS = ["PASS", "FAIL", "INCONCLUSIVE", "REVOKED"];
export const FUNCTIONS = ["power", "setpoint", "mode", "fan", "room_temperature"];
export const COMMAND_FUNCTIONS = ["power", "setpoint", "mode", "fan"];
export const VERIFICATIONS = ["PROBE", "MANUALLY_ATTESTED", "AUTOMATIC_READBACK_VERIFIED"];
export const EVIDENCE_TTL_DAYS = { DISCOVERED: 30, AUTHENTICATED: 30, STATUS_READ: 30, READ_MAPPING: 90, COMMAND: 30 };
const DAY = 86_400_000;
/** v200: the largest clock difference accepted between the hotel's devices (probe host, staff) and the PMS. A record
 * dated later than the PMS clock is CLOCK_SKEW (never VERIFIED while it is ahead); one accepted with a skew is marked
 * time-uncertain for good and never authorises automatic control. */
export const CLOCK_SKEW_MS = 2 * 60_000;
/** v200 room-temperature calibration: the module's raw value × scale (°F converted) must agree with a documented
 * reference within the tolerance (at most 1.5 °C), both inside a plausible room range. */
export const TEMP_RULES = { maxToleranceC: 1.5, minC: 5, maxC: 45, methods: ["reference_thermometer", "wall_thermostat", "unit_display"] };
const rank = (l) => LEVELS.indexOf(l);
const byTime = (a, b) => Number(b.at) - Number(a.at) || Number(b.id ?? 0) - Number(a.id ?? 0);
const latestConclusive = (list) => list.filter((e) => e.result !== "INCONCLUSIVE").sort(byTime)[0] ?? null;

/** Is this (latest) record a current success: PASS, signed when automatic, not dated in the future, within its
 * validity, and after the last hardware/firmware change. */
function judge(e, ttlDays, now, revalidateAfter) {
  if (!e) return { state: "NOT_TESTED", lastVerifiedAt: null };
  if (Number(e.at) > now) return { state: "CLOCK_SKEW", lastVerifiedAt: null, at: Number(e.at), skewMs: Number(e.at) - now };
  if (e.verification === "AUTOMATIC_READBACK_VERIFIED" && e.signatureValid !== true) return { state: "SIGNATURE_INVALID", lastVerifiedAt: null, at: Number(e.at) };
  if (e.result !== "PASS") return { state: e.result === "REVOKED" ? "REVOKED" : "FAILED", lastVerifiedAt: null, at: Number(e.at) };
  const timeUncertain = Number(e.clockSkewMs ?? 0) > 0;
  const extra = timeUncertain ? { timeUncertain: true, skewMs: Number(e.clockSkewMs) } : {};
  if (revalidateAfter && Number(e.at) < Number(revalidateAfter)) return { state: "REVALIDATION_REQUIRED", lastVerifiedAt: Number(e.at), verification: e.verification, ...extra };
  if (now - Number(e.at) > ttlDays * DAY) return { state: "EXPIRED", lastVerifiedAt: Number(e.at), verification: e.verification, ...extra };
  return { state: "VERIFIED", lastVerifiedAt: Number(e.at), validUntil: Number(e.at) + ttlDays * DAY, verification: e.verification, ...extra };
}

/**
 * The full current state of one unit from its evidence: level, each level's state, and each function's read /
 * command state. `revalidateAfter`: time of the last firmware / module / model change (older evidence does not count).
 */
export function unitState(evidence = [], { now = Date.now(), revalidateAfter = null } = {}) {
  // Automatic records must carry a valid signature; deviceRegistry() sets signatureValid from the server key.
  const levels = {};
  let level = "NONE", chain = true;
  for (const l of ["DISCOVERED", "AUTHENTICATED", "STATUS_READ"]) {
    const j = judge(latestConclusive(evidence.filter((e) => e.level === l && !e.function)), EVIDENCE_TTL_DAYS[l], now, revalidateAfter);
    levels[l] = j;
    if (chain && j.state === "VERIFIED") level = l; else chain = false;
  }
  const functions = {};
  for (const f of FUNCTIONS) {
    const ok = rank(level) >= rank("STATUS_READ");
    const read = ok ? judge(latestConclusive(evidence.filter((e) => e.function === f && e.level === "STATUS_READ" && !e.functions?.remoteChange)), EVIDENCE_TTL_DAYS.READ_MAPPING, now, revalidateAfter) : { state: "NOT_TESTED", lastVerifiedAt: null };
    // v200: a change made on the physical remote and detected by the PMS itself (certified adapter).
    const remoteChange = ok && read.state === "VERIFIED" ? judge(latestConclusive(evidence.filter((e) => e.function === f && e.level === "STATUS_READ" && e.functions?.remoteChange)), EVIDENCE_TTL_DAYS.COMMAND, now, revalidateAfter) : { state: "NOT_TESTED", lastVerifiedAt: null };
    let command = { state: COMMAND_FUNCTIONS.includes(f) ? "NOT_TESTED" : "NOT_APPLICABLE", lastVerifiedAt: null };
    if (COMMAND_FUNCTIONS.includes(f) && read.state === "VERIFIED") command = judge(latestConclusive(evidence.filter((e) => e.function === f && e.level === "COMMAND_CONFIRMED")), EVIDENCE_TTL_DAYS.COMMAND, now, revalidateAfter);
    functions[f] = { read, remoteChange, command };
  }
  const confirmed = COMMAND_FUNCTIONS.filter((f) => functions[f].command.state === "VERIFIED");
  levels.COMMAND_CONFIRMED = confirmed.length ? { state: "VERIFIED", functions: confirmed } : { state: "NOT_TESTED" };
  if (level === "STATUS_READ" && confirmed.length) level = "COMMAND_CONFIRMED";
  const timeUncertain = ["DISCOVERED", "AUTHENTICATED", "STATUS_READ"].some((l) => levels[l].timeUncertain);
  return { level, levels, functions, timeUncertain };
}

/** Backwards-compatible: the unit's highest current level. */
export const provenLevel = (evidence, opts) => unitState(evidence, opts).level;

/**
 * What the PMS may do with THIS unit, per function — never «commands: true» for the whole device:
 *   read[f]        the mapping of f is confirmed and current;
 *   commands[f]    null, or how the command of f was verified (MANUALLY_ATTESTED / AUTOMATIC_READBACK_VERIFIED);
 *   automation[f]  automatic use (e.g. Temperature Guard) — only with AUTOMATIC_READBACK_VERIFIED.
 */
export function allowedOperations(state) {
  const read = {}, commands = {}, automation = {}, guard = {};
  for (const f of FUNCTIONS) {
    read[f] = state.functions[f].read.state === "VERIFIED";
    if (!COMMAND_FUNCTIONS.includes(f)) continue;
    const { read: r, remoteChange: rc, command: c } = state.functions[f];
    commands[f] = c.state === "VERIFIED" ? c.verification : null;
    // v200 Temperature Guard order (each step its own record): 1) the function is read, 2) a change made on the
    // physical remote is detected by the PMS, 3) a test command from the PMS is accepted, 4) a NEW read confirms it —
    // 2–4 produced by a certified adapter (signed), none time-uncertain.
    guard[f] = [
      { step: "read", ok: r.state === "VERIFIED" && !r.timeUncertain },
      { step: "remote_change_detected", ok: rc.state === "VERIFIED" && rc.verification === "AUTOMATIC_READBACK_VERIFIED" && !rc.timeUncertain },
      { step: "test_command_readback", ok: c.state === "VERIFIED" && c.verification === "AUTOMATIC_READBACK_VERIFIED" && !c.timeUncertain },
    ];
    automation[f] = !state.timeUncertain && guard[f].every((g) => g.ok);
  }
  return { read, commands, automation, guard };
}

const meaningful = (t) => String(t ?? "").trim().length >= 10 && (String(t).match(/\p{L}/gu) ?? []).length >= 5;
const present = (v) => v !== null && v !== undefined && v !== "";
const ts = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * The ONE validation every record passes — probe import, a person's entry, the PMS's own automatic test. Returns
 * null when valid, else an error code. `state` is the unit's current state (unitState).
 */
export function validateEvidence(ev, state = unitState([])) {
  if (!LEVELS.includes(ev.level)) return "INVALID_LEVEL";
  if (!RESULTS.includes(ev.result)) return "INVALID_RESULT";
  if (!VERIFICATIONS.includes(ev.verification)) return "INVALID_VERIFICATION";
  if (!String(ev.method ?? "").trim()) return "METHOD_REQUIRED";
  const fn = ev.function ?? "";
  if (fn && !FUNCTIONS.includes(fn)) return "INVALID_FUNCTION";
  if (ev.level === "COMMAND_CONFIRMED" && !fn) return "FUNCTION_REQUIRED";
  if (ev.level === "COMMAND_CONFIRMED" && !COMMAND_FUNCTIONS.includes(fn)) return "NOT_A_COMMAND_FUNCTION";
  if (fn && !["STATUS_READ", "COMMAND_CONFIRMED"].includes(ev.level)) return "FUNCTION_ONLY_FOR_READ_OR_COMMAND";
  if (ev.result === "REVOKED" && !fn) return "REVOKE_NEEDS_FUNCTION";
  if (ev.verification !== "PROBE" && !meaningful(ev.detail)) return "DETAIL_REQUIRED";
  if (ev.result !== "PASS") return null;
  const f = ev.functions ?? {};
  if (!fn) {
    // Unit levels, in order.
    const below = LEVELS[rank(ev.level) - 1];
    if (below && rank(state.level) < rank(below)) return "PREVIOUS_LEVEL_NOT_PROVEN";
    if (ev.level === "COMMAND_CONFIRMED") return "FUNCTION_REQUIRED";
    if (ev.level === "STATUS_READ") {
      const raw = f.raw && typeof f.raw === "object" ? Object.values(f.raw).filter(present) : [];
      if (!raw.length) return "VALUES_REQUIRED";
    }
    return null;
  }
  if (rank(state.level) < rank("STATUS_READ")) return "PREVIOUS_LEVEL_NOT_PROVEN";
  if (ev.verification === "PROBE") return "PROBE_CANNOT_CONFIRM_FUNCTIONS";
  if (ev.level === "STATUS_READ") {
    // A confirmed mapping: which raw value, what it read, and what the unit itself showed at the same time.
    if (f.remoteChange) {
      // Only the PMS's own certified adapter can say it detected a change made on the remote.
      if (ev.verification !== "AUTOMATIC_READBACK_VERIFIED") return "REMOTE_CHANGE_NEEDS_ADAPTER";
      const x = f.remoteChange;
      if (!x.before || !x.after || !present(x.before.value) || !present(x.after.value) || !ts(x.before.at) || !ts(x.after.at)) return "REMOTE_CHANGE_INCOMPLETE";
      if (ts(x.after.at) < ts(x.before.at)) return "REMOTE_CHANGE_OUT_OF_ORDER";
      if (String(x.before.value) === String(x.after.value)) return "NO_CHANGE_OBSERVED";
      if (!x.before.deviceId || x.before.deviceId !== x.after.deviceId) return "DEVICE_IDENTITY_MISMATCH";
      return null;
    }
    const m = f.mapping;
    if (!m || !present(m.value) || !present(m.observed)) return "MAPPING_REQUIRED";
    return mappingError(fn, m);
  }
  // COMMAND_CONFIRMED for one function: its read must be confirmed first (the read-back depends on it).
  if (state.functions[fn]?.read.state !== "VERIFIED") return "FUNCTION_READ_NOT_CONFIRMED";
  const c = f.command;
  if (!c || !present(c.value)) return "COMMAND_REQUIRED";
  if (!f.before || !f.after || !present(f.before.value) || !present(f.after.value)) return "READBACK_REQUIRED";
  if (String(f.after.value) !== String(c.value)) return "READBACK_DOES_NOT_MATCH";
  if (String(f.before.value) === String(c.value)) return "NO_CHANGE_OBSERVED";
  if (ev.verification === "AUTOMATIC_READBACK_VERIFIED") {
    // The PMS's own record: the read before, the command sent, the device's answer and a NEW read, in that order.
    const r = f.request, a = f.response;
    if (!r || !a || !ts(f.before.at) || !ts(r.at) || !ts(a.at) || !ts(f.after.at)) return "AUTOMATIC_RECORD_INCOMPLETE";
    if (!(ts(f.before.at) <= ts(r.at) && ts(r.at) <= ts(a.at) && ts(a.at) <= ts(f.after.at))) return "AUTOMATIC_RECORD_OUT_OF_ORDER";
    if (a.ok !== true) return "DEVICE_DID_NOT_ACCEPT";
  }
  return null;
}

/** v200: numeric functions are compared after the documented scale / unit; room temperature needs a calibration. */
function mappingError(fn, m) {
  if (!["setpoint", "room_temperature"].includes(fn)) return String(m.value) === String(m.observed) ? null : "MAPPING_DOES_NOT_MATCH";
  const scale = m.scale === undefined || m.scale === "" ? 1 : Number(m.scale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 10) return "INVALID_SCALE";
  const unit = m.unit ?? "C";
  if (!["C", "F"].includes(unit)) return "INVALID_UNIT";
  const raw = Number(m.value), observed = Number(m.observed);
  if (!Number.isFinite(raw) || !Number.isFinite(observed)) return "MAPPING_NOT_NUMERIC";
  const scaled = raw * scale, celsius = unit === "F" ? (scaled - 32) * 5 / 9 : scaled;
  if (celsius < TEMP_RULES.minC || celsius > TEMP_RULES.maxC || observed < TEMP_RULES.minC || observed > TEMP_RULES.maxC) return "TEMPERATURE_OUT_OF_RANGE";
  if (fn === "setpoint") return Math.abs(celsius - observed) <= 0.01 ? null : "MAPPING_DOES_NOT_MATCH";
  if (!TEMP_RULES.methods.includes(m.method)) return "CALIBRATION_METHOD_REQUIRED";
  const tol = Number(m.tolerance);
  if (!Number.isFinite(tol) || tol <= 0) return "TOLERANCE_REQUIRED";
  if (tol > TEMP_RULES.maxToleranceC) return "TOLERANCE_TOO_WIDE";
  return Math.abs(celsius - observed) <= tol ? null : "TEMPERATURE_OUTSIDE_TOLERANCE";
}

const parseProbeTime = (s, fallback) => {
  const m = String(s ?? "").match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)([+-]\d\d)(\d\d)$/);
  const t = Date.parse(m ? `${m[1]}${m[2]}:${m[3]}` : String(s ?? ""));
  return Number.isFinite(t) ? t : fallback;
};

/**
 * The records an AC Probe report (v4+, the PROTECTED full report — the shareable copy has no identifiers) proposes for
 * each device. Pure; nothing here is trusted until validateEvidence() accepts it. Raw datapoints are STATUS_READ
 * evidence; the probe's guesses of what they mean are kept as `candidates` only — never a confirmed function.
 */
export function probeEvidence(report) {
  if (report?.tool !== "corali-ac-probe" || Number(report.version) < 4) return { error: "NOT_AN_AC_PROBE_REPORT_V4" };
  if (!Array.isArray(report.devices) || report.devices.some((d) => !d.ip)) return { error: "SHAREABLE_REPORT_HAS_NO_IDENTIFIERS" };
  const method = `ac-probe v${report.version}`;
  return {
    devices: report.devices.map((d) => {
      const tuyaId = d.tuya?.device_id ?? (d.tuya_read?.ok ? d.tuya_read.device_id : null);
      const unitKey = tuyaId ? `tuya:${tuyaId}` : d.mac ? `mac:${String(d.mac).toLowerCase()}` : `ip:${d.ip}`;
      const protocol = d.tuya || d.tuya_read ? `Tuya${d.tuya?.version ? ` v${d.tuya.version}` : d.tuya_read?.version ? ` v${d.tuya_read.version}` : ""}` : d.broadlink ? `BroadLink ${d.broadlink.devtype ?? ""}`.trim() : "";
      const ev = [];
      const add = (level, result, detail, functions = {}) => ev.push({ level, result, method, verification: "PROBE", function: "", detail: String(detail ?? "").slice(0, 300), functions });
      if (d.level && d.level !== "NONE") add("DISCOVERED", "PASS", d.tuya ? "εκπομπή Tuya στο δίκτυο" : d.broadlink ? "απάντηση σε ανακάλυψη BroadLink" : "ανοιχτή θύρα τοπικού πρωτοκόλλου");
      if (d.access === "AUTHENTICATED") add("AUTHENTICATED", "PASS", d.access_reason);
      else if (d.access === "AUTH_FAILED" || d.access === "LOCAL_LOCKED") add("AUTHENTICATED", "FAIL", d.access_reason);
      else if (d.access === "NETWORK_ERROR") add("AUTHENTICATED", "INCONCLUSIVE", d.access_reason);
      if (d.tuya_read?.ok) add("STATUS_READ", "PASS", "ακατέργαστα datapoints διαβάστηκαν τοπικά — η σημασία τους (θερμοκρασία, power, mode) δεν έχει επιβεβαιωθεί", { raw: d.tuya_read.dps ?? {}, candidates: d.tuya_read.candidates ?? {} });
      return { unitKey, refs: { ip: d.ip, mac: d.mac ?? null, tuyaDeviceId: tuyaId, productKey: d.tuya?.product_key ?? null }, detected: { moduleVendor: d.module_vendor ?? null, protocol }, evidence: ev };
    }),
  };
}

const parse = (s) => { try { return JSON.parse(String(s ?? "{}")); } catch { return {}; } };
const rowToEvidence = (e) => ({ id: Number(e.id), unitId: Number(e.unit_id), level: String(e.level), function: String(e.function ?? ""), result: String(e.result), method: String(e.method), verification: String(e.verification || "MANUALLY_ATTESTED"), detail: String(e.detail), functions: parse(e.functions_json), functionsJson: String(e.functions_json ?? "{}"), by: String(e.recorded_by), at: Number(e.at), clockSkewMs: Number(e.clock_skew_ms ?? 0), commandId: String(e.command_id ?? ""), adapter: String(e.adapter ?? ""), signature: String(e.signature ?? "") });

/** v200: an automatic record is signed with a server-side key (never held by the browser or the API caller). */
const canonical = (owner, unitId, e) => JSON.stringify([owner, Number(unitId), e.level, e.function ?? "", e.result, e.method, e.verification, Number(e.at), e.commandId ?? "", e.adapter ?? "", e.functionsJson]);
export const signEvidence = (key, owner, unitId, e) => createHmac("sha256", String(key)).update(canonical(owner, unitId, e)).digest("hex");
export function signatureValid(key, owner, unitId, e) {
  if (!key || String(key).length < 16 || !/^[0-9a-f]{64}$/.test(e.signature ?? "")) return false;
  const a = Buffer.from(signEvidence(key, owner, unitId, e), "hex"), b = Buffer.from(e.signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
async function loadUnit(pool, owner, unitId, { lock = false } = {}) {
  const u = (await pool.query(`SELECT * FROM device_compat_units WHERE owner_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [owner, unitId])).rows[0];
  if (!u) return null;
  const ev = (await pool.query(`SELECT * FROM device_compat_evidence WHERE owner_id=$1 AND unit_id=$2`, [owner, unitId])).rows.map(rowToEvidence);
  return { unit: u, evidence: ev };
}
/** Inserts one record. With a fingerprint the database itself guarantees it is stored once (unique index). */
async function insertEvidence(pool, owner, unitId, e, by, at, { fingerprint = null, signingKey = null } = {}) {
  const functionsJson = JSON.stringify(e.functions ?? {});
  const rec = { ...e, at, functionsJson };
  const signature = e.verification === "AUTOMATIC_READBACK_VERIFIED" ? signEvidence(signingKey, owner, unitId, rec) : "";
  const r = await pool.query(
    `INSERT INTO device_compat_evidence(owner_id,unit_id,level,result,method,detail,functions_json,recorded_by,at,function,verification,fingerprint,clock_skew_ms,command_id,adapter,signature)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(owner_id,fingerprint) DO NOTHING`,
    [owner, unitId, e.level, e.result, String(e.method).slice(0, 80), String(e.detail ?? "").trim().slice(0, 300), functionsJson, String(by).slice(0, 80), at, e.function ?? "", e.verification, fingerprint, Math.max(0, Number(e.clockSkewMs ?? 0)), e.commandId ?? "", e.adapter ?? "", signature],
  );
  return r.rowCount ?? 0;
}
/** One transaction (own connection when the pool has one). */
async function inTransaction(pool, fn) {
  const c = typeof pool.connect === "function" ? await pool.connect() : pool;
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) { await c.query("ROLLBACK").catch(() => undefined); throw e; } finally { c.release?.(); }
}

/**
 * Imports a probe report. Per device, one transaction with the unit row locked: every proposed record passes
 * validateEvidence() against the unit's state at that point (refused records are reported, not stored) and is stored
 * once by its fingerprint — two imports of the same report at the same time store it once (unique index).
 * The report's time must not be ahead of the PMS clock by more than CLOCK_SKEW_MS; a smaller skew is recorded and makes
 * those records time-uncertain (never used for automatic control).
 */
export async function importProbeReport({ pool, owner, report, by, now = Date.now() }) {
  const parsed = probeEvidence(report);
  if (parsed.error) return { ok: false, error: parsed.error };
  const at = parseProbeTime(report.at, now), skew = at - now;
  if (skew > CLOCK_SKEW_MS) return { ok: false, error: "REPORT_IN_THE_FUTURE", skewMs: skew };
  const clockSkewMs = skew > 0 ? skew : 0;
  let units = 0, added = 0;
  const rejected = [];
  for (const d of parsed.devices) {
    await inTransaction(pool, async (c) => {
      const u = (await c.query(
        `INSERT INTO device_compat_units(owner_id,unit_key,refs_json,label,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)
         ON CONFLICT(owner_id,unit_key) DO UPDATE SET refs_json=$3,updated_at=$5 RETURNING id`,
        [owner, d.unitKey, JSON.stringify({ ...d.refs, detected: d.detected }), d.detected.moduleVendor ?? "", now],
      )).rows[0];
      const cur = await loadUnit(c, owner, u.id, { lock: true });
      const evidence = cur.evidence.map((e) => ({ ...e, signatureValid: false }));
      for (const e of d.evidence) {
        const state = unitState(evidence, { now: Math.max(now, at), revalidateAfter: cur.unit.revalidate_after });
        const error = validateEvidence(e, state);
        if (error) { rejected.push({ unitKey: d.unitKey, level: e.level, error }); continue; }
        const fingerprint = createHash("sha256").update(JSON.stringify([d.unitKey, e.level, e.function ?? "", e.method, at])).digest("hex");
        added += await insertEvidence(c, owner, u.id, { ...e, clockSkewMs }, by, at, { fingerprint });
        evidence.push({ ...e, at, id: Number.MAX_SAFE_INTEGER });
      }
    });
    units++;
  }
  return { ok: true, units, evidence: added, rejected, ...(clockSkewMs ? { clockSkewMs } : {}) };
}

/**
 * A person records a test. Always MANUALLY_ATTESTED (what a person observed) — the API cannot claim an automatic
 * verification. Validated by the same rules as every other record.
 */
export async function recordEvidence({ pool, owner, unitId, level, result, method, detail, function: fn = "", functions = {}, by, now = Date.now() }) {
  const cur = await loadUnit(pool, owner, unitId);
  if (!cur) return { ok: false, error: "UNIT_NOT_FOUND" };
  const e = { level, result, method, detail, function: fn, functions, verification: "MANUALLY_ATTESTED" };
  const error = validateEvidence(e, unitState(cur.evidence, { now, revalidateAfter: cur.unit.revalidate_after }));
  if (error) return { ok: false, error };
  await insertEvidence(pool, owner, unitId, e, by, now);
  return { ok: true };
}

/** Withdraws one function's command permission (e.g. after a wrong behaviour). Recorded, never deleted. */
export const revokeFunction = ({ pool, owner, unitId, function: fn, detail, by, now = Date.now() }) =>
  recordEvidence({ pool, owner, unitId, level: "COMMAND_CONFIRMED", result: "REVOKED", method: "revocation", detail, function: fn, by, now });

// ── v200 certified adapters ────────────────────────────────────────────────────────────────────────────────────
// Automatic evidence is produced ONLY here, by talking to the device through a certified adapter — never from values a
// caller supplies. An adapter is code of the PMS (registered at start-up, not reachable from the API):
//   read(refs)                     → { deviceId, values: { [function]: value }, at }
//   send(refs, fn, value, cmdId)   → { ok, commandId, at }
// The record is accepted only when the before / after reads come from the SAME physical unit (deviceId = the unit's
// registered identity), the device's answer carries the command id that was sent, and the new read shows the value.
// It is signed with the server key; a record whose signature does not verify never counts.
// No adapter is registered in this release: there is no certified AUX / Inventor driver yet.
const ADAPTERS = new Map();
export function registerAdapter(name, impl) {
  if (!/^[a-z0-9-]{2,40}$/.test(String(name)) || typeof impl?.read !== "function" || typeof impl?.send !== "function") throw Error("INVALID_ADAPTER");
  ADAPTERS.set(name, impl);
}
export const registeredAdapters = () => [...ADAPTERS.keys()];
const identityOf = (refs) => refs?.tuyaDeviceId || refs?.mac || null;
async function adapterContext({ pool, owner, unitId, adapter, signingKey }) {
  if (!signingKey || String(signingKey).length < 16) return { error: "SIGNING_KEY_REQUIRED" };
  const impl = ADAPTERS.get(adapter);
  if (!impl) return { error: "NO_CERTIFIED_ADAPTER" };
  const cur = await loadUnit(pool, owner, unitId);
  if (!cur) return { error: "UNIT_NOT_FOUND" };
  const refs = parse(cur.unit.refs_json), identity = identityOf(refs);
  if (!identity) return { error: "UNIT_HAS_NO_IDENTITY" };
  return { impl, cur, refs, identity };
}
// The order of the steps is timed by the PMS clock (`at`); the device's own time is kept apart (`deviceAt`) — the two
// clocks are never compared with each other.
const readFrom = async (impl, refs, identity, fn, now) => {
  const r = await impl.read(refs);
  if (!r || r.deviceId !== identity) return { error: "DEVICE_IDENTITY_MISMATCH" };
  return { value: r.values?.[fn], at: now(), deviceAt: Number(r.at) || null, deviceId: r.deviceId };
};
const stateFor = (cur, now, owner, signingKey) => unitState(cur.evidence.map((e) => ({ ...e, signatureValid: signatureValid(signingKey, owner, e.unitId, e) })), { now, revalidateAfter: cur.unit.revalidate_after });

/** A command test by the PMS itself: read → command (with id) → device answer → new read; signed. */
export async function runAdapterCommandTest({ pool, owner, unitId, adapter, function: fn, value, signingKey, now = () => Date.now(), settle = async () => {} }) {
  const ctx = await adapterContext({ pool, owner, unitId, adapter, signingKey });
  if (ctx.error) return { ok: false, error: ctx.error };
  const before = await readFrom(ctx.impl, ctx.refs, ctx.identity, fn, now);
  if (before.error) return { ok: false, error: before.error };
  const commandId = randomUUID(), request = { at: now(), commandId, value };
  const sent = await ctx.impl.send(ctx.refs, fn, value, commandId);
  if (!sent || sent.commandId !== commandId) return { ok: false, error: "COMMAND_ID_MISMATCH" };
  const response = { ...sent, deviceAt: Number(sent.at) || null, at: now() };
  await settle();
  const after = await readFrom(ctx.impl, ctx.refs, ctx.identity, fn, now);
  if (after.error) return { ok: false, error: after.error };
  const e = { level: "COMMAND_CONFIRMED", result: "PASS", method: `adapter:${adapter}`, verification: "AUTOMATIC_READBACK_VERIFIED", function: fn, adapter, commandId,
    detail: `δοκιμή ${fn} = ${value} από το PMS, εντολή ${commandId.slice(0, 8)}`, functions: { command: { value }, before, request, response: { ok: response.ok === true, commandId: response.commandId, at: response.at, deviceAt: response.deviceAt }, after } };
  const at = now(), error = validateEvidence(e, stateFor(ctx.cur, at, owner, signingKey));
  // A refused readback is itself evidence: stored as a signed FAIL, so the function is not allowed.
  const stored = error && !["FUNCTION_READ_NOT_CONFIRMED", "PREVIOUS_LEVEL_NOT_PROVEN", "NOT_A_COMMAND_FUNCTION"].includes(error) ? { ...e, result: "FAIL", detail: `${e.detail} — ${error}` } : error ? null : e;
  if (stored) await insertEvidence(pool, owner, unitId, stored, "pms-adapter", at, { signingKey });
  return error ? { ok: false, error, recorded: Boolean(stored) } : { ok: true, commandId };
}

/** Step 2 of the Temperature Guard order: a person changes the value on the physical remote; the PMS detects it. */
export async function observeRemoteChange({ pool, owner, unitId, adapter, function: fn, signingKey, waitForChange, now = () => Date.now() }) {
  const ctx = await adapterContext({ pool, owner, unitId, adapter, signingKey });
  if (ctx.error) return { ok: false, error: ctx.error };
  const before = await readFrom(ctx.impl, ctx.refs, ctx.identity, fn, now);
  if (before.error) return { ok: false, error: before.error };
  await waitForChange();
  const after = await readFrom(ctx.impl, ctx.refs, ctx.identity, fn, now);
  if (after.error) return { ok: false, error: after.error };
  const e = { level: "STATUS_READ", result: "PASS", method: `adapter:${adapter}`, verification: "AUTOMATIC_READBACK_VERIFIED", function: fn, adapter, detail: `αλλαγή από το τηλεχειριστήριο εντοπίστηκε: ${before.value} → ${after.value}`, functions: { remoteChange: { before, after } } };
  const at = now(), error = validateEvidence(e, stateFor(ctx.cur, at, owner, signingKey));
  if (error) return { ok: false, error };
  await insertEvidence(pool, owner, unitId, e, "pms-adapter", at, { signingKey });
  return { ok: true };
}

/** Firmware update, module replaced, protocol changed: every earlier success stops counting (history kept). */
export async function markHardwareChange({ pool, owner, unitId, reason, now = Date.now() }) {
  if (!meaningful(reason)) return { ok: false, error: "DETAIL_REQUIRED" };
  const r = await pool.query(`UPDATE device_compat_units SET revalidate_after=$3,revalidate_reason=$4,updated_at=$3 WHERE owner_id=$1 AND id=$2`, [owner, unitId, now, String(reason).trim().slice(0, 200)]);
  return r.rowCount ? { ok: true } : { ok: false, error: "UNIT_NOT_FOUND" };
}

const clean = (v) => String(v ?? "").trim().slice(0, 80);
async function upsertModel(pool, owner, model, now, extra = {}) {
  const m = { ac_brand: clean(model?.acBrand), ac_model: clean(model?.acModel), wifi_module: clean(model?.wifiModule), app: clean(model?.app), firmware: clean(model?.firmware), protocol: clean(model?.protocol) };
  if (!m.ac_brand || !m.ac_model || !m.wifi_module) return null;
  return (await pool.query(
    `INSERT INTO device_compat_models(owner_id,ac_brand,ac_model,wifi_module,app,firmware,protocol,target_level,installed,plan,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
     ON CONFLICT(owner_id,ac_brand,ac_model,wifi_module,app,firmware) DO UPDATE SET protocol=CASE WHEN EXCLUDED.protocol<>'' THEN EXCLUDED.protocol ELSE device_compat_models.protocol END,updated_at=$11 RETURNING id`,
    [owner, m.ac_brand, m.ac_model, m.wifi_module, m.app, m.firmware, m.protocol, extra.targetLevel ?? "", extra.installed === false ? 0 : 1, String(extra.plan ?? "").slice(0, 300), now],
  )).rows[0];
}

/**
 * Sets a unit's model (A/C + module + app + firmware — a different firmware is a different model) and room. Moving a
 * unit that already had a model to ANOTHER model (new firmware, replaced module) forces revalidation.
 */
export async function assignUnit({ pool, owner, unitId, model, roomId = null, label = "", now = Date.now() }) {
  const row = await upsertModel(pool, owner, model, now);
  if (!row) return { ok: false, error: "MODEL_REQUIRED" };
  const prev = (await pool.query(`SELECT model_id FROM device_compat_units WHERE owner_id=$1 AND id=$2`, [owner, unitId])).rows[0];
  if (!prev) return { ok: false, error: "UNIT_NOT_FOUND" };
  const changed = prev.model_id !== null && prev.model_id !== undefined && Number(prev.model_id) !== Number(row.id);
  await pool.query(
    `UPDATE device_compat_units SET model_id=$3,room_id=$4,label=CASE WHEN $5<>'' THEN $5 ELSE label END,updated_at=$6${changed ? ",revalidate_after=$6,revalidate_reason='αλλαγή μοντέλου / firmware / module'" : ""} WHERE owner_id=$1 AND id=$2`,
    [owner, unitId, row.id, roomId, clean(label), now],
  );
  return { ok: true, modelId: Number(row.id), revalidationRequired: changed };
}

/** The Hotel Corali modules and the first goal for each (catalogue rows; brand/model completed when known). */
export const HOTEL_MODULES = [
  { acBrand: "AUX", acModel: "εγκατεστημένο (μοντέλο προς συμπλήρωση)", wifiModule: "CTTG-40X24-WIFI-AKS2", app: "AC Freedom", protocol: "BroadLink (υπό επιβεβαίωση)", targetLevel: "STATUS_READ", installed: true, plan: "Discovery, τοπική σύνδεση (authentication) και ανάγνωση κατάστασης AUX" },
  { acBrand: "Inventor", acModel: "εγκατεστημένο (μοντέλο προς συμπλήρωση)", wifiModule: "EU-ODZ104", app: "Inventor Control", protocol: "Tuya (υπό επιβεβαίωση)", targetLevel: "STATUS_READ", installed: true, plan: "Εντοπισμός πρωτοκόλλου Inventor και δοκιμή τοπικής ανάγνωσης" },
  { acBrand: "—", acModel: "μη εγκατεστημένο", wifiModule: "CTT-WIFI-BL3353-P", app: "", protocol: "", targetLevel: "DISCOVERED", installed: false, plan: "Δοκιμή μετά την εγκατάσταση" },
  { acBrand: "—", acModel: "μη εγκατεστημένο", wifiModule: "MDWBRCU1", app: "Smart Life", protocol: "", targetLevel: "DISCOVERED", installed: false, plan: "Δοκιμή μετά την εγκατάσταση" },
];
export async function seedHotelModules({ pool, owner, now = Date.now() }) {
  let n = 0;
  for (const m of HOTEL_MODULES) if (await upsertModel(pool, owner, m, now, m)) n++;
  return { ok: true, models: n };
}

/** The registry: models with what is CURRENTLY proven on their units, every unit with its state, permissions and history. */
export async function deviceRegistry({ pool, owner, includeRefs = false, now = Date.now(), signingKey = null }) {
  const [models, units, evidence, rooms] = await Promise.all([
    pool.query(`SELECT * FROM device_compat_models WHERE owner_id=$1 ORDER BY installed DESC,ac_brand,ac_model,firmware`, [owner]).then((r) => r.rows),
    pool.query(`SELECT * FROM device_compat_units WHERE owner_id=$1 ORDER BY id`, [owner]).then((r) => r.rows),
    pool.query(`SELECT * FROM device_compat_evidence WHERE owner_id=$1 ORDER BY at,id`, [owner]).then((r) => r.rows),
    pool.query(`SELECT id,code FROM rooms WHERE owner_id=$1`, [owner]).then((r) => r.rows),
  ]);
  const outUnits = units.map((u) => {
    const ev = evidence.filter((e) => Number(e.unit_id) === Number(u.id)).map(rowToEvidence).map((e) => ({ ...e, signatureValid: e.verification === "AUTOMATIC_READBACK_VERIFIED" ? signatureValid(signingKey, owner, u.id, e) : undefined }));
    const state = unitState(ev, { now, revalidateAfter: u.revalidate_after });
    const refs = parse(u.refs_json);
    const candidates = ev.filter((e) => e.level === "STATUS_READ" && !e.function && e.result === "PASS").sort(byTime)[0]?.functions.candidates ?? {};
    return {
      id: Number(u.id), label: String(u.label), modelId: u.model_id ? Number(u.model_id) : null, roomId: u.room_id ? Number(u.room_id) : null,
      room: rooms.find((r) => Number(r.id) === Number(u.room_id))?.code ?? null, detected: refs.detected ?? {},
      level: state.level, levels: state.levels, functions: state.functions, allowed: allowedOperations(state), candidates, timeUncertain: state.timeUncertain,
      revalidation: u.revalidate_after ? { at: Number(u.revalidate_after), reason: String(u.revalidate_reason ?? "") } : null,
      refs: includeRefs ? { ip: refs.ip ?? null, mac: refs.mac ?? null, tuyaDeviceId: refs.tuyaDeviceId ?? null } : null,
      evidence: ev.slice(-30).map((e) => { const out = { ...e, signed: Boolean(e.signature) }; delete out.functionsJson; delete out.signature; return out; }),
    };
  });
  const outModels = models.map((m) => {
    const mine = outUnits.filter((u) => u.modelId === Number(m.id));
    const byLevel = Object.fromEntries(["NONE", ...LEVELS].map((l) => [l, mine.filter((u) => u.level === l).length]));
    const confirmedRead = FUNCTIONS.filter((f) => mine.some((u) => u.allowed.read[f]));
    const confirmedCommands = COMMAND_FUNCTIONS.filter((f) => mine.some((u) => u.allowed.commands[f])).map((f) => ({ function: f, automatic: mine.some((u) => u.allowed.automation[f]) }));
    return { id: Number(m.id), acBrand: String(m.ac_brand), acModel: String(m.ac_model), wifiModule: String(m.wifi_module), app: String(m.app), firmware: String(m.firmware), protocol: String(m.protocol), targetLevel: String(m.target_level ?? ""), installed: Number(m.installed ?? 1) === 1, plan: String(m.plan ?? ""), units: mine.length, byLevel, confirmedRead, confirmedCommands, targetReached: m.target_level ? mine.some((u) => rank(u.level) >= rank(String(m.target_level))) : null };
  });
  return { levels: LEVELS, functions: FUNCTIONS, ttlDays: EVIDENCE_TTL_DAYS, models: outModels, units: outUnits };
}

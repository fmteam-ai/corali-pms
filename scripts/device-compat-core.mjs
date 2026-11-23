// v198 Device Compatibility Registry. The PMS never assumes that every AUX or every Inventor speaks the same protocol:
// what it may do with an air conditioner is decided per installed UNIT from the evidence recorded for that unit, and
// the catalogue per MODEL (A/C model + Wi-Fi module + app + firmware) only summarises what was proven on its units.
//
// Compatibility ladder — each level proven by its OWN test, in order:
//   DISCOVERED         the module answered a discovery on the hotel network (AC Probe);
//   AUTHENTICATED      a local session succeeded (BroadLink auth, Tuya local key accepted);
//   STATUS_READ        the unit's state was read (power / setpoint / room temperature / mode);
//   COMMAND_CONFIRMED  a command was sent AND a read-back confirmed the change (recorded by a person after a test —
//                      the AC Probe never sends commands, so it can never claim this level).
// Results: PASS, FAIL, INCONCLUSIVE (no answer / network error — says nothing either way, never lowers a level).
// A level counts only while its latest conclusive test passed and every level below it is proven.
export const LEVELS = ["DISCOVERED", "AUTHENTICATED", "STATUS_READ", "COMMAND_CONFIRMED"];
export const RESULTS = ["PASS", "FAIL", "INCONCLUSIVE"];

/** The highest proven level from a unit's evidence (any order). "NONE" when not even discovery is proven. */
export function provenLevel(evidence = []) {
  let level = "NONE";
  for (const l of LEVELS) {
    const latest = evidence.filter((e) => e.level === l && e.result !== "INCONCLUSIVE").sort((a, b) => Number(b.at) - Number(a.at) || Number(b.id ?? 0) - Number(a.id ?? 0))[0];
    if (!latest || latest.result !== "PASS") break;
    level = l;
  }
  return level;
}
const rank = (l) => LEVELS.indexOf(l);

/** What the PMS may do with THIS unit — from its own level only, never from the brand or another unit. */
export function allowedOperations(level) {
  return { read: rank(level) >= rank("STATUS_READ"), command: level === "COMMAND_CONFIRMED" };
}

const meaningful = (t) => String(t ?? "").trim().length >= 10 && (String(t).match(/\p{L}/gu) ?? []).length >= 5;

/**
 * Checks one test record before it is stored. Returns null when valid, else an error code.
 * STATUS_READ PASS needs the values read; COMMAND_CONFIRMED PASS needs the command and a read before and after that
 * shows the commanded value only after (the change itself is the proof). A PASS needs every lower level proven.
 */
export function validateEvidence(ev, currentLevel = "NONE") {
  if (!LEVELS.includes(ev.level)) return "INVALID_LEVEL";
  if (!RESULTS.includes(ev.result)) return "INVALID_RESULT";
  if (!String(ev.method ?? "").trim()) return "METHOD_REQUIRED";
  if (ev.manual && !meaningful(ev.detail)) return "DETAIL_REQUIRED";
  if (ev.result !== "PASS") return null;
  const below = LEVELS[rank(ev.level) - 1];
  if (below && rank(currentLevel) < rank(below)) return "PREVIOUS_LEVEL_NOT_PROVEN";
  const f = ev.functions ?? {};
  if (ev.level === "STATUS_READ") {
    const read = f.read && typeof f.read === "object" ? Object.entries(f.read).filter(([, v]) => v !== null && v !== undefined && v !== "") : [];
    if (!read.length) return "VALUES_REQUIRED";
  }
  if (ev.level === "COMMAND_CONFIRMED") {
    const c = f.command;
    if (!c || !String(c.name ?? "").trim() || c.value === undefined) return "COMMAND_REQUIRED";
    if (!f.before || !f.after || !(c.name in f.before) || !(c.name in f.after)) return "READBACK_REQUIRED";
    if (String(f.after[c.name]) !== String(c.value)) return "READBACK_DOES_NOT_MATCH";
    if (String(f.before[c.name]) === String(c.value)) return "NO_CHANGE_OBSERVED";
  }
  return null;
}

const parseProbeTime = (s, fallback) => {
  const m = String(s ?? "").match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)([+-]\d\d)(\d\d)$/);
  const t = Date.parse(m ? `${m[1]}${m[2]}:${m[3]}` : String(s ?? ""));
  return Number.isFinite(t) ? t : fallback;
};

/**
 * The tests an AC Probe report (v4+, the PROTECTED full report — the shareable copy has no identifiers) proves for
 * each device: [{ unitKey, refs, detected, evidence: [{ level, result, method, detail, functions }] }]. Pure.
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
      const add = (level, result, detail, functions = {}) => ev.push({ level, result, method, detail: String(detail ?? "").slice(0, 300), functions });
      if (d.level && d.level !== "NONE") add("DISCOVERED", "PASS", d.tuya ? "εκπομπή Tuya στο δίκτυο" : d.broadlink ? "απάντηση σε ανακάλυψη BroadLink" : "ανοιχτή θύρα τοπικού πρωτοκόλλου");
      const auth = d.access;
      if (auth === "AUTHENTICATED") add("AUTHENTICATED", "PASS", d.access_reason);
      else if (auth === "AUTH_FAILED" || auth === "LOCAL_LOCKED") add("AUTHENTICATED", "FAIL", d.access_reason);
      else if (auth === "NETWORK_ERROR") add("AUTHENTICATED", "INCONCLUSIVE", d.access_reason);
      if (d.tuya_read?.ok) add("STATUS_READ", "PASS", "κατάσταση διαβάστηκε τοπικά (οι αντιστοιχίσεις DP είναι υποψήφιες μέχρι να επιβεβαιωθούν)", { read: d.tuya_read.candidates ?? {}, dpIds: Object.keys(d.tuya_read.dps ?? {}), mappingConfirmed: false });
      return { unitKey, refs: { ip: d.ip, mac: d.mac ?? null, tuyaDeviceId: tuyaId, productKey: d.tuya?.product_key ?? null }, detected: { moduleVendor: d.module_vendor ?? null, protocol }, evidence: ev };
    }),
  };
}

/** Imports a probe report: each device becomes (or updates) a unit; its tests are appended once (re-import = no-op). */
export async function importProbeReport({ pool, owner, report, by, now = Date.now() }) {
  const parsed = probeEvidence(report);
  if (parsed.error) return { ok: false, error: parsed.error };
  const at = parseProbeTime(report.at, now);
  if (at > now + 5 * 60_000) return { ok: false, error: "REPORT_IN_THE_FUTURE" };
  let units = 0, added = 0;
  for (const d of parsed.devices) {
    const u = (await pool.query(
      `INSERT INTO device_compat_units(owner_id,unit_key,refs_json,label,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)
       ON CONFLICT(owner_id,unit_key) DO UPDATE SET refs_json=$3,updated_at=$5 RETURNING id`,
      [owner, d.unitKey, JSON.stringify({ ...d.refs, detected: d.detected }), d.detected.moduleVendor ?? "", now],
    )).rows[0];
    units++;
    for (const e of d.evidence) {
      const r = await pool.query(
        `INSERT INTO device_compat_evidence(owner_id,unit_id,level,result,method,detail,functions_json,recorded_by,at)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE NOT EXISTS (SELECT 1 FROM device_compat_evidence WHERE owner_id=$1 AND unit_id=$2 AND level=$3 AND method=$5 AND at=$9)`,
        [owner, u.id, e.level, e.result, e.method, e.detail, JSON.stringify(e.functions), String(by).slice(0, 80), at],
      );
      added += r.rowCount ?? 0;
    }
  }
  return { ok: true, units, evidence: added };
}

/** A person records a test (e.g. COMMAND_CONFIRMED after a command with read-back). Ordered and validated. */
export async function recordEvidence({ pool, owner, unitId, level, result, method, detail, functions = {}, by, now = Date.now() }) {
  const ev = (await pool.query(`SELECT id,level,result,at FROM device_compat_evidence WHERE owner_id=$1 AND unit_id=$2`, [owner, unitId])).rows;
  const exists = (await pool.query(`SELECT 1 FROM device_compat_units WHERE owner_id=$1 AND id=$2`, [owner, unitId])).rows.length;
  if (!exists) return { ok: false, error: "UNIT_NOT_FOUND" };
  const error = validateEvidence({ level, result, method, detail, functions, manual: true }, provenLevel(ev));
  if (error) return { ok: false, error };
  await pool.query(
    `INSERT INTO device_compat_evidence(owner_id,unit_id,level,result,method,detail,functions_json,recorded_by,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [owner, unitId, level, result, String(method).slice(0, 80), String(detail).trim().slice(0, 300), JSON.stringify(functions), String(by).slice(0, 80), now],
  );
  return { ok: true };
}

/** Sets a unit's model (A/C + module + app + firmware — a different firmware is a different model) and room. */
export async function assignUnit({ pool, owner, unitId, model, roomId = null, label = "", now = Date.now() }) {
  const clean = (v) => String(v ?? "").trim().slice(0, 80);
  const m = { ac_brand: clean(model?.acBrand), ac_model: clean(model?.acModel), wifi_module: clean(model?.wifiModule), app: clean(model?.app), firmware: clean(model?.firmware), protocol: clean(model?.protocol) };
  if (!m.ac_brand || !m.ac_model || !m.wifi_module) return { ok: false, error: "MODEL_REQUIRED" };
  const row = (await pool.query(
    `INSERT INTO device_compat_models(owner_id,ac_brand,ac_model,wifi_module,app,firmware,protocol,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT(owner_id,ac_brand,ac_model,wifi_module,app,firmware) DO UPDATE SET protocol=CASE WHEN EXCLUDED.protocol<>'' THEN EXCLUDED.protocol ELSE device_compat_models.protocol END,updated_at=$8 RETURNING id`,
    [owner, m.ac_brand, m.ac_model, m.wifi_module, m.app, m.firmware, m.protocol, now],
  )).rows[0];
  const r = await pool.query(`UPDATE device_compat_units SET model_id=$3,room_id=$4,label=CASE WHEN $5<>'' THEN $5 ELSE label END,updated_at=$6 WHERE owner_id=$1 AND id=$2`, [owner, unitId, row.id, roomId, clean(label), now]);
  return r.rowCount ? { ok: true, modelId: Number(row.id) } : { ok: false, error: "UNIT_NOT_FOUND" };
}

/** The registry: models with what was proven on their units, and every unit with its own level and history. */
export async function deviceRegistry({ pool, owner, includeRefs = false }) {
  const [models, units, evidence, rooms] = await Promise.all([
    pool.query(`SELECT * FROM device_compat_models WHERE owner_id=$1 ORDER BY ac_brand,ac_model,firmware`, [owner]).then((r) => r.rows),
    pool.query(`SELECT * FROM device_compat_units WHERE owner_id=$1 ORDER BY id`, [owner]).then((r) => r.rows),
    pool.query(`SELECT * FROM device_compat_evidence WHERE owner_id=$1 ORDER BY at,id`, [owner]).then((r) => r.rows),
    pool.query(`SELECT id,code FROM rooms WHERE owner_id=$1`, [owner]).then((r) => r.rows),
  ]);
  const parse = (s) => { try { return JSON.parse(String(s ?? "{}")); } catch { return {}; } };
  const outUnits = units.map((u) => {
    const ev = evidence.filter((e) => Number(e.unit_id) === Number(u.id)).map((e) => ({ id: Number(e.id), level: String(e.level), result: String(e.result), method: String(e.method), detail: String(e.detail), functions: parse(e.functions_json), by: String(e.recorded_by), at: Number(e.at) }));
    const level = provenLevel(ev), refs = parse(u.refs_json);
    return {
      id: Number(u.id), label: String(u.label), modelId: u.model_id ? Number(u.model_id) : null, roomId: u.room_id ? Number(u.room_id) : null,
      room: rooms.find((r) => Number(r.id) === Number(u.room_id))?.code ?? null, detected: refs.detected ?? {}, level, allowed: allowedOperations(level),
      refs: includeRefs ? { ip: refs.ip ?? null, mac: refs.mac ?? null, tuyaDeviceId: refs.tuyaDeviceId ?? null } : null,
      evidence: ev.slice(-20),
    };
  });
  const outModels = models.map((m) => {
    const mine = outUnits.filter((u) => u.modelId === Number(m.id));
    const byLevel = Object.fromEntries(["NONE", ...LEVELS].map((l) => [l, mine.filter((u) => u.level === l).length]));
    // Functions confirmed on at least one unit of this exact model (read values / confirmed commands).
    const read = new Set(), commands = new Set();
    for (const u of mine) for (const e of u.evidence) if (e.result === "PASS") {
      if (e.level === "STATUS_READ") for (const k of Object.keys(e.functions.read ?? {})) read.add(e.functions.mappingConfirmed === false ? `${k} (υποψήφιο)` : k);
      if (e.level === "COMMAND_CONFIRMED" && e.functions.command?.name) commands.add(String(e.functions.command.name));
    }
    return { id: Number(m.id), acBrand: String(m.ac_brand), acModel: String(m.ac_model), wifiModule: String(m.wifi_module), app: String(m.app), firmware: String(m.firmware), protocol: String(m.protocol), units: mine.length, byLevel, confirmedRead: [...read], confirmedCommands: [...commands] };
  });
  return { levels: LEVELS, models: outModels, units: outUnits };
}

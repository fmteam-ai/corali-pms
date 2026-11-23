// v202 Integration lifecycle — «a service does not work» is not the same as «a service has not been activated yet».
//
// Every external connection (Channel Manager / Channex, Viva, Stripe, WhatsApp, myDATA, Meta, Tuya A/C, Omada …) is
// in exactly one state:
//
//   NOT_CONFIGURED  no connection saved in the PMS (or without its credentials) — nothing is expected of it
//   DISABLED        saved, but switched off — nothing is expected of it
//   TESTING         switched on, but the activation prerequisites have not all been proven yet — it may be tried,
//                   problems are shown in the PMS, never pushed / e-mailed as failures
//   ACTIVE          activated (prerequisites proven) and its own checks CONFIRM it works
//   DEGRADED        activated, and its checks fail — raises failure alerts
//   UNVERIFIED      v203: activated, but its health could not be confirmed (no / unreadable check) — never shown as
//                   «working»; it is monitored like an active one (an activated service we cannot see is a problem)
//
// Activation is a recorded act: every prerequisite of the provider must have a PASSED check, recent enough, and the
// person and time are kept (integration_activation). Deactivation keeps the history. Nothing here deletes data.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const DAY = 24 * 60 * 60_000;

export const INTEGRATION_STATES = ["NOT_CONFIGURED", "DISABLED", "TESTING", "ACTIVE", "DEGRADED", "UNVERIFIED"];
export const STATE_EL = {
  NOT_CONFIGURED: "Δεν έχει ρυθμιστεί",
  DISABLED: "Απενεργοποιημένη",
  TESTING: "Σε δοκιμή (δεν έχει ενεργοποιηθεί)",
  ACTIVE: "Ενεργή",
  DEGRADED: "Ενεργή με πρόβλημα",
  UNVERIFIED: "Ενεργοποιημένη — η λειτουργία της δεν έχει επιβεβαιωθεί",
};

/** Proven prerequisites before a provider counts as ACTIVE (checks recorded by its connection test). */
export const PREREQUISITES = {
  channelManager: [
    { key: "room_rate_mapping", el: "Επαληθευμένη αντιστοίχιση τύπων δωματίων και rate plans με το Channex" },
    { key: "initial_reconciliation", el: "Αρχική πλήρης σύγκριση διαθεσιμότητας PMS ↔ Channex χωρίς διαφορές" },
  ],
  viva: [{ key: "sandbox_payment", el: "Δοκιμαστική πληρωμή και επιστροφή στο sandbox επιβεβαιωμένες" }],
  stripe: [{ key: "sandbox_payment", el: "Δοκιμαστική πληρωμή και webhook στο test mode επιβεβαιωμένα" }],
  whatsapp: [{ key: "test_message", el: "Δοκιμαστικό μήνυμα παραδόθηκε (delivery receipt)" }],
  mydata: [{ key: "test_submission", el: "Δοκιμαστική αποστολή στο dev περιβάλλον της ΑΑΔΕ με MARK" }],
  meta: [{ key: "test_publish", el: "Δοκιμαστική δημοσίευση επιβεβαιωμένη" }],
  tuya: [{ key: "status_read", el: "Ανάγνωση κατάστασης κλιματιστικού από το εργοστασιακό Wi-Fi module (Device Compatibility Registry)" }],
  omada: [{ key: "voucher_roundtrip", el: "Δημιουργία και ανάκληση κωδικού Wi-Fi επιβεβαιωμένες" }],
};
export const PREREQUISITE_MAX_AGE_MS = 30 * DAY;
/** v203: a check dated more than this after «now» is not evidence (clock skew tolerance, as in the device registry). */
export const CHECK_CLOCK_SKEW_MS = 5 * 60_000;
export const ALERTING_STATES = new Set(["ACTIVE", "DEGRADED", "UNVERIFIED"]);

/**
 * Pure: the state of one provider. row = provider_connections row (or null); activation = integration_activation row
 * (or null); healthy = the provider's own checks pass (false → DEGRADED once activated; null = not known).
 */
/**
 * v204: the credentials each provider needs before it can be anything but NOT_CONFIGURED (secrets inside the sealed
 * secrets_encrypted, settings in settings_json). A provider that needs none must be listed in CREDENTIAL_FREE — a
 * documented exception; none today.
 */
export const REQUIRED_CREDENTIALS = {
  channelManager: { secrets: ["apiKey"], settings: ["propertyCode"] },
  viva: { secrets: ["clientId", "clientSecret"], settings: [] },
  stripe: { secrets: ["secretKey", "webhookSecret"], settings: [] },
  whatsapp: { secrets: ["accessToken"], settings: ["phoneNumberId"] },
  mydata: { secrets: ["username", "subscriptionKey"], settings: ["issuerVat"] },
  meta: { secrets: ["pageAccessToken"], settings: ["pageId"] },
  tuya: { secrets: ["accessId", "accessSecret"], settings: [] },
  omada: { secrets: ["clientId", "clientSecret"], settings: ["interfaceUrl", "omadacId"] },
};
export const CREDENTIAL_FREE = new Set();

const keyOf = (documentKey) => createHash("sha256").update(String(documentKey)).digest();
/** The PMS's own sealing (lib/security/encryption: v1.iv.tag.data, AES-256-GCM, key = SHA-256 of PMS_DOCUMENT_KEY). */
export function sealSecrets(obj, documentKey) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", keyOf(documentKey), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function unsealSecrets(sealed, documentKey) {
  const [version, iv, tag, data] = String(sealed ?? "").split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("INVALID_CIPHERTEXT");
  const d = createDecipheriv("aes-256-gcm", keyOf(documentKey), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8")) ?? {};
}

/**
 * Are the provider's required credentials really there? { ok, missing[], reason } — never the values. Unknown
 * provider (no requirement written down and not a documented exception) → not ok.
 */
export function credentialsStatus(provider, row, documentKey = process.env.PMS_DOCUMENT_KEY) {
  if (!row) return { ok: false, missing: [], reason: "NO_CONNECTION" };
  if (CREDENTIAL_FREE.has(provider)) return { ok: true, missing: [], reason: "CREDENTIAL_FREE" };
  const req = REQUIRED_CREDENTIALS[provider];
  if (!req) return { ok: false, missing: [], reason: "NO_REQUIREMENTS_DEFINED" };
  const sealed = String(row.secrets_encrypted ?? "").trim();
  if (!sealed) return { ok: false, missing: req.secrets, reason: "NO_SECRETS" };
  if (!documentKey) return { ok: false, missing: [], reason: "CANNOT_VERIFY" };
  let secrets;
  try { secrets = unsealSecrets(sealed, documentKey); } catch { return { ok: false, missing: [], reason: "SECRETS_UNREADABLE" }; }
  let settings = {};
  try { settings = JSON.parse(String(row.settings_json || "{}")) ?? {}; } catch { settings = {}; }
  const missing = [...req.secrets.filter((k) => !String(secrets?.[k] ?? "").trim()), ...req.settings.filter((k) => !String(settings?.[k] ?? "").trim())];
  return { ok: missing.length === 0, missing, reason: missing.length ? "MISSING" : "OK" };
}

/**
 * Pure: the state of one provider. row = provider_connections row (or null); credentials = credentialsStatus(…);
 * activation = integration_activation row (or null); healthy = the provider's own checks (true / false / null).
 * v204: without verified credentials a connection is NOT_CONFIGURED whatever else is recorded (no artificial
 * placeholder; an old activation does not make an empty connection active).
 */
export function integrationState({ row, credentials = null, activation = null, healthy = null }) {
  if (!row) return "NOT_CONFIGURED";
  if (!Number(row.active)) return "DISABLED";
  const activated = Boolean(activation?.activated_at && !activation.deactivated_at);
  if (credentials?.ok !== true) {
    // Never activated: an incomplete connection is simply not configured (no alerts).
    if (!activated) return "NOT_CONFIGURED";
    // v204: an ACTIVATED connection that lost its credentials (key rotated, field cleared) is a FAILURE that must be
    // alerted, never a silent «not configured»; when this process cannot check them at all, it is UNVERIFIED.
    return !credentials || credentials.reason === "CANNOT_VERIFY" ? "UNVERIFIED" : "DEGRADED";
  }
  if (!activated) return "TESTING";
  // v203: only a confirmed healthy check is ACTIVE; unknown health is UNVERIFIED, never «working».
  return healthy === true ? "ACTIVE" : healthy === false ? "DEGRADED" : "UNVERIFIED";
}

/** v204: did the LATEST sync run fail? (never succeeded, a run after the last success, or an error recorded) */
export function lastRunFailed(st) {
  if (!st?.last_run_at) return false;
  return !st.last_ok_at || Number(st.last_ok_at) < Number(st.last_run_at) || Boolean(String(st.last_error ?? "").trim());
}
/** Minutes of continuous failure: an incident is raised only after SYNC_FAIL_GRACE_MS (the sync runs every minute). */
export const SYNC_FAIL_GRACE_MS = 10 * 60_000;

/**
 * The Channel Manager's health from its sync state (v204: judged by the LATEST run, not by a recent success):
 *   true  = the latest run (≤ 30′ ago) succeeded — last_ok_at is that run (≥ last_run_at) — and no error was
 *           recorded after it;
 *   false = never ran, not run for 30′, the latest run failed (last_run_at after last_ok_at), or an error is recorded;
 *   null  = the state could not be read.
 */
export function channelSyncHealthy(st, now = Date.now()) {
  if (st === undefined) return null;
  if (!st?.last_run_at || now - Number(st.last_run_at) > 30 * 60_000) return false;
  if (!st.last_ok_at || Number(st.last_ok_at) < Number(st.last_run_at)) return false;
  if (String(st.last_error ?? "").trim()) return false;
  return true;
}

/** May failures of this provider be pushed / e-mailed as failures? Only once it has been activated. */
export const mayAlert = (state) => ALERTING_STATES.has(state);

/**
 * Pure: which prerequisites are proven, and whether activation is allowed. A check counts only if it PASSED, is not
 * older than 30 days, is not dated in the future (beyond CHECK_CLOCK_SKEW_MS) and was made after the last change of
 * the provider's configuration (configChangedAt: connection settings, room / rate mapping …).
 */
export function activationReadiness(provider, checks, now = Date.now(), configChangedAt = 0) {
  const list = PREREQUISITES[provider] ?? [];
  const items = list.map((p) => {
    const c = (checks ?? []).filter((x) => x.check_key === p.key).sort((a, b) => Number(b.checked_at) - Number(a.checked_at))[0];
    const at = c ? Number(c.checked_at) : null;
    const future = c && at > now + CHECK_CLOCK_SKEW_MS;
    const fresh = c && !future && now - at <= PREREQUISITE_MAX_AGE_MS;
    const afterChange = c && at >= Number(configChangedAt || 0);
    const detail = !c ? "Δεν έχει ελεγχθεί"
      : future ? "Ο χρόνος του ελέγχου είναι στο μέλλον — δεν γίνεται δεκτός (ελέγξτε το ρολόι και επαναλάβετε τον έλεγχο)"
      : !fresh ? "Ο έλεγχος είναι παλαιότερος από 30 ημέρες — επαναλάβετε τον"
      : !afterChange ? "Οι ρυθμίσεις άλλαξαν μετά τον έλεγχο — απαιτείται νέα επαλήθευση"
      : String(c.detail ?? "");
    return { key: p.key, el: p.el, ok: Boolean(c && Number(c.ok) === 1 && fresh && afterChange), detail, checkedAt: at, future: Boolean(future), stale: Boolean(c && !afterChange) };
  });
  return { provider, items, ready: list.length > 0 && items.every((i) => i.ok), configChangedAt: Number(configChangedAt || 0) || null };
}

/** When the provider's configuration last changed (its saved connection, and for the Channel Manager its mapping). */
export async function configChangedAt(pool, owner, provider) {
  const conn = (await pool.query(`SELECT updated_at FROM provider_connections WHERE owner_id=$1 AND provider_key=$2`, [owner, provider])).rows[0];
  let at = Number(conn?.updated_at ?? 0);
  if (provider === "channelManager") {
    const m = (await pool.query(`SELECT max(updated_at) AS at FROM channel_room_mappings WHERE owner_id=$1`, [owner]).catch(() => ({ rows: [] }))).rows[0];
    at = Math.max(at, Number(m?.at ?? 0));
  }
  return at;
}

/** Records one prerequisite check (history kept: every check is a new row). The time is the PMS clock, never later than now. */
export async function recordIntegrationCheck({ pool, owner, provider, check, ok, detail = "", by = "system", now = Date.now() }) {
  if (now > Date.now() + CHECK_CLOCK_SKEW_MS) throw new Error("CHECK_IN_FUTURE");
  await pool.query(`INSERT INTO integration_checks(owner_id,provider_key,check_key,ok,detail,checked_by,checked_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [owner, provider, check, ok ? 1 : 0, String(detail).slice(0, 500), by, now]);
}

/** Reads the state of providers (all, or the ones given). Never throws: an unreadable table → state per row only. */
export async function integrationStates({ pool, owner, providers = null, health = {}, documentKey = process.env.PMS_DOCUMENT_KEY }) {
  const rows = (await pool.query(`SELECT provider_key,active,secrets_encrypted,settings_json,updated_at FROM provider_connections WHERE owner_id=$1`, [owner])).rows;
  const acts = (await pool.query(`SELECT provider_key,activated_at,activated_by,deactivated_at FROM integration_activation WHERE owner_id=$1`, [owner]).catch(() => ({ rows: [] }))).rows;
  const keys = providers ?? [...new Set([...Object.keys(PREREQUISITES), ...rows.map((r) => r.provider_key)])];
  const out = {};
  for (const k of keys) {
    const row = rows.find((r) => r.provider_key === k) ?? null;
    const activation = acts.find((a) => a.provider_key === k) ?? null;
    const credentials = credentialsStatus(k, row, documentKey);
    out[k] = { state: integrationState({ row, credentials, activation, healthy: health[k] ?? null }), credentials: { ok: credentials.ok, missing: credentials.missing, reason: credentials.reason }, configChangedAt: row?.updated_at == null ? null : Number(row.updated_at), activatedAt: activation?.activated_at && !activation.deactivated_at ? Number(activation.activated_at) : null, activatedBy: activation?.activated_at && !activation.deactivated_at ? activation.activated_by ?? null : null };
  }
  return out;
}

/** Activation: refused unless every prerequisite is proven. Returns { ok, error?, readiness }. */
export async function activateIntegration({ pool, owner, provider, by, now = Date.now(), documentKey = process.env.PMS_DOCUMENT_KEY }) {
  const row = (await pool.query(`SELECT active,secrets_encrypted,settings_json FROM provider_connections WHERE owner_id=$1 AND provider_key=$2`, [owner, provider])).rows[0];
  const checks = (await pool.query(`SELECT check_key,ok,detail,checked_at FROM integration_checks WHERE owner_id=$1 AND provider_key=$2 ORDER BY checked_at DESC LIMIT 200`, [owner, provider])).rows;
  // v203: validity re-checked AT activation time: not in the future, not expired, made after the last config change.
  const readiness = activationReadiness(provider, checks, now, await configChangedAt(pool, owner, provider));
  if (!row) return { ok: false, error: "NOT_CONFIGURED", readiness };
  if (!Number(row.active)) return { ok: false, error: "DISABLED", readiness };
  // v204: the credentials are checked here too, not only for display.
  const credentials = credentialsStatus(provider, row, documentKey);
  if (!credentials.ok) return { ok: false, error: "CREDENTIALS_MISSING", missing: credentials.missing, reason: credentials.reason, readiness };
  if (!readiness.ready) return { ok: false, error: "PREREQUISITES_NOT_MET", readiness };
  await pool.query(
    `INSERT INTO integration_activation(owner_id,provider_key,activated_at,activated_by,evidence_json,deactivated_at) VALUES($1,$2,$3,$4,$5,NULL)
     ON CONFLICT(owner_id,provider_key) DO UPDATE SET activated_at=$3,activated_by=$4,evidence_json=$5,deactivated_at=NULL`,
    [owner, provider, now, by, JSON.stringify(readiness.items)],
  );
  return { ok: true, readiness };
}

/** Back to TESTING (e.g. before changing the mapping); the activation history stays in the audit log. */
export async function deactivateIntegration({ pool, owner, provider, now = Date.now() }) {
  const r = await pool.query(`UPDATE integration_activation SET deactivated_at=$3 WHERE owner_id=$1 AND provider_key=$2 AND deactivated_at IS NULL`, [owner, provider, now]);
  return (r.rowCount ?? 0) > 0;
}

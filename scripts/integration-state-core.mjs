// v202 Integration lifecycle — «a service does not work» is not the same as «a service has not been activated yet».
//
// Every external connection (Channel Manager / Channex, Viva, Stripe, WhatsApp, myDATA, Meta, Tuya A/C, Omada …) is
// in exactly one state:
//
//   NOT_CONFIGURED  no connection saved in the PMS (or without its credentials) — nothing is expected of it
//   DISABLED        saved, but switched off — nothing is expected of it
//   TESTING         switched on, but the activation prerequisites have not all been proven yet — it may be tried,
//                   problems are shown in the PMS, never pushed / e-mailed as failures
//   ACTIVE          activated (prerequisites proven) and working
//   DEGRADED        activated, but its checks fail — this, and only this, raises failure alerts
//
// Activation is a recorded act: every prerequisite of the provider must have a PASSED check, recent enough, and the
// person and time are kept (integration_activation). Deactivation keeps the history. Nothing here deletes data.
const DAY = 24 * 60 * 60_000;

export const INTEGRATION_STATES = ["NOT_CONFIGURED", "DISABLED", "TESTING", "ACTIVE", "DEGRADED"];
export const STATE_EL = {
  NOT_CONFIGURED: "Δεν έχει ρυθμιστεί",
  DISABLED: "Απενεργοποιημένη",
  TESTING: "Σε δοκιμή (δεν έχει ενεργοποιηθεί)",
  ACTIVE: "Ενεργή",
  DEGRADED: "Ενεργή με πρόβλημα",
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
export const ALERTING_STATES = new Set(["ACTIVE", "DEGRADED"]);

/**
 * Pure: the state of one provider. row = provider_connections row (or null); activation = integration_activation row
 * (or null); healthy = the provider's own checks pass (false → DEGRADED once activated; null = not known).
 */
export function integrationState({ row, activation = null, healthy = null }) {
  if (!row || !String(row.secrets_encrypted ?? "x")) return "NOT_CONFIGURED";
  if (!Number(row.active)) return "DISABLED";
  if (!activation?.activated_at || activation.deactivated_at) return "TESTING";
  return healthy === false ? "DEGRADED" : "ACTIVE";
}

/** May failures of this provider be pushed / e-mailed as failures? Only once it has been activated. */
export const mayAlert = (state) => ALERTING_STATES.has(state);

/** Pure: which prerequisites are proven (a recent PASSED check), and whether activation is allowed. */
export function activationReadiness(provider, checks, now = Date.now()) {
  const list = PREREQUISITES[provider] ?? [];
  const items = list.map((p) => {
    const c = (checks ?? []).filter((x) => x.check_key === p.key).sort((a, b) => Number(b.checked_at) - Number(a.checked_at))[0];
    const fresh = c && now - Number(c.checked_at) <= PREREQUISITE_MAX_AGE_MS;
    return { key: p.key, el: p.el, ok: Boolean(c && Number(c.ok) === 1 && fresh), detail: !c ? "Δεν έχει ελεγχθεί" : !fresh ? "Ο έλεγχος είναι παλαιότερος από 30 ημέρες — επαναλάβετε τον" : String(c.detail ?? ""), checkedAt: c ? Number(c.checked_at) : null };
  });
  return { provider, items, ready: list.length > 0 && items.every((i) => i.ok) };
}

/** Records one prerequisite check (history kept: every check is a new row). */
export async function recordIntegrationCheck({ pool, owner, provider, check, ok, detail = "", by = "system", now = Date.now() }) {
  await pool.query(`INSERT INTO integration_checks(owner_id,provider_key,check_key,ok,detail,checked_by,checked_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [owner, provider, check, ok ? 1 : 0, String(detail).slice(0, 500), by, now]);
}

/** Reads the state of providers (all, or the ones given). Never throws: an unreadable table → state per row only. */
export async function integrationStates({ pool, owner, providers = null, health = {} }) {
  const rows = (await pool.query(`SELECT provider_key,active,secrets_encrypted FROM provider_connections WHERE owner_id=$1`, [owner])).rows;
  const acts = (await pool.query(`SELECT provider_key,activated_at,activated_by,deactivated_at FROM integration_activation WHERE owner_id=$1`, [owner]).catch(() => ({ rows: [] }))).rows;
  const keys = providers ?? [...new Set([...Object.keys(PREREQUISITES), ...rows.map((r) => r.provider_key)])];
  const out = {};
  for (const k of keys) {
    const row = rows.find((r) => r.provider_key === k) ?? null;
    const activation = acts.find((a) => a.provider_key === k) ?? null;
    out[k] = { state: integrationState({ row, activation, healthy: health[k] ?? null }), activatedAt: activation?.activated_at ? Number(activation.activated_at) : null, activatedBy: activation?.activated_by ?? null };
  }
  return out;
}

/** Activation: refused unless every prerequisite is proven. Returns { ok, error?, readiness }. */
export async function activateIntegration({ pool, owner, provider, by, now = Date.now() }) {
  const row = (await pool.query(`SELECT active,secrets_encrypted FROM provider_connections WHERE owner_id=$1 AND provider_key=$2`, [owner, provider])).rows[0];
  const checks = (await pool.query(`SELECT check_key,ok,detail,checked_at FROM integration_checks WHERE owner_id=$1 AND provider_key=$2 ORDER BY checked_at DESC LIMIT 200`, [owner, provider])).rows;
  const readiness = activationReadiness(provider, checks, now);
  if (!row) return { ok: false, error: "NOT_CONFIGURED", readiness };
  if (!Number(row.active)) return { ok: false, error: "DISABLED", readiness };
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

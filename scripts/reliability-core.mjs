// v188 Operational Reliability Center: not «is the service online» but «did its work complete». For every area the
// unfinished or failed tasks themselves — an availability change not synced to the OTAs, a guest message stuck in
// the queue, a myDATA document without a MARK, a TV without a recent confirmation, a cron step that stopped — each
// with its age, the error, and a recovery action where one exists. Read by the PMS page (live, so a dead cron is
// seen too) and by the cron every 10 minutes (one PMS notification per new problem).
const MIN = 60_000, HOUR = 60 * MIN;
const ago = (now, t) => { const m = Math.max(0, Math.round((now - Number(t)) / MIN)); return m < 60 ? `${m}′` : m < 48 * 60 ? `${Math.round(m / 60)} ώρ.` : `${Math.round(m / 1440)} ημ.`; };
const hhmm = (t) => new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(t)));
const worst = (items) => (items.some((i) => i.level === "fail") ? "fail" : items.some((i) => i.level === "warn") ? "warn" : "ok");
const one = async (pool, sql, params) => (await pool.query(sql, params)).rows;
import { heartbeatState } from "./job-control-core.mjs";
import { alertDeliveryIssues } from "./alert-core.mjs";
import { otaReconcile, queueOtaResync } from "./ota-reconcile-core.mjs";

export const AREAS = [
  { key: "channel", el: "Booking & Channel Manager", en: "Booking & Channel Manager" },
  { key: "messaging", el: "Μηνύματα πελατών", en: "Guest messaging" },
  { key: "payments", el: "Πληρωμές", en: "Payments" },
  { key: "mydata", el: "myDATA", en: "myDATA" },
  { key: "devices", el: "Corali TV / IoT", en: "Corali TV / IoT" },
  { key: "network", el: "Wi-Fi πελατών & κάρτες πρόσβασης", en: "Guest Wi-Fi & access cards" },
  { key: "integrations", el: "API & webhooks", en: "API & webhooks" },
  { key: "automations", el: "Αυτοματισμοί (cron)", en: "Automations (cron)" },
  { key: "backups", el: "Αντίγραφα ασφαλείας", en: "Backups" },
  { key: "release", el: "Έκδοση & έλεγχοι", en: "Release & checks" },
];

/** Every check; `now` is passed so the result is reproducible in tests. */
export async function checkReliability({ pool, owner, now = Date.now(), version = null }) {
  const P = [owner, now];
  const [outbox, syncState, channex, otaNoRoom, deliveries, stuckDeliveries, campaignFails, sessions, balanceLinks, fiscal, tvs, climate, ac, bridge, wifi, cards, hooks, steps] = await Promise.all([
    one(pool, `SELECT id,date_from,date_to,reason,status,attempts,COALESCE(last_error,'') err,created_at FROM channel_sync_outbox WHERE owner_id=$1 AND status IN ('pending','failed','processing') AND created_at<$2::bigint-10*60000 ORDER BY created_at LIMIT 50`, P),
    one(pool, `SELECT last_run_at,last_ok_at,COALESCE(last_error,'') last_error,last_webhook_at FROM channel_sync_state WHERE owner_id=$1`, [owner]),
    one(pool, `SELECT 1 FROM provider_connections WHERE owner_id=$1 AND provider_key IN ('channex','channelManager') AND active=1`, [owner]).catch(() => []),
    one(pool, `SELECT id,reference,guest_name,check_in,external_room_type FROM bookings WHERE owner_id=$1 AND room_id IS NULL AND external_room_type IS NOT NULL AND status='confirmed' AND check_in<=(to_char(now() AT TIME ZONE 'Europe/Athens','YYYY-MM-DD')::date+14)::text ORDER BY check_in LIMIT 30`, [owner]),
    one(pool, `SELECT d.id,d.event_key,d.channel,COALESCE(d.last_error,'') err,d.attempts,d.updated_at,b.reference,b.guest_name FROM message_deliveries d JOIN bookings b ON b.owner_id=d.owner_id AND b.id=d.booking_id WHERE d.owner_id=$1 AND d.status='failed' AND d.updated_at>$2::bigint-7*86400000 ORDER BY d.updated_at DESC LIMIT 50`, P),
    one(pool, `SELECT d.id,d.event_key,d.channel,d.status,d.scheduled_at,d.updated_at,b.reference FROM message_deliveries d JOIN bookings b ON b.owner_id=d.owner_id AND b.id=d.booking_id WHERE d.owner_id=$1 AND ((d.status='pending' AND d.scheduled_at<$2::bigint-20*60000 AND d.scheduled_at>$2::bigint-3*86400000) OR (d.status='processing' AND d.updated_at<$2::bigint-15*60000) OR (d.status='uncertain' AND d.updated_at>$2::bigint-7*86400000)) ORDER BY d.scheduled_at LIMIT 50`, P),
    one(pool, `SELECT c.name,r.channel,count(*)::int n,max(r.error) err FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE r.owner_id=$1 AND r.status='failed' AND r.updated_at>$2::bigint-7*86400000 GROUP BY c.name,r.channel`, P),
    one(pool, `SELECT id,guest_first_name,guest_last_name,payable_cents,check_in,created_at,payment_gateway FROM booking_sessions WHERE owner_id=$1 AND status='payment_pending' AND recovery_due_at<$2::bigint AND created_at>$2::bigint-7*86400000 ORDER BY created_at DESC LIMIT 30`, P),
    one(pool, `SELECT l.id,b.reference,l.updated_at FROM balance_payment_links l JOIN bookings b ON b.owner_id=l.owner_id AND b.id=l.booking_id WHERE l.owner_id=$1 AND l.status='checkout_pending' AND l.updated_at<$2::bigint-2*3600000 LIMIT 30`, P).catch(() => []),
    one(pool, `SELECT f.id,f.series,f.aa,f.status,f.attempts,COALESCE(f.last_error,'') err,f.created_at,f.mark,f.total_cents,b.reference FROM fiscal_documents f LEFT JOIN bookings b ON b.owner_id=f.owner_id AND b.id=f.booking_id WHERE f.owner_id=$1 AND (f.status='failed' OR (f.status='pending' AND f.created_at<$2::bigint-30*60000) OR (f.status='sent' AND (f.mark IS NULL OR f.mark=''))) ORDER BY f.created_at DESC LIMIT 50`, P),
    one(pool, `SELECT s.room_id,r.code,s.last_seen_at,COALESCE(s.power_error,'') power_error,EXISTS(SELECT 1 FROM bookings b WHERE b.owner_id=s.owner_id AND b.room_id=s.room_id AND b.status='checked_in') occupied FROM tv_screens s JOIN rooms r ON r.owner_id=s.owner_id AND r.id=s.room_id WHERE s.owner_id=$1 AND s.active=1`, [owner]),
    one(pool, `SELECT c.room_id,r.code,c.read_at,c.checked_at,COALESCE(c.error,'') error FROM room_climate c JOIN rooms r ON r.owner_id=c.owner_id AND r.id=c.room_id WHERE c.owner_id=$1 AND c.device_id<>''`, [owner]),
    one(pool, `SELECT a.room_id,r.code,COALESCE(a.error,'') error,a.changed_at FROM room_ac_devices a JOIN rooms r ON r.owner_id=a.owner_id AND r.id=a.room_id WHERE a.owner_id=$1 AND a.device_id<>'' AND COALESCE(a.error,'')<>''`, [owner]),
    one(pool, `SELECT last_seen_at,last_report FROM omada_bridge WHERE owner_id=$1`, [owner]).catch(() => []),
    one(pool, `SELECT w.booking_id,w.status,w.error,w.created_at,b.reference,r.code FROM guest_wifi w JOIN bookings b ON b.owner_id=w.owner_id AND b.id=w.booking_id LEFT JOIN rooms r ON r.owner_id=w.owner_id AND r.id=w.room_id WHERE w.owner_id=$1 AND (w.status='failed' OR (w.status IN ('pending','removing') AND w.created_at<$2::bigint-20*60000))`, P).catch(() => []),
    one(pool, `SELECT c.id,c.holder_name,c.send_error,c.valid_from FROM access_cards c WHERE c.owner_id=$1 AND c.status='active' AND c.valid_until>$2::bigint AND (c.send_error<>'' OR (c.sent_at IS NULL AND c.valid_from<$2::bigint AND c.email<>''))`, P).catch(() => []),
    one(pool, `SELECT d.id,d.event,d.attempts,COALESCE(d.last_error,'') err,d.response_status,d.created_at,w.url FROM api_webhook_deliveries d JOIN api_webhooks w ON w.id=d.webhook_id AND w.owner_id=d.owner_id WHERE d.owner_id=$1 AND d.status<>'sent' AND (d.attempts>=3 OR d.created_at<$2::bigint-30*60000) AND d.created_at>$2::bigint-7*86400000 ORDER BY d.created_at DESC LIMIT 50`, P).catch(() => []),
    one(pool, `SELECT name,last_run_at,last_ok_at,last_status,last_error,consecutive_failures FROM automation_status WHERE owner_id=$1`, [owner]),
  ]);

  // v189: heartbeats, alert deliveries, devices that never connected, reconciliations, backups, the installed release.
  const [beats, undelivered, unacked, tvNever, climateNever, acNever, presenceNever, recon, backups, release, ota] = await Promise.all([
    one(pool, `SELECT * FROM cron_heartbeat WHERE owner_id=$1`, [owner]).catch(() => []),
    alertDeliveryIssues(pool, owner, now).catch(() => []),
    one(pool, `SELECT count(*)::int n FROM alerts WHERE owner_id=$1 AND severity='fail' AND acknowledged_at IS NULL AND resolved_at IS NULL`, [owner]).catch(() => [{ n: 0 }]),
    one(pool, `SELECT s.room_id,r.code,s.created_at,EXISTS(SELECT 1 FROM bookings b WHERE b.owner_id=s.owner_id AND b.room_id=s.room_id AND b.status='checked_in') occupied FROM tv_screens s JOIN rooms r ON r.owner_id=s.owner_id AND r.id=s.room_id WHERE s.owner_id=$1 AND s.active=1 AND s.last_seen_at IS NULL AND s.created_at<$2::bigint-3600000`, P).catch(() => []),
    one(pool, `SELECT c.room_id,r.code,c.checked_at FROM room_climate c JOIN rooms r ON r.owner_id=c.owner_id AND r.id=c.room_id WHERE c.owner_id=$1 AND c.device_id<>'' AND c.read_at IS NULL AND c.checked_at IS NOT NULL AND COALESCE(c.error,'')=''`, [owner]).catch(() => []),
    one(pool, `SELECT a.room_id,r.code,a.updated_at FROM room_ac_devices a JOIN rooms r ON r.owner_id=a.owner_id AND r.id=a.room_id WHERE a.owner_id=$1 AND a.device_id<>'' AND a.state IS NULL AND a.changed_at IS NULL AND COALESCE(a.error,'')='' AND a.updated_at<$2::bigint-3600000`, P).catch(() => []),
    one(pool, `SELECT a.room_id,r.code FROM room_ac_devices a JOIN rooms r ON r.owner_id=a.owner_id AND r.id=a.room_id WHERE a.owner_id=$1 AND a.presence_device_id<>'' AND a.presence_seen_at IS NULL AND a.presence_checked_at IS NOT NULL`, [owner]).catch(() => []),
    one(pool, `SELECT DISTINCT ON (kind) kind,ran_at,status,issues_json,totals_json,error FROM reconciliation_runs WHERE owner_id=$1 ORDER BY kind,ran_at DESC`, [owner]).catch(() => []),
    one(pool, `SELECT DISTINCT ON (kind) kind,started_at,finished_at,status,file,size_bytes,details_json,error FROM backup_runs WHERE owner_id=$1 AND status<>'running' ORDER BY kind,started_at DESC`, [owner]).catch(() => []),
    one(pool, `SELECT version,ran_at,status,checks_json,qa_json FROM release_checks WHERE scope='installation' ORDER BY ran_at DESC LIMIT 1`, []).catch(() => []),
    otaReconcile({ pool, owner, now }).catch((e) => ({ active: false, error: e instanceof Error ? e.message : String(e), mismatches: [] })),
  ]);

  const areas = {};
  const add = (key, x) => { (areas[key] ??= { items: [], info: [] }).items.push(x); };
  const info = (key, s) => { (areas[key] ??= { items: [], info: [] }).info.push(s); };

  // Booking & Channel Manager: every availability change must reach the OTAs; OTA bookings need a room.
  const st = syncState[0], channelOn = channex.length > 0 || Boolean(st?.last_run_at);
  for (const o of outbox) {
    const age = now - Number(o.created_at);
    add("channel", { key: `outbox:${o.id}`, level: o.status === "failed" || Number(o.attempts) >= 3 || age > 30 * MIN ? "fail" : "warn", text: `Μεταβολή διαθεσιμότητας ${o.date_from}${o.date_to !== o.date_from ? ` → ${o.date_to}` : ""} (${o.reason || "—"}) δεν έχει συγχρονιστεί εδώ και ${ago(now, o.created_at)}${Number(o.attempts) ? ` · ${o.attempts} προσπάθειες` : ""}${o.err ? ` · ${o.err.slice(0, 120)}` : ""}`, action: { type: "retry_outbox", id: Number(o.id) }, at: Number(o.created_at) });
  }
  if (channelOn && st?.last_ok_at && now - Number(st.last_ok_at) > 30 * MIN && outbox.length) add("channel", { key: "sync:stale", level: "fail", text: `Τελευταίος επιτυχής συγχρονισμός ${hhmm(st.last_ok_at)}${st.last_error ? ` · ${st.last_error.slice(0, 120)}` : ""}`, action: { type: "sync_now" }, at: Number(st.last_ok_at) });
  for (const b of otaNoRoom) add("channel", { key: `noroom:${b.id}`, level: "warn", text: `Κράτηση OTA ${b.reference} (${b.guest_name}, άφιξη ${b.check_in}) χωρίς δωμάτιο — τύπος ${b.external_room_type}`, link: `/pms/reservations?q=${encodeURIComponent(b.reference)}` });
  // v189 OTA reconciliation: what the PMS sells now ≠ what was last sent, with nothing queued to fix it.
  if (ota.active) {
    for (const m of ota.mismatches.slice(0, 30)) add("channel", m.ota === null
      ? { key: `ota-unsent:${m.roomType}:${m.from}`, level: "warn", text: `Διαθεσιμότητα «${m.roomType}» ${m.from}${m.to !== m.from ? ` → ${m.to}` : ""}: δεν έχει σταλεί ποτέ στον channel manager (PMS ${m.pms})`, action: { type: "resync_ota" }, at: now }
      : { key: `ota:${m.roomType}:${m.from}`, level: "fail", text: `Διαθεσιμότητα «${m.roomType}» ${m.from}${m.to !== m.from ? ` → ${m.to}` : ""}: PMS ${m.pms}, στάλθηκε στα OTA ${m.ota} — η αλλαγή δεν έχει σταλεί`, action: { type: "resync_ota" }, at: now });
    if (ota.mismatches.length > 30) add("channel", { key: "ota:more", level: "warn", text: `και ${ota.mismatches.length - 30} ακόμη διαστήματα με διαφορά`, action: { type: "resync_ota" }, at: now });
    info("channel", `Συμφωνία διαθεσιμότητας: ${ota.checked} ημέρες×τύποι${ota.mismatches.length ? `, ${ota.mismatches.length} διαστήματα με διαφορά` : ", χωρίς διαφορές"}${ota.pendingSync ? ` · ${ota.pendingSync} σε αναμονή αποστολής (δεν μετρούν ως συμφωνία)` : ""}`);
  }
  // v190 read-back: what Channex itself reports (hourly); a difference after our push was accepted.
  const rb = recon.find((r) => r.kind === "ota_readback");
  if (channelOn && rb) {
    let issues = [];
    try { issues = JSON.parse(String(rb.issues_json)); } catch { issues = []; }
    if (rb.status === "error") add("channel", { key: "readback:error", level: "warn", text: `Ανάγνωση διαθεσιμότητας από το Channex ${hhmm(rb.ran_at)}: δεν έγινε · ${String(rb.error).slice(0, 140)}`, at: Number(rb.ran_at) });
    else if (issues.length) for (const i of issues.slice(0, 10)) add("channel", { key: `readback:${i.reference}:${i.detail.slice(0, 40)}`, level: "warn", text: `Channex (ανάγνωση ${hhmm(rb.ran_at)}): ${i.detail}`, at: Number(rb.ran_at) });
    let t = {};
    try { t = JSON.parse(String(rb.totals_json ?? "{}")); } catch { t = {}; }
    const n = (k) => Number(t[k] ?? 0);
    const summary = `ίδιες ${n("MATCHED")} · διαφορετικές ${n("MISMATCHED")} · δεν επιστράφηκαν ${n("NOT_RETURNED")} · δεν ελέγχθηκαν (σε αναμονή αποστολής) ${n("NOT_CHECKED")}`;
    if (rb.status !== "error") info("channel", t.complete && !issues.length ? `Ανάγνωση από το Channex ${hhmm(rb.ran_at)}: πλήρης συμφωνία (${summary})` : `Ανάγνωση από το Channex ${hhmm(rb.ran_at)}: ${summary}`);
  }
  const syncBeat = beats.find((b) => b.job === "channel-sync");
  if (channelOn && syncBeat) {
    const h = heartbeatState(syncBeat, now);
    if (h.status === "stopped") add("channel", { key: "cron:channel-sync", level: "fail", text: `Ο συγχρονισμός channel manager (cron) δεν έχει ξεκινήσει από ${hhmm(syncBeat.last_start_at)} — ελέγξτε το Cron Jobs στο cPanel`, at: Number(syncBeat.last_start_at) });
    else if (h.status === "hung") add("channel", { key: "cron:channel-sync:hung", level: "fail", text: `Ο συγχρονισμός channel manager τρέχει από ${hhmm(syncBeat.running_since)} χωρίς να τελειώνει`, at: Number(syncBeat.running_since) });
  }
  if (channelOn && st?.last_ok_at) info("channel", `Τελευταίος συγχρονισμός επιβεβαιωμένος ${hhmm(st.last_ok_at)}`);
  if (!channelOn) info("channel", "Ο channel manager δεν είναι συνδεδεμένος");

  // Guest messaging: a failed or stuck message, failed campaign messages.
  for (const d of deliveries) add("messaging", { key: `delivery:${d.id}`, level: "fail", text: `${d.reference} · ${d.guest_name}: «${d.event_key}» (${d.channel}) απέτυχε · ${d.err.slice(0, 140) || "σφάλμα"} · ${d.attempts} προσπάθειες`, action: { type: "retry_delivery", id: Number(d.id) }, at: Number(d.updated_at) });
  for (const d of stuckDeliveries) {
    // v190: «uncertain» = the send started but was never confirmed; it may have reached the guest, so it is never
    // retried automatically — a person checks and decides (send again / mark as sent).
    if (d.status === "uncertain") add("messaging", { key: `uncertain:${d.id}`, level: "warn", text: `${d.reference}: «${d.event_key}» (${d.channel}) — αβέβαιο αν στάλθηκε (η αποστολή διακόπηκε). Ελέγξτε με τον πελάτη πριν την ξαναστείλετε.`, action: { type: "resend_uncertain", id: Number(d.id) }, altAction: { type: "mark_sent", id: Number(d.id) }, at: Number(d.updated_at) });
    else add("messaging", { key: `stuck:${d.id}`, level: d.status === "processing" ? "fail" : "warn", text: `${d.reference}: «${d.event_key}» (${d.channel}) ${d.status === "processing" ? "η αποστολή δεν έχει επιβεβαιωθεί" : "δεν στάλθηκε ενώ έπρεπε"} εδώ και ${ago(now, d.status === "processing" ? d.updated_at : d.scheduled_at)}`, action: d.status === "pending" ? { type: "retry_delivery", id: Number(d.id) } : undefined, at: Number(d.scheduled_at) });
  }
  for (const c of campaignFails) add("messaging", { key: `campaign:${c.name}:${c.channel}`, level: "warn", text: `Καμπάνια «${c.name}»: ${c.n} αποτυχίες (${c.channel}) · ${String(c.err ?? "").slice(0, 100)}`, link: "/pms/campaigns" });
  if (!deliveries.length && !stuckDeliveries.length) info("messaging", "Ουρά αποστολής χωρίς εκκρεμότητες");

  // Payments: an online payment session that expired unpaid may be a payment Stripe took but the PMS never confirmed.
  for (const s of sessions) add("payments", { key: `session:${s.id}`, level: "warn", text: `Online κράτηση ${s.guest_first_name} ${s.guest_last_name} (€${(Number(s.payable_cents) / 100).toFixed(2)}, άφιξη ${s.check_in}) έληξε χωρίς επιβεβαίωση πληρωμής ${s.payment_gateway ? `(${s.payment_gateway})` : ""} — ελέγξτε στο Stripe αν χρεώθηκε`, at: Number(s.created_at) });
  for (const l of balanceLinks) add("payments", { key: `balance:${l.id}`, level: "warn", text: `${l.reference}: πληρωμή υπολοίπου ξεκίνησε πριν ${ago(now, l.updated_at)} χωρίς επιβεβαίωση από το Stripe`, at: Number(l.updated_at) });

  // v189 payment reconciliation: the latest run with Stripe itself and the folio check.
  const stripeRun = recon.find((r) => r.kind === "stripe"), folioRun = recon.find((r) => r.kind === "folio");
  for (const run of [stripeRun, folioRun].filter(Boolean)) {
    let issues = [];
    try { issues = JSON.parse(String(run.issues_json)); } catch { issues = []; }
    const label = run.kind === "stripe" ? "Συμφωνία με Stripe" : "Συμφωνία folio";
    if (run.status === "error") add("payments", { key: `recon:${run.kind}:error`, level: "warn", text: `${label} ${hhmm(run.ran_at)}: δεν ολοκληρώθηκε · ${String(run.error).slice(0, 140)}`, action: { type: "reconcile_now" }, at: Number(run.ran_at) });
    for (const i of issues.slice(0, 15)) add("payments", { key: `recon:${run.kind}:${i.kind}:${i.providerRef ?? i.reference}:${i.amountCents}`, level: i.level === "warn" ? "warn" : "fail", text: `${label}: ${i.detail}`, link: i.reference && i.reference !== "—" ? `/pms/reservations?q=${encodeURIComponent(i.reference)}` : undefined, at: Number(run.ran_at) });
    if (run.status === "ok") info("payments", `${label} ${hhmm(run.ran_at)}: χωρίς διαφορές`);
    if (now - Number(run.ran_at) > 36 * HOUR) add("payments", { key: `recon:${run.kind}:stale`, level: "warn", text: `${label}: τελευταίος έλεγχος ${hhmm(run.ran_at)}`, action: { type: "reconcile_now" }, at: Number(run.ran_at) });
  }

  // myDATA: every document needs a MARK from AADE.
  for (const f of fiscal) add("mydata", { key: `fiscal:${f.id}`, level: f.status === "failed" ? "fail" : "warn", text: `${f.series}-${f.aa}${f.reference ? ` (${f.reference})` : ""} €${(Number(f.total_cents) / 100).toFixed(2)}: ${f.status === "failed" ? `απέτυχε · ${f.err.slice(0, 140)}` : f.status === "sent" ? "στάλθηκε χωρίς MARK" : `σε αναμονή εδώ και ${ago(now, f.created_at)}`}${Number(f.attempts) ? ` · ${f.attempts} προσπάθειες` : ""}`, action: f.status === "sent" ? undefined : { type: "retry_fiscal", id: Number(f.id) }, at: Number(f.created_at) });

  // Devices: TVs in occupied rooms must have reported recently; plugs, sensors and A/C without errors.
  for (const t of tvs) {
    const stale = !t.last_seen_at || now - Number(t.last_seen_at) > 15 * MIN;
    if (t.occupied && stale) add("devices", { key: `tv:${t.room_id}`, level: "fail", text: `Τηλεόραση δωματίου ${t.code} (με πελάτη) χωρίς επιβεβαίωση ${t.last_seen_at ? `από ${hhmm(t.last_seen_at)}` : "ποτέ"}`, link: "/pms/tv", at: Number(t.last_seen_at ?? 0) });
    else if (!t.occupied && stale && t.last_seen_at && now - Number(t.last_seen_at) > 24 * HOUR) add("devices", { key: `tv:${t.room_id}`, level: "warn", text: `Τηλεόραση δωματίου ${t.code} χωρίς επαφή από ${hhmm(t.last_seen_at)}`, link: "/pms/tv", at: Number(t.last_seen_at) });
    if (t.power_error) add("devices", { key: `plug:${t.room_id}`, level: "warn", text: `Πρίζα δωματίου ${t.code}: ${t.power_error.slice(0, 140)}`, link: "/pms/tv" });
  }
  for (const c of climate) {
    if (c.error) add("devices", { key: `climate:${c.room_id}`, level: "warn", text: `Αισθητήρας θερμοκρασίας ${c.code}: ${c.error.slice(0, 140)}`, link: "/pms/room-ac" });
    else if (c.read_at && now - Number(c.read_at) > 2 * HOUR) add("devices", { key: `climate:${c.room_id}`, level: "warn", text: `Αισθητήρας θερμοκρασίας ${c.code}: τελευταία μέτρηση ${hhmm(c.read_at)}`, link: "/pms/room-ac" });
  }
  for (const a of ac) add("devices", { key: `ac:${a.room_id}`, level: "warn", text: `Κλιματισμός ${a.code}: ${a.error.slice(0, 140)}`, link: "/pms/room-ac" });
  // v189 device lifecycle: set up but never connected (a TV paired but never opened, a sensor that never gave a value).
  for (const t of tvNever) if (!t.occupied) add("devices", { key: `tv:${t.room_id}`, level: "warn", text: `Τηλεόραση δωματίου ${t.code}: ρυθμίστηκε ${hhmm(t.created_at)} αλλά δεν συνδέθηκε ποτέ`, link: "/pms/tv", at: Number(t.created_at) });
  for (const c of climateNever) add("devices", { key: `climate:${c.room_id}`, level: "warn", text: `Αισθητήρας θερμοκρασίας ${c.code}: δεν έχει δώσει ποτέ μέτρηση`, link: "/pms/room-ac" });
  for (const a of acNever) add("devices", { key: `ac:${a.room_id}`, level: "warn", text: `Κλιματισμός ${a.code}: ρυθμίστηκε αλλά δεν έχει απαντήσει ποτέ`, link: "/pms/room-ac", at: Number(a.updated_at) });
  for (const a of presenceNever) add("devices", { key: `presence:${a.room_id}`, level: "warn", text: `Αισθητήρας παρουσίας ${a.code}: δεν έχει στείλει ποτέ κατάσταση`, link: "/pms/room-ac" });
  if (tvs.length && !areas.devices) info("devices", `${tvs.length} τηλεοράσεις με πρόσφατη επιβεβαίωση`);

  // Wi-Fi & access cards.
  const br = bridge[0];
  if (br && (!br.last_seen_at || now - Number(br.last_seen_at) > 10 * MIN)) add("network", { key: "bridge", level: "fail", text: `Γέφυρα Raspberry Pi (Omada) χωρίς επαφή ${br.last_seen_at ? `από ${hhmm(br.last_seen_at)}` : "— δεν έχει συνδεθεί ποτέ"}: οι κωδικοί Wi-Fi δεν ενημερώνονται`, link: "/pms/integrations", at: Number(br.last_seen_at ?? 0) });
  for (const w of wifi) add("network", { key: `wifi:${w.booking_id}`, level: w.status === "failed" ? "fail" : "warn", text: `Wi-Fi ${w.reference}${w.code ? ` (δωμ. ${w.code})` : ""}: ${w.status === "failed" ? `απέτυχε · ${String(w.error).slice(0, 120)}` : w.status === "removing" ? "ο κωδικός δεν αφαιρέθηκε μετά το check-out" : "ο κωδικός δεν ενεργοποιήθηκε"}`, at: Number(w.created_at) });
  for (const c of cards) add("network", { key: `card:${c.id}`, level: "warn", text: `Κάρτα πρόσβασης ${c.holder_name}: ${c.send_error ? `δεν στάλθηκε · ${String(c.send_error).slice(0, 120)}` : "δεν έχει σταλεί"}`, link: "/pms/access-cards" });

  // API webhooks to the hotel's systems.
  for (const h of hooks) add("integrations", { key: `hook:${h.id}`, level: Number(h.attempts) >= 5 ? "fail" : "warn", text: `Webhook «${h.event}» → ${String(h.url).replace(/^https?:\/\//, "").slice(0, 60)}: ${h.response_status ? `HTTP ${h.response_status}` : h.err.slice(0, 100) || "χωρίς απάντηση"} · ${h.attempts} προσπάθειες`, action: { type: "retry_webhook", id: Number(h.id) }, at: Number(h.created_at) });

  // Automations: the cron itself (a step that runs every minute must have run lately) and every step's last result.
  // v189 heartbeat (dead-man switch): the start of every run is recorded; a run that never ends is a killed or hung one.
  const gm = steps.find((s) => s.name === "Guest messages");
  const beat = beats.find((b) => b.job === "automations");
  if (beat) {
    const h = heartbeatState(beat, now);
    if (h.status === "stopped" || h.status === "never") add("automations", { key: "cron:stopped", level: "fail", text: `Το cron δεν έχει ξεκινήσει από ${hhmm(beat.last_start_at)} — κανένας αυτοματισμός δεν εκτελείται (μηνύματα, συγχρονισμός, συσκευές). Ελέγξτε το Cron Jobs στο cPanel.`, at: Number(beat.last_start_at) });
    else if (h.status === "hung") add("automations", { key: "cron:hung", level: "fail", text: `Εκτέλεση του cron ξεκίνησε ${hhmm(beat.running_since)} και δεν τελείωσε (κόλλησε ή τερματίστηκε)`, at: Number(beat.running_since) });
    else if (h.status === "late") add("automations", { key: "cron:late", level: "warn", text: `Το cron καθυστερεί: τελευταία έναρξη ${hhmm(beat.last_start_at)}`, at: Number(beat.last_start_at) });
    if (beat.last_status === "killed") add("automations", { key: "cron:killed", level: "warn", text: `Η τελευταία εκτέλεση τερματίστηκε στο όριο χρόνου (${Math.round(Number(beat.last_duration_ms) / 1000)}s) · ${String(beat.last_error).slice(0, 120)}`, at: Number(beat.last_finish_at) });
    info("automations", `Heartbeat: τελευταία έναρξη ${hhmm(beat.last_start_at)}${beat.last_finish_at ? ` · ολοκλήρωση ${hhmm(beat.last_finish_at)} (${Math.round(Number(beat.last_duration_ms) / 1000)}s)` : ""} · ${beat.runs} εκτελέσεις${Number(beat.overlap_count) ? ` · ${beat.overlap_count} επικαλύψεις αποφεύχθηκαν` : ""}`);
  } else if (gm && now - Number(gm.last_run_at) > 10 * MIN) add("automations", { key: "cron:stopped", level: "fail", text: `Το cron δεν έχει τρέξει από ${hhmm(gm.last_run_at)} — κανένας αυτοματισμός δεν εκτελείται (μηνύματα, συγχρονισμός, συσκευές). Ελέγξτε το Cron Jobs στο cPanel.`, at: Number(gm.last_run_at) });
  for (const d of undelivered) add("automations", { key: `alertdelivery:${d.id}`, level: d.status === "failed" ? "fail" : "warn", text: `Η ειδοποίηση «${String(d.title).slice(0, 80)}» ${d.status === "failed" ? "δεν παραδόθηκε" : d.status === "uncertain" ? "ίσως παραδόθηκε (αβέβαιο — δεν ξαναστέλνεται αυτόματα)" : "δεν έχει παραδοθεί ακόμη"} (${d.channel === "email" ? `email ${d.recipient}` : "push στα κινητά"}) · ${d.attempts} προσπάθειες · ${String(d.last_error).slice(0, 100)}`, action: { type: "retry_alert", id: Number(d.id) }, at: Number(d.created_at) });
  if (Number(unacked[0]?.n ?? 0)) info("automations", `${unacked[0].n} κρίσιμες ειδοποιήσεις χωρίς επιβεβαίωση`);
  for (const s of steps) if (s.last_status !== "ok" && s.last_status !== "skipped") add("automations", { key: `step:${s.name}`, level: Number(s.consecutive_failures) >= 3 ? "fail" : "warn", text: `«${s.name}»: ${s.last_status === "timeout" ? "λήξη χρόνου" : "αποτυχία"} ${Number(s.consecutive_failures)} φορές στη σειρά · ${String(s.last_error).slice(0, 140)}${s.last_ok_at ? ` · τελευταία επιτυχία ${hhmm(s.last_ok_at)}` : ""}`, at: Number(s.last_run_at) });
  if (gm && !areas.automations) info("automations", `Όλα τα βήματα OK · τελευταία εκτέλεση ${hhmm(gm.last_run_at)}`);
  if (!gm) info("automations", "Δεν έχει καταγραφεί ακόμη εκτέλεση του cron");

  // v189 backups: a recent, successful backup and a recent restore rehearsal.
  const bk = backups.find((b) => b.kind === "backup"), rh = backups.find((b) => b.kind === "rehearsal");
  if (!bk) add("backups", { key: "backup:none", level: "warn", text: "Δεν έχει καταγραφεί αντίγραφο ασφαλείας της βάσης (cron run-db-backup.mjs)" });
  else if (bk.status !== "ok") add("backups", { key: "backup:failed", level: "fail", text: `Το αντίγραφο ασφαλείας ${hhmm(bk.started_at)} απέτυχε · ${String(bk.error).slice(0, 140)}`, at: Number(bk.started_at) });
  else if (now - Number(bk.started_at) > 26 * HOUR) add("backups", { key: "backup:stale", level: "fail", text: `Τελευταίο αντίγραφο ασφαλείας ${hhmm(bk.started_at)} — το ημερήσιο δεν έγινε`, at: Number(bk.started_at) });
  else info("backups", `Αντίγραφο ${hhmm(bk.started_at)} · ${(Number(bk.size_bytes) / 1048576).toFixed(1)} MB`);
  if (!rh) add("backups", { key: "rehearsal:none", level: "warn", text: "Δεν έχει γίνει δοκιμαστική επαναφορά αντιγράφου (run-restore-rehearsal.mjs)" });
  else {
    let d = {};
    try { d = JSON.parse(String(rh.details_json)); } catch { d = {}; }
    const failedChecks = (d.checks ?? []).filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`).join(" · ");
    if (rh.status === "failed") add("backups", { key: "rehearsal:failed", level: "fail", text: `Η δοκιμαστική επαναφορά ${hhmm(rh.started_at)} απέτυχε · ${(rh.error || failedChecks).slice(0, 180)}`, at: Number(rh.started_at) });
    else if (rh.status === "partial") add("backups", { key: "rehearsal:partial", level: "warn", text: `Δοκιμή ${hhmm(rh.started_at)}: το αρχείο αποκρυπτογραφείται και διαβάζεται (${d.tables ?? "?"} πίνακες), αλλά δεν επαναφέρθηκε σε βάση — ορίστε REHEARSAL_DATABASE_URL για πλήρη δοκιμή`, at: Number(rh.started_at) });
    else info("backups", `Επαναφορά δοκιμάστηκε ${hhmm(rh.started_at)}: ${(d.checks ?? []).length} έλεγχοι OK (${rh.file})`);
    if (now - Number(rh.started_at) > 8 * 24 * HOUR) add("backups", { key: "rehearsal:stale", level: "warn", text: `Τελευταία δοκιμαστική επαναφορά ${hhmm(rh.started_at)} (πάνω από 8 ημέρες)`, at: Number(rh.started_at) });
  }

  // v189 release: the post-install check of the installed version.
  const rel = release[0];
  if (!rel) add("release", { key: "release:none", level: "warn", text: "Δεν έχει καταγραφεί έλεγχος εγκατάστασης (εγκαταστάσεις πριν το v189)" });
  else {
    let qa = {}, checks = [];
    try { qa = JSON.parse(String(rel.qa_json)); checks = JSON.parse(String(rel.checks_json)); } catch { /* shown below without details */ }
    if (version && rel.version !== version) add("release", { key: "release:mismatch", level: "warn", text: `Τρέχει η ${version} αλλά ο τελευταίος έλεγχος εγκατάστασης είναι για την ${rel.version}` });
    if (rel.status === "failed") add("release", { key: "release:failed", level: "fail", text: `Έλεγχος εγκατάστασης ${rel.version}: ${checks.filter((c) => c.status === "fail").map((c) => `${c.name} — ${c.detail}`).join(" · ").slice(0, 200)}` });
    else if (rel.status === "unverified") add("release", { key: "release:unverified", level: "warn", text: `Έκδοση ${rel.version}: ${checks.filter((c) => c.status !== "ok").map((c) => `${c.name} — ${c.detail}`).join(" · ").slice(0, 200)}` });
    // v191: external providers not certified in sandbox for this package are said so, never implied as verified.
    const sb = Array.isArray(qa.sandbox) ? qa.sandbox : [];
    const notRun = sb.filter((x) => x.status !== "PASS");
    if (notRun.length) add("release", { key: "release:sandbox", level: "warn", text: `Εξωτερικοί πάροχοι χωρίς πιστοποίηση σε sandbox για την ${rel.version}: ${notRun.map((x) => `${x.name} (${x.status})`).join(" · ").slice(0, 300)}` });
    if (qa.verdict) info("release", `${rel.version} · QA ${qa.passed}/${qa.total} ${qa.verdict} (${String(qa.at ?? "").slice(0, 10)}, commit ${qa.commit ?? "—"})${qa.files ? ` · ${qa.files} αρχεία επαληθεύτηκαν` : ""}`);
    info("release", `Έλεγχος εγκατάστασης ${hhmm(rel.ran_at)}: ${checks.map((c) => `${c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "✗"} ${c.name}`).join(" · ")}`);
  }

  const out = AREAS.map((a) => {
    const x = areas[a.key] ?? { items: [], info: [] };
    const inactive = a.key === "channel" && !channelOn && !x.items.length;
    return { key: a.key, el: a.el, en: a.en, status: inactive ? "inactive" : worst(x.items), summary: x.items.length ? `${x.items.length} ${x.items.length === 1 ? "θέμα" : "θέματα"}` : x.info[0] ?? "Χωρίς εκκρεμότητες", info: x.info, items: x.items.sort((p, q) => (p.level === q.level ? Number(q.at ?? 0) - Number(p.at ?? 0) : p.level === "fail" ? -1 : 1)) };
  });
  return { at: now, status: out.some((a) => a.status === "fail") ? "fail" : out.some((a) => a.status === "warn") ? "warn" : "ok", areas: out };
}

/** Recovery actions (the PMS «Επανάληψη» buttons). Returns how many tasks were queued again. */
export async function recoverReliability({ pool, owner, type, id = null, now = Date.now() }) {
  const by = id === null ? "" : " AND id=$3";
  const p = id === null ? [owner, now] : [owner, now, id];
  const run = async (sql) => (await pool.query(sql, p)).rowCount ?? 0;
  if (type === "retry_outbox") return run(`UPDATE channel_sync_outbox SET status='pending',next_attempt_at=0,last_error=NULL,updated_at=$2 WHERE owner_id=$1 AND (status IN ('pending','failed') OR (status='processing' AND updated_at<$2::bigint-600000))${by}`);
  // v190: only work that definitely did not go out is taken back; «processing» / «uncertain» never automatically.
  if (type === "retry_delivery") return run(`UPDATE message_deliveries SET status='pending',scheduled_at=$2,last_error=NULL,updated_at=$2 WHERE owner_id=$1 AND status IN ('failed','pending')${by}`);
  if (type === "resend_uncertain" || type === "mark_sent") {
    if (id === null) throw Error("ID_REQUIRED");
    return run(type === "resend_uncertain"
      ? `UPDATE message_deliveries SET status='pending',scheduled_at=$2,last_error='Νέα αποστολή μετά από έλεγχο (αβέβαιο αποτέλεσμα)',updated_at=$2 WHERE owner_id=$1 AND status='uncertain' AND id=$3`
      : `UPDATE message_deliveries SET status='sent',last_error='Επιβεβαιώθηκε χειροκίνητα ότι στάλθηκε',updated_at=$2 WHERE owner_id=$1 AND status='uncertain' AND id=$3`);
  }
  if (type === "retry_fiscal") return run(`UPDATE fiscal_documents SET status='pending',next_attempt_at=$2,updated_at=$2 WHERE owner_id=$1 AND status IN ('failed','pending')${by}`);
  if (type === "retry_webhook") return run(`UPDATE api_webhook_deliveries SET status='pending',next_at=$2 WHERE owner_id=$1 AND status<>'sent'${by}`);
  if (type === "retry_alert") return run(`UPDATE alert_outbox SET status='pending',attempts=0,next_attempt_at=0,updated_at=$2 WHERE owner_id=$1 AND status IN ('failed','pending')${by}`);
  if (type === "resync_ota") { const r = await otaReconcile({ pool, owner, now }); return r.active ? queueOtaResync({ pool, owner, mismatches: r.mismatches, now }) : 0; }
  throw Error("UNKNOWN_ACTION");
}

/**
 * The cron (every 10 minutes): every critical problem becomes an alert — told once (PMS notification, push to the
 * front desk, e-mail to the administrators, each delivery confirmed and retried), resolved when it clears, told again
 * if it returns, and escalated when nobody acknowledged it within 30 minutes.
 */
export async function runReliabilityAlerts({ pool, owner, now = Date.now(), emails = null }) {
  const { raiseAlert, resolveAlerts, escalateAlerts } = await import("./alert-core.mjs");
  const r = await checkReliability({ pool, owner, now });
  const failing = r.areas.flatMap((a) => a.items.filter((i) => i.level === "fail").map((i) => ({ area: a, item: i })));
  // v190: EVERY critical problem becomes an alert (none dropped), most important areas first. The PMS notification
  // list gets at most 10 new entries per run plus one summary; every alert still gets its deliveries, which the
  // alert outbox sends in order, 30 per minute.
  const PRIORITY = ["payments", "channel", "automations", "backups", "release", "mydata", "messaging", "network", "devices", "integrations"];
  const rank = (k) => { const i = PRIORITY.indexOf(k); return i < 0 ? PRIORITY.length : i; };
  failing.sort((a, b) => rank(a.area.key) - rank(b.area.key));
  let told = 0, silent = 0;
  for (const f of failing) {
    const res = await raiseAlert({ pool, owner, key: `rel:${f.item.key}`, area: f.area.key, severity: "fail", title: `${f.area.el}: ${f.item.text}`, titleEn: `${f.area.en}: problem (see Reliability center)`, link: "/pms/reliability", now, emails, notify: told < 10 });
    if (res.fresh) { if (told < 10) told++; else silent++; }
  }
  if (silent) await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/reliability',$4)`, [owner, `⚠️ Και ${silent} ακόμη νέα προβλήματα — δείτε το Κέντρο αξιοπιστίας`, `⚠️ ${silent} more new problems — see the Reliability center`, now]);
  told += silent;
  const resolved = await resolveAlerts({ pool, owner, activeKeys: failing.map((f) => `rel:${f.item.key}`), now });
  const escalated = await escalateAlerts({ pool, owner, now, emails });
  await pool.query(`INSERT INTO reliability_state(owner_id,alerted_json,status,checked_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO UPDATE SET alerted_json=$2,status=$3,checked_at=$4`, [owner, JSON.stringify(failing.map((f) => f.item.key).slice(0, 300)), r.status, now]);
  return { status: r.status, told, resolved, escalated, failing: failing.length };
}

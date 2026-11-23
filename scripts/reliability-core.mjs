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

export const AREAS = [
  { key: "channel", el: "Booking & Channel Manager", en: "Booking & Channel Manager" },
  { key: "messaging", el: "Μηνύματα πελατών", en: "Guest messaging" },
  { key: "payments", el: "Πληρωμές", en: "Payments" },
  { key: "mydata", el: "myDATA", en: "myDATA" },
  { key: "devices", el: "Corali TV / IoT", en: "Corali TV / IoT" },
  { key: "network", el: "Wi-Fi πελατών & κάρτες πρόσβασης", en: "Guest Wi-Fi & access cards" },
  { key: "integrations", el: "API & webhooks", en: "API & webhooks" },
  { key: "automations", el: "Αυτοματισμοί (cron)", en: "Automations (cron)" },
];

/** Every check; `now` is passed so the result is reproducible in tests. */
export async function checkReliability({ pool, owner, now = Date.now() }) {
  const P = [owner, now];
  const [outbox, syncState, channex, otaNoRoom, deliveries, stuckDeliveries, campaignFails, sessions, balanceLinks, fiscal, tvs, climate, ac, bridge, wifi, cards, hooks, steps] = await Promise.all([
    one(pool, `SELECT id,date_from,date_to,reason,status,attempts,COALESCE(last_error,'') err,created_at FROM channel_sync_outbox WHERE owner_id=$1 AND status IN ('pending','failed','processing') AND created_at<$2::bigint-10*60000 ORDER BY created_at LIMIT 50`, P),
    one(pool, `SELECT last_run_at,last_ok_at,COALESCE(last_error,'') last_error,last_webhook_at FROM channel_sync_state WHERE owner_id=$1`, [owner]),
    one(pool, `SELECT 1 FROM provider_connections WHERE owner_id=$1 AND provider_key='channex' AND active=1`, [owner]).catch(() => []),
    one(pool, `SELECT id,reference,guest_name,check_in,external_room_type FROM bookings WHERE owner_id=$1 AND room_id IS NULL AND external_room_type IS NOT NULL AND status='confirmed' AND check_in<=(to_char(now() AT TIME ZONE 'Europe/Athens','YYYY-MM-DD')::date+14)::text ORDER BY check_in LIMIT 30`, [owner]),
    one(pool, `SELECT d.id,d.event_key,d.channel,COALESCE(d.last_error,'') err,d.attempts,d.updated_at,b.reference,b.guest_name FROM message_deliveries d JOIN bookings b ON b.owner_id=d.owner_id AND b.id=d.booking_id WHERE d.owner_id=$1 AND d.status='failed' AND d.updated_at>$2::bigint-7*86400000 ORDER BY d.updated_at DESC LIMIT 50`, P),
    one(pool, `SELECT d.id,d.event_key,d.channel,d.status,d.scheduled_at,d.updated_at,b.reference FROM message_deliveries d JOIN bookings b ON b.owner_id=d.owner_id AND b.id=d.booking_id WHERE d.owner_id=$1 AND ((d.status='pending' AND d.scheduled_at<$2::bigint-20*60000 AND d.scheduled_at>$2::bigint-3*86400000) OR (d.status='processing' AND d.updated_at<$2::bigint-15*60000)) ORDER BY d.scheduled_at LIMIT 50`, P),
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
  if (channelOn && st?.last_ok_at) info("channel", `Τελευταίος συγχρονισμός επιβεβαιωμένος ${hhmm(st.last_ok_at)}`);
  if (!channelOn) info("channel", "Ο channel manager δεν είναι συνδεδεμένος");

  // Guest messaging: a failed or stuck message, failed campaign messages.
  for (const d of deliveries) add("messaging", { key: `delivery:${d.id}`, level: "fail", text: `${d.reference} · ${d.guest_name}: «${d.event_key}» (${d.channel}) απέτυχε · ${d.err.slice(0, 140) || "σφάλμα"} · ${d.attempts} προσπάθειες`, action: { type: "retry_delivery", id: Number(d.id) }, at: Number(d.updated_at) });
  for (const d of stuckDeliveries) add("messaging", { key: `stuck:${d.id}`, level: d.status === "processing" ? "fail" : "warn", text: `${d.reference}: «${d.event_key}» (${d.channel}) ${d.status === "processing" ? "κόλλησε στην αποστολή" : "δεν στάλθηκε ενώ έπρεπε"} εδώ και ${ago(now, d.status === "processing" ? d.updated_at : d.scheduled_at)}`, action: { type: "retry_delivery", id: Number(d.id) }, at: Number(d.scheduled_at) });
  for (const c of campaignFails) add("messaging", { key: `campaign:${c.name}:${c.channel}`, level: "warn", text: `Καμπάνια «${c.name}»: ${c.n} αποτυχίες (${c.channel}) · ${String(c.err ?? "").slice(0, 100)}`, link: "/pms/campaigns" });
  if (!deliveries.length && !stuckDeliveries.length) info("messaging", "Ουρά αποστολής χωρίς εκκρεμότητες");

  // Payments: an online payment session that expired unpaid may be a payment Stripe took but the PMS never confirmed.
  for (const s of sessions) add("payments", { key: `session:${s.id}`, level: "warn", text: `Online κράτηση ${s.guest_first_name} ${s.guest_last_name} (€${(Number(s.payable_cents) / 100).toFixed(2)}, άφιξη ${s.check_in}) έληξε χωρίς επιβεβαίωση πληρωμής ${s.payment_gateway ? `(${s.payment_gateway})` : ""} — ελέγξτε στο Stripe αν χρεώθηκε`, at: Number(s.created_at) });
  for (const l of balanceLinks) add("payments", { key: `balance:${l.id}`, level: "warn", text: `${l.reference}: πληρωμή υπολοίπου ξεκίνησε πριν ${ago(now, l.updated_at)} χωρίς επιβεβαίωση από το Stripe`, at: Number(l.updated_at) });

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
  if (tvs.length && !areas.devices) info("devices", `${tvs.length} τηλεοράσεις με πρόσφατη επιβεβαίωση`);

  // Wi-Fi & access cards.
  const br = bridge[0];
  if (br && (!br.last_seen_at || now - Number(br.last_seen_at) > 10 * MIN)) add("network", { key: "bridge", level: "fail", text: `Γέφυρα Raspberry Pi (Omada) χωρίς επαφή ${br.last_seen_at ? `από ${hhmm(br.last_seen_at)}` : "— δεν έχει συνδεθεί ποτέ"}: οι κωδικοί Wi-Fi δεν ενημερώνονται`, link: "/pms/integrations", at: Number(br.last_seen_at ?? 0) });
  for (const w of wifi) add("network", { key: `wifi:${w.booking_id}`, level: w.status === "failed" ? "fail" : "warn", text: `Wi-Fi ${w.reference}${w.code ? ` (δωμ. ${w.code})` : ""}: ${w.status === "failed" ? `απέτυχε · ${String(w.error).slice(0, 120)}` : w.status === "removing" ? "ο κωδικός δεν αφαιρέθηκε μετά το check-out" : "ο κωδικός δεν ενεργοποιήθηκε"}`, at: Number(w.created_at) });
  for (const c of cards) add("network", { key: `card:${c.id}`, level: "warn", text: `Κάρτα πρόσβασης ${c.holder_name}: ${c.send_error ? `δεν στάλθηκε · ${String(c.send_error).slice(0, 120)}` : "δεν έχει σταλεί"}`, link: "/pms/access-cards" });

  // API webhooks to the hotel's systems.
  for (const h of hooks) add("integrations", { key: `hook:${h.id}`, level: Number(h.attempts) >= 5 ? "fail" : "warn", text: `Webhook «${h.event}» → ${String(h.url).replace(/^https?:\/\//, "").slice(0, 60)}: ${h.response_status ? `HTTP ${h.response_status}` : h.err.slice(0, 100) || "χωρίς απάντηση"} · ${h.attempts} προσπάθειες`, action: { type: "retry_webhook", id: Number(h.id) }, at: Number(h.created_at) });

  // Automations: the cron itself (a step that runs every minute must have run lately) and every step's last result.
  const gm = steps.find((s) => s.name === "Guest messages");
  if (gm && now - Number(gm.last_run_at) > 10 * MIN) add("automations", { key: "cron:stopped", level: "fail", text: `Το cron δεν έχει τρέξει από ${hhmm(gm.last_run_at)} — κανένας αυτοματισμός δεν εκτελείται (μηνύματα, συγχρονισμός, συσκευές). Ελέγξτε το Cron Jobs στο cPanel.`, at: Number(gm.last_run_at) });
  for (const s of steps) if (s.last_status !== "ok") add("automations", { key: `step:${s.name}`, level: Number(s.consecutive_failures) >= 3 ? "fail" : "warn", text: `«${s.name}»: ${s.last_status === "timeout" ? "λήξη χρόνου" : "αποτυχία"} ${Number(s.consecutive_failures)} φορές στη σειρά · ${String(s.last_error).slice(0, 140)}${s.last_ok_at ? ` · τελευταία επιτυχία ${hhmm(s.last_ok_at)}` : ""}`, at: Number(s.last_run_at) });
  if (gm && !areas.automations) info("automations", `Όλα τα βήματα OK · τελευταία εκτέλεση ${hhmm(gm.last_run_at)}`);
  if (!gm) info("automations", "Δεν έχει καταγραφεί ακόμη εκτέλεση του cron");

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
  if (type === "retry_outbox") return run(`UPDATE channel_sync_outbox SET status='pending',next_attempt_at=0,last_error=NULL,updated_at=$2 WHERE owner_id=$1 AND status IN ('pending','failed','processing')${by}`);
  if (type === "retry_delivery") return run(`UPDATE message_deliveries SET status='pending',scheduled_at=$2,last_error=NULL,updated_at=$2 WHERE owner_id=$1 AND status IN ('failed','pending','processing')${by}`);
  if (type === "retry_fiscal") return run(`UPDATE fiscal_documents SET status='pending',next_attempt_at=$2,updated_at=$2 WHERE owner_id=$1 AND status IN ('failed','pending')${by}`);
  if (type === "retry_webhook") return run(`UPDATE api_webhook_deliveries SET status='pending',next_at=$2 WHERE owner_id=$1 AND status<>'sent'${by}`);
  throw Error("UNKNOWN_ACTION");
}

/** The cron: one PMS notification per new problem (fail level); a problem that clears and returns is told again. */
export async function runReliabilityAlerts({ pool, owner, now = Date.now() }) {
  const r = await checkReliability({ pool, owner, now });
  const failing = r.areas.flatMap((a) => a.items.filter((i) => i.level === "fail").map((i) => ({ area: a, item: i })));
  const prev = (await pool.query(`SELECT alerted_json FROM reliability_state WHERE owner_id=$1`, [owner])).rows[0];
  let told = [];
  try { told = JSON.parse(String(prev?.alerted_json ?? "[]")); } catch { told = []; }
  const fresh = failing.filter((f) => !told.includes(f.item.key));
  for (const f of fresh.slice(0, 10)) {
    await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/reliability',$4)`, [owner, `⚠️ ${f.area.el}: ${f.item.text}`.slice(0, 300), `⚠️ ${f.area.en}: problem (see Reliability center)`.slice(0, 300), now]);
  }
  await pool.query(`INSERT INTO reliability_state(owner_id,alerted_json,status,checked_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO UPDATE SET alerted_json=$2,status=$3,checked_at=$4`, [owner, JSON.stringify(failing.map((f) => f.item.key).slice(0, 300)), r.status, now]);
  return { status: r.status, told: fresh.length, failing: failing.length };
}

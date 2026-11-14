// «Ενεργοποίηση εισερχομένων» WhatsApp in the automation cron (every minute), so the PMS page never waits on Meta:
// the button only records a request; here the Meta app's WhatsApp webhook is pointed at the booking site (Meta checks
// it with the stored verify token) and the app is subscribed to the hotel's WhatsApp account. The result is saved on
// the connection and shown in PMS → Συνδέσεις → WhatsApp.

const graphError = (j) => String(j?.error?.error_user_msg || j?.error?.message || "Άγνωστο σφάλμα της Meta").slice(0, 300);

async function graph(fetchImpl, url, init) {
  try {
    const r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && !j.error, json: j };
  } catch {
    return { ok: false, json: { error: { message: "Η Meta δεν απάντησε (timeout)." } } };
  }
}

/** Does one pending setup; `credentials(key)` is the automation runner's provider reader. */
export async function runWhatsAppInboxSetup({ pool, owner, credentials, origin, fetchImpl = fetch, now = Date.now() }) {
  const c = await credentials("whatsapp").catch(() => null);
  if (!c || c.disabled) return { ran: false };
  const s = c.settings ?? {}, x = c.secrets ?? {};
  const requested = Number(s.inboxSetupRequestedAt || 0), done = Number(s.inboxSetupDoneAt || 0);
  if (!requested || done >= requested) return { ran: false };
  const save = async (result) => {
    await pool.query(
      `UPDATE provider_connections SET settings_json=(settings_json::jsonb || $3::jsonb)::text WHERE owner_id=$1 AND provider_key=$2`,
      [owner, "whatsapp", JSON.stringify({ inboxSetupDoneAt: String(now), inboxSetupResult: result })],
    );
    await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/integrations',$4)`, [owner, result === "ok" ? "✓ Τα εισερχόμενα WhatsApp ενεργοποιήθηκαν" : `Τα εισερχόμενα WhatsApp δεν ενεργοποιήθηκαν: ${result}`.slice(0, 300), result === "ok" ? "✓ WhatsApp inbox enabled" : `WhatsApp inbox not enabled: ${result}`.slice(0, 300), now]);
    return { ran: true, result };
  };
  const appId = String(s.appId ?? ""), waba = String(s.businessAccountId ?? ""), version = /^v\d+\.\d+$/.test(String(s.apiVersion ?? "")) ? s.apiVersion : "v26.0";
  if (!/^\d{5,25}$/.test(appId) || !x.appSecret) return save("λείπει το App ID ή το App secret");
  if (!x.accessToken || !/^\d{5,30}$/.test(waba)) return save("λείπει ο κωδικός πρόσβασης ή το Business account ID");
  if (!x.verifyToken) return save("λείπει το verify token");
  const base = `https://graph.facebook.com/${version}`, callback = `${String(origin).replace(/\/$/, "")}/api/webhooks/meta`;
  const hook = await graph(fetchImpl, `${base}/${appId}/subscriptions`, { method: "POST", body: new URLSearchParams({ object: "whatsapp_business_account", callback_url: callback, verify_token: x.verifyToken, fields: "messages", include_values: "true", access_token: `${appId}|${x.appSecret}` }) });
  if (!hook.ok) return save(`η Meta δεν αποδέχτηκε τη διεύθυνση (${graphError(hook.json)})`);
  const sub = await graph(fetchImpl, `${base}/${waba}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${x.accessToken}` } });
  if (!sub.ok) return save(`η εφαρμογή δεν συνδέθηκε με τον λογαριασμό WhatsApp (${graphError(sub.json)})`);
  return save("ok");
}

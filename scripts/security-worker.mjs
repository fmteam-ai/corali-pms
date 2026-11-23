// v180: the hourly security check (cron): counts of the last hour, admins without 2FA, the Cloudflare lock — each new
// problem becomes one PMS notification (PMS → Security center). Old counters (30+ days) are removed.
import { alertText, securityAlerts } from "./security-core.mjs";
import { raiseAlert } from "./alert-core.mjs";

export async function runSecurityCheck({ pool, owner, now = Date.now() }) {
  const hourAgo = now - 3_600_000;
  const [events, failed, admins, settings] = await Promise.all([
    pool.query(`SELECT kind,sum(count)::int AS n FROM security_events WHERE owner_id=$1 AND last_at>$2 GROUP BY kind`, [owner, hourAgo]),
    pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE owner_id=$1 AND action IN ('security.login_failed','security.login_blocked') AND created_at>$2::bigint`, [owner, hourAgo]),
    pool.query(`SELECT username,COALESCE(NULLIF(role,''),'readonly') AS role,totp_confirmed_at FROM pms_staff_users WHERE owner_id=$1 AND active=1`, [owner]),
    pool.query(`SELECT edge_enforce,edge_last_seen_at,alerted_json FROM security_settings WHERE owner_id=$1`, [owner]),
  ]);
  const counts = Object.fromEntries(events.rows.map((r) => [String(r.kind), Number(r.n)]));
  counts.login_failed = Number(failed.rows[0]?.n ?? 0);
  const s = settings.rows[0];
  const alerts = securityAlerts({
    counts,
    admins: admins.rows.map((a) => ({ username: String(a.username), role: String(a.role), totp: Boolean(a.totp_confirmed_at) })),
    edge: s ? { enforce: Number(s.edge_enforce) === 1, lastSeenAt: s.edge_last_seen_at ? Number(s.edge_last_seen_at) : null } : null,
    now,
  });
  let told = [];
  try { told = JSON.parse(String(s?.alerted_json ?? "[]")); } catch { told = []; }
  const fresh = alerts.filter((a) => !told.includes(a.key));
  for (const a of fresh) {
    const text = alertText(a);
    await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/security',$4)`, [owner, text.el.slice(0, 300), text.en.slice(0, 300), now]);
  }
  // Remember what is still true, so a problem that goes away and comes back is told again.
  await pool.query(
    `INSERT INTO security_settings(owner_id,alerted_json,updated_at) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET alerted_json=$2`,
    [owner, JSON.stringify(alerts.map((a) => a.key).slice(0, 100)), now],
  );
  // v198: the «lock open» alert (raised at once by the PMS on the first request) also from here — the case with no
  // request at all — and resolved as soon as the key arrives again.
  const stale = alerts.some((a) => a.kind === "edge_stale");
  if (stale) await raiseAlert({ pool, owner, key: "security:edge_open", area: "security", severity: "fail", title: "🛡️ Το κλείδωμα Cloudflare δεν λαμβάνει το κλειδί εδώ και 30′ — ελέγξτε τον κανόνα στο Cloudflare", link: "/pms/security", now }).catch(() => undefined);
  else await pool.query(`UPDATE alerts SET resolved_at=$2 WHERE owner_id=$1 AND alert_key='security:edge_open' AND resolved_at IS NULL`, [owner, now]).catch(() => undefined);
  await pool.query(`DELETE FROM security_events WHERE owner_id=$1 AND hour_at<$2`, [owner, now - 30 * 86_400_000]);
  return { alerts: alerts.length, told: fresh.length };
}

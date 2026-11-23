#!/usr/bin/env node
// v198: safe recovery of the Cloudflare origin lock from the server itself (cPanel terminal) — the way back in when the
// lock protects the administration and Cloudflare stopped sending the key. Needs shell access to the server: it is
// not reachable from the internet, so it is not a general fail-open.
//
//   node --env-file=runtime.env scripts/edge-lock.mjs status
//   node --env-file=runtime.env scripts/edge-lock.mjs off        # switch the lock off (recorded, owner notified)
//   node --env-file=runtime.env scripts/edge-lock.mjs open-all   # keep the lock, but stale → everything opens
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { edgeDecision } from "./security-core.mjs";

const [cmd = "status"] = process.argv.slice(2);
const owner = process.env.PMS_OWNER_ID;
if (!owner) { console.error("PMS_OWNER_ID is missing (run with --env-file=runtime.env)"); process.exit(2); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl(), max: 1 });
try {
  const now = Date.now();
  const r = (await pool.query(`SELECT edge_secret_hash,edge_enforce,edge_last_seen_at,edge_stale_policy FROM security_settings WHERE owner_id=$1`, [owner])).rows[0];
  const enforce = Number(r?.edge_enforce) === 1, lastSeenAt = r?.edge_last_seen_at ? Number(r.edge_last_seen_at) : null, policy = String(r?.edge_stale_policy ?? "open_all");
  const stale = enforce && edgeDecision({ enforce, keyOk: false, lastSeenAt, now }) === "open";
  if (cmd === "status") {
    console.log(JSON.stringify({ configured: Boolean(r?.edge_secret_hash), enforce, policy, lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null, stale }, null, 2));
  } else if (cmd === "off" || cmd === "open-all") {
    const sql = cmd === "off" ? `UPDATE security_settings SET edge_enforce=0,updated_at=$2 WHERE owner_id=$1` : `UPDATE security_settings SET edge_stale_policy='open_all',updated_at=$2 WHERE owner_id=$1`;
    await pool.query(sql, [owner, now]);
    const what = cmd === "off" ? "απενεργοποιήθηκε" : "ορίστηκε σε «Άνοιγμα όλων»";
    await pool.query(`INSERT INTO audit_logs(owner_id,user_id,action,entity_name,entity_id,payload_before,payload_after,ip_address,user_agent,created_at) VALUES($1,NULL,$2,'security','edge',$3,$4,'server-console','edge-lock.mjs',$5)`, [owner, `security.edge_${cmd.replace("-", "_")}`, JSON.stringify({ enforce, policy }), JSON.stringify(cmd === "off" ? { enforce: false } : { policy: "open_all" }), now]);
    await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/security',$4)`, [owner, `🛡️ Το κλείδωμα Cloudflare ${what} από το τερματικό του server`, `Cloudflare lock changed from the server console (${cmd})`, now]);
    console.log(`OK — ${cmd}. Οι εφαρμογές το βλέπουν μέσα σε 30 δευτερόλεπτα.`);
  } else { console.error("usage: edge-lock.mjs status | off | open-all"); process.exitCode = 2; }
} finally { await pool.end(); }

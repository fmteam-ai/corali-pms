// v177: per-booking Wi-Fi password on TP-Link Omada (see omada-core.mjs). Every 5 minutes from the automation cron:
// a checked-in stay without a password gets one (added to the guest SSID's PPSK profile); a password whose stay ended
// (checked out, cancelled, or past its check-out day) is removed. Failures are kept on the row and retried next run.
import { guestPassword, omadaClient, privateController, pskName, wifiPlan } from "./omada-core.mjs";

export async function runGuestWifi({ pool, owner, credentials, seal, now = Date.now(), today }) {
  const c = await credentials("omada").catch(() => null);
  if (!c || c.disabled) return null;
  const s = c.settings ?? {}, conn = { url: s.interfaceUrl, omadacId: s.omadacId, clientId: c.secrets?.clientId, clientSecret: c.secrets?.clientSecret };
  const stays = (await pool.query(`SELECT b.id,b.reference,b.status,b.check_in,b.check_out,b.room_id FROM bookings b WHERE b.owner_id=$1 AND b.status='checked_in' AND b.check_out>=$2`, [owner, today])).rows
    .map((b) => ({ ...b, check_in: String(b.check_in).slice(0, 10), check_out: String(b.check_out).slice(0, 10) }));
  const entries = (await pool.query(`SELECT booking_id,psk_name,status FROM guest_wifi WHERE owner_id=$1 AND status IN ('active','pending')`, [owner])).rows;
  const plan = wifiPlan(stays, entries, today);
  if (!plan.add.length && !plan.remove.length) return { added: 0, removed: 0, failed: 0 };
  // v179: a controller inside the hotel (e.g. https://192.168.10.2) is reached by the hotel's bridge (Raspberry Pi):
  // the PMS only chooses the passwords and marks what to add / remove; the bridge does it and reports back.
  if (privateController(s.interfaceUrl)) {
    for (const b of plan.add) {
      await pool.query(
        `INSERT INTO guest_wifi(owner_id,booking_id,room_id,psk_name,psk_encrypted,ssid,status,error,created_at,removed_at) VALUES($1,$2,$3,$4,$5,$6,'pending','',$7,NULL)
         ON CONFLICT(owner_id,booking_id) DO UPDATE SET room_id=$3,psk_name=$4,psk_encrypted=$5,ssid=$6,status='pending',error='',created_at=$7,removed_at=NULL`,
        [owner, b.id, b.room_id, pskName(b.reference), seal(guestPassword()), String(s.ssid ?? ""), now],
      );
    }
    if (plan.remove.length) await pool.query(`UPDATE guest_wifi SET status='removing' WHERE owner_id=$1 AND booking_id=ANY($2::bigint[]) AND status IN ('active','pending')`, [owner, plan.remove.map((e) => Number(e.booking_id))]);
    return { added: 0, removed: 0, failed: 0, queued: plan.add.length + plan.remove.length };
  }
  const api = omadaClient(conn);
  const siteId = await api.siteId(s.siteName);
  const profile = await api.profile(siteId, s.profile);
  let added = 0, removed = 0, failed = 0;
  for (const b of plan.add) {
    const name = pskName(b.reference), psk = guestPassword();
    try {
      // A retry after a lost answer: the entry may already exist under this name — replace it with the new password.
      if ((await api.psks(siteId, profile.id)).includes(name)) await api.deletePsks(siteId, profile.id, [name]);
      await api.addPsk(siteId, profile.id, name, psk);
      await pool.query(
        `INSERT INTO guest_wifi(owner_id,booking_id,room_id,psk_name,psk_encrypted,ssid,status,error,created_at,removed_at) VALUES($1,$2,$3,$4,$5,$6,'active','',$7,NULL)
         ON CONFLICT(owner_id,booking_id) DO UPDATE SET room_id=$3,psk_name=$4,psk_encrypted=$5,ssid=$6,status='active',error='',created_at=$7,removed_at=NULL`,
        [owner, b.id, b.room_id, name, seal(psk), String(s.ssid ?? (profile.ssids[0] ?? "")), now],
      );
      added++;
    } catch (e) {
      failed++;
      await pool.query(`INSERT INTO guest_wifi(owner_id,booking_id,room_id,psk_name,psk_encrypted,ssid,status,error,created_at) VALUES($1,$2,$3,$4,'','','failed',$5,$6)
        ON CONFLICT(owner_id,booking_id) DO UPDATE SET status=CASE WHEN guest_wifi.status='active' THEN 'active' ELSE 'failed' END,error=$5`, [owner, b.id, b.room_id, name, String(e instanceof Error ? e.message : e).slice(0, 120), now]);
    }
  }
  if (plan.remove.length) {
    const names = plan.remove.map((e) => String(e.psk_name));
    try {
      await api.deletePsks(siteId, profile.id, names);
      await pool.query(`UPDATE guest_wifi SET status='removed',removed_at=$1,error='' WHERE owner_id=$2 AND booking_id=ANY($3::bigint[]) AND status='active'`, [now, owner, plan.remove.map((e) => Number(e.booking_id))]);
      removed += names.length;
    } catch (e) {
      failed += names.length;
      await pool.query(`UPDATE guest_wifi SET error=$1 WHERE owner_id=$2 AND booking_id=ANY($3::bigint[])`, [String(e instanceof Error ? e.message : e).slice(0, 120), owner, plan.remove.map((e) => Number(e.booking_id))]);
    }
  }
  return { added, removed, failed };
}

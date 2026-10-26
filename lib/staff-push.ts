// Web Push to the Corali Staff app: alerts reach the phone even when the app is closed (Android, and iPhone with the
// app added to the home screen, iOS 16.4+). The VAPID keys are created once per hotel and kept in the database.
import webpush from "web-push";
import { after } from "next/server";
import { db } from "@/lib/db";
import { isDesk, normalizeAlertKinds, normalizeModules, roleModules, type AlertKind, type StaffModule } from "@/lib/staff-core";

export type PushText = { el: string; en: string };
export type PushMessage = { kind: AlertKind; title: PushText; body: PushText; url: string; tag?: string };
/** Who gets it: listed people, a specialty's members, everyone with an app section, the front desk, all other staff, or everyone. */
export type PushAudience = { userIds?: number[]; specialtyId?: number; module?: StaffModule; desk?: boolean; staff?: boolean; everyone?: boolean };

export async function vapidPublicKey(ownerId: string): Promise<string> {
  return (await vapidKeys(ownerId)).public_key;
}

async function vapidKeys(ownerId: string): Promise<{ public_key: string; private_key: string }> {
  const found = (await db().query(`SELECT public_key,private_key FROM push_vapid WHERE owner_id=$1`, [ownerId])).rows[0];
  if (found) return found;
  const k = webpush.generateVAPIDKeys();
  await db().query(`INSERT INTO push_vapid(owner_id,public_key,private_key,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO NOTHING`, [ownerId, k.publicKey, k.privateKey, Date.now()]);
  return (await db().query(`SELECT public_key,private_key FROM push_vapid WHERE owner_id=$1`, [ownerId])).rows[0];
}

async function audienceIds(ownerId: string, a: PushAudience): Promise<number[]> {
  const users = (await db().query(
    `SELECT u.id,u.role,COALESCE(json_agg(s.modules_json) FILTER (WHERE s.id IS NOT NULL),'[]') AS modules,COALESCE(array_agg(s.id) FILTER (WHERE s.id IS NOT NULL),'{}') AS specialty_ids
       FROM pms_staff_users u
       LEFT JOIN staff_user_specialties us ON us.owner_id=u.owner_id AND us.staff_user_id=u.id
       LEFT JOIN staff_specialties s ON s.owner_id=us.owner_id AND s.id=us.specialty_id AND s.active=1
      WHERE u.owner_id=$1 AND u.active=1 GROUP BY u.id,u.role`,
    [ownerId],
  )).rows;
  return users.filter((u) => {
    if (a.everyone) return true;
    if (a.userIds?.includes(Number(u.id))) return true;
    if (a.desk && isDesk(String(u.role))) return true;
    if (a.staff && !isDesk(String(u.role))) return true;
    if (a.specialtyId && (u.specialty_ids as unknown[]).map(Number).includes(a.specialtyId)) return true;
    if (a.module) {
      const mods = new Set<StaffModule>(roleModules(String(u.role)));
      for (const m of u.modules as unknown[]) for (const x of normalizeModules(m)) mods.add(x);
      // The front desk follows these through its own alerts (e.g. the PMS notification of a new defect).
      if (mods.has(a.module) && !isDesk(String(u.role))) return true;
    }
    return false;
  }).map((u) => Number(u.id));
}

export async function sendStaffPush(ownerId: string, audience: PushAudience, msg: PushMessage, exceptUserId?: number): Promise<number> {
  const ids = (await audienceIds(ownerId, audience)).filter((id) => id !== exceptUserId);
  if (!ids.length) return 0;
  const subs = (await db().query(`SELECT id,endpoint,p256dh,auth,kinds_json,lang FROM push_subscriptions WHERE owner_id=$1 AND staff_user_id=ANY($2::bigint[])`, [ownerId, ids])).rows;
  const wanted = subs.filter((s) => normalizeAlertKinds((() => { try { return JSON.parse(s.kinds_json); } catch { return []; } })()).includes(msg.kind));
  if (!wanted.length) return 0;
  const keys = await vapidKeys(ownerId);
  const subject = process.env.PMS_ORIGIN?.startsWith("https://") ? process.env.PMS_ORIGIN : "mailto:info@hotelcorali.gr";
  let sent = 0;
  await Promise.all(wanted.map(async (s) => {
    const lang = s.lang === "en" ? "en" : "el";
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: msg.title[lang], body: msg.body[lang], url: msg.url, tag: msg.tag ?? msg.kind }),
        { vapidDetails: { subject, publicKey: keys.public_key, privateKey: keys.private_key }, TTL: 6 * 3600, urgency: "high", timeout: 10_000 },
      );
      sent++;
      await db().query(`UPDATE push_subscriptions SET last_sent_at=$2,failures=0 WHERE id=$1`, [s.id, Date.now()]);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // Gone / not found: the phone unsubscribed or reinstalled; other errors are retried on the next alert.
      if (status === 404 || status === 410) await db().query(`DELETE FROM push_subscriptions WHERE id=$1`, [s.id]);
      else await db().query(`UPDATE push_subscriptions SET failures=failures+1 WHERE id=$1`, [s.id]);
    }
  }));
  return sent;
}

type Committed = { table: "pms_notifications" | "maintenance_notices" | "staff_shifts" | "housekeeping_tasks"; id: number };

/**
 * Send after the response (and after the transaction that caused it): with `committed`, only if that row exists, so a
 * rolled-back change never rings a phone. Push problems never affect the request.
 */
export function deferStaffPush(ownerId: string, audience: PushAudience, msg: PushMessage, opts: { committed?: Committed; exceptUserId?: number } = {}) {
  const run = async () => {
    try {
      if (opts.committed) {
        const ok = await db().query(`SELECT 1 FROM ${opts.committed.table} WHERE owner_id=$1 AND id=$2`, [ownerId, opts.committed.id]);
        if (!ok.rowCount) return;
      }
      await sendStaffPush(ownerId, audience, msg, opts.exceptUserId);
    } catch (e) {
      console.error("Staff push failed", e instanceof Error ? e.message : e);
    }
  };
  try { after(run); } catch { setTimeout(() => void run(), 1_500); }
}

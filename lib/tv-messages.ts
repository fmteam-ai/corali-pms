// Messages from reception to guests' TVs (PMS → TV messages). Shown on the Corali TV screen until the guest presses
// OK or the message expires; urgent ones also bring the Corali TV app to the front.
import { db, withTransaction } from "@/lib/db";
import { hotelToday } from "@/lib/tape-chart";
import { loadTvSettings } from "@/lib/tv";
import { messageExpiry, messageText, personalize, tvMessageTheme, type TvMessageBody, type TvMessageDuration, type TvMessageTheme } from "@/lib/tv-messages-core";

export type TvMessageRoom = { roomId: number; roomCode: string; expiresAt: number; seenAt: number | null };
export type TvMessageRow = { id: number; body: TvMessageBody; urgent: boolean; theme: TvMessageTheme; hasImage: boolean; createdAt: number; createdBy: string; cancelledAt: number | null; rooms: TvMessageRoom[] };
export type TvScreenMessage = { id: number; text: string; urgent: boolean; theme: TvMessageTheme; createdAt: number; image: string | null };
export type TvMessagePhoto = { mime: string; base64: string };

const parseBody = (v: unknown): TvMessageBody => {
  try { const x = JSON.parse(String(v)); return { el: typeof x.el === "string" ? x.el : undefined, en: typeof x.en === "string" ? x.en : undefined }; } catch { return {}; }
};

/** Send to the given rooms (all active screens when roomIds is "all"). Returns the new message id. */
export async function sendTvMessage(ownerId: string, userId: number, body: TvMessageBody, roomIds: number[] | "all", duration: TvMessageDuration, urgent: boolean, photo: TvMessagePhoto | null = null, theme: TvMessageTheme = "standard"): Promise<number> {
  const settings = await loadTvSettings(ownerId);
  const today = hotelToday(), now = Date.now();
  return withTransaction(async (c) => {
    const rooms = (await c.query(
      `SELECT r.id,(SELECT b.check_out FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in') AND b.check_in<=$2 AND b.check_out>=$2 ORDER BY b.check_out DESC LIMIT 1) AS stay_out
       FROM rooms r JOIN tv_screens s ON s.owner_id=r.owner_id AND s.room_id=r.id AND s.active=1
       WHERE r.owner_id=$1 AND r.active=1 AND ($3::bigint[] IS NULL OR r.id=ANY($3::bigint[]))`,
      [ownerId, today, roomIds === "all" ? null : roomIds],
    )).rows;
    if (!rooms.length) throw new Error("NO_ROOMS");
    const m = await c.query(`INSERT INTO tv_messages(owner_id,body_json,urgent,created_by,created_at,image_mime,image_base64,theme) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [ownerId, JSON.stringify(body), urgent ? 1 : 0, userId, now, photo?.mime ?? null, photo?.base64 ?? null, theme]);
    const id = Number(m.rows[0].id);
    for (const r of rooms) {
      await c.query(`INSERT INTO tv_message_rooms(message_id,owner_id,room_id,expires_at) VALUES($1,$2,$3,$4)`, [id, ownerId, r.id, messageExpiry(duration, now, today, r.stay_out ? String(r.stay_out) : null, settings.checkOutTime)]);
    }
    return id;
  });
}

export async function cancelTvMessage(ownerId: string, id: number): Promise<boolean> {
  const r = await db().query(`UPDATE tv_messages SET cancelled_at=$1 WHERE owner_id=$2 AND id=$3 AND cancelled_at IS NULL`, [Date.now(), ownerId, id]);
  return Boolean(r.rowCount);
}

/** The latest 40 messages with each room's expiry and when the guest saw it. */
export async function listTvMessages(ownerId: string): Promise<TvMessageRow[]> {
  const msgs = (await db().query(
    `SELECT m.id,m.body_json,m.urgent,m.theme,m.created_at,m.cancelled_at,m.image_mime IS NOT NULL AS has_image,COALESCE(u.display_name,'') AS created_by FROM tv_messages m LEFT JOIN pms_staff_users u ON u.id=m.created_by AND u.owner_id=m.owner_id
     WHERE m.owner_id=$1 ORDER BY m.created_at DESC LIMIT 40`, [ownerId])).rows;
  if (!msgs.length) return [];
  const rooms = (await db().query(
    `SELECT t.message_id,t.room_id,r.code,t.expires_at,t.seen_at FROM tv_message_rooms t JOIN rooms r ON r.id=t.room_id AND r.owner_id=t.owner_id
     WHERE t.owner_id=$1 AND t.message_id=ANY($2::bigint[]) ORDER BY r.code`, [ownerId, msgs.map((m) => m.id)])).rows;
  return msgs.map((m) => ({
    id: Number(m.id), body: parseBody(m.body_json), urgent: Number(m.urgent) === 1, theme: tvMessageTheme(m.theme), hasImage: Boolean(m.has_image), createdAt: Number(m.created_at), createdBy: String(m.created_by),
    cancelledAt: m.cancelled_at === null ? null : Number(m.cancelled_at),
    rooms: rooms.filter((r) => Number(r.message_id) === Number(m.id)).map((r) => ({ roomId: Number(r.room_id), roomCode: String(r.code), expiresAt: Number(r.expires_at), seenAt: r.seen_at === null ? null : Number(r.seen_at) })),
  }));
}

/** Unseen, unexpired messages for a room's screen, newest first, in the screen's language (photo URL via the screen link). */
export async function screenMessages(ownerId: string, roomId: number, lang: string, token: string, firstName: string | null): Promise<TvScreenMessage[]> {
  const r = await db().query(
    `SELECT m.id,m.body_json,m.urgent,m.theme,m.created_at,m.image_mime IS NOT NULL AS has_image FROM tv_message_rooms t JOIN tv_messages m ON m.id=t.message_id
     WHERE t.owner_id=$1 AND t.room_id=$2 AND t.seen_at IS NULL AND t.expires_at>$3 AND m.cancelled_at IS NULL ORDER BY m.urgent DESC,m.created_at DESC LIMIT 5`,
    [ownerId, roomId, Date.now()],
  );
  return r.rows.map((m) => ({ id: Number(m.id), text: personalize(messageText(parseBody(m.body_json), lang), firstName), urgent: Number(m.urgent) === 1, theme: tvMessageTheme(m.theme), createdAt: Number(m.created_at), image: m.has_image ? `/api/public/tv/${encodeURIComponent(token)}/message-image/${Number(m.id)}` : null })).filter((m) => m.text || m.image);
}

async function screenRoom(token: string): Promise<{ ownerId: string; roomId: number } | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const s = (await db().query(`SELECT owner_id,room_id FROM tv_screens WHERE token=$1 AND active=1`, [token])).rows[0];
  return s ? { ownerId: String(s.owner_id), roomId: Number(s.room_id) } : null;
}

/** A message photo for the screen it was sent to (also after it was seen); null otherwise. */
export async function screenMessageImage(token: string, messageId: number): Promise<{ mime: string; data_base64: string } | undefined> {
  const s = await screenRoom(token);
  if (!s) return undefined;
  const r = await db().query(
    `SELECT m.image_mime AS mime,m.image_base64 AS data_base64 FROM tv_messages m JOIN tv_message_rooms t ON t.message_id=m.id
     WHERE m.owner_id=$1 AND t.room_id=$2 AND m.id=$3 AND m.cancelled_at IS NULL AND m.image_mime IS NOT NULL`,
    [s.ownerId, s.roomId, messageId],
  );
  return r.rows[0];
}

/** A message photo for PMS staff (preview in the sent list). */
export async function messageImage(ownerId: string, messageId: number): Promise<{ mime: string; data_base64: string } | undefined> {
  return (await db().query(`SELECT image_mime AS mime,image_base64 AS data_base64 FROM tv_messages WHERE owner_id=$1 AND id=$2 AND image_mime IS NOT NULL`, [ownerId, messageId])).rows[0];
}

/** The guest pressed OK on the TV. */
export async function markTvMessageSeen(token: string, messageId: number): Promise<boolean> {
  const s = await screenRoom(token);
  if (!s) return false;
  const r = await db().query(`UPDATE tv_message_rooms SET seen_at=$1 WHERE owner_id=$2 AND room_id=$3 AND message_id=$4 AND seen_at IS NULL`, [Date.now(), s.ownerId, s.roomId, messageId]);
  return Boolean(r.rowCount);
}

/** Newest unseen urgent message for the TV app's background check (null when none); undefined for an unknown link. */
export async function pendingUrgent(token: string): Promise<number | null | undefined> {
  const s = await screenRoom(token);
  if (!s) return undefined;
  const r = await db().query(
    `SELECT m.id FROM tv_message_rooms t JOIN tv_messages m ON m.id=t.message_id
     WHERE t.owner_id=$1 AND t.room_id=$2 AND t.seen_at IS NULL AND t.expires_at>$3 AND m.cancelled_at IS NULL AND m.urgent=1 ORDER BY m.created_at DESC LIMIT 1`,
    [s.ownerId, s.roomId, Date.now()],
  );
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

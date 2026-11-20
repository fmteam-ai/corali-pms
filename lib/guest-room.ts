// v176: «Do not disturb» / «Please clean my room» from the guest's phone (My booking). Same records as the TV:
// tv_requests (cleaning, dnd_on / dnd_off) and tv_screens.dnd_since, so Housekeeping, PMS → Requests and the TV agree.
import { db, withTransaction } from "@/lib/db";
import { canUseRoom, guestRoomTexts, roomRequestProblem } from "@/lib/guest-room-core";
import { instayAsk } from "@/lib/instay";
import { guestWifiFor } from "@/lib/guest-wifi";
import { instayTexts, instayTopics } from "@/lib/instay-core";
import type { GuestLang } from "@/lib/guest-portal-core";
import { pushNotification } from "@/lib/pms-notifications";
import { tvRequestLabels } from "@/lib/tv-requests-core";

type Booking = Record<string, unknown>;

/** What the phone shows: in-house, do not disturb (needs the room's screen row), an open cleaning request. */
export async function guestRoomState(ownerId: string, b: Booking, lang: GuestLang) {
  const inHouse = canUseRoom(b);
  const roomId = Number(b.room_id);
  const s = inHouse ? (await db().query(`SELECT dnd_since FROM tv_screens WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0] : null;
  const open = inHouse ? (await db().query(`SELECT created_at FROM tv_requests WHERE owner_id=$1 AND room_id=$2 AND booking_id=$3 AND kind='cleaning' AND status='open' ORDER BY id DESC LIMIT 1`, [ownerId, roomId, Number(b.id)])).rows[0] : null;
  // v176: «Is everything all right?» from the second day of the stay, until answered (here or on the TV).
  const ask = inHouse && (await instayAsk(ownerId, Number(b.id), { status: String(b.status), check_in: String(b.check_in), check_out: String(b.check_out) }));
  return { texts: guestRoomTexts[lang], inHouse, dndAvailable: Boolean(s), dnd: s ? s.dnd_since !== null : false, cleaningSince: open ? Number(open.created_at) : null,
    instay: ask ? { texts: instayTexts[lang], topics: instayTopics } : null,
    // v177: the stay's own Wi-Fi password (Omada), shown with a QR code for other devices.
    wifi: inHouse ? await guestWifiFor(ownerId, Number(b.id)) : null };
}

/** Switch do not disturb / ask for cleaning. Throws NOT_IN_HOUSE, DND_ON, NO_SCREEN. A repeated request is not doubled. */
export async function guestRoomRequest(ownerId: string, b: Booking, kind: "cleaning" | "dnd", on = false): Promise<void> {
  const inHouse = canUseRoom(b);
  const roomId = Number(b.room_id), bookingId = Number(b.id), now = Date.now();
  await withTransaction(async (c) => {
    const s = inHouse ? (await c.query(`SELECT s.dnd_since,r.code FROM tv_screens s JOIN rooms r ON r.id=s.room_id AND r.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.room_id=$2 FOR UPDATE OF s`, [ownerId, roomId])).rows[0] : null;
    const dnd = Boolean(s && s.dnd_since !== null);
    const problem = roomRequestProblem(kind, dnd, inHouse);
    if (problem) throw Error(problem);
    if (kind === "dnd" && !s) throw Error("NO_SCREEN");
    const code = s ? String(s.code) : String((await c.query(`SELECT code FROM rooms WHERE owner_id=$1 AND id=$2`, [ownerId, roomId])).rows[0]?.code ?? roomId);
    let record: "cleaning" | "dnd_on" | "dnd_off";
    if (kind === "dnd") {
      if (on === dnd) return;
      await c.query(`UPDATE tv_screens SET dnd_since=$1 WHERE owner_id=$2 AND room_id=$3`, [on ? now : null, ownerId, roomId]);
      record = on ? "dnd_on" : "dnd_off";
    } else {
      const dup = await c.query(`SELECT 1 FROM tv_requests WHERE owner_id=$1 AND room_id=$2 AND booking_id=$3 AND kind='cleaning' AND status='open'`, [ownerId, roomId, bookingId]);
      if (dup.rowCount) return;
      record = "cleaning";
    }
    await c.query(`INSERT INTO tv_requests(owner_id,room_id,booking_id,kind,status,created_at,details_json) VALUES($1,$2,$3,$4,$5,$6,$7)`, [ownerId, roomId, bookingId, record, record === "cleaning" ? "open" : "info", now, JSON.stringify({ source: "phone" })]);
    const l = tvRequestLabels[record], who = b.guest_name ? ` · ${String(b.guest_name)}` : "";
    await pushNotification(c, ownerId, { kind: "tv_request", titleEl: `${l.icon} Δωμάτιο ${code}${who}: ${l.el} (κινητό)`, titleEn: `${l.icon} Room ${code}${who}: ${l.en} (phone)`, link: "/pms/tv-requests" });
  });
}

/** When housekeeping finishes cleaning a room, the guest's open cleaning requests for it are done too. */
export async function closeCleaningRequests(q: { query: (sql: string, params: unknown[]) => Promise<unknown> }, ownerId: string, roomId: number, staffUserId: number | null): Promise<void> {
  await q.query(`UPDATE tv_requests SET status='done',handled_at=$1,handled_by=$2 WHERE owner_id=$3 AND room_id=$4 AND kind='cleaning' AND status='open'`, [Date.now(), staffUserId, ownerId, roomId]);
}

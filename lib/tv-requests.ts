// Guest requests from the Corali TV screen (TV → PMS): stored in tv_requests, announced in the PMS notifications,
// handled on PMS → Requests from TV. Do not disturb also sets tv_screens.dnd_since (Housekeeping shows it).
import { db, withTransaction } from "@/lib/db";
import { pushNotification } from "@/lib/pms-notifications";
import { hotelToday } from "@/lib/tape-chart";
import { initialStatus, transferProblem, transferSummary, tvRequestLabels, type TransferDetails, type TvRequestKind, type TvRequestRecordKind } from "@/lib/tv-requests-core";

export type TvRequestRow = { id: number; roomId: number; roomCode: string; guestName: string | null; kind: TvRequestRecordKind; status: string; createdAt: number; handledAt: number | null; handledBy: string; details: TransferDetails | null };

const hotelTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

async function screen(token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const today = hotelToday();
  const s = (await db().query(
    `SELECT s.owner_id,s.room_id,s.dnd_since,r.code,
       (SELECT b.id FROM bookings b WHERE b.owner_id=s.owner_id AND b.room_id=s.room_id AND b.status IN ('confirmed','checked_in') AND b.check_in<=$2 AND b.check_out>=$2 ORDER BY b.check_in DESC LIMIT 1) AS booking_id,
       (SELECT b.guest_name FROM bookings b WHERE b.owner_id=s.owner_id AND b.room_id=s.room_id AND b.status IN ('confirmed','checked_in') AND b.check_in<=$2 AND b.check_out>=$2 ORDER BY b.check_in DESC LIMIT 1) AS guest_name,
       (SELECT b.check_out FROM bookings b WHERE b.owner_id=s.owner_id AND b.room_id=s.room_id AND b.status IN ('confirmed','checked_in') AND b.check_in<=$2 AND b.check_out>=$2 ORDER BY b.check_in DESC LIMIT 1) AS check_out
     FROM tv_screens s JOIN rooms r ON r.id=s.room_id AND r.owner_id=s.owner_id WHERE s.token=$1 AND s.active=1 AND r.active=1`,
    [token, today],
  )).rows[0];
  return s ? { ownerId: String(s.owner_id), roomId: Number(s.room_id), roomCode: String(s.code), bookingId: s.booking_id ? Number(s.booking_id) : null, guestName: s.guest_name ? String(s.guest_name) : null, checkOut: s.check_out ? String(s.check_out) : null, today, dnd: s.dnd_since !== null } : null;
}

/**
 * A request from the TV. Only while a guest is staying in the room. The same open request within 10 minutes is not
 * repeated. Returns null for an unknown link / no guest, otherwise whether it was recorded and the do-not-disturb state.
 */
export async function createTvRequest(token: string, kind: TvRequestKind | "dnd", dndOn?: boolean, transfer?: TransferDetails): Promise<{ recorded: boolean; dnd: boolean; error?: string } | null> {
  const s = await screen(token);
  if (!s || !s.bookingId) return null;
  // A transfer (the "taxi" request) carries where / when / how many; checked against the stay and the hotel clock.
  if (kind === "taxi" && transfer) {
    const problem = transferProblem(transfer, s.today, hotelTime(), s.checkOut);
    if (problem) return { recorded: false, dnd: s.dnd, error: problem };
  }
  const details = kind === "taxi" && transfer ? JSON.stringify({ destination: transfer.destination, date: transfer.date, time: transfer.time, people: transfer.people }) : null;
  const now = Date.now();
  const record: TvRequestRecordKind = kind === "dnd" ? (dndOn ? "dnd_on" : "dnd_off") : kind;
  return withTransaction(async (c) => {
    if (kind === "dnd") {
      if (Boolean(dndOn) === s.dnd) return { recorded: false, dnd: s.dnd };
      await c.query(`UPDATE tv_screens SET dnd_since=$1 WHERE owner_id=$2 AND room_id=$3`, [dndOn ? now : null, s.ownerId, s.roomId]);
    } else {
      const dup = await c.query(`SELECT 1 FROM tv_requests WHERE owner_id=$1 AND room_id=$2 AND kind=$3 AND status='open' AND created_at>$4 AND details_json IS NOT DISTINCT FROM $5`, [s.ownerId, s.roomId, kind, now - 10 * 60_000, details]);
      if (dup.rowCount) return { recorded: false, dnd: s.dnd };
    }
    await c.query(`INSERT INTO tv_requests(owner_id,room_id,booking_id,kind,status,created_at,details_json) VALUES($1,$2,$3,$4,$5,$6,$7)`, [s.ownerId, s.roomId, s.bookingId, record, initialStatus(record), now, details]);
    const l = tvRequestLabels[record], who = s.guestName ? ` · ${s.guestName}` : "";
    const more = (lang: "el" | "en") => (transfer && details ? ` ${transferSummary(transfer, lang)}` : "");
    await pushNotification(c, s.ownerId, { kind: "tv_request", titleEl: `${l.icon} Δωμάτιο ${s.roomCode}${who}: ${l.el}${more("el")}`, titleEn: `${l.icon} Room ${s.roomCode}${who}: ${l.en}${more("en")}`, link: "/pms/tv-requests" });
    return { recorded: true, dnd: kind === "dnd" ? Boolean(dndOn) : s.dnd };
  });
}

/** Do-not-disturb state of a room's screen (shown on the TV). */
export async function screenDnd(ownerId: string, roomId: number): Promise<boolean> {
  return Boolean((await db().query(`SELECT 1 FROM tv_screens WHERE owner_id=$1 AND room_id=$2 AND dnd_since IS NOT NULL`, [ownerId, roomId])).rowCount);
}

export async function listTvRequests(ownerId: string, all: boolean): Promise<TvRequestRow[]> {
  const r = await db().query(
    `SELECT q.id,q.room_id,r.code,b.guest_name,q.kind,q.status,q.created_at,q.handled_at,q.details_json,COALESCE(u.display_name,'') AS handled_by
       FROM tv_requests q JOIN rooms r ON r.id=q.room_id AND r.owner_id=q.owner_id
       LEFT JOIN bookings b ON b.id=q.booking_id AND b.owner_id=q.owner_id
       LEFT JOIN pms_staff_users u ON u.id=q.handled_by AND u.owner_id=q.owner_id
      WHERE q.owner_id=$1 AND ($2::boolean OR q.status='open' OR q.created_at>$3)
      ORDER BY (q.status='open') DESC, q.created_at DESC LIMIT 200`,
    [ownerId, all, Date.now() - 24 * 3_600_000],
  );
  return r.rows.map((x) => ({ id: Number(x.id), roomId: Number(x.room_id), roomCode: String(x.code), guestName: x.guest_name ? String(x.guest_name) : null, kind: String(x.kind) as TvRequestRecordKind, status: String(x.status), createdAt: Number(x.created_at), handledAt: x.handled_at === null ? null : Number(x.handled_at), handledBy: String(x.handled_by), details: x.details_json ? (JSON.parse(String(x.details_json)) as TransferDetails) : null }));
}

/** Rooms with do not disturb on, for the PMS. */
export async function dndRooms(ownerId: string): Promise<{ roomId: number; roomCode: string; since: number }[]> {
  const r = await db().query(`SELECT s.room_id,r.code,s.dnd_since FROM tv_screens s JOIN rooms r ON r.id=s.room_id AND r.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.dnd_since IS NOT NULL ORDER BY r.code`, [ownerId]);
  return r.rows.map((x) => ({ roomId: Number(x.room_id), roomCode: String(x.code), since: Number(x.dnd_since) }));
}

export async function completeTvRequest(ownerId: string, id: number, userId: number): Promise<boolean> {
  const r = await db().query(`UPDATE tv_requests SET status='done',handled_at=$1,handled_by=$2 WHERE owner_id=$3 AND id=$4 AND status='open'`, [Date.now(), userId, ownerId, id]);
  return Boolean(r.rowCount);
}

/** Staff switch do not disturb off (e.g. the guest asked at reception). */
export async function clearDnd(ownerId: string, roomId: number): Promise<void> {
  await db().query(`UPDATE tv_screens SET dnd_since=NULL WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId]);
}

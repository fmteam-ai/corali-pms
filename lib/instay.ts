// v176: «Is everything all right?» on the second day of a stay. Answers are stored as requests (tv_requests):
// instay_good (information) or instay_bad (open, with the topics) — reception sees a «no» at once in the PMS
// notifications and on PMS → Requests from TV, and closes it there when fixed.
import { db, withTransaction } from "@/lib/db";
import { instayDue, type InstayTopic } from "@/lib/instay-core";
import { pushNotification } from "@/lib/pms-notifications";
import { hotelToday } from "@/lib/tape-chart";
import { requestDetailsSummary, tvRequestLabels } from "@/lib/tv-requests-core";

/** Should this booking be asked now (second day of a checked-in stay, not answered yet)? */
export async function instayAsk(ownerId: string, bookingId: number, stay: { status: string; check_in: string; check_out: string }): Promise<boolean> {
  if (!instayDue(stay, hotelToday())) return false;
  return !(await db().query(`SELECT 1 FROM tv_requests WHERE owner_id=$1 AND booking_id=$2 AND kind IN ('instay_good','instay_bad') LIMIT 1`, [ownerId, bookingId])).rowCount;
}

/** Record the answer once per booking. Returns false if it was already answered or the stay is not due. */
export async function recordInstay(ownerId: string, bookingId: number, good: boolean, topics: InstayTopic[], source: "tv" | "phone"): Promise<boolean> {
  return withTransaction(async (c) => {
    const b = (await c.query(`SELECT b.id,b.room_id,b.status,b.check_in,b.check_out,b.guest_name,r.code FROM bookings b JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id WHERE b.owner_id=$1 AND b.id=$2 FOR UPDATE OF b`, [ownerId, bookingId])).rows[0];
    if (!b || !instayDue({ status: String(b.status), check_in: String(b.check_in), check_out: String(b.check_out) }, hotelToday())) return false;
    if ((await c.query(`SELECT 1 FROM tv_requests WHERE owner_id=$1 AND booking_id=$2 AND kind IN ('instay_good','instay_bad') LIMIT 1`, [ownerId, bookingId])).rowCount) return false;
    const kind = good ? "instay_good" : "instay_bad";
    const details = { topics: good ? [] : [...new Set(topics)].slice(0, 7), source };
    await c.query(`INSERT INTO tv_requests(owner_id,room_id,booking_id,kind,status,created_at,details_json) VALUES($1,$2,$3,$4,$5,$6,$7)`, [ownerId, b.room_id, bookingId, kind, good ? "info" : "open", Date.now(), JSON.stringify(details)]);
    const l = tvRequestLabels[kind], who = b.guest_name ? ` · ${String(b.guest_name)}` : "";
    await pushNotification(c, ownerId, {
      kind: "tv_request",
      titleEl: `${l.icon} Δωμάτιο ${String(b.code)}${who}: ${l.el} ${requestDetailsSummary(details, "el")}`.trim(),
      titleEn: `${l.icon} Room ${String(b.code)}${who}: ${l.en} ${requestDetailsSummary(details, "en")}`.trim(),
      link: "/pms/tv-requests",
    });
    return true;
  });
}

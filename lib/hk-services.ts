// Linen & towel changes: settings, today's list for Housekeeping and the once-a-day reminder in the PMS notifications.
import { db, withTransaction } from "@/lib/db";
import { dueServices, nextServiceDate, normalizeHkServiceSettings, type HkService, type HkServiceSettings } from "@/lib/hk-services-core";
import { pushNotification } from "@/lib/pms-notifications";
import { hotelToday } from "@/lib/tape-chart";

export type HkServiceRow = { bookingId: number; roomId: number; roomCode: string; guestName: string; checkIn: string; checkOut: string; night: number; nights: number; due: HkService[]; done: HkService[]; nextSheets: string | null; nextTowels: string | null; dnd: boolean };

export async function loadHkServiceSettings(ownerId: string): Promise<HkServiceSettings> {
  const r = (await db().query(`SELECT sheets_every,towels_every,reminder_hour FROM housekeeping_service_settings WHERE owner_id=$1`, [ownerId])).rows[0];
  return normalizeHkServiceSettings(r ? { sheetsEvery: r.sheets_every, towelsEvery: r.towels_every, reminderHour: r.reminder_hour } : null);
}

export async function saveHkServiceSettings(ownerId: string, s: HkServiceSettings) {
  await db().query(
    `INSERT INTO housekeeping_service_settings(owner_id,sheets_every,towels_every,reminder_hour,updated_at) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(owner_id) DO UPDATE SET sheets_every=$2,towels_every=$3,reminder_hour=$4,updated_at=$5`,
    [ownerId, s.sheetsEvery, s.towelsEvery, s.reminderHour, Date.now()],
  );
}

/** Every stay in house today (arrived before today, leaving after today) with what is due and what was done. */
export async function hkServiceRows(ownerId: string, today = hotelToday()): Promise<{ settings: HkServiceSettings; rows: HkServiceRow[] }> {
  const settings = await loadHkServiceSettings(ownerId);
  const [stays, done] = await Promise.all([
    db().query(
      `SELECT b.id,b.room_id,r.code,b.guest_name,b.check_in,b.check_out,(SELECT s.dnd_since FROM tv_screens s WHERE s.owner_id=b.owner_id AND s.room_id=b.room_id) AS dnd_since
         FROM bookings b JOIN rooms r ON r.id=b.room_id AND r.owner_id=b.owner_id
        WHERE b.owner_id=$1 AND b.status IN ('confirmed','checked_in') AND b.check_in<$2 AND b.check_out>$2 ORDER BY r.code`,
      [ownerId, today],
    ),
    db().query(`SELECT booking_id,service FROM housekeeping_service_done WHERE owner_id=$1 AND date=$2`, [ownerId, today]),
  ]);
  const doneBy = new Map<number, HkService[]>();
  for (const d of done.rows) doneBy.set(Number(d.booking_id), [...(doneBy.get(Number(d.booking_id)) ?? []), d.service as HkService]);
  const day = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  return {
    settings,
    rows: stays.rows.map((b) => {
      const checkIn = String(b.check_in), checkOut = String(b.check_out);
      return {
        bookingId: Number(b.id), roomId: Number(b.room_id), roomCode: String(b.code), guestName: String(b.guest_name ?? ""), checkIn, checkOut,
        night: day(checkIn, today), nights: day(checkIn, checkOut),
        due: dueServices(checkIn, checkOut, today, settings), done: doneBy.get(Number(b.id)) ?? [],
        nextSheets: nextServiceDate(checkIn, checkOut, today, settings, "sheets"), nextTowels: nextServiceDate(checkIn, checkOut, today, settings, "towels"),
        dnd: b.dnd_since !== null,
      };
    }),
  };
}

export async function markHkService(ownerId: string, bookingId: number, service: HkService, done: boolean, userId: number) {
  const today = hotelToday();
  if (done) {
    await db().query(
      `INSERT INTO housekeeping_service_done(owner_id,booking_id,service,date,room_id,done_by,done_at) SELECT $1,b.id,$3,$4,b.room_id,$5,$6 FROM bookings b WHERE b.owner_id=$1 AND b.id=$2 ON CONFLICT DO NOTHING`,
      [ownerId, bookingId, service, today, userId, Date.now()],
    );
  } else {
    await db().query(`DELETE FROM housekeeping_service_done WHERE owner_id=$1 AND booking_id=$2 AND service=$3 AND date=$4`, [ownerId, bookingId, service, today]);
  }
}

const athensHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", hour12: false }).format(new Date()));

/**
 * Once a day, from the reminder hour on, a notification lists the rooms that need sheets / towels today. Called when
 * the PMS loads notifications (no extra cron job); the date stamp makes sure it is sent only once.
 */
export async function maybeSendHkReminder(ownerId: string): Promise<void> {
  const settings = await loadHkServiceSettings(ownerId);
  const today = hotelToday();
  if (athensHour() < settings.reminderHour || (settings.sheetsEvery === 0 && settings.towelsEvery === 0)) return;
  await withTransaction(async (c) => {
    await c.query(`INSERT INTO housekeeping_service_settings(owner_id,updated_at) VALUES($1,0) ON CONFLICT DO NOTHING`, [ownerId]);
    const claimed = await c.query(`UPDATE housekeeping_service_settings SET last_reminder_date=$2 WHERE owner_id=$1 AND last_reminder_date IS DISTINCT FROM $2 RETURNING owner_id`, [ownerId, today]);
    if (!claimed.rowCount) return;
    const { rows } = await hkServiceRows(ownerId, today);
    const rooms = (s: HkService) => rows.filter((r) => r.due.includes(s)).map((r) => r.roomCode);
    const sheets = rooms("sheets"), towels = rooms("towels");
    if (!sheets.length && !towels.length) return;
    const part = (label: string, list: string[]) => (list.length ? `${label}: ${list.join(", ")}` : "");
    await pushNotification(c, ownerId, {
      kind: "housekeeping",
      titleEl: `🛏️ Σήμερα · ${[part("Αλλαγή σεντονιών", sheets), part("Αλλαγή πετσετών", towels)].filter(Boolean).join(" · ")}`,
      titleEn: `🛏️ Today · ${[part("Change sheets", sheets), part("Change towels", towels)].filter(Boolean).join(" · ")}`,
      link: "/pms/housekeeping",
    });
  });
}

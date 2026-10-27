// Corali virtual access cards in the automation cron: the day before arrival (from the sending time) each booking
// gets its card by e-mail; booking cards follow date changes and end when the booking is cancelled.
import { createHash, randomBytes } from "node:crypto";
import { bookingValidity, cardEmail, dueToIssue, normalizeCardSettings } from "./access-card-core.mjs";

const athensNow = () => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const v = (t) => p.find((x) => x.type === t)?.value ?? "00";
  return { today: `${v("year")}-${v("month")}-${v("day")}`, time: `${v("hour")}:${v("minute")}` };
};

export async function runAccessCards({ pool, owner, seal, email, origin }) {
  const s = await pool.query(`SELECT settings_json FROM access_card_settings WHERE owner_id=$1`, [owner]);
  let raw = null;
  try { raw = s.rows[0] ? JSON.parse(String(s.rows[0].settings_json)) : null; } catch { raw = null; }
  const settings = normalizeCardSettings(raw);
  if (!settings.enabled) return;
  const { today, time } = athensNow(), now = Date.now();
  // Keep stored times of booking cards in step with their booking (the PMS list and the wallets show them).
  const cards = await pool.query(`SELECT c.id,c.until_locked,b.check_in,b.check_out,b.status FROM access_cards c JOIN bookings b ON b.owner_id=c.owner_id AND b.id=c.booking_id WHERE c.owner_id=$1 AND c.kind='booking' AND c.status='active' AND c.valid_until>$2`, [owner, now - 86_400_000]);
  for (const c of cards.rows) {
    if (["cancelled", "no_show"].includes(String(c.status))) { await pool.query(`UPDATE access_cards SET status='revoked',revoked_at=$1,revoked_reason='booking cancelled',updated_at=$1 WHERE id=$2`, [now, c.id]); continue; }
    if (Number(c.until_locked)) continue;
    const v = bookingValidity(String(c.check_in), String(c.check_out), settings);
    await pool.query(`UPDATE access_cards SET valid_from=$1,valid_until=$2,updated_at=$3 WHERE id=$4 AND (valid_from<>$1 OR valid_until<>$2)`, [v.from, v.until, now, c.id]);
  }
  const zones = settings.zones.filter((z) => z.guests).map((z) => z.key);
  const due = await pool.query(
    `SELECT b.id,b.guest_name,b.guest_email,b.guest_language,b.check_in,b.check_out,b.status,b.room_id,r.code room_code FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
      WHERE b.owner_id=$1 AND b.status IN ('confirmed','checked_in') AND b.check_in<=($2::date+1)::text AND b.check_out>=$2::text::text
        AND NOT EXISTS (SELECT 1 FROM access_cards c WHERE c.owner_id=b.owner_id AND c.booking_id=b.id) LIMIT 200`,
    [owner, today],
  );
  for (const b of due.rows) {
    if (!dueToIssue({ ...b, check_in: String(b.check_in), check_out: String(b.check_out) }, today, time, settings)) continue;
    const token = randomBytes(32).toString("base64url"), serial = `CRL-${randomBytes(6).toString("hex").toUpperCase()}`, v = bookingValidity(String(b.check_in), String(b.check_out), settings);
    const ins = await pool.query(
      `INSERT INTO access_cards(owner_id,kind,booking_id,room_id,holder_name,email,lang,zones_json,valid_from,valid_until,serial,token_hash,token_encrypted,created_by,created_at,updated_at) VALUES($1,'booking',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'automation',$13,$13) ON CONFLICT DO NOTHING RETURNING id`,
      [owner, b.id, b.room_id, String(b.guest_name), String(b.guest_email ?? ""), String(b.guest_language ?? "en"), JSON.stringify(zones), v.from, v.until, serial, createHash("sha256").update(token).digest("hex"), seal(token), now],
    );
    if (!ins.rowCount) continue;
    if (!b.guest_email) { await pool.query(`UPDATE access_cards SET send_error='NO_EMAIL' WHERE id=$1`, [ins.rows[0].id]); continue; }
    try {
      const m = cardEmail(b.guest_language, { name: String(b.guest_name), link: `${origin}/card/${token}`, from: v.from, until: v.until, room: b.room_code ? String(b.room_code) : "" });
      await email(String(b.guest_email), m.subject, m.body);
      await pool.query(`UPDATE access_cards SET sent_at=$1,send_error='' WHERE id=$2`, [Date.now(), ins.rows[0].id]);
    } catch (e) {
      await pool.query(`UPDATE access_cards SET send_error=$1 WHERE id=$2`, [e instanceof Error ? e.message.slice(0, 200) : "SEND_FAILED", ins.rows[0].id]);
    }
  }
  if (due.rowCount) console.log(`Access cards: ${due.rowCount} checked`);
}

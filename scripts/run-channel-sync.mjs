// Channel manager sync (PMS instance only). cPanel cron every 5 minutes:
//   cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-channel-sync.mjs
// 1) Pushes sellable rooms per mapped room type and date for queued ranges (direct bookings close inventory).
// 2) Pulls new / modified / cancelled OTA reservations from the Channex booking-revision feed, imports and acknowledges them.
import process from "node:process";
import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { CHANNEX_HOSTS, availabilityRanges, normalizeRevision, sellable } from "./channel-core.mjs";

if (!process.env.DATABASE_URL || !process.env.PMS_DOCUMENT_KEY) throw Error("DATABASE_URL and PMS_DOCUMENT_KEY are required");
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function unseal(value) {
  const key = createHash("sha256").update(process.env.PMS_DOCUMENT_KEY).digest();
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1") throw Error("INVALID_CIPHERTEXT");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

async function api(host, key, path, init = {}) {
  const response = await fetch(`${host}/api/v1${path}`, { ...init, headers: { "user-api-key": key, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(`HTTP_${response.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  return body;
}

/** Sellable rooms per room type and date: active, not out of order, minus stays and unpaid online holds. */
async function availability(from, to) {
  const r = await pool.query(
    `SELECT d.day::date::text AS date, rt.room_type,
            count(r.id) FILTER (WHERE r.operational_status<>'out_of_order'
              AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in') AND b.check_in<=d.day::date::text AND b.check_out>d.day::date::text)
              AND NOT EXISTS (SELECT 1 FROM booking_sessions s WHERE s.owner_id=r.owner_id AND s.status='payment_pending' AND s.recovery_due_at>$4 AND s.check_in<=d.day::date::text AND s.check_out>d.day::date::text AND s.room_allocations::jsonb @> jsonb_build_array(r.id)))::int AS free
       FROM generate_series($2::date,$3::date,interval '1 day') AS d(day)
       CROSS JOIN (SELECT DISTINCT room_type FROM channel_room_mappings WHERE owner_id=$1) rt
       LEFT JOIN rooms r ON r.owner_id=$1 AND r.room_type=rt.room_type AND r.active=1
      GROUP BY d.day, rt.room_type`,
    [owner, from, to, Date.now()],
  );
  return r.rows;
}

async function assignRoom(client, roomType, checkIn, checkOut) {
  const rooms = (await client.query(`SELECT id FROM rooms WHERE owner_id=$1 AND room_type=$2 AND active=1 AND operational_status<>'out_of_order' ORDER BY code`, [owner, roomType])).rows;
  for (const room of rooms) {
    await client.query("SELECT pg_advisory_xact_lock($1)", [room.id]);
    const busy = await client.query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 AND status NOT IN ('cancelled','checked_out','no_show') AND check_in<$4 AND check_out>$3 LIMIT 1`, [owner, room.id, checkIn, checkOut]);
    if (!busy.rowCount) return room.id;
  }
  return null;
}

async function notify(client, titleEl, titleEn, bookingId) {
  await client.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'ota_change',$2,$3,$4,$5)`, [owner, titleEl, titleEn, bookingId ? `/pms/reservations/${bookingId}` : "/pms/reservations", Date.now()]);
}

async function importRevision(rev) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const done = await client.query(`SELECT 1 FROM channel_import_log WHERE owner_id=$1 AND revision_id=$2 AND status='imported'`, [owner, rev.revisionId]);
    if (done.rowCount) { await client.query("ROLLBACK"); return "duplicate"; }
    const existing = (await client.query(`SELECT * FROM bookings WHERE owner_id=$1 AND external_channel=$2 AND external_reservation_id=$3 FOR UPDATE`, [owner, rev.channel, rev.bookingId])).rows;
    const ids = [];
    if (rev.status === "cancelled") {
      for (const b of existing) {
        if (b.status === "confirmed") await client.query(`UPDATE bookings SET status='cancelled',version=version+1 WHERE id=$1`, [b.id]);
        await client.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,created_at,updated_at) VALUES($1,$2,$3,'ota_cancel',$4,$4)`, [owner, b.check_in, b.check_out, Date.now()]);
        ids.push(b.id);
      }
      await notify(client, `Ακύρωση OTA (${rev.channel}) · ${rev.reference} · ${rev.guestName}`, `OTA cancellation (${rev.channel}) · ${rev.reference} · ${rev.guestName}`, ids[0]);
    } else {
      // New or modified: replace the reservation's rooms with the revision's rooms (keeping checked-in stays untouched).
      for (const b of existing) if (b.status === "confirmed") await client.query(`UPDATE bookings SET status='cancelled',version=version+1 WHERE id=$1`, [b.id]);
      const unassigned = [];
      for (const [index, room] of rev.rooms.entries()) {
        const kept = existing.find((b) => b.status === "checked_in");
        if (kept && index === 0) { ids.push(kept.id); continue; }
        const roomId = room.roomType ? await assignRoom(client, room.roomType, room.checkIn, room.checkOut) : null;
        if (!roomId) unassigned.push(room.externalRoomTypeId ?? "?");
        const balance = rev.paymentCollect === "ota" ? 0 : room.totalCents;
        const inserted = await client.query(
          `INSERT INTO bookings(owner_id,reference,guest_name,guest_email,guest_phone,guest_country,guest_language,room_id,check_in,check_out,channel,status,total_cents,balance_cents,adults,children,special_requests,created_at,external_channel,external_reservation_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13,$14,$15,$16,$17,$11,$18) RETURNING id`,
          [owner, `${rev.channel.toUpperCase().slice(0, 3)}-${rev.reference}${rev.rooms.length > 1 ? `-${index + 1}` : ""}-${rev.revisionId.slice(0, 6)}`, rev.guestName, rev.guestEmail, rev.guestPhone, rev.guestCountry, rev.guestLanguage, roomId, room.checkIn, room.checkOut, rev.channel, room.totalCents, balance, room.adults, room.children, rev.notes, Date.now(), rev.bookingId],
        );
        ids.push(Number(inserted.rows[0].id));
        await client.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,created_at,updated_at) VALUES($1,$2,$3,'ota_booking',$4,$4)`, [owner, room.checkIn, room.checkOut, Date.now()]);
      }
      const label = rev.status === "modified" ? ["Τροποποίηση OTA", "OTA modification"] : ["Νέα κράτηση OTA", "New OTA booking"];
      await notify(client, `${label[0]} (${rev.channel}) · ${rev.reference} · ${rev.guestName}${unassigned.length ? " · ΧΩΡΙΣ ΔΩΜΑΤΙΟ: ελέγξτε για overbooking" : ""}`, `${label[1]} (${rev.channel}) · ${rev.reference} · ${rev.guestName}${unassigned.length ? " · NO ROOM: check for overbooking" : ""}`, ids[0]);
    }
    await client.query(`INSERT INTO channel_import_log(owner_id,revision_id,status,booking_ids,created_at) VALUES($1,$2,'imported',$3,$4) ON CONFLICT(owner_id,revision_id) DO UPDATE SET status='imported',booking_ids=$3,error=NULL`, [owner, rev.revisionId, JSON.stringify(ids), Date.now()]);
    await client.query("COMMIT");
    return "imported";
  } catch (error) {
    await client.query("ROLLBACK");
    await pool.query(`INSERT INTO channel_import_log(owner_id,revision_id,status,error,created_at) VALUES($1,$2,'failed',$3,$4) ON CONFLICT(owner_id,revision_id) DO UPDATE SET status='failed',error=$3`, [owner, rev.revisionId, String(error).slice(0, 500), Date.now()]);
    return "failed";
  } finally {
    client.release();
  }
}

try {
  const c = (await pool.query(`SELECT active,settings_json,secrets_encrypted FROM provider_connections WHERE owner_id=$1 AND provider_key='channelManager'`, [owner])).rows[0];
  if (!c || !Number(c.active)) { console.log("Channel manager not active; nothing to do."); process.exit(0); }
  const settings = JSON.parse(c.settings_json), key = JSON.parse(unseal(c.secrets_encrypted)).apiKey;
  const host = process.env.CHANNEX_BASE_URL || CHANNEX_HOSTS[settings.environment === "staging" ? "staging" : "production"], propertyId = settings.propertyCode;
  if (!key || !propertyId) throw Error("Channel manager API key and property id are required");
  const mappings = (await pool.query(`SELECT room_type,external_room_type_id FROM channel_room_mappings WHERE owner_id=$1`, [owner])).rows;
  const typeByExternal = Object.fromEntries(mappings.map((m) => [m.external_room_type_id, m.room_type]));

  // 1) Push availability for queued ranges (clamped to today .. +500 days).
  const due = (await pool.query(`SELECT id,date_from,date_to,attempts FROM channel_sync_outbox WHERE owner_id=$1 AND status IN ('pending','failed') AND next_attempt_at<=$2 ORDER BY id LIMIT 200`, [owner, Date.now()])).rows;
  if (due.length && mappings.length) {
    const earliest = due.map((d) => d.date_from).sort()[0];
    const from = earliest < today ? today : earliest;
    const to = [...due.map((d) => d.date_to)].sort().at(-1);
    const end = to > addDays(today, 500) ? addDays(today, 500) : to;
    try {
      if (end >= from) {
        const rows = await availability(from, end);
        const values = mappings.flatMap((m) => availabilityRanges(rows.filter((r) => r.room_type === m.room_type).map((r) => ({ date: r.date, available: sellable(r.free) }))).map((range) => ({ property_id: propertyId, room_type_id: m.external_room_type_id, ...range })));
        for (let i = 0; i < values.length; i += 500) await api(host, key, "/availability", { method: "POST", body: JSON.stringify({ values: values.slice(i, i + 500) }) });
      }
      await pool.query(`UPDATE channel_sync_outbox SET status='sent',updated_at=$1 WHERE id=ANY($2::bigint[])`, [Date.now(), due.map((d) => d.id)]);
    } catch (error) {
      for (const d of due) await pool.query(`UPDATE channel_sync_outbox SET status='failed',attempts=attempts+1,last_error=$1,next_attempt_at=$2,updated_at=$3 WHERE id=$4`, [String(error).slice(0, 500), Date.now() + Math.min(60, 2 ** Number(d.attempts)) * 60_000, Date.now(), d.id]);
    }
  }

  // 2) Pull OTA reservations and acknowledge the imported ones.
  const feed = await api(host, key, `/booking_revisions/feed?filter[property_id]=${encodeURIComponent(propertyId)}`);
  let imported = 0;
  for (const revision of feed.data ?? []) {
    const rev = normalizeRevision(revision, typeByExternal);
    const result = await importRevision(rev);
    if (result === "imported" || result === "duplicate") {
      await api(host, key, `/booking_revisions/${encodeURIComponent(rev.revisionId)}/ack`, { method: "POST" }).catch((e) => console.error("ack failed", rev.revisionId, String(e)));
      if (result === "imported") imported++;
    }
  }
  console.log(`Channel sync: ${due.length} availability range(s), ${imported} OTA revision(s) imported.`);
} finally {
  await pool.end();
}

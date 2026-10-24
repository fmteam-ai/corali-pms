// Channel manager sync (PMS instance only). cPanel cron every minute (runs never overlap):
//   cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-channel-sync.mjs
// 1) Drains the Channex booking-revision feed (new / modified / cancelled OTA reservations), imports and acknowledges.
//    Unacknowledged revisions drop out of the feed after ~30 minutes, so a revision that fails raises a PMS alert.
// 2) Pushes sellable rooms per mapped room type and date for queued ranges (direct and OTA bookings close inventory),
//    plus an hourly full push as drift correction.
import process from "node:process";
import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { AVAILABILITY_SQL, CHANNEX_HOSTS, availabilityRanges, feedHasMore, normalizeRevision, planRevision, sellable } from "./channel-core.mjs";

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

/** Sellable rooms per room type and date (see AVAILABILITY_SQL). */
async function availability(from, to) {
  return (await pool.query(AVAILABILITY_SQL, [owner, from, to, Date.now()])).rows;
}

async function roomFree(client, roomId, checkIn, checkOut, exceptBookingId) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [roomId]);
  const busy = await client.query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 AND id<>$5 AND status NOT IN ('cancelled','checked_out','no_show') AND check_in<$4 AND check_out>$3 LIMIT 1`, [owner, roomId, checkIn, checkOut, exceptBookingId ?? 0]);
  return !busy.rowCount;
}

async function assignRoom(client, roomType, checkIn, checkOut, exceptBookingId) {
  const rooms = (await client.query(`SELECT id FROM rooms WHERE owner_id=$1 AND room_type=$2 AND active=1 AND operational_status<>'out_of_order' ORDER BY code`, [owner, roomType])).rows;
  for (const room of rooms) if (await roomFree(client, room.id, checkIn, checkOut, exceptBookingId)) return room.id;
  return null;
}

const outbox = (client, from, to, reason) => client.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)`, [owner, from, to, reason, Date.now()]);

async function notify(client, titleEl, titleEn, bookingId) {
  await client.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'ota_change',$2,$3,$4,$5)`, [owner, titleEl, titleEn, bookingId ? `/pms/reservations/${bookingId}` : "/pms/reservations", Date.now()]);
}

async function importRevision(rev) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const done = await client.query(`SELECT 1 FROM channel_import_log WHERE owner_id=$1 AND revision_id=$2 AND status='imported'`, [owner, rev.revisionId]);
    if (done.rowCount) { await client.query("ROLLBACK"); return "duplicate"; }
    const existing = (await client.query(`SELECT * FROM bookings WHERE owner_id=$1 AND external_channel=$2 AND external_reservation_id=$3 ORDER BY id FOR UPDATE`, [owner, rev.channel, rev.bookingId])).rows;
    const ids = [];
    if (rev.status === "cancelled") {
      for (const b of existing) {
        if (b.status !== "confirmed") continue;
        await client.query(`UPDATE bookings SET status='cancelled',cancelled_at=$2,version=version+1 WHERE id=$1`, [b.id, Date.now()]);
        await outbox(client, b.check_in, b.check_out, "ota_cancel");
        ids.push(Number(b.id));
      }
      await notify(client, `Ακύρωση OTA (${rev.channel}) · ${rev.reference} · ${rev.guestName}`, `OTA cancellation (${rev.channel}) · ${rev.reference} · ${rev.guestName}`, ids[0] ?? existing[0]?.id);
    } else {
      // New or modified: update the bookings already imported for this reservation in place (room, folio and payments
      // stay), add rooms that are new and cancel rooms the guest dropped. Never drop an OTA booking: with no free room
      // it is imported without a room (it still counts against availability) and reception is warned.
      const plan = planRevision(existing, rev.rooms);
      const unassigned = [];
      for (const { booking: b, room } of plan.updates) {
        const checkIn = b.status === "checked_in" ? b.check_in : room.checkIn;
        let roomId = b.room_id;
        const sameType = room.roomType && roomId ? (await client.query(`SELECT 1 FROM rooms WHERE id=$1 AND room_type=$2`, [roomId, room.roomType])).rowCount : 0;
        if (b.status !== "checked_in" && (!roomId || !sameType || !(await roomFree(client, roomId, checkIn, room.checkOut, b.id)))) roomId = room.roomType ? await assignRoom(client, room.roomType, checkIn, room.checkOut, b.id) : null;
        if (!roomId) unassigned.push(room.externalRoomTypeId ?? "?");
        const balance = rev.paymentCollect === "ota" ? 0 : Math.max(0, Number(b.balance_cents) + room.totalCents - Number(b.total_cents));
        await client.query(
          `UPDATE bookings SET room_id=$2,check_in=$3,check_out=$4,total_cents=$5,balance_cents=$6,adults=$7,children=$8,guest_name=$9,guest_email=COALESCE($10,guest_email),guest_phone=$11,special_requests=$12,external_room_type=$13,version=version+1 WHERE id=$1`,
          [b.id, roomId, checkIn, room.checkOut, room.totalCents, balance, room.adults, room.children, rev.guestName, rev.guestEmail, rev.guestPhone, rev.notes, room.roomType],
        );
        await outbox(client, b.check_in < checkIn ? b.check_in : checkIn, b.check_out > room.checkOut ? b.check_out : room.checkOut, "ota_modify");
        ids.push(Number(b.id));
      }
      for (const [n, room] of plan.inserts.entries()) {
        const index = plan.updates.length + n;
        const roomId = room.roomType ? await assignRoom(client, room.roomType, room.checkIn, room.checkOut) : null;
        if (!roomId) unassigned.push(room.externalRoomTypeId ?? "?");
        const balance = rev.paymentCollect === "ota" ? 0 : room.totalCents;
        const inserted = await client.query(
          `INSERT INTO bookings(owner_id,reference,guest_name,guest_email,guest_phone,guest_country,guest_language,room_id,check_in,check_out,channel,status,total_cents,balance_cents,adults,children,special_requests,created_at,external_channel,external_reservation_id,external_room_type)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13,$14,$15,$16,$17,$11,$18,$19) RETURNING id`,
          [owner, `${rev.channel.toUpperCase().slice(0, 3)}-${rev.reference}${rev.rooms.length > 1 ? `-${index + 1}` : ""}-${rev.revisionId.slice(0, 6)}`, rev.guestName, rev.guestEmail, rev.guestPhone, rev.guestCountry, rev.guestLanguage, roomId, room.checkIn, room.checkOut, rev.channel, room.totalCents, balance, room.adults, room.children, rev.notes, Date.now(), rev.bookingId, room.roomType],
        );
        ids.push(Number(inserted.rows[0].id));
        await outbox(client, room.checkIn, room.checkOut, "ota_booking");
      }
      for (const b of plan.cancels) {
        await client.query(`UPDATE bookings SET status='cancelled',cancelled_at=$2,version=version+1 WHERE id=$1`, [b.id, Date.now()]);
        await outbox(client, b.check_in, b.check_out, "ota_modify");
      }
      const label = rev.status === "modified" || existing.length ? ["Τροποποίηση OTA — ελέγξτε ημερομηνίες/δωμάτιο", "OTA modification — check dates/room"] : ["Νέα κράτηση OTA", "New OTA booking"];
      await notify(client, `${label[0]} (${rev.channel}) · ${rev.reference} · ${rev.guestName}${unassigned.length ? " · ΧΩΡΙΣ ΔΩΜΑΤΙΟ: ελέγξτε για overbooking" : ""}`, `${label[1]} (${rev.channel}) · ${rev.reference} · ${rev.guestName}${unassigned.length ? " · NO ROOM: check for overbooking" : ""}`, ids[0]);
    }
    await client.query(`INSERT INTO channel_import_log(owner_id,revision_id,status,booking_ids,created_at) VALUES($1,$2,'imported',$3,$4) ON CONFLICT(owner_id,revision_id) DO UPDATE SET status='imported',booking_ids=$3,error=NULL`, [owner, rev.revisionId, JSON.stringify(ids), Date.now()]);
    await client.query("COMMIT");
    return "imported";
  } catch (error) {
    await client.query("ROLLBACK");
    const first = !(await pool.query(`SELECT 1 FROM channel_import_log WHERE owner_id=$1 AND revision_id=$2`, [owner, rev.revisionId])).rowCount;
    await pool.query(`INSERT INTO channel_import_log(owner_id,revision_id,status,error,created_at) VALUES($1,$2,'failed',$3,$4) ON CONFLICT(owner_id,revision_id) DO UPDATE SET status='failed',error=$3`, [owner, rev.revisionId, String(error).slice(0, 500), Date.now()]);
    // Channex keeps an unacknowledged revision in the feed for ~30 minutes only: reception must look now.
    if (first) await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/integrations',$4)`, [owner, `⚠️ Κράτηση OTA δεν εισήχθη (${rev.channel} ${rev.reference}) — ελέγξτε άμεσα στο Channex`, `⚠️ OTA booking not imported (${rev.channel} ${rev.reference}) — check Channex now`, Date.now()]);
    console.error("revision failed", rev.revisionId, String(error));
    return "failed";
  } finally {
    client.release();
  }
}

// Only one run at a time (cron every minute; a slow push must not overlap the next run).
const lock = await pool.connect();
try {
  if (!(await lock.query("SELECT pg_try_advisory_lock(hashtext('corali-channel-sync')) AS ok")).rows[0].ok) { console.log("Channel sync already running."); process.exit(0); }
  const c = (await pool.query(`SELECT active,settings_json,secrets_encrypted FROM provider_connections WHERE owner_id=$1 AND provider_key='channelManager'`, [owner])).rows[0];
  if (!c || !Number(c.active)) { console.log("Channel manager not active; nothing to do."); process.exit(0); }
  const settings = JSON.parse(c.settings_json), key = JSON.parse(unseal(c.secrets_encrypted)).apiKey;
  const host = process.env.CHANNEX_BASE_URL || CHANNEX_HOSTS[settings.environment === "staging" ? "staging" : "production"], propertyId = settings.propertyCode;
  if (!key || !propertyId) throw Error("Channel manager API key and property id are required");
  const mappings = (await pool.query(`SELECT room_type,external_room_type_id FROM channel_room_mappings WHERE owner_id=$1`, [owner])).rows;
  const typeByExternal = Object.fromEntries(mappings.map((m) => [m.external_room_type_id, m.room_type]));

  // Drift correction: a full 500-day push every hour, so a missed change cannot leave the OTAs wrong for long.
  if (mappings.length && !(await pool.query(`SELECT 1 FROM channel_sync_outbox WHERE owner_id=$1 AND reason IN ('drift','full_sync') AND created_at>$2`, [owner, Date.now() - 3_600_000])).rowCount) {
    await outbox(pool, today, addDays(today, 500), "drift");
  }

  // 1) Drain the feed first, so the availability of rooms just sold on one OTA goes out in this same run: import,
  //    acknowledge, and read the next page while pages are full. A failed revision is left
  //    unacknowledged (retried next run) without blocking the others.
  let imported = 0;
  for (let page = 0; page < 30; page++) {
    const feed = await api(host, key, `/booking_revisions/feed?filter[property_id]=${encodeURIComponent(propertyId)}`);
    const items = feed.data ?? [];
    let acked = 0;
    for (const revision of items) {
      const rev = normalizeRevision(revision, typeByExternal);
      const result = await importRevision(rev);
      if (result === "imported" || result === "duplicate") {
        try { await api(host, key, `/booking_revisions/${encodeURIComponent(rev.revisionId)}/ack`, { method: "POST" }); acked++; } catch (e) { console.error("ack failed", rev.revisionId, String(e)); }
        if (result === "imported") imported++;
      }
    }
    if (!feedHasMore(feed.meta, items.length, acked > 0)) break;
  }
  // 2) Push availability for queued ranges, including OTA bookings just imported (clamped to today .. +500 days;
  //    Channex rejects past dates).
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

  await pool.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_ok_at,last_error) VALUES($1,$2,$2,NULL) ON CONFLICT(owner_id) DO UPDATE SET last_run_at=$2,last_ok_at=$2,last_error=NULL`, [owner, Date.now()]);
  console.log(`Channel sync: ${due.length} availability range(s), ${imported} OTA revision(s) imported.`);
} catch (error) {
  await pool.query(`INSERT INTO channel_sync_state(owner_id,last_run_at,last_error) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET last_run_at=$2,last_error=$3`, [owner, Date.now(), String(error).slice(0, 500)]).catch(() => {});
  throw error;
} finally {
  lock.release();
  await pool.end();
}

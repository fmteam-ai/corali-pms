// v187 Guest Journey Orchestrator (cron every 2 minutes; the PMS can run it at once): for each stay — arrivals in the
// next two days and guests in house — read the real state (room readiness, sensor, A/C, message deliveries, TV), let
// journey-core decide each step, perform the recovery actions (retry failed messages, pre-condition the room with
// the A/C, send / re-send the TV welcome with wake), keep one row per step and every change in the history, and alert
// staff once when a step fails. Also: the health of every cron step (automation_status).
import { FINAL, JOURNEY_STEPS, STEP_LABELS, automationAlert, evaluators, stepsFor, welcomeBody } from "./journey-core.mjs";
import { expectedReadyAt, hotelMs, roomState, DEFAULT_CHECKIN_TIME } from "./room-ready-core.mjs";
import { normalizePowerSettings } from "./tv-power-core.mjs";

const parse = (v, d) => { try { const x = JSON.parse(String(v ?? "")); return x && typeof x === "object" ? x : d; } catch { return d; } };
const athensDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function context(pool, owner, now) {
  const today = athensDate(now);
  const bookings = (await pool.query(
    `SELECT b.id,b.status,b.check_in,b.check_out,b.guest_name,COALESCE(b.guest_language,'en') lang,b.room_id,COALESCE(b.guest_email,'') email,COALESCE(b.guest_phone,'') phone,r.code room_code,r.operational_status
       FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
      WHERE b.owner_id=$1 AND ((b.status='confirmed' AND b.check_in>=$2 AND b.check_in<=$3) OR (b.status='checked_in' AND b.check_out>=$2))`,
    [owner, today, addDays(today, 2)],
  )).rows;
  const ids = bookings.map((b) => Number(b.id)), roomIds = [...new Set(bookings.map((b) => b.room_id).filter(Boolean).map(Number))];
  const [tasks, climate, ac, tvs, deliveries, prev, tvSettings, power, auto] = await Promise.all([
    pool.query(`SELECT room_id,status,expected_ready_at FROM housekeeping_tasks WHERE owner_id=$1 AND room_id=ANY($2::bigint[]) AND status IN ('todo','in_progress','cleaned','repaired','out_of_order')`, [owner, roomIds]),
    pool.query(`SELECT room_id,temp,read_at FROM room_climate WHERE owner_id=$1 AND room_id=ANY($2::bigint[])`, [owner, roomIds]),
    pool.query(`SELECT room_id,device_id,occupied FROM room_ac_devices WHERE owner_id=$1 AND room_id=ANY($2::bigint[]) AND device_id<>''`, [owner, roomIds]),
    pool.query(`SELECT room_id,last_seen_at FROM tv_screens WHERE owner_id=$1 AND active=1 AND room_id=ANY($2::bigint[])`, [owner, roomIds]),
    pool.query(`SELECT booking_id,event_key,channel,status,COALESCE(last_error,'') last_error,sent_at FROM message_deliveries WHERE owner_id=$1 AND booking_id=ANY($2::bigint[])`, [owner, ids]),
    pool.query(`SELECT * FROM journey_actions WHERE owner_id=$1 AND booking_id=ANY($2::bigint[])`, [owner, ids]),
    pool.query(`SELECT settings_json FROM tv_settings WHERE owner_id=$1`, [owner]),
    pool.query(`SELECT settings_json FROM tv_power_settings WHERE owner_id=$1`, [owner]),
    pool.query(`SELECT enabled,events_json FROM message_automation_settings WHERE owner_id=$1`, [owner]),
  ]);
  const checkInTime = String(parse(tvSettings.rows[0]?.settings_json, {}).checkInTime ?? DEFAULT_CHECKIN_TIME);
  const acEnabled = normalizePowerSettings(parse(power.rows[0]?.settings_json, {})).acEnabled;
  const events = parse(auto.rows[0]?.events_json, {});
  const arrivalAutomationOn = Number(auto.rows[0]?.enabled ?? 0) === 1 && (events.pre_arrival !== false || events.checkin !== false);
  return { today, bookings, tasks: tasks.rows, climate: climate.rows, ac: ac.rows, tvs: tvs.rows, deliveries: deliveries.rows, prev: prev.rows, checkInTime, acEnabled, arrivalAutomationOn };
}

/** Seen-at of the TV welcome message sent for this step (if any). */
async function tvSeen(pool, owner, messageId, roomId) {
  if (!messageId) return null;
  const r = (await pool.query(`SELECT seen_at FROM tv_message_rooms WHERE owner_id=$1 AND message_id=$2 AND room_id=$3`, [owner, messageId, roomId])).rows[0];
  return r?.seen_at ? Number(r.seen_at) : null;
}

async function perform(pool, owner, action, b, now, result) {
  if (action.type === "retry_deliveries") {
    await pool.query(`UPDATE message_deliveries SET status='pending',scheduled_at=$3,last_error=NULL,updated_at=$3 WHERE owner_id=$1 AND booking_id=$2 AND event_key IN ('pre_arrival','checkin') AND status='failed'`, [owner, b.id, now]);
    return { ...result, retries: Number(result.retries ?? 0) + 1, retriedAt: now };
  }
  if (action.type === "ac_precondition") {
    // The A/C plug follows the override while the room is empty; once the guest is in, the normal rule takes over.
    const r = await pool.query(`UPDATE room_ac_devices SET override_on=1,override_occupied=0,override_until=$3,override_by='journey',updated_at=$4 WHERE owner_id=$1 AND room_id=$2 AND COALESCE(occupied,0)=0`, [owner, b.room_id, action.until, now]);
    return { ...result, acStartedAt: r.rowCount ? now : null, acError: r.rowCount ? "" : "occupied" };
  }
  if (action.type === "tv_send") {
    const body = welcomeBody(b.guest_name, b.lang);
    const m = await pool.query(`INSERT INTO tv_messages(owner_id,body_json,urgent,created_by,created_at,theme,sound,wake) VALUES($1,$2,0,NULL,$3,'celebration',1,$4) RETURNING id`, [owner, JSON.stringify(body), now, action.wake ? 1 : 0]);
    await pool.query(`INSERT INTO tv_message_rooms(message_id,owner_id,room_id,expires_at) VALUES($1,$2,$3,$4)`, [m.rows[0].id, owner, b.room_id, now + 12 * 3_600_000]);
    return { ...result, messageId: Number(m.rows[0].id), sentAt: now, ...(action.wake ? { wokeAt: now } : {}) };
  }
  return result;
}

async function save(pool, owner, b, step, prevRow, ev, result, now, actor = "system") {
  const changed = !prevRow || prevRow.status !== ev.status || prevRow.detail !== ev.detail;
  const next = ev.next ?? now + 365 * 86_400_000;
  const r = await pool.query(
    `INSERT INTO journey_actions(owner_id,booking_id,step,status,detail,result_json,attempts,next_check_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$8)
     ON CONFLICT(owner_id,booking_id,step) DO UPDATE SET status=$4,detail=$5,result_json=$6,attempts=journey_actions.attempts+1,next_check_at=$7,updated_at=$8 RETURNING id,alerted_at`,
    [owner, b.id, step, ev.status, ev.detail.slice(0, 600), JSON.stringify(result), next, now],
  );
  const id = Number(r.rows[0].id);
  if (changed) await pool.query(`INSERT INTO journey_events(owner_id,action_id,booking_id,step,status,detail,actor,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [owner, id, b.id, step, ev.status, ev.detail.slice(0, 600), actor, now]);
  // Alert once when a step turns failed; a new failure after it recovered alerts again.
  if (ev.status === "failed" && ev.alert && (!prevRow || prevRow.status !== "failed")) {
    const label = STEP_LABELS[step];
    const title = `⚠️ ${b.room_code ? `Δωμ. ${b.room_code}` : "Κράτηση"} · ${b.guest_name}: ${label.el} — ${ev.detail}`;
    await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/journey',$4)`, [owner, title.slice(0, 300), `⚠️ ${b.room_code ? `Room ${b.room_code}` : "Booking"} · ${b.guest_name}: ${label.en} failed`.slice(0, 300), now]);
    await pool.query(`UPDATE journey_actions SET alerted_at=$2 WHERE id=$1`, [id, now]);
  }
  return { id, changed };
}

/**
 * One pass. `bookingId` / `step` / `force` let the PMS run one stay or one step at once («Επανάληψη»). Returns counts
 * per status and the actions performed.
 */
export async function runJourney({ pool, owner, now = Date.now(), bookingId = null, step = null, force = false, actor = "system" }) {
  const c = await context(pool, owner, now);
  const counts = { succeeded: 0, failed: 0, unconfirmed: 0, pending: 0, skipped: 0 }, actions = [];
  const checkInMs = hotelMs(c.today, /^([01]\d|2[0-3]):[0-5]\d$/.test(c.checkInTime) ? c.checkInTime : DEFAULT_CHECKIN_TIME);
  for (const b of c.bookings) {
    if (bookingId !== null && Number(b.id) !== Number(bookingId)) continue;
    const booking = { id: Number(b.id), status: String(b.status), checkIn: String(b.check_in), checkOut: String(b.check_out), guestName: String(b.guest_name), lang: String(b.lang), roomId: b.room_id ? Number(b.room_id) : null, email: String(b.email), phone: String(b.phone) };
    for (const s of stepsFor(booking, c.today)) {
      if (step && s !== step) continue;
      const prevRow = c.prev.find((p) => Number(p.booking_id) === booking.id && p.step === s) ?? null;
      if (prevRow && !force && Number(prevRow.next_check_at) > now) { counts[prevRow.status] = (counts[prevRow.status] ?? 0) + 1; continue; }
      if (prevRow && !force && FINAL.includes(prevRow.status) && prevRow.confirmed_by) { counts[prevRow.status]++; continue; }
      const prev = prevRow ? { status: String(prevRow.status), detail: String(prevRow.detail), result: parse(prevRow.result_json, {}) } : null;
      const roomTasks = c.tasks.filter((t) => Number(t.room_id) === booking.roomId).map((t) => ({ status: String(t.status), expectedReadyAt: t.expected_ready_at === null ? null : Number(t.expected_ready_at) }));
      const roomInfo = booking.roomId ? { code: String(b.room_code ?? booking.roomId), state: roomState({ operationalStatus: String(b.operational_status ?? ""), openTasks: roomTasks }), eta: expectedReadyAt({ operationalStatus: String(b.operational_status ?? ""), openTasks: roomTasks }) } : null;
      const cl = c.climate.find((x) => Number(x.room_id) === booking.roomId);
      const ac = c.ac.find((x) => Number(x.room_id) === booking.roomId);
      const tv = c.tvs.find((x) => Number(x.room_id) === booking.roomId);
      const ctx = {
        booking, now, today: c.today, checkInMs, room: roomInfo, prev, arrivalAutomationOn: c.arrivalAutomationOn,
        deliveries: c.deliveries.filter((d) => Number(d.booking_id) === booking.id).map((d) => ({ event: String(d.event_key), channel: String(d.channel), status: String(d.status), error: String(d.last_error), sentAt: d.sent_at ? Number(d.sent_at) : null })),
        climate: cl ? { temp: cl.temp === null ? null : Number(cl.temp), readAt: cl.read_at ? Number(cl.read_at) : null } : null,
        ac: ac ? { device: true, enabled: c.acEnabled, occupied: Number(ac.occupied ?? 0) === 1 } : null,
        tv: tv ? { lastSeenAt: tv.last_seen_at ? Number(tv.last_seen_at) : null, seenAt: await tvSeen(pool, owner, Number(prev?.result?.messageId ?? 0), booking.roomId) } : null,
      };
      const ev = evaluators[s](ctx);
      let result = prev?.result ?? {};
      if (ev.action) { result = await perform(pool, owner, ev.action, b, now, result); actions.push({ bookingId: booking.id, step: s, action: ev.action.type }); }
      await save(pool, owner, { ...b, id: booking.id }, s, prevRow, ev, result, now, actor);
      counts[ev.status]++;
    }
  }
  return { counts, actions, bookings: c.bookings.length };
}

/** Staff «Επιβεβαίωση χειροκίνητα»: the step is marked succeeded with who and why. */
export async function confirmJourneyStep({ pool, owner, actionId, userId, userName, note, now = Date.now() }) {
  const a = (await pool.query(`SELECT * FROM journey_actions WHERE owner_id=$1 AND id=$2`, [owner, actionId])).rows[0];
  if (!a) throw Error("NOT_FOUND");
  const detail = `Επιβεβαιώθηκε χειροκίνητα από ${userName}${note ? `: ${note}` : ""}.`.slice(0, 600);
  await pool.query(`UPDATE journey_actions SET status='succeeded',detail=$3,confirmed_at=$4,confirmed_by=$5,next_check_at=$6,updated_at=$4 WHERE owner_id=$1 AND id=$2`, [owner, actionId, detail, now, userId, now + 365 * 86_400_000]);
  await pool.query(`INSERT INTO journey_events(owner_id,action_id,booking_id,step,status,detail,actor,created_at) VALUES($1,$2,$3,$4,'succeeded',$5,$6,$7)`, [owner, actionId, a.booking_id, a.step, detail, `user:${userId}`, now]);
}

// ───────────────────────────── cron step health ─────────────────────────────

/** Record one cron step's result; after 3 failures in a row one PMS notification (again only after it recovers). */
export async function recordAutomation(pool, owner, name, status, error, ms, now = Date.now()) {
  const ok = status === "ok";
  const r = (await pool.query(
    `INSERT INTO automation_status(owner_id,name,last_run_at,last_ok_at,last_status,last_error,last_ms,runs,failures,consecutive_failures) VALUES($1,$2,$3::bigint,$4::bigint,$5,$6,$7::int,1,$8::int,$8::int)
     ON CONFLICT(owner_id,name) DO UPDATE SET last_run_at=$3::bigint,last_ok_at=COALESCE($4::bigint,automation_status.last_ok_at),last_status=$5,last_error=$6,last_ms=$7::int,runs=automation_status.runs+1,
       failures=automation_status.failures+$8::int,consecutive_failures=CASE WHEN $8::int=0 THEN 0 ELSE automation_status.consecutive_failures+1 END,alerted_at=CASE WHEN $8::int=0 THEN NULL ELSE automation_status.alerted_at END
     RETURNING consecutive_failures,alerted_at`,
    [owner, name, now, ok ? now : null, status, ok ? "" : String(error ?? "").slice(0, 400), Math.round(ms), ok ? 0 : 1],
  )).rows[0];
  if (!ok) {
    await pool.query(`INSERT INTO automation_failures(owner_id,name,status,error,created_at) VALUES($1,$2,$3,$4,$5)`, [owner, name, status, String(error ?? "").slice(0, 400), now]);
    if (automationAlert({ consecutive_failures: Number(r.consecutive_failures), alerted_at: r.alerted_at })) {
      await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'system',$2,$3,'/pms/journey?tab=automations',$4)`, [owner, `⚠️ Αυτοματισμός «${name}»: ${r.consecutive_failures} αποτυχίες στη σειρά — ${String(error ?? "").slice(0, 160)}`, `⚠️ Automation “${name}” failed ${r.consecutive_failures} times in a row`, now]);
      await pool.query(`UPDATE automation_status SET alerted_at=$3 WHERE owner_id=$1 AND name=$2`, [owner, name, now]);
    }
  }
  if (Math.random() < 0.01) await pool.query(`DELETE FROM automation_failures WHERE owner_id=$1 AND created_at<$2`, [owner, now - 30 * 86_400_000]);
}

export { JOURNEY_STEPS };

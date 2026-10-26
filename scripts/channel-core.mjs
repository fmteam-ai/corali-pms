// Channel manager sync rules (pure; unit tested). Adapter: Channex (https://docs.channex.io).

export const CHANNEX_HOSTS = { staging: "https://staging.channex.io", production: "https://secure.channex.io" };

/** Collapse per-day availability into date ranges with equal values: [{date_from,date_to,availability}] (date_to inclusive). */
export function availabilityRanges(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (const d of sorted) {
    const last = out.at(-1);
    const next = last ? new Date(`${last.date_to}T00:00:00Z`) : null;
    if (next) next.setUTCDate(next.getUTCDate() + 1);
    if (last && last.availability === d.available && next.toISOString().slice(0, 10) === d.date) last.date_to = d.date;
    else out.push({ date_from: d.date, date_to: d.date, availability: d.available });
  }
  return out;
}

/** Availability never goes below zero; out-of-order rooms and holds are already excluded from `free`. */
export function sellable(free) {
  return Math.max(0, Math.trunc(Number(free) || 0));
}

const otaChannel = (name) => {
  const n = String(name ?? "").toLowerCase();
  if (n.includes("booking")) return "booking.com";
  if (n.includes("expedia")) return "expedia";
  if (n.includes("airbnb")) return "airbnb";
  return n.replace(/[^a-z0-9._-]/g, "").slice(0, 40) || "ota";
};

/** Normalise a Channex booking revision into what the PMS imports (one entry per booked room). */
export function normalizeRevision(revision, roomTypeByExternalId) {
  const a = revision.attributes ?? revision;
  const customer = a.customer ?? {};
  const rooms = Array.isArray(a.rooms) ? a.rooms : [];
  const toCents = (v) => Math.round(Number(v ?? 0) * 100);
  return {
    revisionId: String(revision.id ?? a.id),
    bookingId: String(a.booking_id ?? a.ota_reservation_code ?? revision.id),
    status: a.status === "cancelled" ? "cancelled" : a.status === "modified" ? "modified" : "new",
    channel: otaChannel(a.ota_name),
    reference: String(a.ota_reservation_code ?? a.unique_id ?? revision.id).slice(0, 60),
    currency: String(a.currency ?? "EUR").toUpperCase(),
    paymentCollect: a.payment_collect === "ota" ? "ota" : "property",
    guestName: `${customer.name ?? ""} ${customer.surname ?? ""}`.trim() || "OTA guest",
    guestEmail: customer.mail ?? null,
    guestPhone: customer.phone ?? "",
    guestCountry: customer.country ?? "",
    guestLanguage: String(customer.language ?? "en").slice(0, 2).toLowerCase(),
    notes: String(a.notes ?? "").slice(0, 2000),
    rooms: rooms.map((r) => ({
      roomType: roomTypeByExternalId[r.room_type_id] ?? null,
      externalRoomTypeId: r.room_type_id ?? null,
      checkIn: r.checkin_date ?? a.arrival_date,
      checkOut: r.checkout_date ?? a.departure_date,
      adults: Math.max(1, Number(r.occupancy?.adults ?? 1)),
      children: Math.max(0, Number(r.occupancy?.children ?? 0)),
      totalCents: toCents(r.amount ?? (rooms.length ? Number(a.amount ?? 0) / rooms.length : a.amount)),
    })),
  };
}

/**
 * Sellable rooms per mapped room type and date ($1 owner, $2 from, $3 to, $4 now ms): active rooms that are not out of
 * order, minus stays and unpaid online holds, minus OTA bookings that could not be given a room (they are sold too).
 * Shared by the sync job and the PMS connection check, so both compute the same numbers.
 */
export const AVAILABILITY_SQL = `SELECT d.day::date::text AS date, rt.room_type,
    (count(r.id) FILTER (WHERE r.operational_status<>'out_of_order'
      AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in') AND b.check_in<=d.day::date::text AND b.check_out>d.day::date::text)
      AND NOT EXISTS (SELECT 1 FROM booking_sessions s WHERE s.owner_id=r.owner_id AND s.status='payment_pending' AND s.recovery_due_at>$4 AND s.check_in<=d.day::date::text AND s.check_out>d.day::date::text AND s.room_allocations::jsonb @> jsonb_build_array(r.id)))
     - (SELECT count(*) FROM bookings u WHERE u.owner_id=$1 AND u.room_id IS NULL AND u.external_room_type=rt.room_type AND u.status IN ('confirmed','checked_in') AND u.check_in<=d.day::date::text AND u.check_out>d.day::date::text))::int AS free
   FROM generate_series($2::date,$3::date,interval '1 day') AS d(day)
   CROSS JOIN (SELECT DISTINCT room_type FROM channel_room_mappings WHERE owner_id=$1) rt
   LEFT JOIN rooms r ON r.owner_id=$1 AND r.room_type=rt.room_type AND r.active=1
  GROUP BY d.day, rt.room_type`;

/**
 * How a new/modified revision is applied to the PMS bookings already imported for that OTA reservation (oldest first):
 * pair them with the revision's rooms and update in place (keeps the room, folio and payments), insert rooms that are
 * new, cancel bookings for rooms the guest dropped. Checked-in stays are only updated, never cancelled.
 */
export function planRevision(existing, rooms) {
  const active = existing.filter((b) => b.status === "confirmed" || b.status === "checked_in").sort((a, b) => Number(a.id) - Number(b.id));
  const updates = [], inserts = [], cancels = [];
  rooms.forEach((room, i) => (active[i] ? updates.push({ booking: active[i], room }) : inserts.push(room)));
  for (const b of active.slice(rooms.length)) if (b.status === "confirmed") cancels.push(b);
  return { updates, inserts, cancels };
}

/** The Channex feed is paginated (10 per page by default): keep reading while a page was full and something moved. */
export function feedHasMore(meta, pageSize, progressed) {
  return progressed && pageSize > 0 && Number(meta?.total ?? 0) > pageSize;
}

const jsonList = (v) => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v ?? "[]"); return Array.isArray(x) ? x : []; } catch { return []; } };
const shiftDay = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
/** A rule limited to some rooms applies to the room type (what the OTAs sell) only when it covers all its rooms. */
const coversType = (codes, typeCodes) => { const c = jsonList(codes).map(String); return !c.length || typeCodes.every((x) => c.includes(String(x))); };

/** Minimum stay judged on the arrival date (same precedence as lib/min-stay.ts). */
function minStayOnArrival(rules, date, roomType) {
  let best = null, bestKey = [];
  for (const r of rules) {
    if (r.active !== undefined && r.active !== null && Number(r.active) !== 1) continue;
    if (r.room_type && r.room_type !== roomType) continue;
    const period = Boolean(r.starts_on && r.ends_on);
    if (period && (r.starts_on > date || r.ends_on < date)) continue;
    const span = period ? (Date.parse(r.ends_on) - Date.parse(r.starts_on)) / 86_400_000 : Number.MAX_SAFE_INTEGER;
    const key = [r.room_type ? 1 : 0, period ? 1 : 0, -span, Number(r.updated_at ?? 0), Number(r.id) || 0];
    const greater = !best || key.some((v, i) => key.slice(0, i).every((w, j) => w === bestKey[j]) && v > bestKey[i]);
    if (greater) { best = r; bestKey = key; }
  }
  return best ? Math.max(1, Math.trunc(Number(best.min_nights)) || 1) : 1;
}

/**
 * The Channex restrictions of one room type per date, from the same rules the booking engine applies
 * (lib/public-rate.ts): min-stay rules → min_stay_arrival; rate-rule minimum stay and booking-restriction minimum stay
 * (any night of the stay) → min_stay_through; closed rate rules and stop-sell restrictions → stop_sell; closed-to-arrival
 * / departure (rule flags and closed weekdays). Restrictions limited to some rate plans are web-only and skipped.
 * `dates` are the nights to send; rules must be loaded from the day before the first date (departure closures).
 */
export function computeRestrictions({ dates, roomType, roomCodes, rateRules, minStayRules, restrictions }) {
  const typeRules = rateRules.filter((r) => (jsonList(r.room_codes).length ? coversType(r.room_codes, roomCodes) : !r.room_type || r.room_type === roomType));
  const shared = restrictions.filter((r) => Number(r.active ?? 1) === 1 && !jsonList(r.rate_plan_keys).length && coversType(r.room_codes, roomCodes));
  // The rate rule in force on a night: the latest one carrying a restriction (as the booking engine picks it).
  const ruleOn = (date) => typeRules.filter((r) => r.starts_on <= date && r.ends_on >= date && (r.minimum_stay !== null || r.maximum_stay !== null || Number(r.closed) === 1 || Number(r.closed_to_arrival) === 1 || Number(r.closed_to_departure) === 1)).at(-1);
  return dates.map((date) => {
    const rule = ruleOn(date), before = ruleOn(shiftDay(date, -1));
    const active = shared.filter((r) => r.starts_on <= date && r.ends_on >= date);
    const through = Math.max(1, Number(rule?.minimum_stay ?? 1) || 1, ...active.map((r) => Number(r.minimum_stay) || 1));
    const dow = weekday(date);
    return {
      date,
      min_stay_arrival: minStayOnArrival(minStayRules, date, roomType),
      min_stay_through: through,
      stop_sell: Number(rule?.closed) === 1 || active.some((r) => Number(r.stop_sell) === 1),
      closed_to_arrival: Number(rule?.closed_to_arrival) === 1 || active.some((r) => jsonList(r.closed_arrival_weekdays).map(Number).includes(dow)),
      // The PMS closes departure on the last night; Channex on the departure date (the next day).
      closed_to_departure: Number(before?.closed_to_departure) === 1 || shared.some((r) => r.starts_on < date && shiftDay(r.ends_on, 1) >= date && jsonList(r.closed_departure_weekdays).map(Number).includes(dow)),
    };
  });
}

const RESTRICTION_FIELDS = ["min_stay_arrival", "min_stay_through", "stop_sell", "closed_to_arrival", "closed_to_departure"];
export const restrictionKey = (v) => RESTRICTION_FIELDS.map((f) => String(v[f])).join("|");

/** Consecutive dates with identical restrictions become one {date_from,date_to,...} value. */
export function restrictionRanges(days) {
  const out = [];
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = out.at(-1);
    if (last && shiftDay(last.date_to, 1) === d.date && restrictionKey(last) === restrictionKey(d)) last.date_to = d.date;
    else out.push({ date_from: d.date, date_to: d.date, ...Object.fromEntries(RESTRICTION_FIELDS.map((f) => [f, d[f]])) });
  }
  return out;
}

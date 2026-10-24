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

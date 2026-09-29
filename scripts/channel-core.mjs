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

// Folio ledger rules. Pure functions (no database) so they can be unit tested.

export type FolioEntryType = "charge" | "payment" | "refund" | "adjustment" | "discount";
export type FolioCategory = "accommodation" | "extra" | "tax" | "fee" | "other";
export type Payer = "guest" | "company" | "agency";
export const payers: Payer[] = ["guest", "company", "agency"];

/** Stored sign convention: charges/adjustments/refunds increase the balance, payments/discounts decrease it. */
export function signedFolioAmount(type: FolioEntryType, amountCents: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw Error("INVALID_AMOUNT");
  return type === "payment" || type === "discount" ? -amountCents : amountCents;
}

export function refundAllowed(amountCents: number, netPaidCents: number): boolean {
  return Number.isSafeInteger(amountCents) && amountCents > 0 && Number.isSafeInteger(netPaidCents) && netPaidCents >= amountCents;
}

export type Night = { stay_date: string; amount_cents: number; original_cents?: number; payer: string };
export type Entry = { entry_type: string; category?: string | null; amount_cents: number; payer: string };

export type FolioSummary = {
  accommodation: number;
  extras: number;
  taxes: number;
  adjustments: number;
  discounts: number;
  payments: number;
  refunds: number;
  charges: number;
  balance: number;
  byPayer: Record<Payer, { charges: number; paid: number; balance: number }>;
};

const payerOf = (value: string): Payer => (value === "company" || value === "agency" ? value : "guest");

/**
 * Breakdown of a folio: gross charges by category, payments, refunds and balance, in total and per payer.
 * Payments/refunds are reported as positive amounts; balance = charges − payments + refunds (negative = credit).
 */
export function summarizeFolio(nights: Night[], entries: Entry[]): FolioSummary {
  const byPayer = Object.fromEntries(payers.map((p) => [p, { charges: 0, paid: 0, balance: 0 }])) as FolioSummary["byPayer"];
  const s: FolioSummary = { accommodation: 0, extras: 0, taxes: 0, adjustments: 0, discounts: 0, payments: 0, refunds: 0, charges: 0, balance: 0, byPayer };
  for (const night of nights) {
    const amount = Number(night.amount_cents);
    s.accommodation += amount;
    byPayer[payerOf(night.payer)].charges += amount;
  }
  for (const entry of entries) {
    const amount = Number(entry.amount_cents);
    const bucket = byPayer[payerOf(entry.payer)];
    switch (entry.entry_type) {
      case "payment": s.payments += -amount; bucket.paid += -amount; break;
      case "refund": s.refunds += amount; bucket.paid -= amount; break;
      case "discount": s.discounts += -amount; bucket.charges += amount; break;
      case "adjustment": s.adjustments += amount; bucket.charges += amount; break;
      default:
        if (entry.category === "accommodation") s.accommodation += amount;
        else if (entry.category === "tax" || entry.category === "fee") s.taxes += amount;
        else s.extras += amount;
        bucket.charges += amount;
    }
  }
  s.charges = s.accommodation + s.extras + s.taxes + s.adjustments - s.discounts;
  s.balance = s.charges - s.payments + s.refunds;
  for (const p of payers) byPayer[p].balance = byPayer[p].charges - byPayer[p].paid;
  return s;
}

export function stayDates(checkIn: string, checkOut: string): string[] {
  const dates: string[] = [];
  const d = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  while (d < end && dates.length < 400) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

/** Split a total evenly over the nights of a stay (remainder cents go to the first nights). */
export function evenNights(totalCents: number, checkIn: string, checkOut: string, payer: Payer = "guest"): Night[] {
  const dates = stayDates(checkIn, checkOut);
  if (!dates.length) return [];
  const safe = Math.max(0, Math.trunc(totalCents));
  const base = Math.floor(safe / dates.length);
  const remainder = safe % dates.length;
  return dates.map((stay_date, i) => ({ stay_date, amount_cents: base + (i < remainder ? 1 : 0), original_cents: base + (i < remainder ? 1 : 0), payer }));
}

/**
 * Re-map nightly rates onto new stay dates after a move or date change. Nights keep their order; extra nights reuse
 * the last night's rate and payer; surplus nights are dropped.
 */
export function reconcileNights(current: Night[], checkIn: string, checkOut: string): Night[] {
  const sorted = [...current].sort((a, b) => a.stay_date.localeCompare(b.stay_date));
  const dates = stayDates(checkIn, checkOut);
  if (!sorted.length) return [];
  return dates.map((stay_date, i) => {
    const source = sorted[Math.min(i, sorted.length - 1)];
    return { stay_date, amount_cents: Number(source.amount_cents), original_cents: Number(source.original_cents ?? source.amount_cents), payer: source.payer };
  });
}

/** Payment already taken when a legacy booking was created (not yet present as a folio line). */
export function impliedInitialPayment(totalCents: number, balanceCents: number, signedEntries: number[]): number {
  const implied = Number(totalCents) + signedEntries.reduce((sum, v) => sum + Number(v), 0) - Number(balanceCents);
  return Math.max(0, Math.trunc(implied));
}

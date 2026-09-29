// Pure helpers for myDATA documents built from the folio (unit tested).
import { paymentMethodType } from "../scripts/mydata-core.mjs";

export type Buckets = { accommodation: number; extras: number; fees: number; climate: number };
export const bucketKeys: (keyof Buckets)[] = ["accommodation", "extras", "fees", "climate"];

/** Gross amounts per myDATA bucket charged to one payer, from nightly rates and folio lines. */
export function payerBuckets(nights: { amount_cents: number; payer: string }[], entries: { entry_type: string; category?: string | null; amount_cents: number; payer: string }[], payer: string): Buckets {
  const b: Buckets = { accommodation: 0, extras: 0, fees: 0, climate: 0 };
  for (const n of nights) if (n.payer === payer) b.accommodation += Number(n.amount_cents);
  for (const e of entries) {
    if (e.payer !== payer) continue;
    const amount = Number(e.amount_cents);
    if (e.entry_type === "adjustment" || e.entry_type === "discount") b.accommodation += amount;
    else if (e.entry_type === "charge") {
      if (e.category === "accommodation") b.accommodation += amount;
      else if (e.category === "extra") b.extras += amount;
      else if (e.category === "tax") b.climate += amount;
      else b.fees += amount;
    }
  }
  return b;
}

/** What is still to be documented: charged minus already issued (non-cancelled) documents. */
export function remainingBuckets(charged: Buckets, issued: Buckets[]): Buckets {
  const out = { ...charged };
  for (const doc of issued) for (const k of bucketKeys) out[k] -= Number(doc[k] ?? 0);
  return out;
}

/** Payer's net payments per myDATA payment type not yet declared on earlier documents. */
export function remainingPayments(entries: { entry_type: string; amount_cents: number; payer: string; payment_method: string | null }[], payer: string, declared: { type: number; amount: number }[][]) {
  const byType = new Map<number, { method: string; amount: number }>();
  for (const e of entries) {
    if (e.payer !== payer || (e.entry_type !== "payment" && e.entry_type !== "refund")) continue;
    const type = paymentMethodType(e.payment_method);
    const current = byType.get(type) ?? { method: e.payment_method ?? "other", amount: 0 };
    current.amount += -Number(e.amount_cents); // payments are stored negative, refunds positive
    byType.set(type, current);
  }
  for (const doc of declared) for (const p of doc) if (p.type !== 5 && byType.has(p.type)) byType.get(p.type)!.amount -= p.amount;
  return [...byType.values()].filter((p) => p.amount > 0).map((p) => ({ method: p.method, amountCents: p.amount }));
}


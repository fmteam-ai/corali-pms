// Stripe Checkout options set in PMS → Integrations → Stripe (VikBooking-style), pure and unit tested.

export const stripeOptionKeys = ["paymentType", "submitType", "automaticMethods", "futureUsage", "extendedAuth", "companyName", "imageUrl", "metadata", "checkoutNote", "feeMode", "feeValue", "feeType"] as const;

export type StripePaymentType = "capture" | "authorization" | "off_session";
export type StripeOptions = {
  paymentType: StripePaymentType; // capture now · hold (authorize, capture later in the PMS) · save the card only (€0 now)
  submitType: "auto" | "book" | "pay"; // wording of the Checkout button
  automaticMethods: boolean; // let Stripe offer the payment methods enabled in the dashboard; false = cards only
  futureUsage: boolean; // always save the card for later charges (otherwise only when a balance is auto-charged)
  extendedAuth: boolean; // with authorization: ask for an extended hold window where the card supports it
  companyName: string; // shown in the Checkout line item
  imageUrl: string | null; // https image shown in Checkout
  metadata: Record<string, string>; // extra metadata copied to the payment
  checkoutNote: Record<string, string>; // note under the booking form's payment button, per language (empty = default text)
  fee: CardFee; // card processing fee (VikBooking "Charge/Discount" of the payment method)
};
export type CardFee = { mode: "none" | "charge" | "discount"; value: number; type: "percent" | "fixed" }; // fixed in cents

/** Keys the PMS itself puts in Stripe metadata; user metadata can never override them. */
const reserved = new Set(["booking_session_id", "owner_id", "token", "kind", "booking_id", "balance_link_id", "amount_cents"]);

/** "key=value" pairs, one per line or separated by ";" — at most 10, keys a-z/0-9/_ (≤40), values ≤200 characters. */
export function parseMetadata(text: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(text ?? "").split(/[;\n]/)) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const key = part.slice(0, i).trim().toLowerCase(), value = part.slice(i + 1).trim().slice(0, 200);
    if (!/^[a-z0-9_]{1,40}$/.test(key) || reserved.has(key) || !value) continue;
    if (Object.keys(out).length >= 10) break;
    out[key] = value;
  }
  return out;
}

/** Stored per-language note: JSON {el,en,…}, each at most 600 characters. */
export function parseNote(value: unknown): Record<string, string> {
  let parsed: unknown = {};
  try { parsed = JSON.parse(String(value || "{}")); } catch { return {}; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([k, v]) => ["el", "en", "fr", "de", "it", "es"].includes(k) && typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v).trim().slice(0, 600)]));
}

/** Fee settings: value is a percentage (e.g. "2.48") or an amount in euros (e.g. "1.50"). */
export function parseFee(s: Record<string, string>): CardFee {
  const mode = s.feeMode === "charge" || s.feeMode === "discount" ? s.feeMode : "none";
  const type = s.feeType === "fixed" ? "fixed" : "percent";
  const n = Number(String(s.feeValue ?? "").replace(",", "."));
  if (mode === "none" || !Number.isFinite(n) || n <= 0) return { mode: "none", value: 0, type };
  return { mode, type, value: type === "fixed" ? Math.round(Math.min(n, 1000) * 100) : Math.min(n, 20) };
}

/** Signed fee in cents on the reservation total (positive = charge added, negative = discount). */
export function cardFeeCents(totalCents: number, fee: CardFee): number {
  if (fee.mode === "none" || !(totalCents > 0)) return 0;
  const amount = fee.type === "fixed" ? fee.value : Math.round((totalCents * fee.value) / 100);
  return fee.mode === "charge" ? amount : -Math.min(amount, totalCents);
}

const yes = (v: unknown, fallback: boolean) => (v === "yes" ? true : v === "no" ? false : fallback);

/** Options from the stored settings, with safe defaults for anything missing or invalid. */
export function stripeOptions(settings: Record<string, string> | null | undefined): StripeOptions {
  const s = settings ?? {};
  const paymentType = (["capture", "authorization", "off_session"] as const).find((x) => x === s.paymentType) ?? "capture";
  const submitType = (["auto", "book", "pay"] as const).find((x) => x === s.submitType) ?? "book";
  const image = String(s.imageUrl ?? "").trim();
  return {
    paymentType, submitType,
    automaticMethods: yes(s.automaticMethods, true),
    futureUsage: yes(s.futureUsage, false),
    extendedAuth: yes(s.extendedAuth, false),
    companyName: String(s.companyName ?? "").trim().slice(0, 80) || "Hotel Corali",
    imageUrl: /^https:\/\/[^\s"'<>]{4,490}$/.test(image) ? image : null,
    metadata: parseMetadata(s.metadata),
    checkoutNote: parseNote(s.checkoutNote),
    fee: parseFee(s),
  };
}

/** Validation for the Integrations form: null when fine, else the field at fault. */
export function stripeOptionsProblem(settings: Record<string, string>): string | null {
  if (settings.paymentType && !["capture", "authorization", "off_session"].includes(settings.paymentType)) return "paymentType";
  if (settings.submitType && !["auto", "book", "pay"].includes(settings.submitType)) return "submitType";
  for (const k of ["automaticMethods", "futureUsage", "extendedAuth"]) if (settings[k] && !["yes", "no"].includes(settings[k])) return k;
  if (settings.imageUrl && !/^https:\/\/[^\s"'<>]{4,490}$/.test(settings.imageUrl.trim())) return "imageUrl";
  if (settings.companyName && settings.companyName.length > 80) return "companyName";
  if (settings.feeMode && !["none", "charge", "discount"].includes(settings.feeMode)) return "feeMode";
  if (settings.feeType && !["percent", "fixed"].includes(settings.feeType)) return "feeType";
  if (settings.feeValue && !/^\d{1,4}([.,]\d{1,2})?$/.test(settings.feeValue.trim())) return "feeValue";
  if (settings.feeType !== "fixed" && Number(String(settings.feeValue ?? "0").replace(",", ".")) > 20) return "feeValue";
  if (settings.checkoutNote) { try { const n = JSON.parse(settings.checkoutNote); if (!n || typeof n !== "object" || Array.isArray(n)) return "checkoutNote"; } catch { return "checkoutNote"; } }
  return null;
}

/**
 * Checkout Session parameters for a booking payment (everything except amounts, URLs and the PMS metadata).
 * `saveCard` is set when the booking's policy auto-charges the balance later, which needs the card on file.
 */
export function bookingCheckoutParams(o: StripeOptions, saveCard: boolean) {
  const keepCard = saveCard || o.futureUsage;
  const card = o.paymentType === "authorization" && o.extendedAuth ? { card: { request_extended_authorization: "if_available" as const } } : null;
  return {
    submit_type: o.submitType,
    ...(o.automaticMethods ? {} : { payment_method_types: ["card" as const] }),
    ...(card ? { payment_method_options: card } : {}),
    payment_intent_data: {
      ...(o.paymentType === "authorization" ? { capture_method: "manual" as const } : {}),
      ...(keepCard ? { setup_future_usage: "off_session" as const } : {}),
    },
    ...(keepCard ? { customer_creation: "always" as const } : {}),
  };
}

/** Whether a completed Checkout Session secures the booking: paid, a held authorization, or a saved card (setup). */
export function checkoutSecured(session: { mode?: string | null; status?: string | null; payment_status?: string | null }, intentStatus: string | null, setupStatus: string | null): "paid" | "authorized" | "card_saved" | null {
  // A held (manual-capture) payment is "authorized" whatever Checkout reports as payment_status.
  if (session.mode === "payment" && intentStatus === "requires_capture") return "authorized";
  if (session.mode === "payment" && session.payment_status === "paid") return "paid";
  if (session.mode === "setup" && session.status === "complete" && setupStatus === "succeeded") return "card_saved";
  return null;
}

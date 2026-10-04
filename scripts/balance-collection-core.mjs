// Rules for automatic balance collection before arrival (pure; unit tested).

export const MAX_ATTEMPTS = 3;
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

function days(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A confirmed booking with a balance is due once arrival is within the policy window (and not in the past). */
export function collectionDue(booking, policy, today) {
  if (!policy || !policy.active) return false;
  if (booking.status !== "confirmed" || !(Number(booking.balance_cents) > 0)) return false;
  const until = days(today, booking.check_in);
  return until >= 0 && until <= Number(policy.days);
}

/** Whether another charge attempt may be made, given previous attempts (newest first). */
export function attemptAllowed(attempts, now) {
  if (attempts.some((a) => a.status === "succeeded")) return false;
  const tries = attempts.filter((a) => a.status === "failed");
  if (tries.length >= MAX_ATTEMPTS) return false;
  const last = attempts[0];
  return !last || now - Number(last.created_at) >= RETRY_AFTER_MS;
}

/** Stripe PaymentIntent form body for an off-session balance charge. */
export function balanceChargeForm(booking, amountCents) {
  const form = new URLSearchParams();
  form.set("amount", String(amountCents));
  form.set("currency", "eur");
  form.set("customer", booking.payment_customer_ref);
  form.set("payment_method", booking.payment_method_ref);
  form.set("off_session", "true");
  form.set("confirm", "true");
  form.set("description", `Hotel Corali balance ${booking.reference}`);
  form.set("metadata[booking_id]", String(booking.id));
  form.set("metadata[kind]", "balance_auto");
  return form;
}

/** After a failed (or impossible) balance charge the guest has this long to pay with the link before automatic cancellation. */
export const PAYMENT_DEADLINE_MS = 48 * 60 * 60 * 1000;

/** Whether a booking given a payment deadline is still unpaid after it (and should be cancelled automatically). */
export function deadlineExpired(booking, now) {
  return booking.status === "confirmed" && Number(booking.balance_cents) > 0 && booking.balance_deadline_at !== null && booking.balance_deadline_at !== undefined && Number(booking.balance_deadline_at) <= now;
}

/** Deadline shown to the guest, in Greek time, e.g. "6 Oct 2026, 09:05". */
export function deadlineLabel(ms, lang) {
  const locale = { el: "el-GR", en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" }[lang] ?? "en-GB";
  return new Intl.DateTimeFormat(locale, { timeZone: "Europe/Athens", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

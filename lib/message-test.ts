import { stayDate } from "../scripts/email-brand-core.mjs";
// Test sends from PMS → Automated messages: sample booking values and readable diagnoses of SMTP / Meta errors (pure).

/** Placeholder booking used to fill templates in a test message. */
const sampleArrival: Record<string, string> = { el: "Check-in από τις 13:00 · ρεσεψιόν 07:30–21:00", en: "Check-in from 13:00 · reception open 07:30–21:00", fr: "Arrivée à partir de 13h00 · réception 07h30–21h00", de: "Check-in ab 13:00 · Rezeption 07:30–21:00", it: "Check-in dalle 13:00 · reception 07:30–21:00", es: "Check-in desde las 13:00 · recepción 07:30–21:00" };

/** Sample booking for test messages, in the language being tested (dates as guests see them). */
export function sampleValues(origin: string, lang = "en"): Record<string, string> {
  return { name: "Maria Papadopoulou", reference: "CRL-TEST01", checkIn: stayDate("2026-06-12", lang), checkOut: stayDate("2026-06-15", lang), amount: new Intl.NumberFormat(lang === "el" ? "el-GR" : lang, { style: "currency", currency: "EUR" }).format(240), link: `${origin.replace(/\/$/, "")}/book`, arrival: sampleArrival[lang] ?? sampleArrival.en };
}

/** Phone number as WhatsApp expects it: digits only with country code, or null when it cannot be one. */
export function whatsappNumber(value: string): string | null {
  const digits = value.replace(/[\s()+.-]/g, "");
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

export type SendDiagnosis = { code: string; hint: string };

/** Classify a nodemailer failure without exposing credentials. */
export function smtpDiagnosis(error: unknown): SendDiagnosis {
  const e = (error ?? {}) as { code?: string; responseCode?: number; message?: string };
  const code = String(e.code ?? "");
  if (e.message === "EMAIL_NOT_CONFIGURED") return { code: "EMAIL_NOT_CONFIGURED", hint: "not_configured" };
  if (code === "EAUTH" || e.responseCode === 535) return { code: "SMTP_AUTH", hint: "auth" };
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ECONNREFUSED" || code === "ESOCKET" || code === "EDNS") return { code: `SMTP_${code || "CONNECTION"}`, hint: "connection" };
  if (code === "EENVELOPE" || (e.responseCode ?? 0) >= 550) return { code: `SMTP_${e.responseCode ?? "ENVELOPE"}`, hint: "rejected" };
  return { code: `SMTP_${code || e.responseCode || "ERROR"}`, hint: "other" };
}

/** Classify a WhatsApp Cloud API error body (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes). */
export function metaDiagnosis(status: number, body: unknown): SendDiagnosis & { detail: string } {
  const err = ((body ?? {}) as { error?: { code?: number; message?: string; error_data?: { details?: string } } }).error ?? {};
  const code = Number(err.code ?? 0);
  const detail = String(err.error_data?.details || err.message || `HTTP ${status}`).slice(0, 300);
  const hint = code === 190 || status === 401 ? "token" : code === 131030 ? "recipient_not_allowed" : code === 132001 || code === 132000 || code === 132012 ? "template" : code === 131026 || code === 131047 ? "undeliverable" : code === 100 || code === 33 ? "settings" : code === 10 || code === 200 || status === 403 ? "permission" : "other";
  return { code: `WHATSAPP_${code || status}`, hint, detail };
}

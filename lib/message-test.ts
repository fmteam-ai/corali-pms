// Test sends from PMS → Automated messages: sample booking values and readable diagnoses of SMTP / Meta errors (pure).

/** Placeholder booking used to fill templates in a test message. */
export function sampleValues(origin: string): Record<string, string> {
  return { name: "Maria Papadopoulou", reference: "CRL-TEST01", checkIn: "2026-06-12", checkOut: "2026-06-15", amount: "€240.00", link: `${origin.replace(/\/$/, "")}/book`, arrival: "Check-in from 15:00 · reception open 08:00–22:00" };
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

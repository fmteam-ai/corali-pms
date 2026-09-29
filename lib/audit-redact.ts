// Pure helpers for audit payloads, kept separate so they can be unit tested.

const SENSITIVE = /pass(word)?|secret|token|totp|recovery|api_?key|private|hash|cvc|card|document_?number|passport|date_?of_?birth|dob|birth_?date/i;
const MAX_STRING = 2000;
const MAX_DEPTH = 6;

/** Deep copy with credentials and identity-document values replaced, long strings truncated. */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > MAX_DEPTH) return "[depth]";
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactForAudit(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE.test(key) && item !== null && item !== "" && item !== undefined ? "[redacted]" : redactForAudit(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** First client address from proxy headers (Passenger/Apache set X-Forwarded-For). */
export function clientAddress(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  return (first || realIp?.trim() || "").slice(0, 45);
}

/** Action name recorded for a mutating API call. */
export function auditActionName(method: string, body: unknown): string {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const verb = typeof record.action === "string" ? record.action : typeof record.kind === "string" ? `${method.toLowerCase()}:${record.kind}` : method.toLowerCase();
  return verb.slice(0, 100);
}

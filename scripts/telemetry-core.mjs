// v201 structured telemetry: one JSON line per event with a correlation id — no personal data, no secrets.
// The same id travels with an HTTP request (header x-correlation-id), a cron run and a Sentinel incident.
export const CORRELATION_HEADER = "x-correlation-id";
const SECRET_KEYS = /pass|secret|token|key|authorization|cookie|card|iban|email|phone/i;

/** Copies `fields` without values whose name suggests a secret or personal data. */
export function safeFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SECRET_KEYS.test(k) ? "«redacted»" : typeof v === "string" ? v.slice(0, 300) : v;
  return out;
}

/** Writes one structured log line: { level, event, correlationId, at, ...fields }. */
export function logEvent(level, event, correlationId, fields = {}, sink = (line) => (level === "error" ? console.error(line) : console.log(line))) {
  const line = JSON.stringify({ level, event, correlationId: correlationId ?? null, at: new Date().toISOString(), ...safeFields(fields) });
  try { sink(line); } catch { /* logging never throws */ }
  return line;
}

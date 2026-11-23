// v196: one way to handle a query that could not run. A failed read is never turned into an empty list silently:
// it is logged as a structured line (area, source, code, message — no row data) and returned as a DATA_UNAVAILABLE
// marker the caller shows to the user and the Reliability Center counts.
const recent = [];

/** Logs the failure and returns { area, source, code, at }. */
export function reportDataUnavailable(area, source, error, now = Date.now()) {
  const code = String(error?.code ?? error?.name ?? "ERROR").slice(0, 40);
  const entry = { area, source, code: "DATA_UNAVAILABLE", cause: code, at: now };
  try {
    console.error(JSON.stringify({ level: "error", event: "data_unavailable", area, source, cause: code, message: String(error?.message ?? error).slice(0, 200), at: new Date(now).toISOString() }));
  } catch { /* logging must never throw */ }
  recent.push(entry);
  if (recent.length > 100) recent.splice(0, recent.length - 100);
  return entry;
}

/** Failures seen by this process in the last `windowMs` (for the Reliability Center). */
export function recentDataUnavailable(now = Date.now(), windowMs = 15 * 60_000) {
  return recent.filter((e) => now - e.at <= windowMs);
}

export function clearDataUnavailable() { recent.length = 0; }

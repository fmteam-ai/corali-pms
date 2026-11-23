// v189 backup restore rehearsal: a backup is only proven by restoring it. The newest encrypted backup is decrypted,
// its archive read (pg_restore --list), restored into a SEPARATE rehearsal database, and the key tables counted
// there against the live database. Without a rehearsal database the archive is still verified («partial»).
export const CRITICAL_TABLES = ["bookings", "rooms", "folio_entries", "payment_transactions", "pms_staff_users", "fiscal_documents", "guest_checkins"];

/** Newest «corali-db-YYYY-MM-DD-HH-MM-SS.dump.enc» (the names sort by time). */
export function newestBackup(names) {
  return names.filter((n) => /^corali-db-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.dump\.enc$/.test(n)).sort().at(-1) ?? null;
}

/** Time of a backup from its name (UTC, as written by backupName). */
export function backupTime(name) {
  const m = /corali-db-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(name ?? "");
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

/** Tables with data in a pg_restore --list output («123; 0 16385 TABLE DATA public bookings owner»). */
export function tablesWithData(listOutput) {
  const out = new Set();
  for (const line of String(listOutput).split("\n")) {
    const m = /^\s*\d+;\s+\d+\s+\d+\s+TABLE DATA\s+(\S+)\s+"?([^"\s]+)"?/.exec(line);
    if (m) out.add(m[2]);
  }
  return out;
}

/** Same server and database name → refuse (the rehearsal empties its target). */
export function sameDatabase(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    const host = (u) => `${u.hostname.replace(/^127\.0\.0\.1$|^::1$/, "localhost")}:${u.port || "5432"}`;
    return host(x) === host(y) && decodeURIComponent(x.pathname) === decodeURIComponent(y.pathname);
  } catch { return true; }
}

/**
 * Verdict. toc = tables with data in the archive; restored / live = row counts per critical table (restored null when
 * not restored); liveBefore = live rows created before the backup (for tables with created_at), the number the
 * restored copy should hold, give or take rows deleted since by the data-retention job (5% tolerance).
 */
export function evaluateRehearsal({ toc, restored = null, liveBefore = {}, decryptOk = true }) {
  const checks = [];
  checks.push({ name: "Αποκρυπτογράφηση", ok: decryptOk });
  const missing = CRITICAL_TABLES.filter((t) => !toc.has(t) && (liveBefore[t] ?? 0) > 0);
  checks.push({ name: "Πίνακες στο αρχείο", ok: missing.length === 0, detail: missing.length ? `λείπουν: ${missing.join(", ")}` : `${toc.size} πίνακες με δεδομένα` });
  if (restored) {
    for (const t of CRITICAL_TABLES) {
      const want = liveBefore[t];
      const got = restored[t];
      if (want === undefined) continue;
      const ok = got !== undefined && got !== null && got >= Math.floor(want * 0.95) && got <= want + Math.max(2, Math.ceil(want * 0.05));
      checks.push({ name: `Εγγραφές ${t}`, ok, detail: `επαναφορά ${got ?? "—"} · αναμενόμενες ≈${want}` });
    }
  }
  const failed = checks.some((c) => !c.ok);
  return { status: failed ? "failed" : restored ? "ok" : "partial", checks };
}

export const REHEARSAL_MARKER = "corali_rehearsal_target";

/**
 * v190: may the rehearsal write to this target? Refused when it is the live database (same address, or the guard value
 * written to the live database is visible there), or when it holds tables of something else (not empty and not marked
 * as a rehearsal target by an earlier run).
 */
export function targetDecision({ sameUrl, nonceSeen, tables, marker }) {
  if (sameUrl || nonceSeen) return { ok: false, reason: "Η βάση δοκιμής είναι η βάση παραγωγής — η δοκιμή ακυρώθηκε χωρίς να αγγίξει τίποτα" };
  const foreign = tables.filter((t) => t !== REHEARSAL_MARKER);
  if (foreign.length && !marker) return { ok: false, reason: `Η βάση δοκιμής δεν είναι κενή (${foreign.slice(0, 5).join(", ")}${foreign.length > 5 ? "…" : ""}) και δεν έχει σημανθεί ως βάση δοκιμής — η δοκιμή ακυρώθηκε` };
  return { ok: true };
}

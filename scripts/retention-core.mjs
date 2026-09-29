// GDPR retention for identity data collected at online pre-check-in.
// Date of birth and ID/passport numbers are deleted 3 years after the guest's last check-out
// (last non-cancelled stay linked by booking or email; the submission date when no stay is linked).

export const RETENTION_YEARS = 3;

/** Calendar date (Europe/Athens) RETENTION_YEARS before `now`, as YYYY-MM-DD. */
export function retentionCutoff(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = today.split("-").map(Number);
  const cutoff = new Date(Date.UTC(y - RETENTION_YEARS, m - 1, d));
  // 29 February rolls back to 28 February.
  if (cutoff.getUTCMonth() !== m - 1) cutoff.setUTCDate(0);
  return cutoff.toISOString().slice(0, 10);
}

/** Irreversibly clears expired identity data. `query` is pg's pool.query/client.query (or PGlite's). Returns rows purged. */
export async function purgeExpiredIdentityData(query, ownerId, now = new Date()) {
  const result = await query(
    `UPDATE guest_checkins g
        SET date_of_birth_encrypted=NULL, birth_month=NULL, birth_day=NULL, document_number='', identity_purged_at=$2
      WHERE g.owner_id=$1 AND g.identity_purged_at IS NULL
        AND COALESCE(
          (SELECT max(b.check_out) FROM bookings b
            WHERE b.owner_id=g.owner_id AND b.status NOT IN ('cancelled','no_show')
              AND (b.id=g.booking_id OR (COALESCE(g.email,'')<>'' AND lower(b.guest_email)=lower(g.email)))),
          to_char(to_timestamp(g.submitted_at/1000.0) AT TIME ZONE 'Europe/Athens','YYYY-MM-DD')
        ) <= $3`,
    [ownerId, now.getTime(), retentionCutoff(now)],
  );
  return Number(result.affectedRows ?? result.rowCount ?? 0);
}

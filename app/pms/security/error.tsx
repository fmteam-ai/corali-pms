"use client";
// v181: an error on the Security center page shows its message (a browser-side error keeps its text), so the hotel
// can send a photo instead of looking for the server log.
export default function SecurityError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="card" role="alert"><h1>Δεν ήταν δυνατή η φόρτωση του Κέντρου ασφαλείας</h1><p><code>{error?.message || "—"}</code></p>{error?.digest && <p><small className="muted">Κωδικός σφάλματος: {error.digest}</small></p>}<button type="button" onClick={reset}>Επανάληψη</button></section>;
}

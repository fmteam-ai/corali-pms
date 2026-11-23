// v189 payment reconciliation against Stripe itself: the succeeded PaymentIntents Stripe holds for a period, against
// the payment transactions the PMS recorded (booking deposits, balance links, PMS card charges, balance collection
// all record the PaymentIntent id). A payment Stripe took that the PMS never recorded is the case of a webhook that
// never arrived or failed; an amount that differs is a wrong recording. Read only: nothing is changed in Stripe.
const eur = (c) => `€${(Number(c) / 100).toFixed(2)}`;

/** Lists succeeded PaymentIntents created in [fromMs, toMs) (at most `pages` × 100). */
export async function listStripePayments({ secretKey, fromMs, toMs, fetchImpl = fetch, pages = 10 }) {
  const out = [];
  let after = null, complete = true;
  for (let p = 0; p < pages; p++) {
    const q = new URLSearchParams({ limit: "100", "created[gte]": String(Math.floor(fromMs / 1000)), "created[lt]": String(Math.ceil(toMs / 1000)) });
    if (after) q.set("starting_after", after);
    const r = await fetchImpl(`https://api.stripe.com/v1/payment_intents?${q}`, { headers: { Authorization: `Bearer ${secretKey}` }, signal: AbortSignal.timeout(20_000) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(`STRIPE_HTTP_${r.status}: ${String(body?.error?.message ?? "").slice(0, 200)}`);
    const data = Array.isArray(body.data) ? body.data : [];
    out.push(...data);
    if (!body.has_more || !data.length) { complete = true; break; }
    after = data.at(-1).id;
    complete = false;
  }
  return { intents: out, complete };
}

/**
 * Compares. `owner` filters intents carrying another hotel's metadata.owner_id (one Stripe account, several
 * properties); intents without that metadata are taken as this hotel's.
 */
export async function stripeReconcile({ pool, owner, secretKey, fromMs, toMs = Date.now(), fetchImpl = fetch }) {
  const { intents, complete } = await listStripePayments({ secretKey, fromMs, toMs, fetchImpl });
  const ours = intents.filter((pi) => pi.status === "succeeded" && (!pi.metadata?.owner_id || pi.metadata.owner_id === owner));
  const ids = ours.map((pi) => String(pi.id));
  const recorded = ids.length
    ? (await pool.query(`SELECT t.provider_reference AS ref,t.amount_cents,t.status,b.reference FROM payment_transactions t LEFT JOIN bookings b ON b.owner_id=t.owner_id AND b.id=t.booking_id WHERE t.owner_id=$1 AND t.provider='stripe' AND t.provider_reference=ANY($2::text[])`, [owner, ids])).rows
    : [];
  const byRef = new Map(recorded.map((r) => [String(r.ref), r]));
  const issues = [];
  let stripeCents = 0;
  for (const pi of ours) {
    const amount = Number(pi.amount_received ?? pi.amount ?? 0);
    stripeCents += amount;
    const r = byRef.get(String(pi.id));
    const who = pi.metadata?.booking_reference || pi.metadata?.reference || pi.description || "";
    if (!r) issues.push({ kind: "stripe_not_recorded", level: "fail", reference: String(who || "—"), amountCents: amount, providerRef: pi.id, detail: `Το Stripe χρέωσε ${eur(amount)} (${pi.id}${who ? ` · ${who}` : ""}, ${new Date(Number(pi.created) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC) αλλά το PMS δεν το κατέγραψε — πιθανό webhook που δεν έφτασε. Ελέγξτε το Stripe → Webhooks και ξαναστείλτε το συμβάν.` });
    else if (Number(r.amount_cents) !== amount && r.status !== "authorized") issues.push({ kind: "amount_differs", level: "fail", reference: r.reference ?? "—", amountCents: amount - Number(r.amount_cents), providerRef: pi.id, detail: `${r.reference ?? pi.id}: Stripe ${eur(amount)}, PMS ${eur(r.amount_cents)}.` });
  }
  // PMS payments in the period that Stripe does not list (only checked when Stripe's list was complete).
  if (complete) {
    const pmsOnly = (await pool.query(`SELECT t.provider_reference AS ref,t.amount_cents,b.reference FROM payment_transactions t LEFT JOIN bookings b ON b.owner_id=t.owner_id AND b.id=t.booking_id WHERE t.owner_id=$1 AND t.provider='stripe' AND t.kind='payment' AND t.status IN ('succeeded','paid') AND t.provider_reference LIKE 'pi\\_%' AND t.created_at>=$2 AND t.created_at<$3 AND NOT (t.provider_reference=ANY($4::text[]))`, [owner, fromMs + 5 * 60_000, toMs - 5 * 60_000, ids])).rows;
    for (const r of pmsOnly) issues.push({ kind: "pms_not_in_stripe", level: "warn", reference: r.reference ?? "—", amountCents: Number(r.amount_cents), providerRef: r.ref, detail: `Πληρωμή ${r.ref} (${eur(r.amount_cents)}${r.reference ? ` · ${r.reference}` : ""}) καταγράφηκε στο PMS αλλά δεν εμφανίζεται επιτυχής στο Stripe.` });
  }
  return { fromMs, toMs, complete, totals: { stripeCents, intents: ours.length, recorded: recorded.length }, issues };
}

/** Stores a reconciliation run (kind stripe / folio / ota). */
export async function saveReconciliation(pool, owner, kind, { ranAt = Date.now(), fromMs = 0, toMs = 0, issues = [], totals = {}, error = "" }) {
  const status = error ? "error" : issues.some((i) => (i.level ?? "fail") === "fail") ? "fail" : issues.length ? "warn" : "ok";
  await pool.query(`INSERT INTO reconciliation_runs(owner_id,kind,ran_at,from_ms,to_ms,status,issues_json,totals_json,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [owner, kind, ranAt, fromMs, toMs, status, JSON.stringify(issues.slice(0, 200)), JSON.stringify(totals), String(error).slice(0, 500)]);
  await pool.query(`DELETE FROM reconciliation_runs WHERE owner_id=$1 AND kind=$2 AND ran_at<$3`, [owner, kind, ranAt - 60 * 86_400_000]);
  return status;
}

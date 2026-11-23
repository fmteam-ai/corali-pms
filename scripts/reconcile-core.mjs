// v187 financial reconciliation (folio payments are stored as negative amounts; charges positive) (PMS → Ταξίδι πελάτη → Αυτοματισμοί, and the release QA): payments recorded from the
// payment providers against the guests' folios, POS «charge to room» receipts and app orders against the folio
// charges they should have made, and duplicates. Every finding names the booking and the amount.
const eur = (c) => `€${(Number(c) / 100).toFixed(2)}`;

export async function reconcile({ pool, owner, fromMs, toMs = Date.now() }) {
  const q = (sql, extra = []) => pool.query(sql, [owner, fromMs, toMs, ...extra]).then((r) => r.rows);
  const [orphanProvider, orphanFolio, dupFolio, posMissing, posVoid, orderMissing, orderCancel, totals] = await Promise.all([
    // A payment the provider confirmed, with no payment line on that booking's folio.
    q(`SELECT t.provider,t.provider_reference ref,t.amount_cents,b.reference FROM payment_transactions t LEFT JOIN bookings b ON b.owner_id=t.owner_id AND b.id=t.booking_id
        WHERE t.owner_id=$1 AND t.created_at>=$2 AND t.created_at<$3 AND t.status IN ('succeeded','paid') AND t.kind='payment' AND t.provider_reference IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM folio_entries f WHERE f.owner_id=t.owner_id AND f.entry_type='payment' AND (f.receipt_reference=t.provider_reference OR f.receipt_reference LIKE t.provider_reference || '#%'))`),
    // A folio payment that says it came from a provider (Stripe / Viva reference) with no provider transaction.
    q(`SELECT f.id,f.receipt_reference ref,f.amount_cents,b.reference FROM folio_entries f JOIN bookings b ON b.owner_id=f.owner_id AND b.id=f.booking_id
        WHERE f.owner_id=$1 AND f.created_at>=$2 AND f.created_at<$3 AND f.entry_type='payment' AND f.payment_method IN ('stripe','viva') AND f.receipt_reference IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.owner_id=f.owner_id AND t.provider_reference=split_part(f.receipt_reference,'#',1))`),
    // The same charge twice on a folio within two minutes (a retried request charged twice).
    q(`SELECT f.booking_id,b.reference,f.description,f.amount_cents,count(*)::int n FROM folio_entries f JOIN bookings b ON b.owner_id=f.owner_id AND b.id=f.booking_id
        WHERE f.owner_id=$1 AND f.created_at>=$2 AND f.created_at<$3 AND f.entry_type='charge' AND f.amount_cents>0
        GROUP BY f.booking_id,b.reference,f.description,f.amount_cents,(f.created_at/120000) HAVING count(*)>1`),
    // A POS «charge to room» receipt without its folio line.
    q(`SELECT s.receipt_id,s.total_cents,b.reference FROM pos_sales s LEFT JOIN bookings b ON b.owner_id=s.owner_id AND b.id=s.booking_id
        WHERE s.owner_id=$1 AND s.created_at>=$2 AND s.created_at<$3 AND s.payment='room' AND s.source='pos' AND s.status='paid'
          AND (s.folio_entry_id IS NULL OR NOT EXISTS (SELECT 1 FROM folio_entries f WHERE f.owner_id=s.owner_id AND f.id=s.folio_entry_id))`),
    // A voided POS room charge that was never taken off the folio.
    q(`SELECT s.receipt_id,s.total_cents,b.reference FROM pos_sales s LEFT JOIN bookings b ON b.owner_id=s.owner_id AND b.id=s.booking_id
        WHERE s.owner_id=$1 AND s.voided_at>=$2 AND s.voided_at<$3 AND s.status='void' AND s.folio_entry_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM folio_entries f WHERE f.owner_id=s.owner_id AND f.booking_id=s.booking_id AND f.amount_cents=-s.total_cents AND f.description LIKE '%[POS ' || s.receipt_id || ']%')`),
    // An app order with a price but no folio charge.
    q(`SELECT o.id,o.title_el,o.amount_cents,b.reference FROM department_orders o JOIN bookings b ON b.owner_id=o.owner_id AND b.id=o.booking_id
        WHERE o.owner_id=$1 AND o.created_at>=$2 AND o.created_at<$3 AND o.amount_cents>0 AND o.status<>'cancelled'
          AND (o.folio_entry_id IS NULL OR NOT EXISTS (SELECT 1 FROM folio_entries f WHERE f.owner_id=o.owner_id AND f.id=o.folio_entry_id))`),
    // A cancelled app order whose charge was not reversed.
    q(`SELECT o.id,o.title_el,o.amount_cents,b.reference FROM department_orders o JOIN bookings b ON b.owner_id=o.owner_id AND b.id=o.booking_id
        WHERE o.owner_id=$1 AND o.created_at>=$2 AND o.created_at<$3 AND o.status='cancelled' AND o.amount_cents>0 AND o.folio_entry_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM folio_entries f WHERE f.owner_id=o.owner_id AND f.booking_id=o.booking_id AND f.amount_cents=-o.amount_cents)`),
    q(`SELECT
         (SELECT COALESCE(sum(amount_cents),0)::bigint FROM payment_transactions WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3 AND status IN ('succeeded','paid') AND kind='payment') provider,
         (SELECT COALESCE(sum(-amount_cents),0)::bigint FROM folio_entries WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3 AND entry_type='payment' AND payment_method IN ('stripe','viva')) folio_online,
         (SELECT COALESCE(sum(total_cents),0)::bigint FROM pos_sales WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3 AND payment='room' AND status='paid') pos_room,
         (SELECT COALESCE(sum(amount_cents),0)::bigint FROM department_orders WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3 AND status<>'cancelled') app_orders`),
  ]);
  const issues = [
    ...orphanProvider.map((r) => ({ kind: "provider_without_folio", reference: r.reference ?? "—", amountCents: Number(r.amount_cents), detail: `Πληρωμή ${r.provider} ${r.ref} (${eur(r.amount_cents)}) χωρίς εγγραφή πληρωμής στο folio.` })),
    ...orphanFolio.map((r) => ({ kind: "folio_without_provider", reference: r.reference, amountCents: Math.abs(Number(r.amount_cents)), detail: `Πληρωμή στο folio με αναφορά ${r.ref} (${eur(Math.abs(Number(r.amount_cents)))}) χωρίς συναλλαγή παρόχου.` })),
    ...dupFolio.map((r) => ({ kind: "duplicate_charge", reference: r.reference, amountCents: Number(r.amount_cents) * (Number(r.n) - 1), detail: `«${r.description}» ${eur(r.amount_cents)} ×${r.n} μέσα σε 2 λεπτά.` })),
    ...posMissing.map((r) => ({ kind: "pos_without_folio", reference: r.reference ?? "—", amountCents: Number(r.total_cents), detail: `Απόδειξη POS ${r.receipt_id} (χρέωση δωματίου ${eur(r.total_cents)}) χωρίς χρέωση στο folio.` })),
    ...posVoid.map((r) => ({ kind: "void_not_reversed", reference: r.reference ?? "—", amountCents: Number(r.total_cents), detail: `Ακυρωμένη απόδειξη POS ${r.receipt_id} (${eur(r.total_cents)}) δεν αφαιρέθηκε από το folio.` })),
    ...orderMissing.map((r) => ({ kind: "order_without_folio", reference: r.reference, amountCents: Number(r.amount_cents), detail: `Παραγγελία «${r.title_el}» (${eur(r.amount_cents)}) χωρίς χρέωση στο folio.` })),
    ...orderCancel.map((r) => ({ kind: "cancel_not_reversed", reference: r.reference, amountCents: Number(r.amount_cents), detail: `Ακυρωμένη παραγγελία «${r.title_el}» (${eur(r.amount_cents)}) δεν αφαιρέθηκε από το folio.` })),
  ];
  const t = totals[0] ?? {};
  const out = { fromMs, toMs, totals: { providerCents: Number(t.provider ?? 0), folioOnlineCents: Number(t.folio_online ?? 0), posRoomCents: Number(t.pos_room ?? 0), appOrdersCents: Number(t.app_orders ?? 0) }, issues };
  if (out.totals.providerCents !== out.totals.folioOnlineCents && !issues.some((i) => i.kind === "provider_without_folio" || i.kind === "folio_without_provider")) {
    issues.push({ kind: "totals_differ", reference: "—", amountCents: out.totals.providerCents - out.totals.folioOnlineCents, detail: `Σύνολο πληρωμών παρόχων ${eur(out.totals.providerCents)} ≠ πληρωμές online στο folio ${eur(out.totals.folioOnlineCents)}.` });
  }
  return out;
}

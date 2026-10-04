// Keyword guard for automatic replies to guest messages (pure, unit tested): money, changes, cancellations,
// complaints and urgent problems always go to reception, whatever the AI classification says.
const risky = [
  // English
  /refund|money back|charge|charged|pay|payment|card|price|discount|invoice|receipt|deposit|balance|cancel|change|modify|\bmove|extend|shorten|upgrade|complain|complaint|problem|broken|dirty|noise|sick|\bill\b|doctor|emergency|\blost\b|stolen|police|accident|lawyer|review|unhappy|disappoint|wrong/i,
  // Greek
  /επιστροφ|χρέω|χρεω|πληρω|πληρώ|κάρτα|καρτα|τιμή|τιμη|έκπτωσ|εκπτωσ|τιμολ|απόδειξ|αποδειξ|προκαταβ|υπόλοιπ|υπολοιπ|ακύρ|ακυρ|αλλαγ|αλλάξ|αλλαξ|παράτασ|παρατασ|παράπον|παραπον|πρόβλημα|προβλημα|χαλασ|βρώμ|βρωμ|θόρυβ|θορυβ|άρρωστ|αρρωστ|γιατρ|επείγ|επειγ|χάθηκ|χαθηκ|έκλεψ|εκλεψ|αστυνομ|ατύχημα|ατυχημα|κριτικ/i,
  // French, German, Italian, Spanish
  /rembours|annul|paiement|payer|carte|prix|réduction|plainte|problème|erstatt|storn|zahl|karte|preis|rabatt|beschwerd|problem|rimbors|cancell|pagament|carta|prezzo|sconto|reclam|problema|reembols|cancel|pago|tarjeta|precio|descuento|queja/i,
];

/** True when a guest message touches a subject that must be answered by a person. */
export function autoReplyBlocked(text: string): boolean {
  const t = String(text ?? "");
  return t.trim().length === 0 || risky.some((r) => r.test(t));
}

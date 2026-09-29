import { requireApiUser } from "@/lib/auth";
import { documentsBetween, paymentsBetween, toCsv } from "@/lib/payments-report";

const date = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const u = await requireApiUser("reports.financial");
  if (u instanceof Response) return u;
  const q = new URL(request.url).searchParams;
  const from = date.test(q.get("from") ?? "") ? q.get("from")! : "2000-01-01", to = date.test(q.get("to") ?? "") ? q.get("to")! : "2999-12-31";
  const euro = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  let body: string, name: string;
  if (q.get("kind") === "documents") {
    const rows = await documentsBetween(u.ownerId, from, to);
    body = toCsv(["Ημερομηνία", "Τύπος", "Σειρά", "Α/Α", "Κράτηση", "Πελάτης", "Χρεώστης", "Σύνολο €", "Κατάσταση", "MARK"], rows.map((r) => [r.issue_date, r.invoice_type, r.series, r.aa, r.reference, r.guest_name, r.payer, euro(r.total_cents), r.status, r.mark ?? ""]));
    name = `parastatika-${from}-${to}.csv`;
  } else {
    const rows = await paymentsBetween(u.ownerId, from, to, q.get("method") || null);
    body = toCsv(["Ημερομηνία", "Κράτηση", "Πελάτης", "Είδος", "Τρόπος", "Περιγραφή", "Χρεώστης", "Ποσό €", "Απόδειξη", "Χρήστης"], rows.map((r) => [new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "), r.reference, r.guest_name, r.entry_type, r.payment_method ?? "", r.description, r.payer, euro(-r.amount_cents), r.receipt_reference ?? "", r.actor ?? ""]));
    name = `pliromes-${from}-${to}.csv`;
  }
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}

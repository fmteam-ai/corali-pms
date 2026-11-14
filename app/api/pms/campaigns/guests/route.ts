import { recordAudit } from "@/lib/audit";
import { forbidden, requireApiUser } from "@/lib/auth";
import { guestList, guestListCsv, type GuestListFilter, type GuestListStatus, type WhatsAppListStatus } from "@/lib/guest-list";
import { can } from "@/lib/security/permissions";

const filters: GuestListFilter[] = ["all", "eligible", "no_consent", "unsubscribed", "ota_address", "future_stay"];
const csvLabels: Record<GuestListStatus, string> = { eligible: "Λαμβάνει", no_consent: "Χωρίς συγκατάθεση", unsubscribed: "Διαγράφηκε", ota_address: "Διεύθυνση OTA", future_stay: "Μετά τη διαμονή" };
const waCsvLabels: Record<WhatsAppListStatus, string> = { eligible: "Λαμβάνει", no_consent: "Χωρίς συγκατάθεση", unsubscribed: "Διαγράφηκε", no_phone: "Χωρίς κινητό", future_stay: "Μετά τη διαμονή" };

/** Guest e-mail list for bulk messages (search, filter); `format=csv` downloads it (staff who manage campaigns, logged). */
export async function GET(request: Request) {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  const p = new URL(request.url).searchParams;
  const filter = filters.includes(p.get("filter") as GuestListFilter) ? (p.get("filter") as GuestListFilter) : "all";
  const q = (p.get("q") ?? "").slice(0, 100);
  if (p.get("format") === "csv") {
    if (!can(u.role, "integrations.write", u.permissions)) return forbidden(u, "integrations.write", "campaigns.guest_export");
    const { rows } = await guestList(u.ownerId, { q, filter });
    await recordAudit({ ownerId: u.ownerId, userId: u.id, action: "export", entity: "guest_list", after: { rows: rows.length, filter, q: q || null } });
    return new Response(guestListCsv(rows, csvLabels, waCsvLabels), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lista-episkepton-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  }
  const list = await guestList(u.ownerId, { q, filter, limit: 300, lang: p.get("lang") === "en" ? "en" : "el" });
  return Response.json({ ok: true, ...list }, { headers: { "Cache-Control": "no-store" } });
}

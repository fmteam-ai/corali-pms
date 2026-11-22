import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { createPosKey, importSalesCsv, listPosLinks, reportCsv, revokePosKey, salesReport } from "@/lib/department-sales";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { can } from "@/lib/security/permissions";
import { addDays, daysBetween } from "../../../../scripts/department-sales-core.mjs";
import { hotelToday } from "@/lib/tape-chart";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** ?from=&to= (at most 366 days; default the last 30) → the sales report; &format=csv → the same as a CSV file. */
export async function GET(request: Request) {
  const u = await requireApiUser("reports.financial");
  if (u instanceof Response) return u;
  const q = new URL(request.url).searchParams, today = hotelToday();
  const to = isDate(q.get("to")) ? q.get("to")! : today, from = isDate(q.get("from")) ? q.get("from")! : addDays(to, -29);
  if (from > to || daysBetween(from, to) > 365) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const report = await salesReport(u.ownerId, from, to);
  if (q.get("format") === "csv") return new Response(reportCsv(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="department-sales-${from}-${to}.csv"`, "Cache-Control": "no-store" } });
  return Response.json({ ok: true, report, pos: await listPosLinks(u.ownerId) }, { headers: { "Cache-Control": "no-store" } });
}

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pos_create"), departmentId: z.number().int().positive(), name: z.string().trim().max(80).default("") }),
  z.object({ action: z.literal("pos_revoke"), departmentId: z.number().int().positive() }),
  z.object({ action: z.literal("import_csv"), departmentId: z.number().int().positive(), csv: z.string().min(10).max(3_000_000) }),
]);
const errors: Record<string, number> = { NOT_FOUND: 404 };

async function handlePOST(request: Request) {
  const u = await requireApiUser("reports.financial");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    // POS keys open a way into the folios: integrations editors only.
    if (x.action !== "import_csv" && !can(u.role, "integrations.write", u.permissions)) return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    if (x.action === "pos_create") return Response.json({ ok: true, key: await createPosKey(u.ownerId, x.departmentId, u.id, x.name), pos: await listPosLinks(u.ownerId) });
    if (x.action === "pos_revoke") { await revokePosKey(u.ownerId, x.departmentId); return Response.json({ ok: true, pos: await listPosLinks(u.ownerId) }); }
    return Response.json({ ok: true, result: await importSalesCsv(u.ownerId, x.departmentId, x.csv) });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (!errors[m]) console.error("Department sales failed", e);
    return Response.json({ ok: false, error: errors[m] ? m : "SAVE_FAILED" }, { status: errors[m] ?? 500 });
  }
}

// The audit log keeps the action and department; a long CSV is cut to its first 2,000 characters there.
export const POST = audited("department_sales", handlePOST);

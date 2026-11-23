import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportMarkdown, sentinelIncidents } from "../../../../scripts/sentinel-core.mjs";

export const dynamic = "force-dynamic";

/** v201 Corali Sentinel: incidents with their reports (read-only); ?report=<id> → the report as Markdown. */
export async function GET(request: Request) {
  const u = await requireApiUser("audit.read");
  if (u instanceof Response) return u;
  const data = await sentinelIncidents({ pool: db(), owner: u.ownerId });
  const id = Number(new URL(request.url).searchParams.get("report"));
  if (id) {
    const inc = data.incidents.find((i) => i.id === id);
    if (!inc) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    return new Response(reportMarkdown(inc), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="corali-incident-${id}.md"`, "Cache-Control": "no-store" } });
  }
  return Response.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store" } });
}

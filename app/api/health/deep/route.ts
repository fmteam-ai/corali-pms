import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { deepHealth } from "../../../../scripts/health-core.mjs";

export const dynamic = "force-dynamic";

/** v201 internal deep health: every critical service and the freshness of its work (signed-in admin only). */
export async function GET(): Promise<Response> {
  const u = await requireApiUser("audit.read");
  if (u instanceof Response) return u;
  const deep = await deepHealth({ pool: db(), owner: u.ownerId });
  return Response.json({ ok: deep.status === "ok", version: "v201", ...deep }, { status: deep.status === "fail" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}

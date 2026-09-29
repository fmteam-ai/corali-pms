import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { buildRateUrl } from "@/lib/rate-shopper";

const MAX_COMPETITORS = 5;
const apiUrl = z.string().trim().max(500).refine((v) => { if (!v) return true; try { buildRateUrl(v, { from: "2026-01-01", to: "2026-01-02" }); return true; } catch { return false; } });
const fields = z.object({ name: z.string().trim().min(2).max(120), website: z.union([z.url().startsWith("https://"), z.literal("")]).default(""), source: z.enum(["manual", "api"]), apiUrl: apiUrl.default(""), active: z.boolean().default(true) })
  .refine((x) => x.source === "manual" || x.apiUrl, { message: "API_URL_REQUIRED" });

function fail(e: unknown) {
  const m = e instanceof Error ? e.message : "";
  if (e instanceof z.ZodError) return Response.json({ ok: false, error: e.issues.some((i) => i.message === "API_URL_REQUIRED") ? "API_URL_REQUIRED" : "INVALID_INPUT" }, { status: 400 });
  if (m === "LIMIT") return Response.json({ ok: false, error: "COMPETITOR_LIMIT" }, { status: 409 });
  return Response.json({ ok: false, error: "SAVE_FAILED" }, { status: 500 });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("pricing.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = fields.parse(await request.json());
    const count = Number((await db().query(`SELECT count(*)::int n FROM competitors WHERE owner_id=$1`, [u.ownerId])).rows[0].n);
    if (count >= MAX_COMPETITORS) throw Error("LIMIT");
    const r = await db().query(`INSERT INTO competitors(owner_id,name,website,source,api_url,active,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [u.ownerId, x.name, x.website, x.source, x.apiUrl, x.active ? 1 : 0, Date.now()]);
    return Response.json({ ok: true, competitor: r.rows[0] }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

async function handlePATCH(request: Request) {
  const u = await requireApiUser("pricing.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const body = await request.json();
    const id = z.number().int().positive().parse(body?.id);
    const x = fields.parse(body);
    const r = await db().query(`UPDATE competitors SET name=$3,website=$4,source=$5,api_url=$6,active=$7 WHERE owner_id=$1 AND id=$2 RETURNING *`, [u.ownerId, id, x.name, x.website, x.source, x.apiUrl, x.active ? 1 : 0]);
    return r.rowCount ? Response.json({ ok: true, competitor: r.rows[0] }) : Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

async function handleDELETE(request: Request) {
  const u = await requireApiUser("pricing.delete");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    const r = await db().query(`DELETE FROM competitors WHERE owner_id=$1 AND id=$2`, [u.ownerId, id]);
    return Response.json({ ok: Boolean(r.rowCount) }, { status: r.rowCount ? 200 : 404 });
  } catch (e) {
    return fail(e);
  }
}

export const POST = audited("competitor", handlePOST);
export const PATCH = audited("competitor", handlePATCH);
export const DELETE = audited("competitor", handleDELETE);

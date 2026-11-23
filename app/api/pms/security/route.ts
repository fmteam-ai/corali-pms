import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { newEdgeKey, securityOverview, setEdgeEnforce, setEdgeStalePolicy } from "@/lib/security-center";
import { assertTrustedOrigin } from "@/lib/security/origin";

const noStore = { "Cache-Control": "no-store" };

/** v180: PMS → Security center — the state (GET); a new Cloudflare origin key, lock on / off (POST). */
export async function GET() {
  const u = await requireApiUser("audit.read");
  if (u instanceof Response) return u;
  const { lang } = await getPmsT();
  return Response.json({ ok: true, ...(await securityOverview(u.ownerId, lang === "el" ? "el" : "en")) }, { headers: noStore });
}

const input = z.discriminatedUnion("action", [z.object({ action: z.literal("newKey") }), z.object({ action: z.literal("enforce"), on: z.boolean() }), z.object({ action: z.literal("stalePolicy"), policy: z.enum(["open_all", "protect_admin"]) })]);

async function handlePOST(request: Request) {
  const u = await requireApiUser("users.manage");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    // The key is returned once and never stored in clear (only its hash) — the audit log records the action only.
    if (x.action === "newKey") return Response.json({ ok: true, key: await newEdgeKey(u.ownerId) }, { headers: noStore });
    if (x.action === "stalePolicy") { await setEdgeStalePolicy(u.ownerId, x.policy); return Response.json({ ok: true }, { headers: noStore }); }
    await setEdgeEnforce(u.ownerId, x.on);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (e) {
    const m = e instanceof z.ZodError ? "INVALID_INPUT" : e instanceof Error ? e.message : "FAILED";
    return Response.json({ ok: false, error: m }, { status: 400, headers: noStore });
  }
}

export const POST = audited("security", handlePOST);

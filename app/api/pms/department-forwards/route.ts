import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { forwardKinds } from "@/lib/department-forward-core";
import { forwardTargets, forwardToDepartment, forwardsFor, setForwardStatus } from "@/lib/department-forward";
import { assertTrustedOrigin } from "@/lib/security/origin";

const errors: Record<string, number> = { NOT_FOUND: 404, ALREADY_FORWARDED: 409, NO_RECIPIENTS: 409, ALREADY_HANDLED: 409, FORBIDDEN: 403 };
const fail = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  if (!errors[m]) console.error("Department forward failed", e);
  return Response.json({ ok: false, error: errors[m] ? m : "SAVE_FAILED" }, { status: errors[m] ?? 500 });
};

/** ?targets=1 → departments and their recipients; ?kind=message&ids=1,2 → forwards of those messages / orders. */
export async function GET(request: Request) {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  const q = new URL(request.url).searchParams;
  if (q.get("targets")) return Response.json({ ok: true, targets: await forwardTargets(u.ownerId) }, { headers: { "Cache-Control": "no-store" } });
  const kind = z.enum(forwardKinds).safeParse(q.get("kind"));
  if (!kind.success) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const ids = (q.get("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return Response.json({ ok: true, forwards: await forwardsFor(u.ownerId, kind.data, ids) }, { headers: { "Cache-Control": "no-store" } });
}

const input = z.object({ departmentId: z.number().int().positive(), kind: z.enum(forwardKinds), sourceId: z.number().int().positive(), note: z.string().trim().max(300).default(""), notifyGuest: z.boolean().default(true) });

/** PMS: forward a guest message / order to a department (its staff team and / or e-mail); the guest may be told. */
async function handlePOST(request: Request) {
  const u = await requireApiUser("reservations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    const r = await forwardToDepartment(u.ownerId, { ...x, actor: u.id });
    return Response.json({ ok: true, ...r, forwards: await forwardsFor(u.ownerId, x.kind, [x.sourceId]) });
  } catch (e) { return fail(e); }
}

/** Corali Staff (the department): { id, status: "seen" | "done" }. */
async function handlePATCH(request: Request) {
  const u = await requireApiUser("staff.app");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = z.object({ id: z.number().int().positive(), status: z.enum(["seen", "done"]) }).parse(await request.json());
    await setForwardStatus(u.ownerId, x.id, { id: u.id, role: u.role }, x.status);
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}

export const POST = audited("department_forwards", handlePOST);
export const PATCH = audited("department_forwards", handlePATCH);

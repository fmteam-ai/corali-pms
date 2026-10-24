import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { clearDnd, completeTvRequest, dndRooms, listTvRequests } from "@/lib/tv-requests";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("done"), id: z.number().int().positive() }),
  z.object({ action: z.literal("clear_dnd"), roomId: z.number().int().positive() }),
]);

async function state(ownerId: string, all: boolean) {
  const [requests, dnd] = await Promise.all([listTvRequests(ownerId, all), dndRooms(ownerId)]);
  return { ok: true, requests, dnd };
}

export async function GET(request: Request) {
  const u = await requireApiUser("housekeeping.read");
  if (u instanceof Response) return u;
  return Response.json(await state(u.ownerId, new URL(request.url).searchParams.get("all") === "1"), { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("housekeeping.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "done") {
      if (!(await completeTvRequest(u.ownerId, x.id, u.id))) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    } else {
      await clearDnd(u.ownerId, x.roomId);
    }
    return Response.json(await state(u.ownerId, false));
  } catch (e) {
    const code = e instanceof z.ZodError ? "INVALID_INPUT" : "SAVE_FAILED";
    return Response.json({ ok: false, error: code }, { status: code === "SAVE_FAILED" ? 500 : 400 });
  }
}

export const POST = audited("tv_requests", handlePOST);

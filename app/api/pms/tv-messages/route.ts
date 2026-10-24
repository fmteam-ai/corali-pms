import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { parsePhoto } from "@/lib/maintenance";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { cancelTvMessage, listTvMessages, sendTvMessage } from "@/lib/tv-messages";
import { tvMessageDurations, tvMessageThemes } from "@/lib/tv-messages-core";

const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"),
    el: z.string().trim().max(500).default(""),
    en: z.string().trim().max(500).default(""),
    rooms: z.union([z.literal("all"), z.array(z.number().int().positive()).min(1).max(200)]),
    duration: z.enum(tvMessageDurations as [string, ...string[]]),
    urgent: z.boolean().default(false),
    photo: z.string().max(3_500_000).nullable().default(null),
    theme: z.enum(tvMessageThemes as [string, ...string[]]).default("standard"),
  }).refine((x) => x.el || x.en || x.photo),
  z.object({ action: z.literal("cancel"), id: z.number().int().positive() }),
]);

export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, messages: await listTvMessages(u.ownerId) });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("reservations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "send") {
      const photo = x.photo ? parsePhoto(x.photo) : null;
      if (x.photo && !photo) return Response.json({ ok: false, error: "INVALID_PHOTO" }, { status: 400 });
      await sendTvMessage(u.ownerId, u.id, { el: x.el || undefined, en: x.en || undefined }, x.rooms, x.duration as (typeof tvMessageDurations)[number], x.urgent, photo && { mime: photo.mime, base64: photo.base64 }, x.theme as (typeof tvMessageThemes)[number]);
    } else if (!(await cancelTvMessage(u.ownerId, x.id))) {
      return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    return Response.json({ ok: true, messages: await listTvMessages(u.ownerId) });
  } catch (e) {
    const code = e instanceof z.ZodError ? "INVALID_INPUT" : e instanceof Error && e.message === "NO_ROOMS" ? "NO_ROOMS" : "SAVE_FAILED";
    return Response.json({ ok: false, error: code }, { status: code === "SAVE_FAILED" ? 500 : 400 });
  }
}

export const POST = audited("tv_messages", handlePOST);

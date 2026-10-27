import { z } from "zod";
import { audited } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/auth";
import { announcementKinds } from "@/lib/guest-portal-core";
import { createAnnouncement, inHouseGuests, listAnnouncements, listDepartments, removeAnnouncement } from "@/lib/guest-portal";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { sendTvMessage } from "@/lib/tv-messages";

const text = (max: number) => z.string().trim().max(max).default("");
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"), departmentId: z.number().int().positive().nullable().default(null), bookingId: z.number().int().positive().nullable().default(null),
    kind: z.enum(announcementKinds), titleEl: text(120), titleEn: text(120), bodyEl: text(1500), bodyEn: text(1500),
    startsAt: z.number().int().positive(), endsAt: z.number().int().positive().nullable().default(null), tv: z.boolean().default(false),
  }).refine((x) => (x.titleEl || x.bodyEl || x.titleEn || x.bodyEn) && (x.endsAt === null || x.endsAt > x.startsAt)),
  z.object({ action: z.literal("remove"), id: z.number().int().positive() }),
]);

async function state(ownerId: string) {
  const [announcements, guests, departments] = await Promise.all([listAnnouncements(ownerId), inHouseGuests(ownerId), listDepartments(ownerId)]);
  return { ok: true, announcements, guests, departments: departments.map((d) => ({ id: d.id, name: d.nameEl })) };
}

/** PMS → Messages to guests: news, offers and happy hours for every guest in the hotel or one booking. */
export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  return Response.json(await state(u.ownerId), { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("reservations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (x.action === "remove") await removeAnnouncement(u.ownerId, x.id);
    else {
      await createAnnouncement(u.ownerId, u.id, x);
      // Also on the room TVs (all screens, or the guest's room) when asked and the message starts now.
      if (x.tv && x.startsAt <= Date.now() + 60_000) {
        const body = { el: [x.titleEl, x.bodyEl].filter(Boolean).join("\n") || undefined, en: [x.titleEn, x.bodyEn].filter(Boolean).join("\n") || undefined };
        const rooms: number[] | "all" = x.bookingId === null ? "all" : (await db().query(`SELECT room_id FROM bookings WHERE owner_id=$1 AND id=$2 AND room_id IS NOT NULL`, [u.ownerId, x.bookingId])).rows.map((r) => Number(r.room_id));
        if (rooms === "all" || rooms.length) await sendTvMessage(u.ownerId, u.id, body, rooms, "tonight", false, null, x.kind === "info" ? "standard" : "celebration", true, false);
      }
    }
    return Response.json(await state(u.ownerId));
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (m !== "NOT_FOUND") console.error("Guest message failed", e);
    return Response.json({ ok: false, error: m === "NOT_FOUND" ? m : "SAVE_FAILED" }, { status: m === "NOT_FOUND" ? 404 : 500 });
  }
}

export const POST = audited("guest_announcements", handlePOST);

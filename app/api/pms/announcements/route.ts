import { z } from "zod";
import { audited } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/auth";
import { announcementKinds } from "@/lib/guest-portal-core";
import { audienceBookings, createAnnouncement, inHouseGuests, listAnnouncements, listDepartments, removeAnnouncement } from "@/lib/guest-portal";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { sendTvMessage } from "@/lib/tv-messages";
import { AUDIENCE_SEGMENTS, MAX_DISCOUNT } from "../../../../scripts/department-sales-core.mjs";

const text = (max: number) => z.string().trim().max(max).default("");
// v184: the guests an offer is for (in house now) and an item at a promo price.
const audience = z.object({ segment: z.enum(AUDIENCE_SEGMENTS as [string, ...string[]]).default("all"), departmentId: z.number().int().positive().nullable().default(null), languages: z.array(z.enum(["el", "en", "fr", "de", "it", "es"])).max(6).default([]) }).default({ segment: "all", departmentId: null, languages: [] });
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"), departmentId: z.number().int().positive().nullable().default(null), bookingId: z.number().int().positive().nullable().default(null),
    kind: z.enum(announcementKinds), titleEl: text(120), titleEn: text(120), bodyEl: text(1500), bodyEn: text(1500),
    startsAt: z.number().int().positive(), endsAt: z.number().int().positive().nullable().default(null), tv: z.boolean().default(false),
    audience, itemId: z.number().int().positive().nullable().default(null), discountPercent: z.number().int().min(0).max(MAX_DISCOUNT).default(0),
  }).refine((x) => (x.titleEl || x.bodyEl || x.titleEn || x.bodyEn) && (x.endsAt === null || x.endsAt > x.startsAt)),
  z.object({ action: z.literal("remove"), id: z.number().int().positive() }),
  z.object({ action: z.literal("preview"), departmentId: z.number().int().positive().nullable().default(null), audience }),
]);

async function state(ownerId: string) {
  const [announcements, guests, departments] = await Promise.all([listAnnouncements(ownerId), inHouseGuests(ownerId), listDepartments(ownerId)]);
  return { ok: true, announcements, guests, departments: departments.map((d) => ({ id: d.id, name: d.nameEl, items: d.items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.nameEl, priceCents: i.priceCents })) })) };
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
    if (x.action === "preview") {
      const ids = await audienceBookings(u.ownerId, x.audience, x.departmentId);
      return Response.json({ ok: true, count: ids === null ? (await inHouseGuests(u.ownerId)).length : ids.length, all: ids === null });
    }
    if (x.action === "remove") await removeAnnouncement(u.ownerId, x.id);
    else {
      const id = await createAnnouncement(u.ownerId, u.id, x);
      // Also on the room TVs (all screens, or the guest's room) when asked and the message starts now.
      if (x.tv && x.startsAt <= Date.now() + 60_000) {
        const body = { el: [x.titleEl, x.bodyEl].filter(Boolean).join("\n") || undefined, en: [x.titleEn, x.bodyEn].filter(Boolean).join("\n") || undefined };
        // A group offer goes only to the TVs of the rooms in its audience.
        const targets = JSON.parse(String((await db().query(`SELECT target_bookings_json FROM guest_announcements WHERE owner_id=$1 AND id=$2`, [u.ownerId, id])).rows[0]?.target_bookings_json ?? "null")) as number[] | null;
        const ids = x.bookingId !== null ? [x.bookingId] : targets;
        const rooms: number[] | "all" = ids === null ? "all" : (await db().query(`SELECT DISTINCT room_id FROM bookings WHERE owner_id=$1 AND id=ANY($2::bigint[]) AND room_id IS NOT NULL`, [u.ownerId, ids])).rows.map((r) => Number(r.room_id));
        if (rooms === "all" || rooms.length) await sendTvMessage(u.ownerId, u.id, body, rooms, "tonight", false, null, x.kind === "info" ? "standard" : "celebration", true, false);
      }
    }
    return Response.json(await state(u.ownerId));
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    const known: Record<string, number> = { NOT_FOUND: 404, NO_AUDIENCE: 409 };
    if (!known[m]) console.error("Guest message failed", e);
    return Response.json({ ok: false, error: known[m] ? m : "SAVE_FAILED" }, { status: known[m] ?? 500 });
  }
}

export const POST = audited("guest_announcements", handlePOST);

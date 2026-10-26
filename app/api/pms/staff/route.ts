import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { addDaysIso, mondayOf, staffModules } from "@/lib/staff-core";
import { copyWeek, deleteShift, deleteSpecialty, listShifts, listSpecialties, saveShift, saveSpecialty, staffPeople } from "@/lib/staff";
import { deferStaffPush } from "@/lib/staff-push";
import { hotelToday } from "@/lib/tape-chart";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("specialty"), id: z.number().int().positive().optional(), name: z.string().trim().min(2).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), modules: z.array(z.enum(staffModules)).max(3), members: z.array(z.number().int().positive()).max(200) }),
  z.object({ action: z.literal("deleteSpecialty"), id: z.number().int().positive() }),
  z.object({ action: z.literal("shift"), id: z.number().int().positive().optional(), userId: z.number().int().positive(), date: day, start: time, end: time, specialtyId: z.number().int().positive().nullable().default(null), note: z.string().trim().max(120).default("") }),
  z.object({ action: z.literal("deleteShift"), id: z.number().int().positive() }),
  z.object({ action: z.literal("copyWeek"), from: day, to: day }),
]);
const errors: Record<string, number> = { INVALID_SHIFT: 400, INVALID_STAFF: 400, INVALID_SPECIALTY: 400, SHIFT_OVERLAP: 409, NOT_FOUND: 404 };

async function state(ownerId: string, week: string) {
  const monday = mondayOf(week);
  const [people, specialties, shifts] = await Promise.all([staffPeople(ownerId), listSpecialties(ownerId), listShifts(ownerId, monday, addDaysIso(monday, 6))]);
  return { ok: true, monday, people, specialties, shifts };
}

/** PMS → Staff: teams (specialties), people and the shifts of one week (?week=YYYY-MM-DD, any day of it). */
export async function GET(request: Request) {
  const u = await requireApiUser("users.manage");
  if (u instanceof Response) return u;
  const week = new URL(request.url).searchParams.get("week");
  return Response.json(await state(u.ownerId, week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : hotelToday()), { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("users.manage");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    let week = hotelToday();
    if (x.action === "specialty") await saveSpecialty(u.ownerId, x);
    else if (x.action === "deleteSpecialty") await deleteSpecialty(u.ownerId, x.id);
    else if (x.action === "shift") { await saveShift(u, x); week = x.date; }
    else if (x.action === "deleteShift") await deleteShift(u, x.id);
    else {
      const copied = await copyWeek(u, mondayOf(x.from), mondayOf(x.to));
      week = x.to;
      // One alert per person for the copied week.
      const people = [...new Set((await listShifts(u.ownerId, mondayOf(x.to), addDaysIso(mondayOf(x.to), 6))).map((s) => s.userId))];
      if (copied && people.length) deferStaffPush(u.ownerId, { userIds: people }, { kind: "shift", tag: `week-${mondayOf(x.to)}`, url: "/staff?tab=shifts", title: { el: "Νέες βάρδιες", en: "New shifts" }, body: { el: `Το πρόγραμμα της εβδομάδας από ${mondayOf(x.to).split("-").reverse().join("/")} είναι έτοιμο.`, en: `The schedule for the week of ${mondayOf(x.to).split("-").reverse().join("/")} is ready.` } }, { exceptUserId: u.id });
      return Response.json({ ...(await state(u.ownerId, week)), copied });
    }
    return Response.json(await state(u.ownerId, week));
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    return Response.json({ ok: false, error: errors[m] ? m : "SAVE_FAILED" }, { status: errors[m] ?? 500 });
  }
}

export const POST = audited("staff", handlePOST);

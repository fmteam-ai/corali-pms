import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { departmentIcons, departmentModes, isTime } from "@/lib/guest-portal-core";
import { cancelDeptOrder, completeDeptOrder, listDepartments, listDeptOrders, removeDepartment, removeItem, saveDepartment, saveItem } from "@/lib/guest-portal";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { can } from "@/lib/security/permissions";

const text = (max: number) => z.string().trim().max(max).default("");
const time = z.string().refine(isTime);
const department = z.object({ id: z.number().int().positive().optional(), nameEl: z.string().trim().min(1).max(80), nameEn: text(80), descriptionEl: text(400), descriptionEn: text(400), icon: z.enum(departmentIcons), mode: z.enum(departmentModes), openFrom: time, openTo: time, capacity: z.number().int().min(1).max(50), active: z.boolean(), sortOrder: z.number().int().min(0).max(999).default(0) });
const item = z.object({ id: z.number().int().positive().optional(), departmentId: z.number().int().positive(), nameEl: z.string().trim().min(1).max(120), nameEn: text(120), descriptionEl: text(400), descriptionEn: text(400), priceCents: z.number().int().min(0).max(10_000_000), durationMin: z.number().int().min(0).max(600), active: z.boolean(), sortOrder: z.number().int().min(0).max(999).default(0) });
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_department"), department }),
  z.object({ action: z.literal("remove_department"), id: z.number().int().positive() }),
  z.object({ action: z.literal("save_item"), item }),
  z.object({ action: z.literal("remove_item"), id: z.number().int().positive() }),
  z.object({ action: z.literal("order_done"), id: z.number().int().positive() }),
  z.object({ action: z.literal("order_cancel"), id: z.number().int().positive(), reason: z.string().trim().max(300).default("") }),
]);
const errors: Record<string, number> = { NOT_FOUND: 404, ALREADY_HANDLED: 409 };

async function state(ownerId: string) {
  const [departments, orders] = await Promise.all([listDepartments(ownerId), listDeptOrders(ownerId)]);
  return { ok: true, departments, orders };
}

/** PMS → Departments & services: departments with their items and the guests' orders / appointments. */
export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  return Response.json(await state(u.ownerId), { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    // Catalogue and prices: pricing editors; handling orders (a cancellation reverses a charge): folio editors.
    const need = x.action.startsWith("order_") ? "folios.write" : "pricing.write";
    if (!can(u.role, need, u.permissions)) return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    if (x.action === "save_department") await saveDepartment(u.ownerId, x.department);
    else if (x.action === "remove_department") await removeDepartment(u.ownerId, x.id);
    else if (x.action === "save_item") await saveItem(u.ownerId, x.item);
    else if (x.action === "remove_item") await removeItem(u.ownerId, x.id);
    else if (x.action === "order_done") await completeDeptOrder(u.ownerId, x.id, u.id);
    else await cancelDeptOrder(u.ownerId, x.id, { staffId: u.id, reason: x.reason });
    return Response.json(await state(u.ownerId));
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (!errors[m]) console.error("Departments save failed", e);
    return Response.json({ ok: false, error: errors[m] ? m : "SAVE_FAILED" }, { status: errors[m] ?? 500 });
  }
}

export const POST = audited("departments", handlePOST);

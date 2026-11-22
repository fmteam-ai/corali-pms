import { z } from "zod";
import { posBad, posItems, posJson, requirePosKey, syncPosItems } from "@/lib/department-sales";

/** GET /api/v1/pos/items — the department's products / services in the PMS (what guests see in the app). */
export async function GET(request: Request) {
  const k = await requirePosKey(request);
  if (k instanceof Response) return k;
  return posJson(await posItems(k));
}

const items = z.array(z.object({ sku: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(120), name_en: z.string().trim().max(120).optional(), price: z.number().min(0).max(10_000), active: z.boolean().optional() })).min(1).max(500);

/**
 * PUT /api/v1/pos/items — the POS sends its products: { items: [{ sku, name, name_en?, price, active? }] }. Matched by
 * sku; new ones are added to the department (and shown in the guest app while active).
 */
export async function PUT(request: Request) {
  const k = await requirePosKey(request);
  if (k instanceof Response) return k;
  const x = z.object({ items }).safeParse(await request.json().catch(() => null));
  if (!x.success) return posBad("Body: { items: [{ sku, name, name_en?, price (EUR), active? }] } (1–500 items)");
  return posJson(await syncPosItems(k, x.data.items));
}

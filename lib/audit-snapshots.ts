import { db } from "@/lib/db";

// Before-images for audited changes. Each returns the current row (or null) for the record a request is about to change.

async function row(sql: string, values: unknown[]) {
  const result = await db().query(sql, values);
  return result.rows[0] ?? null;
}
const idOf = (body: Record<string, unknown>, key = "id") => (typeof body[key] === "number" ? body[key] : null);

export async function pricingSnapshot(ownerId: string, body: Record<string, unknown>) {
  switch (body.kind) {
    case "base_rate": return row(`SELECT id,code,base_rate_cents FROM rooms WHERE owner_id=$1 AND id=$2`, [ownerId, idOf(body, "roomId")]);
    case "plan": return row(`SELECT * FROM rate_plans WHERE owner_id=$1 AND plan_key=$2`, [ownerId, String(body.key ?? "")]);
    case "cancellation": return idOf(body) ? row(`SELECT * FROM cancellation_policies WHERE owner_id=$1 AND id=$2`, [ownerId, idOf(body)]) : null;
    case "charge": return idOf(body) ? row(`SELECT * FROM mandatory_charges WHERE owner_id=$1 AND id=$2`, [ownerId, idOf(body)]) : null;
    default: return null;
  }
}

export async function rulesSnapshot(ownerId: string, body: Record<string, unknown>) {
  if (!idOf(body)) return null;
  const table = body.kind === "restriction" ? "booking_restrictions" : "special_prices";
  return row(`SELECT * FROM ${table} WHERE owner_id=$1 AND id=$2`, [ownerId, idOf(body)]);
}

export async function catalogSnapshot(ownerId: string, body: Record<string, unknown>) {
  if (body.kind === "room") return row(`SELECT id,code,category_id,description,capacity,base_rate_cents,active FROM rooms WHERE owner_id=$1 AND id=$2`, [ownerId, idOf(body, "roomId")]);
  const table = ({ category: "room_categories", amenity: "room_amenities", extra: "extras" } as Record<string, string>)[String(body.kind)];
  return table && idOf(body) ? row(`SELECT * FROM ${table} WHERE owner_id=$1 AND id=$2`, [ownerId, idOf(body)]) : null;
}

export async function userSnapshot(ownerId: string, body: Record<string, unknown>) {
  return idOf(body) ? row(`SELECT id,username,display_name,email,role,active,permissions_json FROM pms_staff_users WHERE owner_id=$1 AND id=$2`, [ownerId, idOf(body)]) : null;
}

export async function reservationSnapshot(ownerId: string, _body: Record<string, unknown>, params: Record<string, string>) {
  const id = Number(params.id);
  return Number.isSafeInteger(id) ? row(`SELECT * FROM bookings WHERE owner_id=$1 AND id=$2`, [ownerId, id]) : null;
}

export async function paymentPolicySnapshot(ownerId: string) {
  return row(`SELECT * FROM payment_policies WHERE owner_id=$1`, [ownerId]);
}

export async function automationSnapshot(ownerId: string) {
  return row(`SELECT * FROM message_automation_settings WHERE owner_id=$1`, [ownerId]);
}

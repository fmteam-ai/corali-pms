import type { PoolClient } from "pg";
import { normalizeArrivalSettings } from "@/lib/arrival";

type Queryable = Pick<PoolClient, "query">;

export async function loadArrivalSettings(client: Queryable, ownerId: string) {
  const r = await client.query(`SELECT settings_json FROM arrival_settings WHERE owner_id=$1`, [ownerId]);
  return normalizeArrivalSettings(r.rows[0]?.settings_json ?? null);
}

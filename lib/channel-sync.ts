import { db } from "@/lib/db";
import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

/**
 * Queue an availability push for [from, to) (inclusive of the last night). Called in the same transaction as any change
 * that affects sellable rooms, so a direct booking closes the inventory on the OTAs at the next sync run.
 */
export async function enqueueAvailability(client: Queryable, ownerId: string, from: string, to: string, reason: string) {
  if (!from || !to || to < from) return;
  const now = Date.now();
  await client.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,next_attempt_at,created_at,updated_at) VALUES($1,$2,$3,$4,'pending',0,$5,$5)`, [ownerId, from, to, reason.slice(0, 60), now]);
}

export async function channelStatus(ownerId: string) {
  const [types, mappings, outbox, imports] = await Promise.all([
    db().query(`SELECT room_type,count(*)::int AS rooms FROM rooms WHERE owner_id=$1 AND active=1 GROUP BY room_type ORDER BY room_type`, [ownerId]),
    db().query(`SELECT room_type,external_room_type_id FROM channel_room_mappings WHERE owner_id=$1`, [ownerId]),
    db().query(`SELECT status,count(*)::int AS total,max(updated_at) AS last,max(last_error) FILTER (WHERE status='failed') AS error FROM channel_sync_outbox WHERE owner_id=$1 GROUP BY status`, [ownerId]),
    db().query(`SELECT revision_id,status,booking_ids,error,created_at FROM channel_import_log WHERE owner_id=$1 ORDER BY id DESC LIMIT 20`, [ownerId]),
  ]);
  return { roomTypes: types.rows, mappings: mappings.rows, outbox: outbox.rows, imports: imports.rows };
}


import type { PoolClient } from "pg";

export type NotificationKind = "direct_booking" | "manual_booking" | "ota_change" | "housekeeping" | "payment" | "system";

type Queryable = Pick<PoolClient, "query">;

/** Record a staff notification. Call inside the transaction that caused it so it is only visible on commit. */
export async function pushNotification(client: Queryable, ownerId: string, input: { kind: NotificationKind; titleEl: string; titleEn: string; link?: string }) {
  await client.query(
    `INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,$2,$3,$4,$5,$6)`,
    [ownerId, input.kind, input.titleEl.slice(0, 300), input.titleEn.slice(0, 300), input.link ?? "/pms", Date.now()],
  );
}

import type { PoolClient } from "pg";
import { deskAlertKinds, type AlertKind } from "@/lib/staff-core";
import { deferStaffPush } from "@/lib/staff-push";

export type NotificationKind = "direct_booking" | "manual_booking" | "ota_change" | "housekeeping" | "payment" | "guest_message" | "tv_request" | "hk_message" | "system";

type Queryable = Pick<PoolClient, "query">;

/**
 * Record a staff notification. Call inside the transaction that caused it so it is only visible on commit. The front
 * desk also gets it on the Corali Staff app (once committed), if they chose that kind of alert.
 */
export async function pushNotification(client: Queryable, ownerId: string, input: { kind: NotificationKind; titleEl: string; titleEn: string; link?: string }) {
  const r = await client.query(
    `INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [ownerId, input.kind, input.titleEl.slice(0, 300), input.titleEn.slice(0, 300), input.link ?? "/pms", Date.now()],
  );
  if ((deskAlertKinds as readonly string[]).includes(input.kind)) {
    deferStaffPush(ownerId, { desk: true }, { kind: input.kind as AlertKind, title: { el: "Hotel Corali", en: "Hotel Corali" }, body: { el: input.titleEl, en: input.titleEn }, url: input.kind === "hk_message" || input.kind === "tv_request" ? "/staff" : input.link ?? "/pms" }, { committed: { table: "pms_notifications", id: Number(r.rows[0]?.id) } });
  }
}

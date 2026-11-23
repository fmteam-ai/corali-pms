import { db } from "@/lib/db";
import { deepHealth, heartbeatPayload, signHeartbeat } from "../../../../scripts/health-core.mjs";

export const dynamic = "force-dynamic";

/**
 * v201 external watchdog heartbeat: only statuses and progress counters (no guest, room, error or host data),
 * HMAC-signed with MONITORING_SECRET (header X-Corali-Signature: t=<ms>,v1=<hex> over «t.body»). Without the secret
 * configured it answers 503 — an unsigned heartbeat is never served.
 */
export async function GET(): Promise<Response> {
  const secret = process.env.MONITORING_SECRET ?? "";
  if (secret.length < 32) return Response.json({ ok: false, error: "MONITORING_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const service = process.env.APP_ROLE === "booking" ? "corali-booking" : "corali-pms";
  const deep = await deepHealth({ pool: db(), owner: process.env.PMS_OWNER_ID ?? "hotel-corali" });
  const body = JSON.stringify(heartbeatPayload(deep, { service, version: "v201" }));
  const at = Date.now();
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Corali-Signature": `t=${at},v1=${signHeartbeat(secret, at, body)}` } });
}

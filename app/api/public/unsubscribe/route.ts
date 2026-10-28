import { unsubscribeRecipient } from "@/lib/campaigns";
import { allowAttempt, clientIp } from "@/lib/request-limit";

/**
 * Unsubscribe from the hotel's bulk messages: the button on /unsubscribe and mail apps' one-click unsubscribe
 * (RFC 8058, List-Unsubscribe-Post), both with the signed recipient token.
 */
export async function POST(request: Request) {
  const q = new URL(request.url).searchParams;
  let r = q.get("r") ?? "", t = q.get("t") ?? "";
  if (!r) { const body = await request.json().catch(() => ({})) as { r?: unknown; t?: unknown }; r = String(body.r ?? ""); t = String(body.t ?? ""); }
  if (!(await allowAttempt(`unsubscribe:${clientIp(request)}`, 30, 15 * 60_000, 15 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY" }, { status: 429 });
  const id = Number(r);
  const ok = Number.isSafeInteger(id) && id > 0 && (await unsubscribeRecipient(id, t));
  return Response.json({ ok }, { status: ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}

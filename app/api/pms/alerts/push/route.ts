import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { documentKey, env } from "@/lib/env";
import { sendStaffPush } from "@/lib/staff-push";

const input = z.object({ title: z.string().min(1).max(200), body: z.string().max(200), url: z.string().startsWith("/").max(200), tag: z.string().max(60) });

/**
 * v189: the cron's alert deliveries to the front desk's phones (Web Push lives in the PMS). Signed with the document
 * key and a timestamp (5 minutes), so nobody else can make the phones ring. Returns how many phones were reached.
 */
export async function POST(request: Request) {
  const ts = request.headers.get("x-corali-ts") ?? "", sig = request.headers.get("x-corali-sig") ?? "";
  const body = await request.text();
  const want = createHash("sha256").update(`corali-alert-push:${documentKey()}:${ts}:${body}`).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, "hex"); } catch { given = Buffer.alloc(0); }
  if (!/^\d{13}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > 5 * 60_000 || given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = input.safeParse((() => { try { return JSON.parse(body); } catch { return null; } })());
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const x = parsed.data;
  const sent = await sendStaffPush(env().PMS_OWNER_ID, { desk: true }, { kind: "reliability", title: { el: x.title, en: x.title }, body: { el: x.body, en: x.body }, url: x.url, tag: x.tag });
  return Response.json({ ok: true, sent });
}

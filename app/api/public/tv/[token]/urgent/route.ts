import { agentCheck } from "@/lib/tv-commands";
import { pendingUrgent, screenRoom } from "@/lib/tv-messages";
import { agentBaselineSeen, agentPrivacyClaim } from "@/lib/tv-privacy";

const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * Light check for the Corali TV app (every 20 seconds in the background): an unseen urgent message and, for apps ≥ 1.8
 * (they send ?s=<screen on 1/0>&v=<versionCode>&a=<screen-off permission 1/0>; ≥ 1.9 also vol=<0-100>&mute=<1/0>&fixed=<1/0>
 * &clamped=1 and caps=<JSON of the capabilities read on the TV>; ≥ 1.10 prev=<applied policy rev>), the next command (once)
 * and the room's sound policy. ≥ 1.13 (v162): bl=<time its guest-free baseline was saved> and, after a check-out in a
 * room whose TV clears itself, `privacy` = the clearing to run now (once per lease).
 * `screen: null` keeps a 1.7 app from acting on the v157 fields.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const pending = await pendingUrgent(token);
    if (pending === undefined) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: noStore });
    const q = new URL(request.url).searchParams;
    const flag = (k: string) => (q.get(k) === "1" ? true : q.get(k) === "0" ? false : null);
    const v = Number(q.get("v"));
    const room = await screenRoom(token);
    const vol = Number(q.get("vol"));
    let caps: Record<string, unknown> | null = null;
    try { const c = q.get("caps"); if (c && c.length < 2000) caps = JSON.parse(c); } catch { caps = null; }
    const answer = room ? await agentCheck(room.ownerId, room.roomId, {
      interactive: flag("s"), version: Number.isInteger(v) && v > 0 && v < 100000 ? v : null, admin: flag("a"),
      volume: q.has("vol") && Number.isInteger(vol) && vol >= 0 && vol <= 100 ? vol : null, muted: flag("mute"), fixed: flag("fixed"), caps, clamped: q.get("clamped") === "1",
      // ≥ 1.10: the policy revision the TV applied (confirms resets and policy changes).
      policyRev: /^\d{1,15}$/.test(q.get("prev") ?? "") ? Number(q.get("prev")) : null,
    }) : { command: null, policy: null };
    const version = Number.isInteger(v) && v > 0 && v < 100000 ? v : null;
    let privacy = null;
    if (room) {
      const bl = Number(q.get("bl"));
      if (/^\d{12,14}$/.test(q.get("bl") ?? "") && bl <= Date.now() + 86_400_000) await agentBaselineSeen(room.ownerId, room.roomId, bl);
      privacy = await agentPrivacyClaim(room.ownerId, room.roomId, version);
    }
    return Response.json({ ok: true, urgent: pending?.id ?? null, wake: pending?.wake ?? false, screen: null, command: answer.command, policy: answer.policy, privacy }, { headers: noStore });
  } catch (e) {
    console.error("TV urgent check failed", e);
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503, headers: noStore });
  }
}

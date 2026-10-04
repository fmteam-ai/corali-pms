import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { draftGuestReply } from "@/lib/guest-message-ai";
import { anthropicApiKey } from "@/lib/provider-connections";
import { allowAttempt } from "@/lib/request-limit";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({ bookingId: z.number().int().positive() });

/** AI draft of a reply to the guest's latest message; staff review and send it themselves. */
export async function POST(request: Request) {
  const u = await requireApiUser("reservations.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const x = input.parse(await request.json());
    if (!(await anthropicApiKey(u.ownerId))) return Response.json({ ok: false, error: "AI_NOT_CONFIGURED" }, { status: 409 });
    if (!(await allowAttempt(`reply-draft:${u.ownerId}:${u.id}`, 30, 10 * 60_000, 10 * 60_000))) return Response.json({ ok: false, error: "TOO_MANY_REQUESTS" }, { status: 429 });
    const draft = await draftGuestReply(u.ownerId, x.bookingId);
    // An unavailable AI is an answer for the page, not a server error (proxies hide 5xx bodies).
    return draft ? Response.json({ ok: true, reply: draft.reply, topic: draft.topic, safe: draft.safe_to_auto_send }) : Response.json({ ok: false, error: "AI_UNAVAILABLE" }, { status: 409 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof z.ZodError ? "INVALID_INPUT" : "DRAFT_FAILED" }, { status: e instanceof z.ZodError ? 400 : 409 });
  }
}

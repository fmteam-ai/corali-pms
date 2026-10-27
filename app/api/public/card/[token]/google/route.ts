import { cardForToken } from "@/lib/access-cards";
import { env } from "@/lib/env";
import { allowAttempt } from "@/lib/request-limit";
import { googleReady, googleSaveUrl } from "@/lib/wallet-passes";

/** Sends the guest to "Save to Google Wallet" with the signed card. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await cardForToken(token);
  if (!found || !found.enabled || !["active", "scheduled"].includes(found.state)) return new Response("Not found", { status: 404 });
  if (!googleReady(found.wallet, found.secrets)) return new Response("Google Wallet is not set up", { status: 503 });
  if (!(await allowAttempt(`card-google:${token}`, 20, 60 * 60_000, 60 * 60_000))) return new Response("Too many requests", { status: 429 });
  try {
    return Response.redirect(await googleSaveUrl(found.wallet, found.secrets, found.card, String(env().BOOKING_ORIGIN), found.photo), 302);
  } catch (e) {
    console.error("Google Wallet link failed", e);
    return new Response("Pass unavailable", { status: 503 });
  }
}

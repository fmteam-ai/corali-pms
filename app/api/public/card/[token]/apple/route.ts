import { cardForToken } from "@/lib/access-cards";
import { allowAttempt } from "@/lib/request-limit";
import { applePass, appleReady } from "@/lib/wallet-passes";

/** The card as an Apple Wallet pass (.pkpass), signed with the hotel's Pass Type ID certificate. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await cardForToken(token);
  if (!found || !found.enabled || !["active", "scheduled"].includes(found.state)) return new Response("Not found", { status: 404 });
  if (!appleReady(found.wallet, found.secrets)) return new Response("Apple Wallet is not set up", { status: 503 });
  if (!(await allowAttempt(`card-apple:${token}`, 20, 60 * 60_000, 60 * 60_000))) return new Response("Too many requests", { status: 429 });
  try {
    const pkpass = await applePass(found.wallet, found.secrets, found.card);
    return new Response(new Uint8Array(pkpass), { headers: { "Content-Type": "application/vnd.apple.pkpass", "Content-Disposition": `attachment; filename="hotel-corali-key.pkpass"`, "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("Apple Wallet pass failed", e);
    return new Response("Pass unavailable", { status: 503 });
  }
}

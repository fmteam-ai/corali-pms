import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { bridgeStatus, newBridgeToken } from "@/lib/omada-bridge";
import { bridgeUserData } from "@/lib/omada-bridge-setup";
import { assertTrustedOrigin } from "@/lib/security/origin";

/** v179: the hotel's Omada bridge — its state (GET) and a new set-up file for the Raspberry Pi (POST, new key). */
export async function GET() {
  const u = await requireApiUser("integrations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await bridgeStatus(u.ownerId)) }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const u = await requireApiUser("integrations.write");
  if (u instanceof Response) return u;
  assertTrustedOrigin(request);
  z.object({ action: z.literal("setup") }).parse(await request.json());
  const text = await bridgeUserData(env().PMS_ORIGIN, await newBridgeToken(u.ownerId));
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="user-data"', "Cache-Control": "no-store" } });
}

export const POST = audited("omada_bridge", handlePOST);

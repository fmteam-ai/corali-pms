import { handleBridgeRequest } from "@/lib/tv-privacy";

// Service-to-service endpoint for the hotel's on-prem TV privacy gateway (bearer token, no session / cookies, so no
// CSRF surface; outside /api/pms on purpose). PMS role only (lib/app-role.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleBridgeRequest(request);
}

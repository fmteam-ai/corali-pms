import { NextRequest, NextResponse } from "next/server";
import { routeForRole, type ApplicationRole } from "@/lib/app-role";
import { edgeState, markEdgeSeen, recordSecurityEvent } from "@/lib/security-center";
import { CLIENT_IP_HEADER, EDGE_HEADER, SMOKE_HEADER, edgeDecision, edgeExempt, edgeKeyMatches, pickClientIp, smokeBypass } from "./scripts/security-core.mjs";

function configuredRole(): ApplicationRole {
  return process.env.APP_ROLE === "booking" ? "booking" : "pms";
}

// The paths the PMS / booking split applies to (before v180 these were the whole matcher).
const ROLE_PREFIXES = ["/pms", "/book", "/check-in", "/manage-booking", "/pay-balance", "/review", "/tv", "/partner", "/unsubscribe", "/api/auth", "/api/pms", "/api/v1", "/api/gateway", "/api/public", "/api/webhooks"];
const roleRouted = (path: string) => ["/", "/login", "/hk", "/staff"].includes(path) || ROLE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const ip = pickClientIp((name) => request.headers.get(name));

  // v180: Cloudflare origin lock (PMS → Security center).
  // v184: the installer's checks of a staged release (one-time token, only in that process) are not locked out.
  if (!edgeExempt(path) && !smokeBypass(process.env.CORALI_SMOKE_TOKEN, request.headers.get(SMOKE_HEADER))) {
    const edge = await edgeState();
    const keyOk = edgeKeyMatches(request.headers.get(EDGE_HEADER), edge.hash);
    if (keyOk) void markEdgeSeen();
    if (edgeDecision({ enforce: edge.enforce, keyOk, lastSeenAt: edge.lastSeenAt, now: Date.now() }) === "block") {
      void recordSecurityEvent("origin_blocked", ip, path.slice(0, 60));
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  // The routes read the trusted address from here; whatever the visitor sent under this name is replaced, and the
  // origin key is not passed on.
  const headers = new Headers(request.headers);
  headers.set(CLIENT_IP_HEADER, ip);
  headers.delete(EDGE_HEADER);
  headers.delete(SMOKE_HEADER);
  const next = () => NextResponse.next({ request: { headers } });

  if (!roleRouted(path)) return next();
  const role = configuredRole();
  const decision = routeForRole(role, path);

  if (decision.action === "allow") return next();
  if (decision.action === "not-found") {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  if (role === "pms" && ["/book", "/check-in", "/manage-booking", "/pay-balance", "/review", "/tv", "/partner", "/unsubscribe"].some((p) => decision.destination === p || decision.destination.startsWith(`${p}/`))) {
    return NextResponse.redirect(new URL(decision.destination + request.nextUrl.search, process.env.BOOKING_ORIGIN));
  }
  return NextResponse.redirect(new URL(decision.destination, request.url));
}

export const config = {
  // v180: every request except the build's static files (the origin lock and the trusted address apply everywhere).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

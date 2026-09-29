import { NextRequest, NextResponse } from "next/server";
import { routeForRole, type ApplicationRole } from "@/lib/app-role";

function configuredRole(): ApplicationRole {
  return process.env.APP_ROLE === "booking" ? "booking" : "pms";
}

export function proxy(request: NextRequest) {
  const role = configuredRole();
  const decision = routeForRole(role, request.nextUrl.pathname);

  if (decision.action === "allow") return NextResponse.next();
  if (decision.action === "not-found") {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  if (role === "pms" && ["/book", "/check-in", "/manage-booking", "/pay-balance"].some((path) => decision.destination === path || decision.destination.startsWith(`${path}/`))) {
    return NextResponse.redirect(new URL(decision.destination + request.nextUrl.search, process.env.BOOKING_ORIGIN));
  }
  return NextResponse.redirect(new URL(decision.destination, request.url));
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/pms/:path*",
    "/book/:path*",
    "/check-in/:path*",
    "/manage-booking/:path*",
    "/pay-balance/:path*",
    "/api/auth/:path*",
    "/api/pms/:path*",
    "/api/public/:path*",
    "/api/webhooks/:path*",
  ],
};

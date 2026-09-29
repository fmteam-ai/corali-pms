export type ApplicationRole = "pms" | "booking";

export type RoleRouteDecision =
  | { action: "allow" }
  | { action: "redirect"; destination: string }
  | { action: "not-found" };

const pmsPage = (pathname: string) => pathname === "/login" || pathname === "/pms" || pathname.startsWith("/pms/");
const pmsApi = (pathname: string) => pathname === "/api/auth" || pathname.startsWith("/api/auth/") || pathname === "/api/pms" || pathname.startsWith("/api/pms/");
const bookingPage = (pathname: string) => ["/book", "/check-in", "/manage-booking", "/pay-balance", "/review"].some((path) => pathname === path || pathname.startsWith(`${path}/`));
const bookingApi = (pathname: string) => pathname === "/api/public" || pathname.startsWith("/api/public/") || pathname === "/api/webhooks" || pathname.startsWith("/api/webhooks/");

export function routeForRole(role: ApplicationRole, pathname: string): RoleRouteDecision {
  if (pathname === "/") {
    return { action: "redirect", destination: role === "booking" ? "/book" : "/login" };
  }

  if (role === "booking") {
    if (pmsApi(pathname)) return { action: "not-found" };
    if (pmsPage(pathname)) return { action: "redirect", destination: "/book" };
    return { action: "allow" };
  }

  if (bookingApi(pathname)) return { action: "not-found" };
  if (bookingPage(pathname)) return { action: "redirect", destination: pathname };
  return { action: "allow" };
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  experimental: {
    // Room photos are uploaded one at a time (≈0.5 MB each); keep headroom for large phone photos.
    proxyClientMaxBodySize: "15mb",
    serverActions: {
      bodySizeLimit: "1mb",
      allowedOrigins: ["pms.hotelcorali.gr", "booking.hotelcorali.gr"],
    },
  },
  // Uptime monitors can use /healthz (same checks as /api/health).
  async rewrites() {
    return [{ source: "/healthz", destination: "/api/health" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // HTTPS only for a year (both sites always run on HTTPS; subdomains are not included, so the hotel's other
          // sites are not affected).
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          // No plugins, no <base> hijacking, no framing by other sites, and any http:// resource is fetched over https.
          { key: "Content-Security-Policy", value: `object-src 'none'; base-uri 'self'; frame-ancestors 'none'${process.env.NODE_ENV === "production" ? "; upgrade-insecure-requests" : ""}` },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
        ],
      },
      // The back office, the staff apps and every private API are never indexed by search engines.
      ...["/pms/:path*", "/login", "/staff", "/hk", "/partner/:path*", "/api/:path*", "/tv/:path*", "/check-in/:path*", "/manage-booking/:path*", "/card/:path*"].map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] })),
      // Corali Staff: voice commands need the microphone (this page only; the last matching header wins).
      { source: "/staff", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" }] },
      // Partner app: the camera scans the guest pass QR (this page only).
      { source: "/partner", headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" }] },
    ];
  },
};

export default nextConfig;

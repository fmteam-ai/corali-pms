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
        ],
      },
      // Corali Staff: voice commands need the microphone (this page only; the last matching header wins).
      { source: "/staff", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" }] },
    ];
  },
};

export default nextConfig;

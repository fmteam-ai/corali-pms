import { env } from "../env.ts";

export function assertTrustedOrigin(request: Request): void {
  const originHeader = request.headers.get("origin")?.trim();
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  const trustedFetchSites = new Set(["same-origin", "same-site"]);

  // Fetch Metadata headers cannot be set by ordinary cross-site browser
  // JavaScript. Reject an explicit cross-site/none signal even if Origin was
  // copied or omitted by an intermediary.
  if (fetchSite && !trustedFetchSites.has(fetchSite)) throw new Error("UNTRUSTED_ORIGIN");

  if (originHeader) {
    let canonicalOrigin: string;
    try {
      const parsed = new URL(originHeader);
      canonicalOrigin = parsed.origin;
      if (originHeader !== canonicalOrigin) throw new Error("NON_CANONICAL_ORIGIN");
    } catch {
      throw new Error("UNTRUSTED_ORIGIN");
    }
    const config = env();
    const allowed = new Set([new URL(config.PMS_ORIGIN).origin, new URL(config.BOOKING_ORIGIN).origin]);
    if (!allowed.has(canonicalOrigin)) throw new Error("UNTRUSTED_ORIGIN");
    return;
  }

  // Modern same-origin/same-site browser requests may omit Origin in a few
  // cases. They are accepted only with the independent Fetch Metadata signal;
  // requests with neither signal fail closed.
  if (!fetchSite || !trustedFetchSites.has(fetchSite)) throw new Error("UNTRUSTED_ORIGIN");
}

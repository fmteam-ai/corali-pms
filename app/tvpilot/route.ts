import { env } from "@/lib/env";

/**
 * Pilot build of the Corali TV app for the test TV only (room 112): booking.hotelcorali.gr/tvpilot in the Downloader
 * app. The other TVs keep using /tvapp (the released version) — nothing changes for them.
 */
export function GET() {
  return Response.redirect(`${env().BOOKING_ORIGIN}/downloads/corali-tv-pilot.apk`, 302);
}

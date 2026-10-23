import { env } from "@/lib/env";

/** Short address to type into the Downloader app on a TV: booking.hotelcorali.gr/tvapp → the Corali TV app. */
export function GET() {
  return Response.redirect(`${env().BOOKING_ORIGIN}/downloads/corali-tv.apk`, 302);
}

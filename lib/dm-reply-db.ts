// Draft a DM reply from live availability. Drafts wait in the PMS social inbox for reception to approve and send.
import { availabilityReply, parseStayRequest, type RoomOffer, type StayRequest } from "@/lib/dm-availability";
import { bookingLanguage } from "@/lib/booking-i18n";
import { env } from "@/lib/env";
import { publicAvailability } from "@/lib/public-rate";
import { detectLanguage, suggestedReply } from "@/lib/social-reply";
import { hotelToday } from "@/lib/tape-chart";

export async function draftDmReply(ownerId: string, text: string, platform: string): Promise<{ reply: string; request: StayRequest | null }> {
  const bookingUrl = `${env().BOOKING_ORIGIN}/book`;
  const request = parseStayRequest(text, hotelToday());
  if (!request) return { reply: suggestedReply(text, bookingUrl, platform), request: null };
  try {
    const lang = bookingLanguage(detectLanguage(text));
    const result = await publicAvailability({ ownerId, checkIn: request.checkIn, checkOut: request.checkOut, adults: request.adults, children: request.children, rooms: 1, lang, couponCode: null });
    const offers: RoomOffer[] = result.rooms.flatMap((room) => {
      const prices = room.plans.map((p) => p.totalCents).filter((c) => c > 0);
      return prices.length ? [{ name: room.name, fromCents: Math.min(...prices), available: room.availableCount }] : [];
    });
    return { reply: availabilityReply(text, request, offers, bookingUrl, platform), request };
  } catch {
    return { reply: suggestedReply(text, bookingUrl, platform), request };
  }
}

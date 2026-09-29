import { arrivalOptions } from "@/lib/arrival";
import { loadArrivalSettings } from "@/lib/arrival-db";
import { bookingLanguage } from "@/lib/booking-i18n";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  const lang = bookingLanguage(new URL(request.url).searchParams.get("lang"));
  const settings = await loadArrivalSettings(db(), env().PMS_OWNER_ID);
  return Response.json({ ok: true, ...arrivalOptions(settings, lang) }, { headers: { "Cache-Control": "public, max-age=300" } });
}

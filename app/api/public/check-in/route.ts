import { z } from "zod";
import { arrivalInstructions, arrivalModes, pick, transferQuote } from "@/lib/arrival";
import { loadArrivalSettings } from "@/lib/arrival-db";
import { withTransaction } from "@/lib/db";
import { env } from "@/lib/env";
import { ensureFolio, recalcBooking } from "@/lib/folio-db";
import { pushNotification } from "@/lib/pms-notifications";
import { encryptField } from "@/lib/security/encryption";
import { hashToken } from "@/lib/security/tokens";

const schema = z.object({
  token: z.string().min(32).max(200),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().email(),
  phone: z.string().trim().min(5).max(40),
  arrivalTime: z.string().max(20),
  documentType: z.enum(["passport", "identity_card"]),
  documentNumber: z.string().trim().min(4).max(80),
  dateOfBirth: z.iso.date(),
  preferredLanguage: z.enum(["el", "en", "fr", "de", "it", "es"]).default("en"),
  travelDetails: z.string().max(500).default(""),
  specialRequests: z.string().max(1000).default(""),
  luggageAssistance: z.boolean().default(false),
  emailMarketingConsent: z.boolean().default(false),
  whatsappMarketingConsent: z.boolean().default(false),
  arrivalMode: z.enum(arrivalModes).optional().or(z.literal("").transform(() => undefined)),
  arrivalHub: z.string().max(40).optional(),
  transferVehicle: z.string().max(40).optional(),
});

function ageOn(now: number, dob: Date) {
  const d = new Date(now);
  const beforeBirthday = d.getUTCMonth() < dob.getUTCMonth() || (d.getUTCMonth() === dob.getUTCMonth() && d.getUTCDate() < dob.getUTCDate());
  return d.getUTCFullYear() - dob.getUTCFullYear() - (beforeBirthday ? 1 : 0);
}

const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

export async function POST(request: Request) {
  try {
    const c = env();
    if (!c.PMS_DOCUMENT_KEY) return Response.json({ ok: false, error: "DOCUMENT_KEY_NOT_CONFIGURED" }, { status: 503 });
    const documentKey = c.PMS_DOCUMENT_KEY, i = schema.parse(await request.json()), now = Date.now(), dob = new Date(`${i.dateOfBirth}T00:00:00Z`);
    if (ageOn(now, dob) < 18) return Response.json({ ok: false, error: "ADULT_REQUIRED" }, { status: 400 });
    const result = await withTransaction(async (client) => {
      const token = await client.query(
        `SELECT t.*,b.reference,b.adults,b.children,b.total_cents,b.balance_cents,b.check_in,b.check_out,b.folio_initialized_at,b.created_at booking_created_at
           FROM checkin_access_tokens t JOIN bookings b ON b.id=t.booking_id AND b.owner_id=t.owner_id
          WHERE t.token_hash=$1 AND t.owner_id=$2 AND t.status='active' AND t.expires_at>$3 FOR UPDATE OF t, b`,
        [hashToken(i.token), c.PMS_OWNER_ID, now],
      );
      if (!token.rowCount) throw new Error("INVALID_TOKEN");
      const row = token.rows[0];
      const settings = await loadArrivalSettings(client, c.PMS_OWNER_ID);
      const instructions = i.arrivalMode && i.arrivalHub ? arrivalInstructions(settings, i.arrivalMode, i.arrivalHub, i.preferredLanguage) : null;
      if (i.arrivalMode && !instructions) throw new Error("INVALID_ARRIVAL");
      const passengers = Math.max(1, Number(row.adults ?? 1) + Number(row.children ?? 0));
      const quote = i.transferVehicle ? transferQuote(settings, { mode: i.arrivalMode ?? "", vehicle: i.transferVehicle, passengers }) : null;
      if (quote && !quote.ok) throw new Error(quote.error);

      const checkin = await client.query(
        `INSERT INTO guest_checkins(owner_id,booking_id,booking_reference,first_name,last_name,email,phone,arrival_time,document_type,document_number,date_of_birth_encrypted,birth_month,birth_day,adult_at_submission,preferred_language,travel_details,special_requests,luggage_assistance,email_marketing_consent,whatsapp_marketing_consent,marketing_consent_at,marketing_consent_version,status,submitted_at,arrival_mode,arrival_hub)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$15,$16,$17,$18,$19,$20,'v1','submitted',$20,$21,$22) RETURNING id`,
        [c.PMS_OWNER_ID, row.booking_id, row.reference, i.firstName, i.lastName, i.email, i.phone, i.arrivalTime, i.documentType, encryptField(i.documentNumber, documentKey), encryptField(i.dateOfBirth, documentKey), dob.getUTCMonth() + 1, dob.getUTCDate(), i.preferredLanguage, i.travelDetails, i.specialRequests, i.luggageAssistance ? 1 : 0, i.emailMarketingConsent ? 1 : 0, i.whatsappMarketingConsent ? 1 : 0, now, i.arrivalMode ?? null, instructions ? i.arrivalHub : null],
      );
      if (i.emailMarketingConsent || i.whatsappMarketingConsent) {
        await client.query(`UPDATE bookings SET email_marketing_opt_in=CASE WHEN $1 THEN 1 ELSE email_marketing_opt_in END,whatsapp_opt_in=CASE WHEN $2 THEN 1 ELSE whatsapp_opt_in END WHERE owner_id=$3 AND id=$4`, [i.emailMarketingConsent, i.whatsappMarketingConsent, c.PMS_OWNER_ID, row.booking_id]);
      }
      await client.query(`UPDATE checkin_access_tokens SET status='used',used_at=$1 WHERE id=$2`, [now, row.id]);

      let transfer: { vehicle: string; priceCents: number; folio: boolean } | null = null;
      if (quote?.ok && instructions) {
        // Staff-facing records use the Greek names; the guest sees their own language.
        const vehicleName = pick(quote.vehicle.name, "el") || quote.vehicle.key;
        const hubNameEl = arrivalInstructions(settings, i.arrivalMode!, i.arrivalHub!, "el")?.hubName ?? instructions.hubName;
        let folioEntryId: number | null = null;
        if (settings.transfer.autoFolio) {
          // Fixed-price transfer goes straight onto the guest folio.
          await ensureFolio(client, c.PMS_OWNER_ID, { id: Number(row.booking_id), total_cents: Number(row.total_cents), balance_cents: Number(row.balance_cents), check_in: row.check_in, check_out: row.check_out, folio_initialized_at: row.folio_initialized_at, created_at: Number(row.booking_created_at) });
          const entry = await client.query(
            `INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'charge','extra',$3,$4,'guest','guest',$5) RETURNING id`,
            [c.PMS_OWNER_ID, row.booking_id, `Transfer · ${vehicleName} · ${hubNameEl}`.slice(0, 200), quote.vehicle.priceCents, now],
          );
          folioEntryId = Number(entry.rows[0].id);
          await recalcBooking(client, c.PMS_OWNER_ID, Number(row.booking_id));
        }
        await client.query(
          `INSERT INTO transfer_requests(owner_id,booking_id,guest_checkin_id,arrival_mode,arrival_hub,vehicle_key,vehicle_name,passengers,price_cents,arrival_time,travel_details,folio_entry_id,status,created_at,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'requested',$13,$13)`,
          [c.PMS_OWNER_ID, row.booking_id, checkin.rows[0].id, i.arrivalMode, i.arrivalHub, quote.vehicle.key, vehicleName, passengers, quote.vehicle.priceCents, i.arrivalTime, i.travelDetails, folioEntryId, now],
        );
        transfer = { vehicle: pick(quote.vehicle.name, i.preferredLanguage) || quote.vehicle.key, priceCents: quote.vehicle.priceCents, folio: folioEntryId !== null };
        await pushNotification(client, c.PMS_OWNER_ID, { kind: "system", titleEl: `Αίτημα transfer: ${row.reference} · ${vehicleName} · ${hubNameEl} · ${i.arrivalTime} · ${euro(quote.vehicle.priceCents)}`, titleEn: `Transfer request: ${row.reference} · ${vehicleName} · ${instructions.hubName} · ${i.arrivalTime} · ${euro(quote.vehicle.priceCents)}`, link: `/pms/reservations/${row.booking_id}` });
      }
      await pushNotification(client, c.PMS_OWNER_ID, { kind: "system", titleEl: `Online pre-check-in: ${i.firstName} ${i.lastName} · ${row.reference} · άφιξη ${i.arrivalTime}`, titleEn: `Online pre-check-in: ${i.firstName} ${i.lastName} · ${row.reference} · arrival ${i.arrivalTime}`, link: `/pms/reservations/${row.booking_id}` });
      return { instructions, transfer };
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT", issues: e.issues }, { status: 400 });
    const m = e instanceof Error ? e.message : "";
    if (m === "INVALID_TOKEN") return Response.json({ ok: false, error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 401 });
    if (["INVALID_ARRIVAL", "TRANSFER_DISABLED", "TRANSFER_NOT_FOR_MODE", "VEHICLE_UNAVAILABLE", "VEHICLE_TOO_SMALL"].includes(m)) return Response.json({ ok: false, error: m }, { status: 400 });
    return Response.json({ ok: false, error: "CHECKIN_FAILED" }, { status: 500 });
  }
}

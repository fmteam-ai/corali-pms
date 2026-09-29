import { audited } from "@/lib/audit";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { listReservations } from "@/lib/reservations";

const createSchema = z.object({
  guestName: z.string().trim().min(2).max(160), guestEmail: z.string().email().nullable().optional(),
  guestPhone: z.string().trim().max(40).default(""), guestCountry: z.string().trim().max(80).default(""),
  guestLanguage: z.string().trim().min(2).max(5).default("en"), roomId: z.number().int().positive().nullable(),
  checkIn: z.iso.date(), checkOut: z.iso.date(), channel: z.string().trim().max(40).default("direct"),
  adults: z.number().int().min(1).max(20).default(1), children: z.number().int().min(0).max(20).default(0),
  totalCents: z.number().int().min(0), balanceCents: z.number().int().min(0),
  specialRequests: z.string().trim().max(2000).default(""), whatsappOptIn:z.boolean().default(false),emailMarketingOptIn:z.boolean().default(false),
}).refine((value) => value.checkOut > value.checkIn, { message: "Check-out must be after check-in" });

export async function GET(request: Request) {
  const user = await requireApiUser("reservations.read"); if (user instanceof Response) return user;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ ok: true, reservations: await listReservations(user.ownerId, q) });
}

async function handlePOST(request: Request) {
  const user = await requireApiUser("reservations.create"); if (user instanceof Response) return user;
  try {
    assertTrustedOrigin(request); const input = createSchema.parse(await request.json()); const now = Date.now();
    const booking = await withTransaction(async (client) => {
      if (input.roomId) {
        // Use the same transaction lock as public checkout before checking availability.
        await client.query("SELECT pg_advisory_xact_lock($1)", [input.roomId]);
        const room = await client.query("SELECT 1 FROM rooms WHERE owner_id=$1 AND id=$2 AND active=1", [user.ownerId,input.roomId]);
        if (!room.rowCount) throw new Error("INVALID_ROOM");
        const conflict = await client.query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 AND status NOT IN ('cancelled','checked_out','no_show') AND check_in < $4 AND check_out > $3
          UNION ALL SELECT 1 FROM booking_sessions WHERE owner_id=$1 AND status='payment_pending' AND recovery_due_at>$5 AND check_in<$4 AND check_out>$3 AND room_allocations::jsonb @> $6::jsonb LIMIT 1`, [user.ownerId,input.roomId,input.checkIn,input.checkOut,now,JSON.stringify([input.roomId])]);
        if (conflict.rowCount) throw new Error("ROOM_UNAVAILABLE");
      }
      const reference = `CR-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
      const inserted = await client.query(`INSERT INTO bookings (owner_id,reference,guest_name,guest_email,guest_phone,guest_country,guest_language,room_id,check_in,check_out,channel,status,total_cents,balance_cents,adults,children,special_requests,created_at,whatsapp_opt_in,email_marketing_opt_in)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [user.ownerId,reference,input.guestName,input.guestEmail??null,input.guestPhone,input.guestCountry,input.guestLanguage,input.roomId,input.checkIn,input.checkOut,input.channel,input.totalCents,input.balanceCents,input.adults,input.children,input.specialRequests,now,input.whatsappOptIn?1:0,input.emailMarketingOptIn?1:0]);
      await client.query(`INSERT INTO reservation_audit (owner_id,booking_id,actor_id,action,before_json,after_json,created_at) VALUES ($1,$2,$3,'created','{}',$4,$5)`, [user.ownerId,inserted.rows[0].id,String(user.id),JSON.stringify(inserted.rows[0]),now]);
      return inserted.rows[0];
    });
    return Response.json({ ok:true, booking }, { status:201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ok:false,error:"INVALID_INPUT",issues:error.issues},{status:400});
    if (error instanceof Error && error.message === "ROOM_UNAVAILABLE") return Response.json({ok:false,error:"ROOM_UNAVAILABLE"},{status:409});
    if (error instanceof Error && error.message === "INVALID_ROOM") return Response.json({ok:false,error:"INVALID_ROOM"},{status:400});
    return Response.json({ok:false,error:"CREATE_FAILED"},{status:500});
  }
}

export const POST = audited("reservation", handlePOST);

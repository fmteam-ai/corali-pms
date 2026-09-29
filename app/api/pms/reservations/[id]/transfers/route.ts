import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { recalcBooking } from "@/lib/folio-db";
import { assertTrustedOrigin } from "@/lib/security/origin";

const input = z.object({ transferId: z.number().int().positive(), action: z.enum(["confirm", "cancel"]) });

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("reservations.edit");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const bookingId = Number((await params).id), x = input.parse(await request.json());
    const transfer = await withTransaction(async (c) => {
      await c.query(`SELECT id FROM bookings WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [u.ownerId, bookingId]);
      const r = (await c.query(`SELECT * FROM transfer_requests WHERE owner_id=$1 AND booking_id=$2 AND id=$3 FOR UPDATE`, [u.ownerId, bookingId, x.transferId])).rows[0];
      if (!r) throw Error("NOT_FOUND");
      if (r.status === "cancelled" || (x.action === "confirm" && r.status === "confirmed")) throw Error("INVALID_TRANSITION");
      if (x.action === "cancel" && r.folio_entry_id) {
        // Reverse the automatic folio charge; the original line stays for the audit trail.
        await c.query(
          `INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'discount','extra',$3,$4,'guest',$5,$6)`,
          [u.ownerId, bookingId, `Ακύρωση transfer / Transfer cancelled · ${r.vehicle_name}`.slice(0, 200), -Number(r.price_cents), String(u.id), Date.now()],
        );
        await recalcBooking(c, u.ownerId, bookingId);
      }
      return (await c.query(`UPDATE transfer_requests SET status=$1,updated_at=$2 WHERE id=$3 RETURNING *`, [x.action === "confirm" ? "confirmed" : "cancelled", Date.now(), r.id])).rows[0];
    });
    return Response.json({ ok: true, transfer });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    return Response.json({ ok: false, error: m === "NOT_FOUND" || m === "INVALID_TRANSITION" ? m : "UPDATE_FAILED" }, { status: m === "NOT_FOUND" ? 404 : m === "INVALID_TRANSITION" ? 409 : 500 });
  }
}

export const PATCH = audited("transfer_request", handlePATCH);

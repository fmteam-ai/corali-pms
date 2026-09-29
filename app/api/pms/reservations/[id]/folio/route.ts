import { audited } from "@/lib/audit";
import { z } from "zod";
import { forbidden, requireApiUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { refundAllowed, signedFolioAmount, stayDates } from "@/lib/folio";
import { ensureFolio, folioView, recalcBooking } from "@/lib/folio-db";
import { can } from "@/lib/security/permissions";
import { assertTrustedOrigin } from "@/lib/security/origin";

const payer = z.enum(["guest", "company", "agency"]);
const entryInput = z.object({
  entryType: z.enum(["charge", "payment", "refund", "adjustment", "discount"]),
  category: z.enum(["accommodation", "extra", "tax", "fee", "other"]).default("other"),
  description: z.string().trim().min(2).max(300),
  amountCents: z.number().int().positive().max(100_000_00),
  payer: payer.default("guest"),
  paymentMethod: z.string().max(50).optional(),
  receiptReference: z.string().max(100).optional(),
});
const patchInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("nightly"), nights: z.array(z.object({ date: z.iso.date(), amountCents: z.number().int().min(0).max(100_000_00), payer })).min(1).max(400) }),
  z.object({ action: z.literal("payer_details"), payerType: z.enum(["company", "agency"]), name: z.string().trim().max(200), vatNumber: z.string().trim().max(30), taxOffice: z.string().trim().max(100), address: z.string().trim().max(300), email: z.union([z.literal(""), z.email()]) }),
]);

async function lockedBooking(client: Parameters<Parameters<typeof withTransaction>[0]>[0], ownerId: string, id: number) {
  const b = await client.query(`SELECT id,total_cents,balance_cents,check_in,check_out,folio_initialized_at,created_at,status FROM bookings WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [ownerId, id]);
  if (!b.rowCount) throw Error("NOT_FOUND");
  return b.rows[0];
}

function failure(e: unknown) {
  const m = e instanceof Error ? e.message : "";
  const status = m === "NOT_FOUND" ? 404 : ["REFUND_EXCEEDS_PAYMENTS", "STRIPE_PAYMENT_IN_PROGRESS", "DATES_MISMATCH"].includes(m) ? 409 : e instanceof z.ZodError ? 400 : 500;
  return Response.json({ ok: false, error: status === 500 ? "SAVE_FAILED" : e instanceof z.ZodError ? "INVALID_INPUT" : m }, { status });
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("folios.read");
  if (u instanceof Response) return u;
  const id = Number((await params).id);
  const b = await db().query(`SELECT id,total_cents,balance_cents,check_in,check_out,folio_initialized_at,created_at FROM bookings WHERE owner_id=$1 AND id=$2`, [u.ownerId, id]);
  if (!b.rowCount) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  return Response.json({ ok: true, ...(await folioView(db(), u.ownerId, b.rows[0])) });
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("folios.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const id = Number((await params).id), x = entryInput.parse(await request.json());
    const result = await withTransaction(async (c) => {
      const booking = await lockedBooking(c, u.ownerId, id);
      await ensureFolio(c, u.ownerId, booking);
      if (x.entryType === "payment") {
        const pending = await c.query(`SELECT 1 FROM balance_payment_links WHERE owner_id=$1 AND booking_id=$2 AND status='checkout_pending' AND checkout_expires_at>$3 LIMIT 1`, [u.ownerId, id, Date.now()]);
        if (pending.rowCount) throw Error("STRIPE_PAYMENT_IN_PROGRESS");
      }
      if (x.entryType === "refund") {
        const paid = await c.query(`SELECT COALESCE(sum(CASE WHEN entry_type IN ('payment','refund') THEN -amount_cents ELSE 0 END),0) AS net_paid FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 AND payer=$3`, [u.ownerId, id, x.payer]);
        if (!refundAllowed(x.amountCents, Number(paid.rows[0].net_paid))) throw Error("REFUND_EXCEEDS_PAYMENTS");
      }
      const category = x.entryType === "charge" ? x.category : "other";
      const r = await c.query(
        `INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at,payment_method,receipt_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [u.ownerId, id, x.entryType, category, x.description, signedFolioAmount(x.entryType, x.amountCents), x.payer, String(u.id), Date.now(), x.paymentMethod ?? null, x.receiptReference || null],
      );
      const summary = await recalcBooking(c, u.ownerId, id);
      return { entry: r.rows[0], summary };
    });
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("folios.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const id = Number((await params).id), x = patchInput.parse(await request.json());
    if (x.action === "nightly" && !can(u.role, "reservations.edit", u.permissions)) return forbidden(u, "reservations.edit", "folio.nightly");
    const result = await withTransaction(async (c) => {
      const booking = await lockedBooking(c, u.ownerId, id);
      await ensureFolio(c, u.ownerId, booking);
      const now = Date.now();
      if (x.action === "nightly") {
        const expected = stayDates(booking.check_in, booking.check_out);
        const given = [...new Set(x.nights.map((n) => n.date))].sort();
        if (given.length !== x.nights.length || given.join() !== expected.join()) throw Error("DATES_MISMATCH");
        for (const n of x.nights) {
          await c.query(`UPDATE booking_nightly_rates SET amount_cents=$1,payer=$2,updated_by=$3,updated_at=$4 WHERE owner_id=$5 AND booking_id=$6 AND stay_date=$7`, [n.amountCents, n.payer, String(u.id), now, u.ownerId, id, n.date]);
        }
      } else {
        await c.query(
          `INSERT INTO booking_payers(owner_id,booking_id,payer_type,name,vat_number,tax_office,address,email,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT(owner_id,booking_id,payer_type) DO UPDATE SET name=$4,vat_number=$5,tax_office=$6,address=$7,email=$8,updated_at=$9`,
          [u.ownerId, id, x.payerType, x.name, x.vatNumber, x.taxOffice, x.address, x.email, now],
        );
      }
      return recalcBooking(c, u.ownerId, id);
    });
    return Response.json({ ok: true, summary: result });
  } catch (e) {
    return failure(e);
  }
}

export const POST = audited("folio_entry", handlePOST);
export const PATCH = audited("folio", handlePATCH);

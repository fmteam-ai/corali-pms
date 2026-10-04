import Stripe from "stripe";
import { z } from "zod";
import { audited } from "@/lib/audit";
import { reservationSnapshot } from "@/lib/audit-snapshots";
import { requireApiUser } from "@/lib/auth";
import { db, withTransaction } from "@/lib/db";
import { ensureFolio, recalcBooking } from "@/lib/folio-db";
import { stripeCredentials } from "@/lib/provider-connections";
import { assertTrustedOrigin } from "@/lib/security/origin";

// Stripe "virtual terminal" on a reservation: capture or release a held authorization, or charge the saved card.
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("capture"), amountCents: z.number().int().positive().max(100_000_00).optional() }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("charge"), amountCents: z.number().int().positive().max(100_000_00) }),
]);

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("folios.read");
  if (u instanceof Response) return u;
  const id = Number((await params).id);
  const b = (await db().query(`SELECT stripe_authorization_ref,stripe_authorized_cents,stripe_authorized_at,payment_customer_ref,payment_method_ref,balance_cents FROM bookings WHERE owner_id=$1 AND id=$2`, [u.ownerId, id])).rows[0];
  if (!b) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  const credentials = await stripeCredentials(u.ownerId);
  return Response.json({ ok: true, configured: Boolean(credentials?.secretKey), authorization: b.stripe_authorization_ref ? { cents: Number(b.stripe_authorized_cents), at: Number(b.stripe_authorized_at) } : null, savedCard: Boolean(b.payment_customer_ref && b.payment_method_ref), balanceCents: Number(b.balance_cents) });
}

function stripeError(e: unknown) {
  const err = e as { type?: string; code?: string; message?: string };
  if (err?.code === "authentication_required") return "AUTHENTICATION_REQUIRED";
  if (err?.type === "StripeCardError") return `CARD_DECLINED${err.code ? `:${err.code}` : ""}`;
  if (err?.code === "payment_intent_unexpected_state") return "AUTHORIZATION_NOT_CAPTURABLE";
  return null;
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireApiUser("folios.write");
  if (u instanceof Response) return u;
  try {
    assertTrustedOrigin(request);
    const id = Number((await params).id), x = input.parse(await request.json());
    const credentials = await stripeCredentials(u.ownerId);
    if (!credentials?.secretKey) return Response.json({ ok: false, error: "PAYMENT_NOT_CONFIGURED" }, { status: 400 });
    const stripe = new Stripe(credentials.secretKey);
    const result = await withTransaction(async (c) => {
      const b = (await c.query(`SELECT id,reference,total_cents,balance_cents,check_in,check_out,folio_initialized_at,created_at,status,stripe_authorization_ref,stripe_authorized_cents,payment_customer_ref,payment_method_ref FROM bookings WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [u.ownerId, id])).rows[0];
      if (!b) throw Error("NOT_FOUND");
      const now = Date.now();
      const record = async (reference: string, amount: number, description: string) => {
        await ensureFolio(c, u.ownerId, b);
        await c.query(`INSERT INTO payment_transactions(owner_id,booking_id,provider,provider_reference,kind,status,amount_cents,currency,created_at) VALUES($1,$2,'stripe',$3,'payment','succeeded',$4,'EUR',$5) ON CONFLICT(provider,provider_reference) DO UPDATE SET status='succeeded',amount_cents=$4`, [u.ownerId, id, reference, amount, now]);
        await c.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at,payment_method,receipt_reference) VALUES($1,$2,'payment','other',$3,$4,'guest',$5,$6,'stripe',$7) ON CONFLICT DO NOTHING`, [u.ownerId, id, description, -amount, String(u.id), now, reference]);
        await recalcBooking(c, u.ownerId, id);
      };
      if (x.action === "capture" || x.action === "release") {
        if (!b.stripe_authorization_ref) throw Error("NO_AUTHORIZATION");
        const ref = String(b.stripe_authorization_ref), held = Number(b.stripe_authorized_cents);
        if (x.action === "release") {
          await stripe.paymentIntents.cancel(ref, {}, { idempotencyKey: `corali-release-${ref}` });
          await c.query(`UPDATE payment_transactions SET status='released' WHERE owner_id=$1 AND provider='stripe' AND provider_reference=$2`, [u.ownerId, ref]);
        } else {
          const amount = x.amountCents ?? held;
          if (amount > held) throw Error("AMOUNT_EXCEEDS_AUTHORIZATION");
          const intent = await stripe.paymentIntents.capture(ref, { amount_to_capture: amount }, { idempotencyKey: `corali-capture-${ref}-${amount}` });
          if (intent.status !== "succeeded") throw Error("CAPTURE_FAILED");
          await record(ref, amount, "Stripe capture");
        }
        await c.query(`UPDATE bookings SET stripe_authorization_ref=NULL,stripe_authorized_cents=NULL,stripe_authorized_at=NULL WHERE owner_id=$1 AND id=$2`, [u.ownerId, id]);
        return { action: x.action };
      }
      if (!b.payment_customer_ref || !b.payment_method_ref) throw Error("NO_SAVED_CARD");
      if (x.amountCents > Number(b.balance_cents)) throw Error("AMOUNT_EXCEEDS_BALANCE");
      const intent = await stripe.paymentIntents.create({ amount: x.amountCents, currency: "eur", customer: String(b.payment_customer_ref), payment_method: String(b.payment_method_ref), off_session: true, confirm: true, description: `${credentials.options.companyName} · ${b.reference}`, metadata: { ...credentials.options.metadata, kind: "pms_charge", booking_id: String(id), owner_id: u.ownerId } }, { idempotencyKey: `corali-charge-${id}-${x.amountCents}-${Math.floor(now / 120_000)}` });
      if (intent.status !== "succeeded") throw Error(intent.status === "requires_action" ? "AUTHENTICATION_REQUIRED" : "CHARGE_FAILED");
      await record(intent.id, x.amountCents, "Stripe card charge (PMS)");
      return { action: x.action, reference: intent.id };
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    const m = e instanceof Error ? e.message : "";
    const known = ["NOT_FOUND", "NO_AUTHORIZATION", "NO_SAVED_CARD", "AMOUNT_EXCEEDS_AUTHORIZATION", "AMOUNT_EXCEEDS_BALANCE", "CAPTURE_FAILED", "CHARGE_FAILED", "AUTHENTICATION_REQUIRED"].includes(m) ? m : stripeError(e);
    // A declined card or Stripe refusal is a 409 answer, not a 5xx (hosting proxies replace 5xx bodies with their own page).
    return Response.json({ ok: false, error: known ?? "STRIPE_FAILED" }, { status: known === "NOT_FOUND" ? 404 : 409 });
  }
}

export const POST = audited("reservation_payment", handlePOST, { snapshot: reservationSnapshot });

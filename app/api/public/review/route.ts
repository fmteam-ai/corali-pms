import { z } from "zod";
import { reviewRoute } from "@/lib/review";
import { db, withTransaction } from "@/lib/db";
import { env } from "@/lib/env";
import { pushNotification } from "@/lib/pms-notifications";
import { hashToken } from "@/lib/security/tokens";

const token = z.string().min(32).max(200);
const rate = z.object({ token, rating: z.number().int().min(1).max(5), comment: z.string().trim().max(3000).default(""), contactOk: z.boolean().default(false) });
const click = z.object({ token, clicked: z.enum(["google", "tripadvisor"]) });

async function links(ownerId: string) {
  const s = (await db().query(`SELECT review_url,tripadvisor_url FROM message_automation_settings WHERE owner_id=$1`, [ownerId])).rows[0];
  return { google: s?.review_url || null, tripadvisor: s?.tripadvisor_url || null };
}

export async function GET(request: Request) {
  const c = env();
  const t = new URL(request.url).searchParams.get("token") ?? "";
  if (!token.safeParse(t).success) return Response.json({ ok: false, error: "INVALID_TOKEN" }, { status: 401 });
  const r = (await db().query(
    `SELECT r.status,r.route,b.guest_name,b.guest_language FROM review_requests r JOIN bookings b ON b.owner_id=r.owner_id AND b.id=r.booking_id WHERE r.owner_id=$1 AND r.token_hash=$2 AND r.expires_at>$3`,
    [c.PMS_OWNER_ID, hashToken(t), Date.now()],
  )).rows[0];
  if (!r) return Response.json({ ok: false, error: "INVALID_TOKEN" }, { status: 401 });
  return Response.json({ ok: true, name: String(r.guest_name).split(" ")[0], language: r.guest_language, status: r.status, route: r.route, links: r.route === "public" ? await links(c.PMS_OWNER_ID) : null });
}

export async function POST(request: Request) {
  const c = env();
  try {
    const body = await request.json();
    if (click.safeParse(body).success) {
      const x = click.parse(body);
      await db().query(`UPDATE review_requests SET public_clicked=concat_ws(',',NULLIF(public_clicked,''),$3::text) WHERE owner_id=$1 AND token_hash=$2 AND route='public'`, [c.PMS_OWNER_ID, hashToken(x.token), x.clicked]);
      return Response.json({ ok: true });
    }
    const x = rate.parse(body);
    const route = reviewRoute(x.rating)!;
    // Low ratings must explain what went wrong; that text goes only to the management.
    if (route === "private" && x.comment.length < 3) return Response.json({ ok: false, error: "COMMENT_REQUIRED" }, { status: 400 });
    const result = await withTransaction(async (client) => {
      const r = (await client.query(
        `SELECT r.*,b.reference,b.guest_name FROM review_requests r JOIN bookings b ON b.owner_id=r.owner_id AND b.id=r.booking_id WHERE r.owner_id=$1 AND r.token_hash=$2 AND r.expires_at>$3 FOR UPDATE OF r`,
        [c.PMS_OWNER_ID, hashToken(x.token), Date.now()],
      )).rows[0];
      if (!r) throw Error("INVALID_TOKEN");
      if (r.status !== "sent") throw Error("ALREADY_SUBMITTED");
      const now = Date.now();
      await client.query(`UPDATE review_requests SET rating=$1,route=$2,comment=NULLIF($3,''),contact_ok=$4,status=$5,rated_at=$6 WHERE id=$7`, [x.rating, route, x.comment, x.contactOk ? 1 : 0, route === "private" ? "feedback" : "rated", now, r.id]);
      if (route === "private") {
        await pushNotification(client, c.PMS_OWNER_ID, { kind: "system", titleEl: `Αρνητική αξιολόγηση ${x.rating}★ · ${r.reference} · ${r.guest_name}: ${x.comment.slice(0, 140)}`, titleEn: `Low rating ${x.rating}★ · ${r.reference} · ${r.guest_name}: ${x.comment.slice(0, 140)}`, link: "/pms/feedback" });
      }
      return route;
    });
    return Response.json({ ok: true, route: result, links: result === "public" ? await links(c.PMS_OWNER_ID) : null });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (e instanceof z.ZodError) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
    if (m === "INVALID_TOKEN") return Response.json({ ok: false, error: m }, { status: 401 });
    if (m === "ALREADY_SUBMITTED") return Response.json({ ok: false, error: m }, { status: 409 });
    return Response.json({ ok: false, error: "REVIEW_FAILED" }, { status: 500 });
  }
}

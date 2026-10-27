// Corali open API: keys with scopes for the hotel's own systems (POS, accounting, BI), the data they read and the
// charges a POS posts, and the outgoing webhooks. Keys and webhook secrets are shown once; the database keeps only the
// key's SHA-256 and the secret encrypted with the document key.
import { randomBytes } from "node:crypto";
import { API_SCOPES, WEBHOOK_EVENTS, apiKeyHash, parseApiKey, sameHash, webhookUrlProblem, type ApiScope, type WebhookEvent } from "../scripts/open-api-core.mjs";
import { bookingData, sendDelivery } from "../scripts/api-webhook-worker.mjs";
import { db, withTransaction } from "@/lib/db";
import { documentKey } from "@/lib/env";
import { ensureFolio, recalcBooking } from "@/lib/folio-db";
import { allowAttempt, clientIp } from "@/lib/request-limit";
import { decryptField, encryptField } from "@/lib/security/encryption";
import { addDays, hotelToday } from "@/lib/tape-chart";

export { API_SCOPES, WEBHOOK_EVENTS };
export type { ApiScope, WebhookEvent };
export type ApiCaller = { ownerId: string; keyId: number; name: string };

const apiError = (status: number, error: string, message: string) => Response.json({ ok: false, error, message }, { status, headers: { "Cache-Control": "no-store" } });

/** Authorization: Bearer corali_… with the scope the endpoint needs. 120 requests a minute per key. */
export async function requireApiKey(request: Request, scope: ApiScope): Promise<ApiCaller | Response> {
  const parsed = parseApiKey(request.headers.get("authorization"));
  if (!parsed) {
    if (!(await allowAttempt(`api-bad:${clientIp(request)}`, 30, 60_000, 15 * 60_000))) return apiError(429, "RATE_LIMITED", "Too many requests");
    return apiError(401, "UNAUTHORIZED", "Send Authorization: Bearer <API key>");
  }
  const row = (await db().query(`SELECT id,owner_id,name,key_hash,scopes_json,revoked_at FROM api_keys WHERE prefix=$1`, [parsed.prefix])).rows[0];
  if (!row || row.revoked_at || !sameHash(String(row.key_hash), apiKeyHash(parsed.key))) {
    if (!(await allowAttempt(`api-bad:${clientIp(request)}`, 30, 60_000, 15 * 60_000))) return apiError(429, "RATE_LIMITED", "Too many requests");
    return apiError(401, "UNAUTHORIZED", "Unknown or revoked API key");
  }
  if (!(await allowAttempt(`api-key:${row.id}`, 120, 60_000, 60_000))) return apiError(429, "RATE_LIMITED", "More than 120 requests a minute");
  if (!(JSON.parse(String(row.scopes_json)) as string[]).includes(scope)) return apiError(403, "FORBIDDEN", `This key does not have the ${scope} scope`);
  await db().query(`UPDATE api_keys SET last_used_at=$2::bigint WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<$2::bigint-60000)`, [row.id, Date.now()]);
  return { ownerId: String(row.owner_id), keyId: Number(row.id), name: String(row.name) };
}

export const apiJson = (data: unknown) => Response.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
export const apiBad = (message: string) => apiError(400, "INVALID_INPUT", message);
export const apiNotFound = (message = "Not found") => apiError(404, "NOT_FOUND", message);
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const eur = (cents: unknown) => (Number(cents) / 100).toFixed(2);

// ── Data for API callers ─────────────────────────────────────────────────────────────────────────────────────────

export async function apiRooms(ownerId: string) {
  const r = await db().query(`SELECT code,room_type,operational_status,base_rate_cents FROM rooms WHERE owner_id=$1 AND active=1 ORDER BY code`, [ownerId]);
  return r.rows.map((x) => ({ code: String(x.code), type: String(x.room_type), status: String(x.operational_status ?? "ready"), base_rate: eur(x.base_rate_cents), currency: "EUR" }));
}

/** Free rooms per room type and night, at most 365 nights. */
export async function apiAvailability(ownerId: string, from: string | null, to: string | null) {
  const start = isDate(from) ? from : hotelToday(), end = isDate(to) ? to : addDays(start, 30);
  if (end < start || Date.parse(end) - Date.parse(start) > 365 * 86_400_000) return null;
  const r = await db().query(
    `SELECT d.day::date::text AS date, r.room_type, count(r.id) FILTER (WHERE r.operational_status<>'out_of_order' AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status IN ('confirmed','checked_in') AND b.check_in<=d.day::date::text AND b.check_out>d.day::date::text))::int AS free, count(r.id)::int AS total
       FROM generate_series($2::date,$3::date,interval '1 day') AS d(day) JOIN rooms r ON r.owner_id=$1 AND r.active=1 GROUP BY 1,2 ORDER BY 1,2`,
    [ownerId, start, end],
  );
  return r.rows.map((x) => ({ date: String(x.date), room_type: String(x.room_type), free: Number(x.free), total: Number(x.total) }));
}

const BOOKING_COLUMNS = `b.id,b.reference,b.status,b.channel,b.guest_name,b.guest_email,b.guest_language,b.room_id,b.check_in,b.check_out,b.total_cents,b.balance_cents,b.created_at,r.code room_code,r.room_type`;

/** Bookings that overlap [from, to] (by stay dates), optionally of one status; at most 500. */
export async function apiBookings(ownerId: string, q: URLSearchParams) {
  const from = q.get("from"), to = q.get("to"), status = q.get("status"), inHouse = q.get("in_house") === "true";
  if ((from && !isDate(from)) || (to && !isDate(to))) return null;
  const today = hotelToday();
  const r = await db().query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
      WHERE b.owner_id=$1 AND b.check_out>=$2 AND b.check_in<=$3 AND ($4::text IS NULL OR b.status=$4) AND (NOT $5 OR b.status='checked_in') ORDER BY b.check_in,b.id LIMIT 500`,
    [ownerId, from ?? (inHouse ? "0000-01-01" : today), to ?? (inHouse ? "9999-12-31" : addDays(today, 30)), status || null, inHouse],
  );
  return r.rows.map(bookingData);
}

/** One booking with its folio (charges, payments) by reference — or by room code for a guest in house (POS). */
export async function apiBooking(ownerId: string, ref: string) {
  const r = await db().query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
      WHERE b.owner_id=$1 AND (upper(b.reference)=upper($2) OR (b.status='checked_in' AND r.code=$2)) ORDER BY (upper(b.reference)=upper($2)) DESC LIMIT 1`,
    [ownerId, ref.trim()],
  );
  const b = r.rows[0];
  if (!b) return null;
  const f = await db().query(`SELECT id,entry_type,description,amount_cents,payer,payment_method,created_at FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 ORDER BY id`, [ownerId, b.id]);
  return { ...bookingData(b), folio: f.rows.map((x) => ({ id: Number(x.id), type: String(x.entry_type), description: String(x.description), amount: eur(x.amount_cents), payer: String(x.payer), payment_method: x.payment_method ?? null, created_at: new Date(Number(x.created_at)).toISOString() })) };
}

/** POS charge to an open booking's folio (restaurant, bar, spa…). The same external_id is posted only once. */
export async function apiCharge(caller: ApiCaller, ref: string, x: { description: string; amount: number; external_id?: string }) {
  return withTransaction(async (c) => {
    const b = (await c.query(`SELECT b.* FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id WHERE b.owner_id=$1 AND (upper(b.reference)=upper($2) OR (b.status='checked_in' AND r.code=$2)) ORDER BY (upper(b.reference)=upper($2)) DESC LIMIT 1 FOR UPDATE OF b`, [caller.ownerId, ref.trim()])).rows[0];
    if (!b) return { error: "NOT_FOUND" as const };
    if (!["confirmed", "checked_in"].includes(String(b.status))) return { error: "BOOKING_CLOSED" as const };
    const description = `${x.description.trim().slice(0, 180)}${x.external_id ? ` [${caller.name}:${x.external_id}]` : ""}`;
    if (x.external_id) {
      const dup = (await c.query(`SELECT id FROM folio_entries WHERE owner_id=$1 AND booking_id=$2 AND actor_id=$3 AND description=$4 LIMIT 1`, [caller.ownerId, b.id, `api:${caller.keyId}`, description])).rows[0];
      if (dup) return { id: Number(dup.id), reference: String(b.reference), duplicate: true };
    }
    await ensureFolio(c, caller.ownerId, { id: Number(b.id), total_cents: Number(b.total_cents), balance_cents: Number(b.balance_cents), check_in: String(b.check_in), check_out: String(b.check_out), folio_initialized_at: b.folio_initialized_at ?? null, created_at: Number(b.created_at) });
    const e = await c.query(`INSERT INTO folio_entries(owner_id,booking_id,entry_type,category,description,amount_cents,payer,actor_id,created_at) VALUES($1,$2,'charge','extra',$3,$4,'guest',$5,$6) RETURNING id`, [caller.ownerId, b.id, description, Math.round(x.amount * 100), `api:${caller.keyId}`, Date.now()]);
    await recalcBooking(c, caller.ownerId, Number(b.id));
    return { id: Number(e.rows[0].id), reference: String(b.reference), duplicate: false };
  });
}

/** For accounting: folio charges and payments after an id (page through with ?after=<last id>), at most 500. */
export async function apiTransactions(ownerId: string, after: number, from: string | null) {
  const r = await db().query(
    `SELECT f.id,f.entry_type,f.description,f.amount_cents,f.payer,f.payment_method,f.created_at,b.reference FROM folio_entries f JOIN bookings b ON b.owner_id=f.owner_id AND b.id=f.booking_id
      WHERE f.owner_id=$1 AND f.id>$2 AND f.created_at>=$3 ORDER BY f.id LIMIT 500`,
    [ownerId, after, isDate(from) ? Date.parse(`${from}T00:00:00Z`) : 0],
  );
  return r.rows.map((x) => ({ id: Number(x.id), booking_reference: String(x.reference), type: String(x.entry_type), description: String(x.description), amount: eur(x.amount_cents), currency: "EUR", payer: String(x.payer), payment_method: x.payment_method ?? null, created_at: new Date(Number(x.created_at)).toISOString() }));
}

/** For accounting: issued documents (myDATA) after an id, at most 500. */
export async function apiInvoices(ownerId: string, after: number) {
  const r = await db().query(
    `SELECT d.id,d.series,d.aa,d.invoice_type,d.issue_date,d.total_cents,d.status,d.mark,d.uid,d.qr_url,d.cancellation_mark,d.payer,b.reference FROM fiscal_documents d LEFT JOIN bookings b ON b.owner_id=d.owner_id AND b.id=d.booking_id
      WHERE d.owner_id=$1 AND d.id>$2 ORDER BY d.id LIMIT 500`,
    [ownerId, after],
  );
  return r.rows.map((x) => ({ id: Number(x.id), number: `${x.series}-${x.aa}`, type: String(x.invoice_type), issue_date: String(x.issue_date), total: eur(x.total_cents), currency: "EUR", status: String(x.status), mydata_mark: x.mark ?? null, uid: x.uid ?? null, qr_url: x.qr_url ?? null, cancelled_by_mark: x.cancellation_mark ?? null, payer: String(x.payer), booking_reference: x.reference ?? null }));
}

// ── PMS management (keys, webhooks) ──────────────────────────────────────────────────────────────────────────────

export type ApiKeyView = { id: number; name: string; prefix: string; scopes: string[]; createdAt: number; lastUsedAt: number | null; revokedAt: number | null };
export type WebhookView = { id: number; url: string; events: string[]; active: boolean; createdAt: number; lastOkAt: number | null; lastError: string | null; deliveries: { id: number; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; createdAt: number }[] };

export async function openApiStatus(ownerId: string): Promise<{ keys: ApiKeyView[]; webhooks: WebhookView[] }> {
  const keys = await db().query(`SELECT id,name,prefix,scopes_json,created_at,last_used_at,revoked_at FROM api_keys WHERE owner_id=$1 ORDER BY revoked_at IS NOT NULL, id DESC LIMIT 100`, [ownerId]);
  const hooks = await db().query(`SELECT id,url,events_json,active,created_at,last_ok_at,last_error FROM api_webhooks WHERE owner_id=$1 ORDER BY id`, [ownerId]);
  const deliveries = await db().query(`SELECT id,webhook_id,event,status,attempts,response_status,last_error,created_at FROM (SELECT d.*,row_number() OVER (PARTITION BY webhook_id ORDER BY id DESC) n FROM api_webhook_deliveries d WHERE owner_id=$1) x WHERE n<=10 ORDER BY id DESC`, [ownerId]);
  return {
    keys: keys.rows.map((k) => ({ id: Number(k.id), name: String(k.name), prefix: String(k.prefix), scopes: JSON.parse(String(k.scopes_json)), createdAt: Number(k.created_at), lastUsedAt: k.last_used_at ? Number(k.last_used_at) : null, revokedAt: k.revoked_at ? Number(k.revoked_at) : null })),
    webhooks: hooks.rows.map((h) => ({
      id: Number(h.id), url: String(h.url), events: JSON.parse(String(h.events_json)), active: Number(h.active) === 1, createdAt: Number(h.created_at), lastOkAt: h.last_ok_at ? Number(h.last_ok_at) : null, lastError: h.last_error ? String(h.last_error) : null,
      deliveries: deliveries.rows.filter((d) => Number(d.webhook_id) === Number(h.id)).map((d) => ({ id: Number(d.id), event: String(d.event), status: String(d.status), attempts: Number(d.attempts), responseStatus: d.response_status ? Number(d.response_status) : null, error: d.last_error ? String(d.last_error) : null, createdAt: Number(d.created_at) })),
    })),
  };
}

/** A new key; the full key is returned only here. */
export async function createApiKey(ownerId: string, userId: string, name: string, scopes: ApiScope[]): Promise<string> {
  for (;;) {
    const prefix = randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    if (prefix.length < 8) continue;
    const key = `corali_${prefix}_${randomBytes(32).toString("base64url")}`;
    const r = await db().query(`INSERT INTO api_keys(owner_id,name,prefix,key_hash,scopes_json,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(prefix) DO NOTHING`, [ownerId, name, prefix, apiKeyHash(key), JSON.stringify(scopes), userId, Date.now()]);
    if (r.rowCount) return key;
  }
}

export async function revokeApiKey(ownerId: string, id: number): Promise<boolean> {
  return !!(await db().query(`UPDATE api_keys SET revoked_at=$3 WHERE owner_id=$1 AND id=$2 AND revoked_at IS NULL`, [ownerId, id, Date.now()])).rowCount;
}

/** A new webhook; its signing secret is returned only here. */
export async function createWebhook(ownerId: string, userId: string, url: string, events: WebhookEvent[]): Promise<{ secret: string } | { error: string }> {
  const problem = webhookUrlProblem(url);
  if (problem) return { error: `WEBHOOK_${problem}` };
  if (Number((await db().query(`SELECT count(*) n FROM api_webhooks WHERE owner_id=$1`, [ownerId])).rows[0].n) >= 10) return { error: "WEBHOOK_LIMIT" };
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  await db().query(`INSERT INTO api_webhooks(owner_id,url,events_json,secret_encrypted,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6)`, [ownerId, url, JSON.stringify(events), encryptField(secret, documentKey()), userId, Date.now()]);
  return { secret };
}

export async function updateWebhook(ownerId: string, id: number, x: { active?: boolean; events?: WebhookEvent[] }): Promise<boolean> {
  const r = await db().query(`UPDATE api_webhooks SET active=COALESCE($3,active),events_json=COALESCE($4,events_json) WHERE owner_id=$1 AND id=$2`, [ownerId, id, x.active === undefined ? null : x.active ? 1 : 0, x.events ? JSON.stringify(x.events) : null]);
  return !!r.rowCount;
}

export async function deleteWebhook(ownerId: string, id: number): Promise<boolean> {
  await db().query(`DELETE FROM api_webhook_deliveries WHERE owner_id=$1 AND webhook_id=$2`, [ownerId, id]);
  return !!(await db().query(`DELETE FROM api_webhooks WHERE owner_id=$1 AND id=$2`, [ownerId, id])).rowCount;
}

/** Send a "ping" now and say what the other side answered. */
export async function testWebhook(ownerId: string, id: number): Promise<{ ok: boolean; status: number | null; error?: string } | null> {
  const h = (await db().query(`SELECT id,url,secret_encrypted FROM api_webhooks WHERE owner_id=$1 AND id=$2`, [ownerId, id])).rows[0];
  if (!h) return null;
  const now = Date.now(), payload = JSON.stringify({ id: `evt_ping_${now}`, event: "ping", created_at: new Date(now).toISOString(), data: { message: "Corali PMS webhook test" } });
  const d = (await db().query(`INSERT INTO api_webhook_deliveries(owner_id,webhook_id,event,payload_json,next_at,created_at) VALUES($1,$2,'ping',$3,$4,$4) RETURNING id,attempts`, [ownerId, id, payload, now])).rows[0];
  const r = await sendDelivery(db(), { id: d.id, webhook_id: id, event: "ping", payload_json: payload, attempts: 9, url: h.url }, decryptField(String(h.secret_encrypted), documentKey()));
  return r;
}

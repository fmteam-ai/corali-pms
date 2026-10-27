// Virtual access cards in the database (PMS → Digital keys): settings and wallet credentials, issuing (per booking or
// by hand), editing / extending / cancelling, the guest's card page and the door readers' check.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { documentKey, env } from "@/lib/env";
import { sendEmail } from "@/lib/notifications/email";
import { newKeyAndCsr } from "@/lib/cms";
import { decryptField, encryptField } from "@/lib/security/encryption";
import { hotelToday } from "@/lib/tape-chart";
import { accessDecision, bookingValidity, cardEmail, cardLang, cardState, effectiveCard, normalizeCardSettings } from "../scripts/access-card-core.mjs";
import { appleReady, describeAppleCertificate, googleReady, googleUpdate, type PassCard, type WalletConfig, type WalletSecrets } from "@/lib/wallet-passes";

export type CardSettings = ReturnType<typeof normalizeCardSettings>;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const parse = (v: unknown) => { try { return JSON.parse(String(v ?? "")); } catch { return null; } };

const normalizeWallet = (raw: unknown): WalletConfig => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>, s = (k: string, max: number) => (typeof r[k] === "string" ? String(r[k]).trim().slice(0, max) : "");
  return { applePassTypeId: s("applePassTypeId", 120), appleTeamId: s("appleTeamId", 20), appleNfcPublicKey: s("appleNfcPublicKey", 200), googleIssuerId: s("googleIssuerId", 40), googleSmartTap: r.googleSmartTap === true };
};

async function settingsRow(ownerId: string) {
  return (await db().query(`SELECT * FROM access_card_settings WHERE owner_id=$1`, [ownerId])).rows[0] ?? null;
}

export async function cardConfig(ownerId: string) {
  const row = await settingsRow(ownerId);
  const settings = normalizeCardSettings(parse(row?.settings_json));
  const wallet = normalizeWallet(parse(row?.wallet_json));
  let secrets: WalletSecrets = {};
  try { secrets = row?.wallet_secrets_encrypted ? JSON.parse(decryptField(String(row.wallet_secrets_encrypted), documentKey())) : {}; } catch { secrets = {}; }
  return { settings, wallet, secrets, readerKeyHash: row?.reader_key_hash ? String(row.reader_key_hash) : null };
}

/** What the PMS settings screen shows (never the secrets themselves). */
export async function publicCardConfig(ownerId: string) {
  const c = await cardConfig(ownerId);
  let apple: { subject: string; expires: number } | null = null, appleError = "";
  if (c.secrets.applePrivateKey && c.secrets.appleCert && c.secrets.appleWwdr) { try { apple = describeAppleCertificate(c.secrets); } catch (e) { appleError = e instanceof Error ? e.message : "APPLE_CERTIFICATE_INVALID"; } }
  let googleAccount = "";
  try { googleAccount = c.secrets.googleServiceAccount ? String(JSON.parse(c.secrets.googleServiceAccount).client_email ?? "") : ""; } catch { googleAccount = ""; }
  return {
    settings: c.settings, wallet: c.wallet,
    appleCsr: c.secrets.appleCsr ?? "",
    has: { appleKey: Boolean(c.secrets.applePrivateKey), appleCert: Boolean(c.secrets.appleCert), appleWwdr: Boolean(c.secrets.appleWwdr), googleServiceAccount: Boolean(c.secrets.googleServiceAccount), readerKey: Boolean(c.readerKeyHash) },
    apple, appleError, googleAccount,
    appleReady: appleReady(c.wallet, c.secrets) && !appleError, googleReady: googleReady(c.wallet, c.secrets),
  };
}

export async function saveCardSettings(ownerId: string, raw: unknown): Promise<void> {
  const s = normalizeCardSettings(raw);
  await db().query(`INSERT INTO access_card_settings(owner_id,settings_json,updated_at) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET settings_json=$2,updated_at=$3`, [ownerId, JSON.stringify(s), Date.now()]);
}

async function storeWallet(ownerId: string, config: WalletConfig, secrets: WalletSecrets) {
  await db().query(
    `INSERT INTO access_card_settings(owner_id,wallet_json,wallet_secrets_encrypted,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO UPDATE SET wallet_json=$2,wallet_secrets_encrypted=$3,updated_at=$4`,
    [ownerId, JSON.stringify(config), encryptField(JSON.stringify(secrets), documentKey()), Date.now()],
  );
}

/**
 * Apple step 1: the PMS makes the private key (it never leaves the server) and the certificate signing request the
 * hotel uploads to Apple for its Pass Type ID. A new request replaces the previous key, so its certificate is cleared.
 */
export async function newAppleCsr(ownerId: string, email: string): Promise<string> {
  const c = await cardConfig(ownerId);
  const { privateKeyPem, csrPem } = newKeyAndCsr(c.wallet.applePassTypeId || "Hotel Corali Wallet", email || "info@hotelcorali.gr");
  const { appleCert: _old, ...rest } = c.secrets;
  void _old;
  await storeWallet(ownerId, c.wallet, { ...rest, applePrivateKey: privateKeyPem, appleCsr: csrPem });
  return csrPem;
}

/** Wallet setup: non-secret ids and, when given, new certificate / key files (an empty string removes one). */
export async function saveWallet(ownerId: string, config: unknown, secrets: Partial<Record<"appleCert" | "appleWwdr" | "googleServiceAccount", string>>): Promise<void> {
  const c = await cardConfig(ownerId);
  const next: WalletSecrets = { ...c.secrets };
  for (const k of ["appleCert", "appleWwdr", "googleServiceAccount"] as const) {
    const v = secrets[k];
    if (v === undefined) continue;
    if (v === "") delete next[k]; else next[k] = v;
  }
  if (next.googleServiceAccount) { const a = parse(next.googleServiceAccount); if (!a?.client_email || !a?.private_key) throw Error("GOOGLE_SERVICE_ACCOUNT_INVALID"); }
  if (secrets.appleCert && !next.applePrivateKey) throw Error("APPLE_NO_KEY");
  if (next.appleCert && next.appleWwdr && (secrets.appleCert !== undefined || secrets.appleWwdr !== undefined)) describeAppleCertificate(next);
  await storeWallet(ownerId, normalizeWallet(config), next);
}

/** A new key for the door readers / lock controller (shown once; only its hash is kept). */
export async function newReaderKey(ownerId: string): Promise<string> {
  const key = `crk_${randomBytes(24).toString("base64url")}`;
  await db().query(`INSERT INTO access_card_settings(owner_id,reader_key_hash,updated_at) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET reader_key_hash=$2,updated_at=$3`, [ownerId, sha(key), Date.now()]);
  return key;
}

const CARD_SELECT = `SELECT c.*,cr.code card_room_code,br.code booking_room_code,b.reference,b.check_in,b.check_out,b.status booking_status,b.guest_email
  FROM access_cards c LEFT JOIN rooms cr ON cr.owner_id=c.owner_id AND cr.id=c.room_id
  LEFT JOIN bookings b ON b.owner_id=c.owner_id AND b.id=c.booking_id LEFT JOIN rooms br ON br.owner_id=b.owner_id AND br.id=b.room_id`;

function view(row: Record<string, unknown>, settings: CardSettings, now: number) {
  const e = effectiveCard(row, settings);
  const zones = (parse(row.zones_json) as string[] | null) ?? [];
  return {
    id: Number(row.id), kind: String(row.kind), bookingId: row.booking_id === null ? null : Number(row.booking_id), reference: row.reference ? String(row.reference) : "",
    holder: String(row.holder_name), email: String(row.email), lang: String(row.lang), roomCode: e.roomCode, roomId: row.room_id === null ? null : Number(row.room_id), zones,
    validFrom: e.validFrom, validUntil: e.validUntil, untilLocked: Number(row.until_locked) === 1, state: cardState(e, now) as "active" | "scheduled" | "expired" | "revoked",
    serial: String(row.serial), sentAt: row.sent_at === null ? null : Number(row.sent_at), sendError: String(row.send_error), lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    revokedReason: String(row.revoked_reason), createdBy: String(row.created_by), createdAt: Number(row.created_at),
  };
}
export type CardView = ReturnType<typeof view>;

/** Cards of the last 30 days and all current / upcoming ones. */
export async function listCards(ownerId: string): Promise<CardView[]> {
  const { settings } = await cardConfig(ownerId), now = Date.now();
  const r = await db().query(`${CARD_SELECT} WHERE c.owner_id=$1 AND (c.valid_until>$2 OR c.created_at>$2) ORDER BY c.valid_from DESC, c.id DESC LIMIT 300`, [ownerId, now - 30 * 86_400_000]);
  return r.rows.map((x) => view(x, settings, now));
}

/** Bookings in the hotel or arriving within two days, with whether they already have a card (for "Issue now"). */
export async function upcomingWithoutCard(ownerId: string) {
  const today = hotelToday();
  const r = await db().query(
    `SELECT b.id,b.reference,b.guest_name,b.check_in,b.check_out,r.code FROM bookings b LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id
      WHERE b.owner_id=$1 AND b.status IN ('confirmed','checked_in') AND b.check_out>=$2::text AND b.check_in<=($2::date+2)::text
        AND NOT EXISTS (SELECT 1 FROM access_cards c WHERE c.owner_id=b.owner_id AND c.booking_id=b.id AND c.status='active') ORDER BY b.check_in, r.code NULLS LAST`,
    [ownerId, today],
  );
  return r.rows.map((b) => ({ id: Number(b.id), label: `${b.code ? `${b.code} · ` : ""}${b.guest_name} (${b.reference}) · ${String(b.check_in).split("-").reverse().slice(0, 2).join("/")}→${String(b.check_out).split("-").reverse().slice(0, 2).join("/")}` }));
}

async function insertCard(ownerId: string, x: { kind: "booking" | "manual"; bookingId: number | null; roomId: number | null; holder: string; email: string; lang: string; zones: string[]; from: number; until: number; untilLocked: boolean; createdBy: string }) {
  const token = randomBytes(32).toString("base64url"), serial = `CRL-${randomBytes(6).toString("hex").toUpperCase()}`, now = Date.now();
  const r = await db().query(
    `INSERT INTO access_cards(owner_id,kind,booking_id,room_id,holder_name,email,lang,zones_json,valid_from,valid_until,until_locked,serial,token_hash,token_encrypted,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING id`,
    [ownerId, x.kind, x.bookingId, x.roomId, x.holder.slice(0, 120), x.email.slice(0, 200), cardLang(x.lang), JSON.stringify(x.zones), x.from, x.until, x.untilLocked ? 1 : 0, serial, sha(token), encryptField(token, documentKey()), x.createdBy, now],
  );
  return Number(r.rows[0].id);
}

/** Issue the card of a booking now (reception, e.g. a same-day booking). */
export async function issueForBooking(ownerId: string, bookingId: number, actor: string, send: boolean): Promise<number> {
  const { settings } = await cardConfig(ownerId);
  if (!settings.enabled) throw Error("DISABLED");
  const b = (await db().query(`SELECT * FROM bookings WHERE owner_id=$1 AND id=$2 AND status IN ('confirmed','checked_in')`, [ownerId, bookingId])).rows[0];
  if (!b) throw Error("NOT_FOUND");
  if ((await db().query(`SELECT 1 FROM access_cards WHERE owner_id=$1 AND booking_id=$2 AND status='active'`, [ownerId, bookingId])).rowCount) throw Error("ALREADY_ISSUED");
  const v = bookingValidity(String(b.check_in), String(b.check_out), settings);
  const id = await insertCard(ownerId, { kind: "booking", bookingId, roomId: b.room_id === null ? null : Number(b.room_id), holder: String(b.guest_name), email: String(b.guest_email ?? ""), lang: String(b.guest_language ?? "en"), zones: settings.zones.filter((z) => z.guests).map((z) => z.key), from: v.from, until: v.until, untilLocked: false, createdBy: actor });
  if (send && b.guest_email) await sendCard(ownerId, id).catch(() => undefined);
  return id;
}

/** A card for a visitor (day guest, contractor…): reception chooses name, room or areas and the times. */
export async function issueManual(ownerId: string, x: { holder: string; email: string; lang: string; roomId: number | null; zones: string[]; from: number; until: number; send: boolean }, actor: string): Promise<number> {
  const { settings } = await cardConfig(ownerId);
  if (!settings.enabled) throw Error("DISABLED");
  if (x.until <= x.from || x.until <= Date.now()) throw Error("BAD_DATES");
  const known = new Set(settings.zones.map((z) => z.key));
  if (x.roomId !== null && !(await db().query(`SELECT 1 FROM rooms WHERE owner_id=$1 AND id=$2`, [ownerId, x.roomId])).rowCount) throw Error("NOT_FOUND");
  const id = await insertCard(ownerId, { kind: "manual", bookingId: null, roomId: x.roomId, holder: x.holder, email: x.email, lang: x.lang, zones: x.zones.filter((z) => known.has(z)), from: x.from, until: x.until, untilLocked: true, createdBy: actor });
  if (x.send && x.email) await sendCard(ownerId, id);
  return id;
}

async function rowById(ownerId: string, id: number) {
  const r = (await db().query(`${CARD_SELECT} WHERE c.owner_id=$1 AND c.id=$2`, [ownerId, id])).rows[0];
  if (!r) throw Error("NOT_FOUND");
  return r;
}

export const cardLink = (token: string) => `${env().BOOKING_ORIGIN}/card/${token}`;

/** The link to a card (reception can copy it or show its QR to a walk-in). */
export async function cardUrl(ownerId: string, id: number): Promise<string> {
  const r = await rowById(ownerId, id);
  return cardLink(decryptField(String(r.token_encrypted), documentKey()));
}

/** E-mail the card link to its holder (again). */
export async function sendCard(ownerId: string, id: number): Promise<void> {
  const r = await rowById(ownerId, id), { settings } = await cardConfig(ownerId);
  const to = String(r.email || r.guest_email || "");
  if (!to) throw Error("NO_EMAIL");
  const e = effectiveCard(r, settings);
  const m = cardEmail(String(r.lang), { name: String(r.holder_name), link: cardLink(decryptField(String(r.token_encrypted), documentKey())), from: e.validFrom, until: e.validUntil, room: e.roomCode ?? "" });
  try {
    await sendEmail(to, m.subject, m.body);
    await db().query(`UPDATE access_cards SET sent_at=$3,send_error='' WHERE owner_id=$1 AND id=$2`, [ownerId, id, Date.now()]);
  } catch (err) {
    await db().query(`UPDATE access_cards SET send_error=$3 WHERE owner_id=$1 AND id=$2`, [ownerId, id, err instanceof Error ? err.message.slice(0, 200) : "SEND_FAILED"]);
    throw Error("SEND_FAILED");
  }
}

async function pushToWallets(ownerId: string, id: number) {
  const c = await cardConfig(ownerId);
  if (!googleReady(c.wallet, c.secrets)) return;
  const card = await passCard(ownerId, await rowById(ownerId, id), c.settings);
  await googleUpdate(c.wallet, c.secrets, card, String(env().BOOKING_ORIGIN)).catch((e) => console.error("Google Wallet update failed", e));
}

/** Reception edits a card: a new end (extended stay), start, areas or room. A booking card's end then stays as set. */
export async function updateCard(ownerId: string, id: number, x: { validFrom?: number; validUntil?: number; zones?: string[]; roomId?: number | null; holder?: string; followBooking?: boolean }): Promise<void> {
  const r = await rowById(ownerId, id), { settings } = await cardConfig(ownerId);
  if (r.status !== "active") throw Error("REVOKED");
  const e = effectiveCard(r, settings);
  const from = x.validFrom ?? e.validFrom, until = x.validUntil ?? e.validUntil;
  if (until <= from) throw Error("BAD_DATES");
  const known = new Set(settings.zones.map((z) => z.key));
  const locked = x.followBooking && r.kind === "booking" ? 0 : x.validFrom !== undefined || x.validUntil !== undefined ? 1 : Number(r.until_locked);
  await db().query(
    `UPDATE access_cards SET valid_from=$3,valid_until=$4,until_locked=$5,zones_json=$6,room_id=$7,holder_name=$8,updated_at=$9 WHERE owner_id=$1 AND id=$2`,
    [ownerId, id, from, until, locked, JSON.stringify(x.zones ? x.zones.filter((z) => known.has(z)) : (parse(r.zones_json) ?? [])), x.roomId === undefined ? r.room_id : x.roomId, (x.holder ?? String(r.holder_name)).slice(0, 120), Date.now()],
  );
  await pushToWallets(ownerId, id);
}

export async function revokeCard(ownerId: string, id: number, reason: string): Promise<void> {
  const r = await db().query(`UPDATE access_cards SET status='revoked',revoked_at=$3,revoked_reason=$4,updated_at=$3 WHERE owner_id=$1 AND id=$2 AND status='active'`, [ownerId, id, Date.now(), reason.slice(0, 200)]);
  if (!r.rowCount) throw Error("NOT_FOUND");
  await pushToWallets(ownerId, id);
}

async function passCard(ownerId: string, row: Record<string, unknown>, settings: CardSettings): Promise<PassCard> {
  const e = effectiveCard(row, settings), lang = cardLang(row.lang);
  const names = new Map(settings.zones.map((z) => [z.key, lang === "el" ? z.nameEl : z.nameEn]));
  const token = decryptField(String(row.token_encrypted), documentKey());
  return { serial: String(row.serial), credential: token, holder: String(row.holder_name), roomCode: e.roomCode, zones: ((parse(row.zones_json) as string[] | null) ?? []).filter((k) => names.has(k)).map((k) => ({ key: k, name: names.get(k)! })), validFrom: e.validFrom, validUntil: e.validUntil, revoked: e.status === "revoked", lang, webLink: cardLink(token) };
}

/** The guest's card page / wallet downloads: the card for a link token, or null. */
export async function cardForToken(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const row = (await db().query(`${CARD_SELECT} WHERE c.token_hash=$1`, [sha(token)])).rows[0];
  if (!row) return null;
  const c = await cardConfig(String(row.owner_id));
  const card = await passCard(String(row.owner_id), row, c.settings);
  return { card, state: cardState({ ...card, status: card.revoked ? "revoked" : "active" }, Date.now()), wallet: c.wallet, secrets: c.secrets, enabled: c.settings.enabled };
}

/**
 * A door reader / lock controller asks whether a credential (QR or NFC payload) may open a door or area. Answers and
 * logs; when the feature is switched off every answer is "no".
 */
export async function verifyAccess(ownerId: string, readerKey: string, x: { credential: string; zone: string; room?: string; reader?: string }) {
  const c = await cardConfig(ownerId);
  const given = Buffer.from(sha(readerKey)), stored = Buffer.from(c.readerKeyHash ?? "");
  if (!c.readerKeyHash || given.length !== stored.length || !timingSafeEqual(given, stored)) return null;
  const now = Date.now();
  const row = /^[A-Za-z0-9_-]{40,60}$/.test(x.credential) ? (await db().query(`${CARD_SELECT} WHERE c.owner_id=$1 AND c.token_hash=$2`, [ownerId, sha(x.credential)])).rows[0] : undefined;
  const e = row ? effectiveCard(row, c.settings) : null;
  const d = !c.settings.enabled ? { allow: false, reason: "DISABLED" } : accessDecision(e ? { ...e, zones: (parse(row!.zones_json) as string[] | null) ?? [] } : null, { zone: x.zone, room: x.room }, now);
  await db().query(`INSERT INTO access_card_events(owner_id,card_id,zone,room,allowed,reason,reader,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [ownerId, row ? row.id : null, x.zone.slice(0, 40), String(x.room ?? "").slice(0, 20), d.allow ? 1 : 0, d.reason, String(x.reader ?? "").slice(0, 60), now]);
  if (d.allow && row) await db().query(`UPDATE access_cards SET last_used_at=$2 WHERE id=$1`, [row.id, now]);
  return { ...d, holder: d.allow && row ? String(row.holder_name) : undefined, validUntil: d.allow && e ? e.validUntil : undefined };
}

export async function recentEvents(ownerId: string) {
  const r = await db().query(`SELECT e.*,c.holder_name,c.serial FROM access_card_events e LEFT JOIN access_cards c ON c.id=e.card_id WHERE e.owner_id=$1 ORDER BY e.id DESC LIMIT 50`, [ownerId]);
  return r.rows.map((x) => ({ id: Number(x.id), at: Number(x.created_at), zone: String(x.zone), room: String(x.room), allowed: Number(x.allowed) === 1, reason: String(x.reason), reader: String(x.reader), holder: x.holder_name ? String(x.holder_name) : "", serial: x.serial ? String(x.serial) : "" }));
}

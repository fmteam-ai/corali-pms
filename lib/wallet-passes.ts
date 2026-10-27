// Apple Wallet (.pkpass, signed with the hotel's Pass Type ID certificate) and Google Wallet ("Save to Google Wallet"
// link, signed with the hotel's service account) for the virtual access card. The card's credential is in the QR code
// and, when the hotel has Apple's NFC entitlement / Google Smart Tap, in the NFC payload; door readers check it at
// /api/access/verify, so a revoked or expired card stops opening doors even while it is still in a wallet.
import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SignJWT } from "jose";
import { cardTexts, cardLang } from "../scripts/access-card-core.mjs";
import { certificateDer, certificateMatchesKey, cmsSignDetached } from "@/lib/cms";
import { zipStore } from "@/lib/zip-store";

export type WalletConfig = { applePassTypeId: string; appleTeamId: string; appleNfcPublicKey: string; googleIssuerId: string; googleSmartTap: boolean };
export type WalletSecrets = { applePrivateKey?: string; appleCsr?: string; appleCert?: string; appleWwdr?: string; googleServiceAccount?: string };
export type PassCard = { serial: string; credential: string; holder: string; roomCode: string | null; zones: { key: string; name: string }[]; validFrom: number; validUntil: number; revoked: boolean; lang: string; webLink: string };

export const appleReady = (c: WalletConfig, s: WalletSecrets) => Boolean(c.applePassTypeId && c.appleTeamId && s.applePrivateKey && s.appleCert && s.appleWwdr);
export const googleReady = (c: WalletConfig, s: WalletSecrets) => Boolean(c.googleIssuerId && s.googleServiceAccount);

const label = (ms: number, lang: string) => new Intl.DateTimeFormat({ el: "el-GR", en: "en-GB", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" }[cardLang(lang)], { timeZone: "Europe/Athens", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));

async function publicFile(name: string) { return readFile(path.join(process.cwd(), "public", name)); }

/** The PMS-made key, Apple's Pass Type ID certificate for it and Apple's WWDR intermediate. */
function appleSigner(s: WalletSecrets) {
  if (!s.applePrivateKey || !s.appleCert || !s.appleWwdr) throw Error("APPLE_CERTIFICATE_INVALID");
  const key = createPrivateKey(s.applePrivateKey), cert = certificateDer(s.appleCert), wwdr = certificateDer(s.appleWwdr);
  try { new X509Certificate(cert); new X509Certificate(wwdr); } catch { throw Error("APPLE_CERTIFICATE_INVALID"); }
  if (!certificateMatchesKey(cert, key)) throw Error("APPLE_CERTIFICATE_MISMATCH");
  return { key, cert, wwdr };
}

/** Check the uploaded Apple certificate against the key (PMS settings). Returns the certificate's subject and expiry. */
export function describeAppleCertificate(s: WalletSecrets): { subject: string; expires: number } {
  const { cert } = appleSigner(s), x = new X509Certificate(cert);
  return { subject: (x.subject.match(/CN=([^\n]+)/)?.[1] ?? x.subject).trim(), expires: Date.parse(x.validTo) };
}

export async function applePass(c: WalletConfig, s: WalletSecrets, card: PassCard): Promise<Buffer> {
  const t = cardTexts[cardLang(card.lang)];
  const pass: Record<string, unknown> = {
    formatVersion: 1, passTypeIdentifier: c.applePassTypeId, teamIdentifier: c.appleTeamId, serialNumber: card.serial,
    organizationName: "Hotel Corali", description: `Hotel Corali · ${t.title}`, logoText: t.title,
    backgroundColor: "rgb(255,255,255)", foregroundColor: "rgb(23,62,71)", labelColor: "rgb(168,116,26)",
    generic: {
      primaryFields: [{ key: "guest", label: t.guest, value: card.holder }],
      secondaryFields: [...(card.roomCode ? [{ key: "room", label: t.room, value: card.roomCode }] : []), { key: "until", label: t.until, value: label(card.validUntil, card.lang) }],
      auxiliaryFields: [{ key: "from", label: t.from, value: label(card.validFrom, card.lang) }, ...(card.zones.length ? [{ key: "access", label: t.access, value: card.zones.map((z) => z.name).join(", ") }] : [])],
      backFields: [{ key: "hint", label: t.title, value: t.hint }, { key: "link", label: "Hotel Corali", value: card.webLink }],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: card.credential, messageEncoding: "iso-8859-1", altText: card.serial }],
    expirationDate: new Date(card.validUntil).toISOString(), relevantDate: new Date(card.validFrom).toISOString(),
    sharingProhibited: true,
  };
  if (card.revoked) pass.voided = true;
  // NFC needs Apple's NFC pass entitlement; its encryption key comes with it.
  if (c.appleNfcPublicKey) pass.nfc = { message: card.credential, encryptionPublicKey: c.appleNfcPublicKey, requiresAuthentication: false };
  const [logo, icon] = await Promise.all([publicFile("hotel-corali-logo.png"), publicFile("wallet-icon.png")]);
  const files: { name: string; data: Buffer }[] = [
    { name: "pass.json", data: Buffer.from(JSON.stringify(pass), "utf8") },
    { name: "logo.png", data: logo }, { name: "logo@2x.png", data: logo },
    { name: "icon.png", data: icon }, { name: "icon@2x.png", data: icon },
  ];
  const manifest = Buffer.from(JSON.stringify(Object.fromEntries(files.map((f) => [f.name, createHash("sha1").update(f.data).digest("hex")]))), "utf8");
  const { cert, key, wwdr } = appleSigner(s);
  const signature = cmsSignDetached(manifest, cert, [wwdr], key);
  return zipStore([...files, { name: "manifest.json", data: manifest }, { name: "signature", data: signature }]);
}

function serviceAccount(s: WalletSecrets): { client_email: string; private_key: string } {
  const a = JSON.parse(String(s.googleServiceAccount));
  if (!a.client_email || !a.private_key) throw Error("GOOGLE_SERVICE_ACCOUNT_INVALID");
  return a;
}

function googleObject(c: WalletConfig, card: PassCard, origin: string) {
  const t = cardTexts[cardLang(card.lang)], lang = cardLang(card.lang);
  const tv = (value: string) => ({ defaultValue: { language: lang, value } });
  return {
    id: `${c.googleIssuerId}.${card.serial}`, classId: `${c.googleIssuerId}.corali_access_card`,
    state: card.revoked ? "INACTIVE" : "ACTIVE",
    cardTitle: tv("Hotel Corali"), header: tv(card.holder), subheader: tv(t.title),
    logo: { sourceUri: { uri: `${origin}/hotel-corali-logo.png` } }, hexBackgroundColor: "#173e47",
    textModulesData: [...(card.roomCode ? [{ id: "room", header: t.room, body: card.roomCode }] : []), { id: "from", header: t.from, body: label(card.validFrom, card.lang) }, { id: "until", header: t.until, body: label(card.validUntil, card.lang) }, ...(card.zones.length ? [{ id: "access", header: t.access, body: card.zones.map((z) => z.name).join(", ") }] : [])],
    barcode: { type: "QR_CODE", value: card.credential, alternateText: card.serial },
    validTimeInterval: { start: { date: new Date(card.validFrom).toISOString() }, end: { date: new Date(card.validUntil).toISOString() } },
    ...(c.googleSmartTap ? { smartTapRedemptionValue: card.credential } : {}),
  };
}

/** "Save to Google Wallet" link (the class and the object travel inside the signed JWT). */
export async function googleSaveUrl(c: WalletConfig, s: WalletSecrets, card: PassCard, origin: string): Promise<string> {
  const a = serviceAccount(s), key = createPrivateKey(a.private_key);
  const jwt = await new SignJWT({
    origins: [origin], typ: "savetowallet",
    payload: { genericClasses: [{ id: `${c.googleIssuerId}.corali_access_card`, ...(c.googleSmartTap ? { enableSmartTap: true, redemptionIssuers: [c.googleIssuerId] } : {}) }], genericObjects: [googleObject(c, card, origin)] },
  }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(a.client_email).setAudience("google").setIssuedAt().sign(key);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

/** Push a change (new end time, cancellation) to a card already saved in Google Wallet. Best effort: a card never saved is a 404. */
export async function googleUpdate(c: WalletConfig, s: WalletSecrets, card: PassCard, origin: string): Promise<void> {
  const a = serviceAccount(s), key = createPrivateKey(a.private_key), now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/wallet_object.issuer" }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(a.client_email).setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now + 600).sign(key);
  const tok = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(10_000) });
  if (!tok.ok) throw Error(`GOOGLE_TOKEN_${tok.status}`);
  const { access_token } = await tok.json();
  const o = googleObject(c, card, origin);
  const r = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(o.id)}`, { method: "PATCH", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ state: o.state, validTimeInterval: o.validTimeInterval, textModulesData: o.textModulesData, header: o.header }), signal: AbortSignal.timeout(10_000) });
  if (!r.ok && r.status !== 404) throw Error(`GOOGLE_UPDATE_${r.status}`);
}

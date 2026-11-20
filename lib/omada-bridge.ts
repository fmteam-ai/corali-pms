// v179: the hotel's Omada bridge (a Raspberry Pi in the hotel network). The OC200's Open API is only reachable inside
// the hotel, so the bridge asks the PMS every minute what to do (GET /api/bridge/omada with its token), calls the
// controller and reports back (POST). The PMS chooses the passwords; the bridge never keeps any state of its own.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { documentKey } from "@/lib/env";
import { pushNotification } from "@/lib/pms-notifications";
import { providerCredentials } from "@/lib/provider-connections";
import { decryptField } from "@/lib/security/encryption";
import { bridgeWork } from "../scripts/omada-core.mjs";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new bridge token (the old one stops working). Shown once, inside the set-up file for the Raspberry Pi. */
export async function newBridgeToken(ownerId: string): Promise<string> {
  const token = `cb_${randomBytes(32).toString("base64url")}`;
  await db().query(
    `INSERT INTO omada_bridge(owner_id,token_hash,created_at,last_seen_at,last_report) VALUES($1,$2,$3,NULL,'')
     ON CONFLICT(owner_id) DO UPDATE SET token_hash=$2,created_at=$3,last_seen_at=NULL,last_report=''`,
    [ownerId, hash(token), Date.now()],
  );
  return token;
}

/** The owner of a bridge token, or null. */
export async function bridgeOwner(token: string): Promise<string | null> {
  if (!/^cb_[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const want = Buffer.from(hash(token));
  for (const r of (await db().query(`SELECT owner_id,token_hash FROM omada_bridge`)).rows) {
    const have = Buffer.from(String(r.token_hash));
    if (have.length === want.length && timingSafeEqual(have, want)) return String(r.owner_id);
  }
  return null;
}

export type BridgePlan = {
  omada: { url: string; omadacId: string; clientId: string; clientSecret: string; siteName: string; profile: string } | null;
  add: { bookingId: number; name: string; psk: string }[];
  remove: { bookingId: number; name: string }[];
};

/** What the bridge should do now (nothing when Omada is not set up / not active in PMS → Integrations). */
export async function bridgePlan(ownerId: string): Promise<BridgePlan> {
  await db().query(`UPDATE omada_bridge SET last_seen_at=$2 WHERE owner_id=$1`, [ownerId, Date.now()]);
  const c = await providerCredentials(ownerId, "omada");
  if (!c?.active) return { omada: null, add: [], remove: [] };
  const rows = (await db().query(`SELECT booking_id,psk_name,psk_encrypted,status FROM guest_wifi WHERE owner_id=$1 AND status IN ('pending','removing') ORDER BY created_at`, [ownerId])).rows;
  const work = bridgeWork(rows.map((r) => ({ booking_id: Number(r.booking_id), psk_name: String(r.psk_name), status: String(r.status) })));
  const psk = new Map(rows.map((r) => [Number(r.booking_id), String(r.psk_encrypted)]));
  const s = c.settings;
  return {
    omada: { url: s.interfaceUrl ?? "", omadacId: s.omadacId ?? "", clientId: c.secrets.clientId ?? "", clientSecret: c.secrets.clientSecret ?? "", siteName: s.siteName ?? "", profile: s.profile ?? "" },
    add: work.add.flatMap((a) => { try { return [{ ...a, psk: decryptField(psk.get(a.bookingId) ?? "", documentKey()) }]; } catch { return []; } }),
    remove: work.remove,
  };
}

export type BridgeResult = { bookingId: number; op: "add" | "remove"; ok: boolean; error?: string };

/** The bridge's report: added → active, removed → removed; a failure keeps the entry waiting and records why. */
export async function bridgeReport(ownerId: string, results: BridgeResult[], check: string): Promise<void> {
  const now = Date.now();
  for (const r of results.slice(0, 200)) {
    const error = String(r.error ?? "").replace(/[^A-Za-z0-9_ .:-]/g, "").slice(0, 120);
    if (r.op === "add") await db().query(`UPDATE guest_wifi SET status=CASE WHEN $3 THEN 'active' ELSE status END,error=$4 WHERE owner_id=$1 AND booking_id=$2 AND status='pending'`, [ownerId, r.bookingId, r.ok, r.ok ? "" : error]);
    else await db().query(`UPDATE guest_wifi SET status=CASE WHEN $3 THEN 'removed' ELSE status END,removed_at=CASE WHEN $3 THEN $5::bigint ELSE removed_at END,error=$4 WHERE owner_id=$1 AND booking_id=$2 AND status='removing'`, [ownerId, r.bookingId, r.ok, r.ok ? "" : error, now]);
  }
  const prev = (await db().query(`SELECT last_report FROM omada_bridge WHERE owner_id=$1`, [ownerId])).rows[0]?.last_report ?? "";
  const report = check.replace(/[^A-Za-z0-9_ .:,()-]/g, "").slice(0, 200);
  await db().query(`UPDATE omada_bridge SET last_seen_at=$2,last_report=$3 WHERE owner_id=$1`, [ownerId, now, report]);
  // A new controller problem is told once (not every minute).
  if (report && report !== "OK" && report !== prev) {
    await pushNotification(db(), ownerId, { kind: "system", titleEl: `📶 Γέφυρα Wi-Fi (Omada): ${report}`, titleEn: `📶 Wi-Fi bridge (Omada): ${report}`, link: "/pms/integrations" });
  }
}

/** For the PMS: is the bridge alive, what did it last say, how many passwords wait. */
export async function bridgeStatus(ownerId: string) {
  const b = (await db().query(`SELECT created_at,last_seen_at,last_report FROM omada_bridge WHERE owner_id=$1`, [ownerId])).rows[0];
  const waiting = Number((await db().query(`SELECT count(*)::int n FROM guest_wifi WHERE owner_id=$1 AND status IN ('pending','removing')`, [ownerId])).rows[0]?.n ?? 0);
  return { configured: Boolean(b), lastSeenAt: b?.last_seen_at ? Number(b.last_seen_at) : null, report: b ? String(b.last_report) : "", waiting };
}

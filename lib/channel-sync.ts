import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { documentKey, env } from "@/lib/env";
import { decryptField, encryptField } from "@/lib/security/encryption";
import { providerCredentials } from "@/lib/provider-connections";
import { addDays, hotelToday } from "@/lib/tape-chart";
import type { PoolClient } from "pg";
import { AVAILABILITY_SQL, CHANNEX_HOSTS, sellable } from "../scripts/channel-core.mjs";

type Queryable = Pick<PoolClient, "query">;

/**
 * Queue an availability push for [from, to) (inclusive of the last night). Called in the same transaction as any change
 * that affects sellable rooms, so a direct booking closes the inventory on the OTAs at the next sync run.
 */
export async function enqueueAvailability(client: Queryable, ownerId: string, from: string, to: string, reason: string) {
  if (!from || !to || to < from) return;
  const now = Date.now();
  await client.query(`INSERT INTO channel_sync_outbox(owner_id,date_from,date_to,reason,status,next_attempt_at,created_at,updated_at) VALUES($1,$2,$3,$4,'pending',0,$5,$5)`, [ownerId, from, to, reason.slice(0, 60), now]);
}

export async function channelStatus(ownerId: string) {
  const [types, mappings, outbox, imports, state] = await Promise.all([
    db().query(`SELECT room_type,count(*)::int AS rooms FROM rooms WHERE owner_id=$1 AND active=1 GROUP BY room_type ORDER BY room_type`, [ownerId]),
    db().query(`SELECT room_type,external_room_type_id,COALESCE(external_rate_plan_id,'') AS external_rate_plan_id FROM channel_room_mappings WHERE owner_id=$1`, [ownerId]),
    db().query(`SELECT status,count(*)::int AS total,max(updated_at) AS last,max(last_error) FILTER (WHERE status='failed') AS error FROM channel_sync_outbox WHERE owner_id=$1 GROUP BY status`, [ownerId]),
    db().query(`SELECT revision_id,status,booking_ids,error,created_at FROM channel_import_log WHERE owner_id=$1 ORDER BY id DESC LIMIT 20`, [ownerId]),
    db().query(`SELECT last_run_at,last_ok_at,last_error FROM channel_sync_state WHERE owner_id=$1`, [ownerId]),
  ]);
  const st = state.rows[0];
  const webhook = await channexWebhookInfo(ownerId);
  return { webhook, roomTypes: types.rows, mappings: mappings.rows, outbox: outbox.rows, imports: imports.rows, lastRun: st ? { at: st.last_run_at === null ? null : Number(st.last_run_at), okAt: st.last_ok_at === null ? null : Number(st.last_ok_at), error: st.last_error as string | null } : null };
}


export type CheckItem = { key: string; ok: boolean | null; detail: string };

/**
 * Connection check (read-only, nothing is changed in Channex): key and property reachable, every PMS room type mapped
 * to a Channex room type of this property, Channex room counts, the availability Channex holds for the next 14 days
 * compared with what the PMS would send, and how many OTA revisions wait in the feed.
 */
export async function checkChannelConnection(ownerId: string): Promise<{ items: CheckItem[]; channexRoomTypes: { id: string; title: string; rooms: number }[]; channexRatePlans: { id: string; title: string; roomTypeId: string }[] }> {
  const items: CheckItem[] = [];
  const add = (key: string, ok: boolean | null, detail: string) => items.push({ key, ok, detail });
  const c = await providerCredentials(ownerId, "channelManager").catch(() => null);
  if (!c || !c.secrets.apiKey || !c.settings.propertyCode) { add("config", false, "Δεν έχουν οριστεί API key και property id (Συνδέσεις → Channel Manager)."); return { items, channexRoomTypes: [], channexRatePlans: [] }; }
  add("config", c.active ? true : null, c.active ? "Ρυθμίσεις: ενεργός πάροχος." : "Ρυθμίσεις υπάρχουν, αλλά ο πάροχος είναι ανενεργός (ο συγχρονισμός δεν τρέχει).");
  const host = process.env.CHANNEX_BASE_URL || CHANNEX_HOSTS[c.settings.environment === "staging" ? "staging" : "production"];
  const property = c.settings.propertyCode;
  const api = async (path: string) => {
    const r = await fetch(`${host}/api/v1${path}`, { headers: { "user-api-key": c.secrets.apiKey }, signal: AbortSignal.timeout(20_000) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${String(body?.errors?.title ?? "")}`.trim());
    return body;
  };
  let remote: { id: string; title: string; rooms: number }[] = [];
  try {
    const rt = await api(`/room_types?filter[property_id]=${encodeURIComponent(property)}`);
    remote = (rt.data ?? []).map((x: { id: string; attributes?: { title?: string; count_of_rooms?: number } }) => ({ id: String(x.id), title: String(x.attributes?.title ?? ""), rooms: Number(x.attributes?.count_of_rooms ?? 0) }));
    add("api", true, `Σύνδεση με ${host}: OK · ${remote.length} τύποι δωματίων στο Channex.`);
  } catch (e) {
    add("api", false, `Σύνδεση με ${host} απέτυχε: ${e instanceof Error ? e.message : e} (ελέγξτε API key, property id και environment).`);
    return { items, channexRoomTypes: [], channexRatePlans: [] };
  }
  const [types, mappings] = await Promise.all([
    db().query(`SELECT room_type,count(*)::int AS rooms FROM rooms WHERE owner_id=$1 AND active=1 GROUP BY room_type ORDER BY room_type`, [ownerId]),
    db().query(`SELECT room_type,external_room_type_id,external_rate_plan_id FROM channel_room_mappings WHERE owner_id=$1`, [ownerId]),
  ]);
  let plans: { id: string; title: string; roomTypeId: string }[] = [];
  try {
    const rp = await api(`/rate_plans?filter[property_id]=${encodeURIComponent(property)}`);
    plans = (rp.data ?? []).map((x: { id: string; attributes?: { title?: string; room_type_id?: string } }) => ({ id: String(x.id), title: String(x.attributes?.title ?? ""), roomTypeId: String(x.attributes?.room_type_id ?? "") }));
  } catch (e) {
    add("rate_plans", null, `Δεν διαβάστηκαν τα rate plans: ${e instanceof Error ? e.message : e}`);
  }
  for (const t of types.rows) {
    const m = mappings.rows.find((x) => x.room_type === t.room_type);
    const r = m && remote.find((x) => x.id === m.external_room_type_id);
    if (!m) add(`map:${t.room_type}`, false, `Ο τύπος «${t.room_type}» δεν έχει αντιστοίχιση — δεν πωλείται στα OTA.`);
    else if (!r) add(`map:${t.room_type}`, false, `Ο τύπος «${t.room_type}» δείχνει σε ID που δεν υπάρχει σε αυτό το property του Channex.`);
    else add(`map:${t.room_type}`, r.rooms === Number(t.rooms) ? true : null, `«${t.room_type}» → «${r.title}»${r.rooms === Number(t.rooms) ? "" : ` · Channex: ${r.rooms} δωμάτια, PMS: ${t.rooms} (ενημερώστε το count of rooms στο Channex)`}`);
    if (m && r) {
      const plan = m.external_rate_plan_id && plans.find((p) => p.id === m.external_rate_plan_id);
      if (!m.external_rate_plan_id) add(`plan:${t.room_type}`, null, `«${t.room_type}»: δεν έχει οριστεί rate plan — min stay / stop sell δεν στέλνονται.`);
      else if (!plan || plan.roomTypeId !== m.external_room_type_id) add(`plan:${t.room_type}`, false, `«${t.room_type}»: το rate plan δεν ανήκει σε αυτόν τον τύπο δωματίου του Channex.`);
      else add(`plan:${t.room_type}`, true, `«${t.room_type}»: περιορισμοί → rate plan «${plan.title}».`);
    }
  }
  // Read-back: what Channex holds now against what the PMS would send (next 14 days).
  const today = hotelToday(), end = addDays(today, 13);
  try {
    const [held, local] = await Promise.all([
      api(`/availability?filter[property_id]=${encodeURIComponent(property)}&filter[date][gte]=${today}&filter[date][lte]=${end}`),
      db().query(AVAILABILITY_SQL, [ownerId, today, end, Date.now()]),
    ]);
    const diffs: string[] = [];
    for (const m of mappings.rows) {
      const remoteDays = (held.data ?? {})[m.external_room_type_id] ?? {};
      for (const row of local.rows.filter((x) => x.room_type === m.room_type)) {
        const want = sellable(row.free), have = remoteDays[row.date];
        if (Number(have) !== want) diffs.push(`${m.room_type} ${row.date}: Channex ${have ?? "—"}, PMS ${want}`);
      }
    }
    add("readback", diffs.length === 0, diffs.length ? `Διαφορές διαθεσιμότητας (14 ημέρες): ${diffs.slice(0, 6).join(" · ")}${diffs.length > 6 ? ` · +${diffs.length - 6}` : ""}. Πατήστε «Πλήρης συγχρονισμός».` : "Η διαθεσιμότητα στο Channex ταιριάζει με το PMS για τις επόμενες 14 ημέρες.");
  } catch (e) {
    add("readback", null, `Δεν διαβάστηκε η διαθεσιμότητα από το Channex: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const feed = await api(`/booking_revisions/feed?filter[property_id]=${encodeURIComponent(property)}`);
    const waiting = Number(feed.meta?.total ?? (feed.data ?? []).length);
    add("feed", waiting === 0 ? true : null, waiting === 0 ? "Δεν περιμένουν κρατήσεις OTA για εισαγωγή." : `${waiting} κρατήσεις/αλλαγές OTA περιμένουν εισαγωγή (εισάγονται στην επόμενη εκτέλεση· μετά από ~30′ χάνονται από τη ροή).`);
  } catch (e) {
    add("feed", false, `Η ροή κρατήσεων δεν διαβάστηκε: ${e instanceof Error ? e.message : e}`);
  }
  const st = (await db().query(`SELECT last_run_at,last_ok_at,last_error FROM channel_sync_state WHERE owner_id=$1`, [ownerId])).rows[0];
  const age = st?.last_ok_at ? Math.round((Date.now() - Number(st.last_ok_at)) / 60_000) : null;
  add("cron", age !== null && age <= 10, age === null ? "Ο συγχρονισμός (cron run-channel-sync.mjs) δεν έχει τρέξει ακόμη επιτυχώς." : `Τελευταία επιτυχής εκτέλεση πριν ${age}′${age > 10 ? " — ελέγξτε το cron (πρέπει να τρέχει κάθε λεπτό)" : ""}.${st?.last_error ? ` Τελευταίο σφάλμα: ${String(st.last_error).slice(0, 160)}` : ""}`);
  return { items, channexRoomTypes: remote, channexRatePlans: plans };
}

// ── Channex webhook ─────────────────────────────────────────────────────────────────────────────────────────────
// Channex calls this link on booking events; the PMS then runs the channel sync at once instead of waiting for the
// next cron minute. The secret token is made by the PMS (only its hash is compared).

const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");
export const channexWebhookUrl = (token: string) => `${env().BOOKING_ORIGIN}/api/webhooks/channex?token=${token}`;

export async function newChannexWebhook(ownerId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db().query(`INSERT INTO channel_sync_state(owner_id,webhook_token_hash,webhook_token_encrypted) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET webhook_token_hash=$2,webhook_token_encrypted=$3`, [ownerId, tokenHash(token), encryptField(token, documentKey())]);
  return channexWebhookUrl(token);
}

export async function channexWebhookInfo(ownerId: string): Promise<{ url: string | null; lastAt: number | null }> {
  const r = (await db().query(`SELECT webhook_token_encrypted,last_webhook_at FROM channel_sync_state WHERE owner_id=$1`, [ownerId])).rows[0];
  let url: string | null = null;
  try { url = r?.webhook_token_encrypted ? channexWebhookUrl(decryptField(String(r.webhook_token_encrypted), documentKey())) : null; } catch { url = null; }
  return { url, lastAt: r?.last_webhook_at ? Number(r.last_webhook_at) : null };
}

/** True when the token matches (and records the call). */
export async function acceptChannexWebhook(ownerId: string, token: string): Promise<boolean> {
  const r = (await db().query(`SELECT webhook_token_hash FROM channel_sync_state WHERE owner_id=$1`, [ownerId])).rows[0];
  const stored = Buffer.from(String(r?.webhook_token_hash ?? "")), given = Buffer.from(tokenHash(token));
  if (!r?.webhook_token_hash || stored.length !== given.length || !timingSafeEqual(stored, given)) return false;
  await db().query(`UPDATE channel_sync_state SET last_webhook_at=$2 WHERE owner_id=$1`, [ownerId, Date.now()]);
  return true;
}

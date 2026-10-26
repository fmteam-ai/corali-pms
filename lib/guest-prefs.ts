// Structured guest preferences in the database (see lib/guest-prefs-core).
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { mergePrefs, normalizePrefs, type GuestPrefs } from "@/lib/guest-prefs-core";

type Q = Pick<PoolClient, "query">;
export type GuestPrefRecord = { prefs: GuestPrefs; dietary: string; allergies: string };

/** Preferences for several guests at once, by e-mail (lower case). */
export async function prefsByEmail(ownerId: string, emails: string[]): Promise<Map<string, GuestPrefRecord>> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, GuestPrefRecord>();
  if (!list.length) return out;
  const r = await db().query(`SELECT email,prefs_json,COALESCE(dietary,'') dietary,COALESCE(allergies,'') allergies FROM guest_preferences WHERE owner_id=$1 AND email=ANY($2::text[])`, [ownerId, list]);
  for (const x of r.rows) out.set(String(x.email), { prefs: normalizePrefs(x.prefs_json), dietary: String(x.dietary), allergies: String(x.allergies) });
  return out;
}

/** Add what we learned (TV request, check-in) without erasing what staff or the guest set before. */
export async function capturePrefs(q: Q, ownerId: string, email: string, add: Partial<GuestPrefs>, by: string, text: { dietary?: string; allergies?: string } = {}): Promise<void> {
  const key = email.trim().toLowerCase();
  if (!key) return;
  const cur = (await q.query(`SELECT prefs_json FROM guest_preferences WHERE owner_id=$1 AND email=$2 FOR UPDATE`, [ownerId, key])).rows[0];
  const next = JSON.stringify(mergePrefs(normalizePrefs(cur?.prefs_json), add));
  const dietary = text.dietary?.trim().slice(0, 500) || null, allergies = text.allergies?.trim().slice(0, 500) || null;
  await q.query(
    `INSERT INTO guest_preferences(owner_id,email,preferences,dietary,allergies,tags,prefs_json,updated_by,updated_at) VALUES($1,$2,'',COALESCE($4,''),COALESCE($5,''),'',$3,$6,$7)
     ON CONFLICT(owner_id,email) DO UPDATE SET prefs_json=$3,dietary=COALESCE($4,guest_preferences.dietary),allergies=COALESCE($5,guest_preferences.allergies),updated_by=$6,updated_at=$7`,
    [ownerId, key, next, dietary, allergies, by, Date.now()],
  );
}

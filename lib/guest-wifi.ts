// v177: the stay's own Wi-Fi password (TP-Link Omada PPSK, created by the automation cron at check-in).
import { db } from "@/lib/db";
import { documentKey } from "@/lib/env";
import { decryptField } from "@/lib/security/encryption";

/** SSID and password of the booking while its password is active, else null (the hotel's general Wi-Fi is shown). */
export async function guestWifiFor(ownerId: string, bookingId: number): Promise<{ ssid: string; password: string } | null> {
  const r = (await db().query(`SELECT ssid,psk_encrypted FROM guest_wifi WHERE owner_id=$1 AND booking_id=$2 AND status='active'`, [ownerId, bookingId])).rows[0];
  if (!r?.psk_encrypted || !r.ssid) return null;
  try { return { ssid: String(r.ssid), password: decryptField(String(r.psk_encrypted), documentKey()) }; } catch { return null; }
}

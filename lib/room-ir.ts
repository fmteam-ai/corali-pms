// v170: room IR hubs (Tuya IR Control Hub Open Service): A/C and TV by infrared through the hotel's Tuya connection.
// IR is one-way — the PMS shows «sent» (Tuya accepted it and the hub transmitted), never «done»; the room's temperature
// sensor (and Corali TV for the TV) tell whether the appliance reacted.
import { db } from "@/lib/db";
import { documentKey } from "@/lib/env";
import { decryptField, encryptField } from "@/lib/security/encryption";
import { irOnTemp, normalizeIrSettings, normalizePowerSettings, type IrSettings } from "../scripts/tv-power-core.mjs";
import { cachedToken, tuyaCreds } from "../scripts/room-ac-worker.mjs";
import { agentState } from "../scripts/tv-command-core.mjs";
import { irAcPower, irAcScene, irPowerKey, irRemotes, irSendKey, type IrKey } from "../scripts/tuya-core.mjs";

export type { IrSettings };
export type IrRoom = { roomId: number; hubId: string; acRemoteId: string; tvRemoteId: string; lastAc: string; lastAcAt: number | null; lastAcError: string; lastTvAt: number | null; lastTvError: string };

const parse = (v: unknown) => { try { return JSON.parse(String(v)); } catch { return null; } };

async function settingsRow(ownerId: string): Promise<Record<string, unknown>> {
  const r = (await db().query(`SELECT settings_json FROM tv_power_settings WHERE owner_id=$1`, [ownerId])).rows[0];
  return (parse(r?.settings_json) as Record<string, unknown>) ?? {};
}

export async function irSettings(ownerId: string): Promise<IrSettings> {
  return normalizePowerSettings(await settingsRow(ownerId)).ir;
}

export async function saveIrSettings(ownerId: string, userId: number, raw: unknown): Promise<void> {
  const next = { ...normalizePowerSettings(await settingsRow(ownerId)), ir: normalizeIrSettings(raw) };
  await db().query(
    `INSERT INTO tv_power_settings(owner_id,settings_json,auth_key_encrypted,updated_by,updated_at) VALUES($1,$2,'',$3,$4)
     ON CONFLICT(owner_id) DO UPDATE SET settings_json=$2,updated_by=$3,updated_at=$4`,
    [ownerId, JSON.stringify(next), userId, Date.now()],
  );
}

export async function irRooms(ownerId: string): Promise<IrRoom[]> {
  const rows = (await db().query(`SELECT * FROM room_ir WHERE owner_id=$1 ORDER BY room_id`, [ownerId])).rows;
  return rows.map((x) => ({
    roomId: Number(x.room_id), hubId: String(x.hub_id), acRemoteId: String(x.ac_remote_id), tvRemoteId: String(x.tv_remote_id),
    lastAc: String(x.last_ac), lastAcAt: x.last_ac_at ? Number(x.last_ac_at) : null, lastAcError: String(x.last_ac_error),
    lastTvAt: x.last_tv_at ? Number(x.last_tv_at) : null, lastTvError: String(x.last_tv_error),
  }));
}

/** Link a room's IR hub and remotes (all empty removes it). */
export async function setIrRoom(ownerId: string, roomId: number, x: { hubId: string; acRemoteId: string; tvRemoteId: string }): Promise<void> {
  if (!x.hubId && !x.acRemoteId && !x.tvRemoteId) { await db().query(`DELETE FROM room_ir WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId]); return; }
  await db().query(
    `INSERT INTO room_ir(owner_id,room_id,hub_id,ac_remote_id,tv_remote_id,updated_at) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(owner_id,room_id) DO UPDATE SET hub_id=$3,ac_remote_id=$4,
       tv_key_json=CASE WHEN room_ir.tv_remote_id=$5 AND room_ir.hub_id=$3 THEN room_ir.tv_key_json END,tv_remote_id=$5,updated_at=$6`,
    [ownerId, roomId, x.hubId, x.acRemoteId, x.tvRemoteId, Date.now()],
  );
}

async function tuya(ownerId: string) {
  const key = documentKey();
  const unseal = (v: string) => decryptField(v, key), seal = (v: string) => encryptField(v, key);
  const creds = await tuyaCreds(db(), ownerId, unseal);
  if (!creds) return null;
  return { creds, token: async () => cachedToken(db(), ownerId, creds, seal, unseal), dropToken: () => db().query(`DELETE FROM provider_tokens WHERE owner_id=$1 AND provider_key='tuya'`, [ownerId]) };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "TUYA_FAILED").slice(0, 200);

/** Remotes stored under a hub (for the set-up: pick the A/C and the TV). */
export async function listIrRemotes(ownerId: string, hubId: string): Promise<{ remotes: Array<{ id: string; name: string; category: number | null }>; error: string }> {
  const t = await tuya(ownerId);
  if (!t) return { remotes: [], error: "TUYA_NOT_SET_UP" };
  try {
    const list = await irRemotes(fetch, t.creds.host, t.creds, await t.token(), hubId);
    return { remotes: list.map((r) => ({ id: String(r.remote_id ?? ""), name: String(r.remote_name ?? ""), category: r.category_id === undefined ? null : Number(r.category_id) })).filter((r) => r.id), error: "" };
  } catch (e) {
    return { remotes: [], error: errText(e) };
  }
}

/** A/C by IR: on = the hotel's mode / temperature / fan (or the given ones), off = power off. Returns "" or the error. */
export async function irAc(ownerId: string, roomId: number, on: boolean, why: string, scene?: Partial<IrSettings>): Promise<string> {
  const room = (await db().query(`SELECT hub_id,ac_remote_id FROM room_ir WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0];
  if (!room?.hub_id || !room?.ac_remote_id) return "NO_IR_AC";
  const t = await tuya(ownerId);
  if (!t) return "TUYA_NOT_SET_UP";
  const base = await irSettings(ownerId);
  const s = { ...base, temp: irOnTemp(base), ...(scene ?? {}) };
  const label = on ? `on ${s.temp}° m${s.mode} w${s.wind} (${why})` : `off (${why})`;
  let error = "";
  try {
    const token = await t.token();
    if (on) await irAcScene(fetch, t.creds.host, t.creds, token, String(room.hub_id), String(room.ac_remote_id), { power: true, mode: s.mode, temp: s.temp, wind: s.wind });
    else await irAcPower(fetch, t.creds.host, t.creds, token, String(room.hub_id), String(room.ac_remote_id), false);
  } catch (e) {
    error = errText(e);
    if (/TUYA_(1010|1011)/.test(error)) await t.dropToken(); // token expired / invalid: a new one next time
  }
  await db().query(`UPDATE room_ir SET last_ac=$3,last_ac_at=$4,last_ac_error=$5 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, label.slice(0, 120), Date.now(), error]);
  return error;
}

/**
 * The TV's Power key by IR, only to turn ON a TV that does not answer (fully off, e.g. after a power cut). The key
 * toggles, and on the HORIZON «off» opens a confirmation dialog that needs OK, so a TV whose Corali TV app answers is
 * refused: on / off for it go through the app (TV_ANSWERS).
 */
export async function irTvPower(ownerId: string, roomId: number): Promise<string> {
  const scr = (await db().query(`SELECT screen_seen_at,screen_interactive FROM tv_screens WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0];
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  if (scr && !["offline", "unknown"].includes(agentState(num(scr.screen_seen_at), num(scr.screen_interactive), Date.now()))) return "TV_ANSWERS";
  const room = (await db().query(`SELECT hub_id,tv_remote_id,tv_key_json FROM room_ir WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId])).rows[0];
  if (!room?.hub_id || !room?.tv_remote_id) return "NO_IR_TV";
  const t = await tuya(ownerId);
  if (!t) return "TUYA_NOT_SET_UP";
  let error = "";
  try {
    const token = await t.token();
    let key = parse(room.tv_key_json) as IrKey | null;
    if (!key) {
      key = await irPowerKey(fetch, t.creds.host, t.creds, token, String(room.hub_id), String(room.tv_remote_id));
      if (!key) throw Error("NO_POWER_KEY");
      await db().query(`UPDATE room_ir SET tv_key_json=$3 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, JSON.stringify(key)]);
    }
    await irSendKey(fetch, t.creds.host, t.creds, token, String(room.hub_id), String(room.tv_remote_id), key);
  } catch (e) {
    error = errText(e);
    if (/TUYA_(1010|1011)/.test(error)) await t.dropToken();
  }
  await db().query(`UPDATE room_ir SET last_tv_at=$3,last_tv_error=$4 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId, Date.now(), error]);
  return error;
}

/** Check-in → A/C on (hotel settings), check-out → A/C off; only rooms with an IR A/C and the automatic rule on. */
export async function irAutoOnStay(ownerId: string, roomId: number, checkedIn: boolean): Promise<void> {
  await db().query(`UPDATE room_ir SET limit_at=NULL,limit_count=0 WHERE owner_id=$1 AND room_id=$2`, [ownerId, roomId]); // a new stay: the limit starts again
  if (!(await irSettings(ownerId)).auto) return;
  const e = await irAc(ownerId, roomId, checkedIn, checkedIn ? "check-in" : "check-out");
  if (e && e !== "NO_IR_AC") console.error("IR A/C on stay change failed", roomId, e);
}

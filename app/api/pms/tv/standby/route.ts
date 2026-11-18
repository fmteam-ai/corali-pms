import { z } from "zod";
import { audited } from "@/lib/audit";
import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertTrustedOrigin } from "@/lib/security/origin";
import { latestCommands, queueCommand } from "@/lib/tv-commands";
import { powerState, standbyVerdict } from "../../../../../scripts/tv-command-core.mjs";

/** Corali TV 1.15 (versionCode 16): Network Standby Manager, diagnostics, sleep-key OFF, verified wake. */
const STANDBY_APP = 16;
const TEST_MINUTES = [10, 60, 720] as const;

const input = z.discriminatedUnion("action", [
  // Admin: per room — keep CPU / Wi-Fi awake in standby; how PMS OFF is done (lockNow stays the default).
  z.object({ action: z.literal("settings"), roomId: z.number().int().positive(), networkStandby: z.boolean(), offMode: z.enum(["device_admin", "sleep_key"]) }),
  // Reception+: ask the TV for its power / network diagnostics (answer within ~20 s if it is reachable).
  z.object({ action: z.literal("diagnostics"), roomId: z.number().int().positive() }),
  // Admin: standby test — OFF now, ON after N minutes; the PMS records whether the TV stayed reachable and woke up.
  z.object({ action: z.literal("start_test"), roomId: z.number().int().positive(), minutes: z.union([z.literal(10), z.literal(60), z.literal(720)]) }),
]);

async function overview(ownerId: string) {
  const now = Date.now();
  const commands = await latestCommands(ownerId);
  const screens = (await db().query(
    `SELECT s.room_id,r.code,s.app_version,s.screen_seen_at,s.screen_interactive,s.network_standby,s.power_off_mode,s.standby_diag,s.app_admin,
            COALESCE(s.power_method, CASE WHEN s.power_device_id<>'' THEN 'shelly' ELSE 'manual' END) AS method
       FROM tv_screens s JOIN rooms r ON r.id=s.room_id AND r.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.active=1 AND r.active=1 ORDER BY r.code`,
    [ownerId],
  )).rows;
  const failed = new Map((await db().query(
    `SELECT DISTINCT ON (room_id) room_id,finished_at FROM tv_screen_commands WHERE owner_id=$1 AND command IN ('SCREEN_ON','SCREEN_OFF') AND status IN ('FAILED','TIMEOUT') ORDER BY room_id,id DESC`, [ownerId],
  )).rows.map((x) => [Number(x.room_id), Number(x.finished_at)]));
  const events = (await db().query(`SELECT room_id,at,kind,detail FROM (SELECT *,row_number() OVER (PARTITION BY room_id ORDER BY id DESC) n FROM tv_power_events WHERE owner_id=$1) e WHERE n<=12 ORDER BY id DESC`, [ownerId])).rows;
  const diag = new Map((await db().query(
    `SELECT DISTINCT ON (room_id) room_id,status,result_text,finished_at,created_at FROM tv_screen_commands WHERE owner_id=$1 AND command='NETWORK_DIAGNOSTICS' ORDER BY room_id,id DESC`, [ownerId],
  )).rows.map((x) => [Number(x.room_id), { status: String(x.status), text: String(x.result_text ?? ""), at: Number(x.finished_at ?? x.created_at) }]));
  const testRows = (await db().query(`SELECT * FROM tv_power_tests WHERE owner_id=$1 ORDER BY id DESC LIMIT 30`, [ownerId])).rows;
  const ids = testRows.flatMap((t) => [t.off_command_id, t.on_command_id]).filter((x) => x !== null).map(Number);
  const cmds = new Map(ids.length ? (await db().query(`SELECT id,status,error,not_before,delivered_at,finished_at,result_text FROM tv_screen_commands WHERE owner_id=$1 AND id=ANY($2::bigint[])`, [ownerId, ids])).rows.map((c) => [Number(c.id), c]) : []);
  const tests = testRows.map((t) => {
    const off = cmds.get(Number(t.off_command_id)) ?? null, on = cmds.get(Number(t.on_command_id)) ?? null;
    return { id: Number(t.id), room_id: Number(t.room_id), minutes: Number(t.minutes), started_at: Number(t.started_at),
      verdict: standbyVerdict(t, off ? { status: String(off.status) } : null, on ? { status: String(on.status), not_before: on.not_before === null ? null : Number(on.not_before) } : null, now),
      off: off ? { status: String(off.status), error: String(off.error ?? ""), detail: String(off.result_text ?? "") } : null,
      on: on ? { status: String(on.status), error: String(on.error ?? ""), detail: String(on.result_text ?? ""), due: on.not_before === null ? null : Number(on.not_before), at: on.finished_at === null ? null : Number(on.finished_at) } : null };
  });
  return {
    now, standbyApp: STANDBY_APP,
    rooms: screens.map((x) => {
      const roomId = Number(x.room_id), c = commands[roomId];
      const waking = Boolean(c && c.command === "SCREEN_ON" && (c.status === "DELIVERED" || (c.status === "PENDING" && (c.not_before ?? 0) <= now)));
      const p = powerState({ seenAt: x.screen_seen_at === null ? null : Number(x.screen_seen_at), interactive: x.screen_interactive === null ? null : Number(x.screen_interactive), now, waking, lastFailedAt: failed.get(roomId) ?? null });
      let standby = null;
      try { standby = x.standby_diag ? JSON.parse(String(x.standby_diag)) : null; } catch { standby = null; }
      return {
        room_id: roomId, room_code: String(x.code), method: String(x.method), app_version: x.app_version === null ? null : Number(x.app_version), screen_off_permission: x.app_admin === null ? null : Number(x.app_admin) === 1,
        power_state: p.state, reachable: p.reachable, last_heartbeat: x.screen_seen_at === null ? null : Number(x.screen_seen_at),
        network_standby: Number(x.network_standby) !== 0, off_mode: String(x.power_off_mode), standby, last_command: c ?? null, diagnostics: diag.get(roomId) ?? null,
        events: events.filter((e) => Number(e.room_id) === roomId).map((e) => ({ at: Number(e.at), kind: String(e.kind), detail: e.detail })),
      };
    }),
    tests,
  };
}

export async function GET() {
  const u = await requireApiUser("reservations.read");
  if (u instanceof Response) return u;
  return Response.json({ ok: true, ...(await overview(u.ownerId)) }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const x = parsed.data;
  const u = await requireApiUser(x.action === "diagnostics" ? "reservations.write" : "integrations.write");
  if (u instanceof Response) return u;
  try { assertTrustedOrigin(request); } catch { return Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }); }
  const screen = (await db().query(`SELECT app_version,COALESCE(power_method,'manual') AS method FROM tv_screens WHERE owner_id=$1 AND room_id=$2 AND active=1`, [u.ownerId, x.roomId])).rows[0];
  if (!screen) return Response.json({ ok: false, error: "NO_SCREEN" }, { status: 404 });
  if (x.action === "settings") {
    await db().query(`UPDATE tv_screens SET network_standby=$3,power_off_mode=$4 WHERE owner_id=$1 AND room_id=$2`, [u.ownerId, x.roomId, x.networkStandby ? 1 : 0, x.offMode]);
    return Response.json({ ok: true, ...(await overview(u.ownerId)) });
  }
  if (screen.app_version === null || Number(screen.app_version) < STANDBY_APP) return Response.json({ ok: false, error: "APP_TOO_OLD" }, { status: 409 });
  if (x.action === "diagnostics") {
    await queueCommand(u.ownerId, x.roomId, "NETWORK_DIAGNOSTICS", "manual", u.id, null, { ttlMs: 2 * 60_000 });
    return Response.json({ ok: true, ...(await overview(u.ownerId)) });
  }
  // Standby test: only for rooms whose screen the app switches («android_agent»); one test at a time per room.
  if (String(screen.method) !== "android_agent") return Response.json({ ok: false, error: "NOT_ANDROID_AGENT" }, { status: 409 });
  if (!TEST_MINUTES.includes(x.minutes)) return Response.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  const now = Date.now();
  const off = await queueCommand(u.ownerId, x.roomId, "SCREEN_OFF", "manual", u.id, null, { ttlMs: 2 * 60_000 });
  // ON is handed over only after the wait, at the app's first check from then on; if the app never checks in within
  // 15 minutes (TV / Wi-Fi asleep), it ends as TIMEOUT → «unreachable in standby». Never executed later by surprise.
  const on = await queueCommand(u.ownerId, x.roomId, "SCREEN_ON", "manual", u.id, null, { supersede: false, notBefore: now + x.minutes * 60_000, ttlMs: 15 * 60_000 });
  await db().query(`INSERT INTO tv_power_tests(owner_id,room_id,minutes,started_at,off_command_id,on_command_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`, [u.ownerId, x.roomId, x.minutes, now, off?.id ?? null, on?.id ?? null, u.id]);
  return Response.json({ ok: true, ...(await overview(u.ownerId)) });
}

export const POST = audited("tv_standby", handlePOST);

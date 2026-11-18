// Corali TV screen commands (PMS → Android agent), pure and unit tested. A command is created by staff or by the
// automatic arrival / check-out rule, delivered once to the room's app on its next check (every ~20 s), and is only
// EXECUTED when the app reports back that the screen really changed (PowerManager.isInteractive()). The HTTP answer
// alone never counts as success.

export const SCREEN_COMMANDS = ["SCREEN_ON", "SCREEN_OFF", "SHOW_WELCOME"];
/** v159: sound, through Android AudioManager (STREAM_MUSIC) in the Corali TV app ≥ 1.9. */
export const VOLUME_COMMANDS = ["SET_VOLUME", "VOLUME_UP", "VOLUME_DOWN", "MUTE", "UNMUTE"];
/** v163: open the TV maker's Factory Menu for a technician in the room (owner only). Changes no setting by itself. */
export const FACTORY_COMMANDS = ["OPEN_FACTORY_MENU"];
/** v164: the app reports its power / network diagnostics (Corali TV ≥ 1.15). */
export const DIAG_COMMANDS = ["NETWORK_DIAGNOSTICS"];
export const ALL_COMMANDS = [...SCREEN_COMMANDS, ...VOLUME_COMMANDS, ...FACTORY_COMMANDS, ...DIAG_COMMANDS];
/** A volume read back within this many percentage points of the target counts as applied (Android volume steps). */
export const VOLUME_TOLERANCE = 7;
export const COMMAND_STATUSES = ["PENDING", "DELIVERED", "EXECUTED", "FAILED", "TIMEOUT", "UNVERIFIED", "CANCELLED"];
export const FINAL_STATUSES = ["EXECUTED", "FAILED", "TIMEOUT", "UNVERIFIED", "CANCELLED"];
/** Not delivered within this time (TV asleep / offline): TIMEOUT — never executed later by surprise. */
export const COMMAND_TTL_MS = 5 * 60_000;
/** Delivered but no report from the app within this time: UNVERIFIED. */
export const ACK_TIMEOUT_MS = 2 * 60_000;
/** The app checks every 20 s: no check for this long means it is not reachable now. */
export const AGENT_ONLINE_MS = 60_000;

/** How each room's TV is powered on / off. Only the first three exist today; the others are placeholders. */
export const POWER_METHODS = ["manual", "shelly", "android_agent", "ir_controller", "network_wake", "hdmi_cec"];
export const AVAILABLE_POWER_METHODS = ["manual", "shelly", "android_agent"];
export const validPowerMethod = (m) => AVAILABLE_POWER_METHODS.includes(String(m));

/**
 * Status after time passes, for a stored command: PENDING past its expiry → TIMEOUT; DELIVERED without a report for
 * ACK_TIMEOUT_MS → UNVERIFIED. Final states never change.
 */
export function expiredStatus(cmd, now) {
  if (FINAL_STATUSES.includes(cmd.status)) return cmd.status;
  if (cmd.status === "PENDING" && now >= Number(cmd.expires_at)) return "TIMEOUT";
  if (cmd.status === "DELIVERED" && cmd.delivered_at !== null && cmd.delivered_at !== undefined && now - Number(cmd.delivered_at) >= ACK_TIMEOUT_MS) return "UNVERIFIED";
  return cmd.status;
}

/**
 * The app's report for a delivered command. Only a DELIVERED command can be closed, once (a repeated report changes
 * nothing). EXECUTED needs the measured screen state to match the command.
 */
export function reportStatus(cmd, report) {
  if (cmd.status !== "DELIVERED") return null;
  const interactive = report && typeof report.interactive === "boolean" ? report.interactive : null;
  if (report?.status !== "EXECUTED") return "FAILED";
  if (VOLUME_COMMANDS.includes(cmd.command)) return volumeStatus(cmd, report);
  // Factory Menu: EXECUTED only when the app saw it come to the front (the welcome screen left the foreground).
  if (cmd.command === "NETWORK_DIAGNOSTICS") return typeof report?.detail === "string" && report.detail.length > 0 ? "EXECUTED" : "UNVERIFIED";
  if (cmd.command === "OPEN_FACTORY_MENU") return report?.opened === true ? "EXECUTED" : report?.opened === false ? "FAILED" : "UNVERIFIED";
  if (interactive === null) return "UNVERIFIED";
  if (cmd.command === "SCREEN_OFF") return interactive ? "FAILED" : "EXECUTED";
  return interactive ? "EXECUTED" : "FAILED"; // SCREEN_ON, SHOW_WELCOME
}

/** What the PMS may say about the room's TV, from the agent's last check: never "on" without a recent report. */
export function agentState(seenAt, interactive, now) {
  if (seenAt === null || seenAt === undefined) return "unknown";
  if (now - Number(seenAt) > AGENT_ONLINE_MS) return "offline";
  if (interactive === null || interactive === undefined) return "online";
  return Number(interactive) === 1 ? "screen_on" : "screen_off";
}

/** Automatic command when the arrival / check-out decision changes (null: nothing to send). */
export function autoCommand(previous, want, settings) {
  const next = want ? "on" : "off";
  if (previous === next) return { state: next, command: null };
  // The first decision after the method is chosen only records the state.
  if (previous === null || previous === undefined || previous === "") return { state: next, command: null };
  if (want && settings.autoOn) return { state: next, command: "SCREEN_ON" };
  if (!want && settings.autoOff) return { state: next, command: "SCREEN_OFF" };
  return { state: next, command: null };
}

/**
 * A sound command is EXECUTED only when the volume / mute state read back from the TV after the change matches:
 * SET_VOLUME within VOLUME_TOLERANCE of the target (capped by an enforced maximum), MUTE / UNMUTE by the mute flag,
 * VOLUME_UP / DOWN when a volume was read back. A TV with fixed volume (e.g. sound through HDMI ARC) fails.
 */
export function volumeStatus(cmd, report) {
  const volume = Number.isInteger(report?.volume) ? report.volume : null;
  const muted = typeof report?.muted === "boolean" ? report.muted : null;
  if (report?.fixed === true) return "FAILED";
  if (cmd.command === "MUTE") return muted === null ? "UNVERIFIED" : muted ? "EXECUTED" : "FAILED";
  if (cmd.command === "UNMUTE") return muted === null ? "UNVERIFIED" : muted ? "FAILED" : "EXECUTED";
  if (volume === null) return "UNVERIFIED";
  if (cmd.command === "SET_VOLUME") {
    const target = cmd.cap !== null && cmd.cap !== undefined ? Math.min(Number(cmd.value), Number(cmd.cap)) : Number(cmd.value);
    return Math.abs(volume - target) <= VOLUME_TOLERANCE ? "EXECUTED" : "FAILED";
  }
  return "EXECUTED"; // VOLUME_UP / VOLUME_DOWN: the new level is reported and shown
}

/**
 * The room's sound policy: power-on volume and maximum volume in %, null = not set. The maximum is enforced only by
 * the Corali TV app (software, best effort: the remote can still raise it for a moment) — never a factory lock.
 */
export function normalizeSoundPolicy(raw) {
  const x = raw && typeof raw === "object" ? raw : {};
  const pct = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.min(100, Math.max(0, Math.round(Number(v)))));
  const maxVolume = pct(x.maxVolume);
  let defaultVolume = pct(x.defaultVolume);
  if (defaultVolume !== null && maxVolume !== null && defaultVolume > maxVolume) defaultVolume = maxVolume;
  return { defaultVolume, maxVolume, enforceMax: (x.enforceMax === true || x.enforceMax === 1) && maxVolume !== null };
}

/** Factory / hotel capabilities as reported by the app: each one separately, never assumed. */
export const CAPABILITY_LABELS = ["volume", "mute", "fixedVolume", "factoryApp", "factoryHotelMode", "factoryMaxVolume", "factoryPowerVolume", "factoryMenuLock"];
export function parseCapabilities(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of CAPABILITY_LABELS) if (k in raw) out[k] = raw[k] === null ? null : String(raw[k]).slice(0, 40);
  return out;
}

/** The hotel's sound preset (PMS → Corali TV → Ήχος): what «Επαναφορά προεπιλογών» applies. Pilot room 112: 8% / 30%. */
export function normalizeSoundPreset(raw) {
  const p = normalizeSoundPolicy(raw && typeof raw === "object" ? raw : { defaultVolume: 8, maxVolume: 30, enforceMax: true });
  return { defaultVolume: p.defaultVolume ?? 8, maxVolume: p.maxVolume ?? 30, enforceMax: raw && typeof raw === "object" && "enforceMax" in raw ? p.enforceMax : true };
}

export const RESET_PRESETS = ["hotel_default", "no_max_enforcement", "hotel_mode"];

/**
 * v160 resets (software policies only — never a factory reset, never vendor settings, never the room token, Wi-Fi,
 * power method or welcome screen). Returns the policy to save (null: leave it) and the sound commands to queue, in order.
 *  hotel_default:      policy = hotel preset, then UNMUTE
 *  no_max_enforcement: the room's policy with enforceMax=false (power-on volume kept)
 *  hotel_mode:         policy = hotel preset, then UNMUTE + SET_VOLUME(power-on volume)
 *  restore_sound:      no policy change; UNMUTE + SET_VOLUME(room's power-on volume, else the preset's)
 */
export function resetPlan(action, current, preset) {
  const cur = current ? normalizeSoundPolicy(current) : null;
  const p = normalizeSoundPreset(preset);
  if (action === "hotel_default") return { policy: p, commands: [{ command: "UNMUTE", value: null }] };
  if (action === "no_max_enforcement") return { policy: { defaultVolume: cur?.defaultVolume ?? null, maxVolume: cur?.maxVolume ?? null, enforceMax: false }, commands: [] };
  if (action === "hotel_mode") return { policy: p, commands: [{ command: "UNMUTE", value: null }, { command: "SET_VOLUME", value: p.defaultVolume }] };
  if (action === "restore_sound") return { policy: null, commands: [{ command: "UNMUTE", value: null }, { command: "SET_VOLUME", value: cur?.defaultVolume ?? p.defaultVolume }] };
  throw new Error("UNKNOWN_RESET");
}

/** Per-room result shown after a reset: the command chain's state, never «success» without the TV's report. */
export function resetRoomStatus({ appVersion, online, commands, policyRev, appliedRev, needsPolicyAck }) {
  if (appVersion === null || appVersion === undefined || appVersion < 10) return "APP_TOO_OLD";
  const st = commands.map((c) => c.status);
  if (st.includes("FAILED")) return "FAILED";
  if (st.includes("CANCELLED")) return "SUPERSEDED"; // a newer command / reset for the room replaced it
  if (st.includes("TIMEOUT")) return "OFFLINE";
  if (st.includes("UNVERIFIED")) return "UNVERIFIED";
  if (st.some((s) => s === "PENDING")) return online ? "PENDING" : "OFFLINE";
  if (st.some((s) => s === "DELIVERED")) return "DELIVERED";
  if (needsPolicyAck && policyRev !== null && policyRev !== undefined) {
    if (appliedRev === null || appliedRev === undefined) return appVersion < 11 ? "UNVERIFIED" : online ? "PENDING" : "OFFLINE";
    if (Number(appliedRev) < Number(policyRev)) return online ? "PENDING" : "OFFLINE";
  }
  return "EXECUTED";
}

// v163: the TV's «Lock Menu Key» as it really is on the TV. The factory app locks by DISABLING the Settings app
// (com.android.tv.settings, state 2) and the Google TV side panel (launcherx …dashboard.DashboardActivity and
// …DashboardHandler, state 2); the global setting hotel_menu_key_lock alone is not proof. The Corali TV app (≥ 1.14)
// reads the three enabled states with PackageManager (no ADB, no permission) and sends them as "s<n>a<n>h<n>"
// (n = Android COMPONENT_ENABLED_STATE 0..4, or x when it could not be read).
export const MENU_LOCK_STATES = ["LOCKED", "UNLOCKED", "PARTIAL", "UNKNOWN"];
export function parseMenuLockRaw(raw) {
  const m = /^s([0-4x])a([0-4x])h([0-4x])$/.exec(String(raw ?? ""));
  if (!m) return null;
  const n = (v) => (v === "x" ? null : Number(v));
  return { settings: n(m[1]), dashboardActivity: n(m[2]), dashboardHandler: n(m[3]) };
}
/** LOCKED only when all three are disabled; UNLOCKED when all three are enabled / default; anything else PARTIAL. */
export function menuLockState(raw) {
  const p = parseMenuLockRaw(raw);
  if (!p || p.settings === null) return "UNKNOWN";
  const off = (v) => v === 2 || v === 3 || v === 4;
  const on = (v) => v === 0 || v === 1;
  const parts = [p.settings, p.dashboardActivity, p.dashboardHandler].filter((v) => v !== null);
  if (parts.length === 3 && parts.every(off)) return "LOCKED";
  if (parts.every(on)) return parts.length === 3 ? "UNLOCKED" : "UNKNOWN";
  return "PARTIAL";
}

// v164: power state of a room's TV as the PMS may show it. Never ON because the agent is connected or a wake lock is
// held: ON / STANDBY only from the screen state the app measured (PowerManager.isInteractive) in a recent check.
export const POWER_STATES = ["ON", "STANDBY", "WAKING", "UNKNOWN", "ERROR"];
export const POWER_OFF_MODES = ["device_admin", "sleep_key"];
/** A check is expected every 20 s; a silence longer than this is recorded as a gap (TV / network asleep). */
export const GAP_MS = 90_000;
export function powerState({ seenAt, interactive, now, waking = false, lastFailedAt = null }) {
  const fresh = seenAt !== null && seenAt !== undefined && now - Number(seenAt) <= AGENT_ONLINE_MS;
  if (waking) return { state: "WAKING", reachable: fresh };
  if (lastFailedAt !== null && lastFailedAt !== undefined && now - Number(lastFailedAt) < 10 * 60_000 && !fresh) return { state: "ERROR", reachable: false };
  if (seenAt === null || seenAt === undefined) return { state: "UNKNOWN", reachable: false };
  const i = interactive === null || interactive === undefined ? null : Number(interactive);
  if (fresh) return { state: i === 1 ? "ON" : i === 0 ? "STANDBY" : "UNKNOWN", reachable: true };
  // Not heard from: a TV last seen with the screen off is in standby (unreachable); otherwise unknown.
  return { state: i === 0 ? "STANDBY" : "UNKNOWN", reachable: false };
}
/** Standby diagnostics the app sends in its check (≥ 1.15): flags 1 / 0, or null when unknown. */
export function parseStandbyDiag(q) {
  const f = (k) => (q[k] === "1" ? true : q[k] === "0" ? false : null);
  return { networkStandby: f("ns"), cpuWakeLockHeld: f("cpu"), wifiLockHeld: f("wl"), lowPowerStandbyEnabled: f("lps"), lowPowerStandbyExempt: f("lpx"), deviceIdle: f("idl"), networkValidated: f("nv") };
}
/**
 * Verdict of one PMS standby test (OFF now, ON after N minutes). PASS only when the TV, after the wait, took the ON
 * command and reported the screen really on. FAIL_UNREACHABLE: the app never checked in to take it (TV / Wi-Fi asleep).
 */
export function standbyVerdict(test, off, on, now) {
  if (!off || off.status === "PENDING" || off.status === "DELIVERED") return "STARTING";
  if (off.status !== "EXECUTED") return "OFF_FAILED";
  if (!on) return "ERROR";
  if (on.status === "EXECUTED") return "PASS";
  if (on.status === "PENDING") return now < Number(on.not_before ?? 0) ? "WAITING" : "WAKE_DUE";
  if (on.status === "DELIVERED") return "WAKING";
  if (on.status === "TIMEOUT") return "FAIL_UNREACHABLE";
  if (on.status === "FAILED") return "FAIL_WAKE_REFUSED";
  if (on.status === "CANCELLED") return "CANCELLED";
  return "UNVERIFIED";
}

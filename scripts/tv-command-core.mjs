// Corali TV screen commands (PMS → Android agent), pure and unit tested. A command is created by staff or by the
// automatic arrival / check-out rule, delivered once to the room's app on its next check (every ~20 s), and is only
// EXECUTED when the app reports back that the screen really changed (PowerManager.isInteractive()). The HTTP answer
// alone never counts as success.

export const SCREEN_COMMANDS = ["SCREEN_ON", "SCREEN_OFF", "SHOW_WELCOME"];
/** v159: sound, through Android AudioManager (STREAM_MUSIC) in the Corali TV app ≥ 1.9. */
export const VOLUME_COMMANDS = ["SET_VOLUME", "VOLUME_UP", "VOLUME_DOWN", "MUTE", "UNMUTE"];
export const ALL_COMMANDS = [...SCREEN_COMMANDS, ...VOLUME_COMMANDS];
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

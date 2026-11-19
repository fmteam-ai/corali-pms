package gr.hotelcorali.tv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.database.ContentObserver;
import android.provider.Settings;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;

import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Runs while the TV is on (and, holding the processor and Wi-Fi awake, while only the screen is off): brings the welcome screen back when the TV wakes from standby (if enabled) and, every
 * minute, checks for an urgent reception message, which brings Corali TV to the front over Netflix / live TV.
 */
public class WakeService extends Service {
    private static final String CHANNEL = "corali_tv";
    private static final String TAG = "CoraliTV";
    /** Sent with every check; must match android:versionCode. */
    static final int VERSION_CODE = 21;
    private static final long CAPS_EVERY_MS = 10 * 60_000;
    private static final long URGENT_CHECK_MS = 20_000;

    private HandlerThread worker;
    private Handler background;
    // Keep the processor and Wi-Fi awake while the screen is off, so the PMS can turn the screen on again.
    // Sound (v159): volume / mute, the room's sound policy, and when capabilities were last reported.
    private VolumeController volume;
    private volatile boolean clamped;
    private long capsSentAt;
    private ContentObserver volumeWatch;

    private final BroadcastReceiver screenOn = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            Prefs prefs = new Prefs(context);
            if (prefs.blank() && BlackScreenActivity.active) { BootLog.add(context, "SCREEN_ON with the black screen in front — left as is"); return; }
            if (prefs.configured() && prefs.openOnWake() && background != null) {
                BootLog.add(context, "SCREEN_ON (TV turned on)");
                // 1.15: never over a guest's app (a Google Cast or YouTube session wakes the TV too): ask what is in
                // front first, off the main thread, and only then bring the welcome screen.
                background.post(new Runnable() {
                    @Override
                    public void run() {
                        StringBuilder who = new StringBuilder();
                        if (Foreground.guestAppInFront(WakeService.this, who)) {
                            BootLog.add(WakeService.this, "screen-on: " + who + " in front — welcome screen not shown");
                            return;
                        }
                        MainActivity.bringToFront(WakeService.this, false, false, "screen-on");
                        // 1.12: check that it really came to the front; otherwise retry, then the TV's own ADB.
                        scheduleVisibleChecks("screen-on", new long[]{6_000, 15_000, 30_000});
                    }
                });
            }
            // Power-on volume of the room's policy, each time the TV is turned on.
            if (background != null) background.post(new Runnable() { @Override public void run() { applyPowerOnVolume(); } });
        }
    };

    private final Runnable checkUrgent = new Runnable() {
        @Override
        public void run() {
            try {
                JSONObject r = check();
                if (r != null) {
                    urgent(r);
                    policy(r.optJSONObject("policy"));
                    command(r.optJSONObject("command"));
                    // v162: a check-out clearing for this TV (Self-ADB), run in its own thread.
                    PrivacyAgent.start(WakeService.this, r.optJSONObject("privacy"));
                    standby(r.optJSONObject("standby"));
                }
            } catch (Exception ignored) {
                // Offline or server busy: try again shortly.
            }
            background.postDelayed(this, URGENT_CHECK_MS);
        }
    };

    /** An urgent reception message: over whatever is on, or (with "turn the TV on") waking the screen. */
    private void urgent(JSONObject r) {
        long id = r.optLong("urgent", 0);
        boolean wake = r.optBoolean("wake");
        Prefs prefs = new Prefs(this);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (id > 0 && id != prefs.lastUrgent()) {
            if (pm.isInteractive()) {
                prefs.setLastUrgent(id);
                MainActivity.bringToFront(this, true, false);
            } else if (wake) {
                prefs.setLastUrgent(id);
                wakeScreen(pm);
                MainActivity.bringToFront(this, true, true);
            }
            // Otherwise it waits: when the TV is turned on, the welcome screen opens with the message.
        }
    }

    /**
     * A screen command from the PMS (v158), run once per id. The result is measured afterwards with
     * PowerManager.isInteractive() and reported back: the PMS never shows success without this report.
     */
    private void command(JSONObject c) {
        if (c == null) return;
        final long id = c.optLong("id", 0);
        final String type = c.optString("command", "");
        Prefs prefs = new Prefs(this);
        if (id <= 0 || id == prefs.lastCommand()) return;
        prefs.setLastCommand(id);
        final PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        Log.i(TAG, "command " + id + " " + type + " (screen " + (pm.isInteractive() ? "on" : "off") + ")");
        if (type.equals("SET_VOLUME") || type.equals("VOLUME_UP") || type.equals("VOLUME_DOWN") || type.equals("MUTE") || type.equals("UNMUTE")) {
            soundCommand(id, type, c);
            return;
        }
        if ("OPEN_FACTORY_MENU".equals(type)) {
            factoryMenu(id, pm);
            return;
        }
        if ("MENU_LOCK".equals(type) || "MENU_UNLOCK".equals(type)) {
            menuLock(id, "MENU_LOCK".equals(type), pm);
            return;
        }
        if ("APP_UPDATE".equals(type)) {
            appUpdate(id, c, pm);
            return;
        }
        if ("NETWORK_DIAGNOSTICS".equals(type)) {
            diagnostics(id, pm);
            return;
        }
        if ("SCREEN_ON".equals(type)) {
            powerOn(id, pm);
            return;
        }
        if ("SCREEN_OFF".equals(type)) {
            powerOff(id, pm);
            return;
        }
        long verifyAfter;
        if ("SHOW_WELCOME".equals(type)) {
            if (!pm.isInteractive()) { report(id, false, false, "SCREEN_IS_OFF"); return; }
            MainActivity.bringToFront(this, true, false);
            verifyAfter = 2_000;
        } else {
            report(id, false, pm.isInteractive(), "UNKNOWN_COMMAND");
            return;
        }
        background.postDelayed(new Runnable() {
            @Override
            public void run() {
                boolean on = pm.isInteractive();
                Log.i(TAG, "command " + id + " " + type + " done, screen " + (on ? "on" : "off"));
                report(id, true, on, "");
            }
        }, verifyAfter);
    }

    /** Volume / mute from the PMS, read back afterwards (the server decides EXECUTED from the values). */
    private void soundCommand(long id, String type, JSONObject c) {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        try {
            if (volume.fixed()) { report(id, false, pm.isInteractive(), "FIXED_VOLUME", soundState()); return; }
            Integer cap = c.isNull("cap") ? null : c.optInt("cap");
            if ("SET_VOLUME".equals(type)) volume.setPercent(c.optInt("value", 0), cap);
            else if ("VOLUME_UP".equals(type)) volume.step(true, cap);
            else if ("VOLUME_DOWN".equals(type)) volume.step(false, cap);
            else volume.setMuted("MUTE".equals(type));
            Log.i(TAG, "sound " + id + " " + type + " → " + volume.percent() + "% muted=" + volume.muted());
            report(id, true, pm.isInteractive(), "", soundState());
        } catch (RuntimeException e) {
            Log.w(TAG, "sound " + id + " failed: " + e);
            report(id, false, pm.isInteractive(), "AUDIO_ERROR", soundState());
        }
    }

    private JSONObject soundState() {
        JSONObject o = new JSONObject();
        try {
            int p = volume.percent();
            if (p >= 0) o.put("volume", p);
            o.put("muted", volume.muted());
            o.put("fixed", volume.fixed());
        } catch (Exception ignored) { }
        return o;
    }

    /** The room's sound policy from the PMS (kept, so it also applies when the PMS cannot be reached). */
    private void policy(JSONObject p) {
        if (p == null) return;
        new Prefs(this).setSoundPolicy(p.toString());
        enforceMax();
    }

    /** Maximum volume, software (best effort): a level above it is brought back to it. */
    private void enforceMax() {
        try {
            JSONObject p = new JSONObject(new Prefs(this).soundPolicy());
            if (!p.optBoolean("enforceMax") || p.isNull("maxVolume") || volume.fixed()) return;
            int max = p.optInt("maxVolume", 100);
            if (volume.percent() > max) {
                volume.setPercent(max, null);
                clamped = true;
                Log.i(TAG, "volume brought back to the maximum " + max + "%");
            }
        } catch (Exception ignored) {
            // No policy yet.
        }
    }

    /** Power-on volume (TV turned on / app started at boot), capped by the maximum. */
    private void applyPowerOnVolume() {
        try {
            JSONObject p = new JSONObject(new Prefs(this).soundPolicy());
            if (p.isNull("defaultVolume") || volume.fixed()) return;
            Integer cap = p.optBoolean("enforceMax") && !p.isNull("maxVolume") ? p.optInt("maxVolume") : null;
            int now = volume.setPercent(p.optInt("defaultVolume"), cap);
            Log.i(TAG, "power-on volume → " + now + "%");
        } catch (Exception ignored) {
            // No policy yet.
        }
    }

    /** POST /api/public/tv/<token>/command {id, status, interactive, error}; the server decides EXECUTED / FAILED. */
    private void report(long id, boolean done, boolean interactive, String error) { report(id, done, interactive, error, null); }

    /** As report(), with the sound state read back after a sound command. */
    private void report(long id, boolean done, boolean interactive, String error, JSONObject sound) {
        Prefs prefs = new Prefs(this);
        Uri screen = Uri.parse(prefs.screenUrl());
        String token = screen.getLastPathSegment();
        if (token == null) return;
        HttpURLConnection http = null;
        try {
            JSONObject body = new JSONObject().put("id", id).put("status", done ? "EXECUTED" : "FAILED").put("interactive", interactive);
            if (!error.isEmpty()) body.put("error", error);
            if (sound != null) {
                if (sound.has("volume")) body.put("volume", sound.getInt("volume"));
                if (sound.has("muted")) body.put("muted", sound.getBoolean("muted"));
                if (sound.has("fixed")) body.put("fixed", sound.getBoolean("fixed"));
                if (sound.has("opened")) body.put("opened", sound.getBoolean("opened"));
                if (sound.has("detail")) body.put("detail", sound.getString("detail"));
                if (sound.has("menuLock")) body.put("menuLock", sound.getString("menuLock"));
                if (sound.has("blank")) body.put("blank", sound.getBoolean("blank"));
                if (sound.has("version")) body.put("version", sound.getInt("version"));
            }
            URL url = new URL(screen.getScheme() + "://" + screen.getAuthority() + "/api/public/tv/" + Uri.encode(token) + "/command");
            http = (HttpURLConnection) url.openConnection();
            http.setConnectTimeout(15_000);
            http.setReadTimeout(15_000);
            http.setRequestMethod("POST");
            http.setDoOutput(true);
            http.setRequestProperty("Content-Type", "application/json");
            OutputStream out = http.getOutputStream();
            out.write(body.toString().getBytes("UTF-8"));
            out.close();
            Log.i(TAG, "report " + id + " → HTTP " + http.getResponseCode());
        } catch (Exception e) {
            // The PMS marks it UNVERIFIED after two minutes without a report.
            Log.w(TAG, "report " + id + " failed: " + e);
        } finally {
            if (http != null) http.disconnect();
        }
    }

    static void start(Context c) {
        Intent i = new Intent(c, WakeService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i); else c.startService(i);
        } catch (RuntimeException ignored) {
            // Not allowed right now (background limits); the next start-up or app launch tries again.
        }
    }

    // ---- 1.15 (v164): verified power control and diagnostics

    /**
     * PMS ON: (1) wake lock with ACQUIRE_CAUSES_WAKEUP + the welcome screen with «turn screen on»; (2) if the screen is
     * still off after 4 s, the wake key through the TV's own ADB. EXECUTED only if the screen is measured on. The
     * welcome screen is shown because the PMS turned the TV on. One attempt, no retry loop.
     */
    private void powerOn(final long id, final PowerManager pm) {
        if (new Prefs(this).blank() && pm.isInteractive()) {
            BlackScreenActivity.hide(this);
            MainActivity.bringToFront(this, false, false, "pms-on");
            report(id, true, true, "", detail("black screen → welcome"));
            return;
        }
        if (pm.isInteractive()) {
            MainActivity.bringToFront(this, false, false, "pms-on");
            report(id, true, true, "", detail("already on"));
            return;
        }
        wakeScreen(pm);
        MainActivity.bringToFront(this, false, true, "pms-on");
        background.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (pm.isInteractive()) { report(id, true, true, "", detail("wake lock")); return; }
                SelfAdbProbe.Result r = SelfAdbProbe.shell(getFilesDir(), SelfAdbProbe.KEY_WAKEUP);
                final String adb = r.status.name();
                background.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        boolean on = pm.isInteractive();
                        if (on) MainActivity.bringToFront(WakeService.this, false, false, "pms-on");
                        BootLog.add(WakeService.this, "PMS ON: wake lock failed, wake key " + adb + " → screen " + (on ? "on" : "OFF"));
                        report(id, true, on, on ? "" : "WAKE_REFUSED", detail("wake key (" + adb + ")" + (on ? "" : "; " + powerSummary())));
                    }
                }, 3_000);
            }
        }, 4_000);
    }

    /** PMS OFF by the room's method: lockNow (device admin, default) or the sleep key through the TV's own ADB. */
    private void powerOff(final long id, final PowerManager pm) {
        String mode = new Prefs(this).offMode();
        String used;
        if (!pm.isInteractive()) {
            report(id, true, false, "", detail("already off"));
            return;
        }
        if ("black_screen".equals(mode)) {
            BlackScreenActivity.show(this, "pms-off");
            background.postDelayed(new Runnable() {
                @Override
                public void run() {
                    boolean ok = BlackScreenActivity.active;
                    try {
                        report(id, ok, pm.isInteractive(), ok ? "" : "BLACK_SCREEN_NOT_SHOWN", new JSONObject().put("blank", ok).put("detail", "black screen (" + (ok ? "in front" : "not in front") + "); " + NetworkStandbyManager.get(WakeService.this).query()));
                    } catch (Exception e) {
                        report(id, false, pm.isInteractive(), "REPORT_ERROR");
                    }
                }
            }, 2_500);
            return;
        }
        if ("sleep_key".equals(mode)) {
            SelfAdbProbe.Result r = SelfAdbProbe.shell(getFilesDir(), SelfAdbProbe.KEY_SLEEP);
            used = "sleep key (" + r.status.name() + ")";
            if (r.status != SelfAdbProbe.Status.PASS) {
                // Fallback to the working method, so OFF does not stop working when ADB is unavailable.
                if (!ScreenAdmin.active(this) || !ScreenAdmin.screenOff(this)) { report(id, false, pm.isInteractive(), "SLEEP_KEY_FAILED", detail(used)); return; }
                used += " → lockNow";
            }
        } else {
            if (!ScreenAdmin.active(this)) { report(id, false, pm.isInteractive(), "NO_SCREEN_OFF_PERMISSION"); return; }
            if (!ScreenAdmin.screenOff(this)) { report(id, false, pm.isInteractive(), "LOCK_FAILED"); return; }
            used = "lockNow";
        }
        final String how = used;
        background.postDelayed(new Runnable() {
            @Override
            public void run() {
                boolean on = pm.isInteractive();
                report(id, true, on, "", detail(how + "; " + NetworkStandbyManager.get(WakeService.this).query()));
            }
        }, 3_000);
    }

    /** Power & network diagnostics for the PMS: the app's own state plus selected read-only lines of dumpsys power. */
    private void diagnostics(long id, PowerManager pm) {
        NetworkStandbyManager ns = NetworkStandbyManager.get(this);
        StringBuilder sb = new StringBuilder();
        sb.append("agent 1.18 · screen ").append(pm.isInteractive() ? "on" : "off").append(new Prefs(this).blank() ? " (black screen)" : "").append('\n');
        // 1.16: what the firmware says about silent boot / why it started (read only).
        sb.append("boot: quiescent=").append(sysProp("ro.boot.quiescent")).append(" · reason=").append(sysProp("sys.boot.reason"))
          .append(" · bootreason=").append(sysProp("ro.boot.bootreason")).append(" · factory_boot_mode=").append(sysProp("persist.sys.factory_boot_mode")).append('\n');
        sb.append("firmware: ").append(Build.DISPLAY).append(" · ").append(sysProp("ro.build.version.incremental")).append(" · ").append(Build.MODEL).append('\n');
        sb.append("idle standby: tv_idle_standby_time=").append(settingG("tv_idle_standby_time")).append(" · attentive_timeout=").append(settingS("attentive_timeout"))
          .append(" · sleep_timeout=").append(settingS("sleep_timeout")).append(" · default_power_on_mode=").append(settingS("default_power_on_mode")).append('\n');
        sb.append("network standby ").append(ns.enabled()).append(" · cpu lock ").append(ns.cpuHeld()).append(" · wifi lock ").append(ns.wifiHeld()).append('\n');
        sb.append("low power standby ").append(NetworkStandbyManager.lowPowerStandby(this, "isLowPowerStandbyEnabled"))
          .append(" (supported ").append(NetworkStandbyManager.lowPowerStandby(this, "isLowPowerStandbySupported"))
          .append(", app exempt ").append(NetworkStandbyManager.lowPowerStandby(this, "isExemptFromLowPowerStandby")).append(")\n");
        sb.append("doze ").append(NetworkStandbyManager.deviceIdle(this)).append(" · internet validated ").append(NetworkStandbyManager.networkValidated(this)).append('\n');
        sb.append("screen-off permission ").append(ScreenAdmin.active(this)).append(" · off mode ").append(new Prefs(this).offMode()).append('\n');
        String top = Foreground.topPackage(this);
        sb.append("in front: ").append(top == null ? "?" : top).append('\n');
        sb.append(powerSummary());
        report(id, true, pm.isInteractive(), "", detail(sb.toString()));
    }

    /** A system property (reflection; read only), or "?" when Android does not allow reading it. */
    static String sysProp(String name) {
        try {
            Object v = Class.forName("android.os.SystemProperties").getMethod("get", String.class, String.class).invoke(null, name, "");
            String s = v == null ? "" : v.toString();
            return s.isEmpty() ? "-" : s.length() > 80 ? s.substring(0, 80) : s;
        } catch (Exception e) {
            return "?";
        }
    }

    private String settingG(String name) {
        try { String v = Settings.Global.getString(getContentResolver(), name); return v == null ? "-" : v; } catch (RuntimeException e) { return "?"; }
    }

    private String settingS(String name) {
        try { String v = Settings.Secure.getString(getContentResolver(), name); return v == null ? "-" : v; } catch (RuntimeException e) { return "?"; }
    }

    /** Selected lines of dumpsys power (wakefulness, last sleep / wake reason, Low Power Standby, wake locks). */
    private String powerSummary() {
        SelfAdbProbe.Result r = SelfAdbProbe.shell(getFilesDir(), SelfAdbProbe.DUMP_POWER);
        if (r.status != SelfAdbProbe.Status.PASS) return "dumpsys power: " + r.status.name();
        StringBuilder sb = new StringBuilder();
        int n = 0;
        for (String line : r.detail.split("\r?\n")) {
            String t = line.trim();
            if (t.startsWith("mWakefulness=") || t.startsWith("mLastSleepReason") || t.startsWith("mLastWakeReason") || t.startsWith("mLastWakeTime")
                    || t.startsWith("mLastSleepTime") || t.toLowerCase(java.util.Locale.US).contains("low power standby") || t.startsWith("mLowPowerStandby")
                    || t.startsWith("mIsActive") || t.startsWith("mIsEnabled") || t.startsWith("mStayOn") || t.startsWith("mDeviceIdleMode")
                    || t.startsWith("Wake Locks:") || t.contains("CoraliTV") || t.startsWith("Suspend Blockers:") || t.startsWith("mHoldingWakeLockSuspendBlocker")) {
                sb.append(t.length() > 160 ? t.substring(0, 160) : t).append('\n');
                if (++n >= 40) break;
            }
        }
        return sb.length() == 0 ? "dumpsys power: no matching lines" : sb.toString();
    }

    private static JSONObject detail(String text) {
        try { return new JSONObject().put("detail", text.length() > 3900 ? text.substring(0, 3900) : text); } catch (Exception e) { return null; }
    }

    /** The room's standby settings from the PMS (≥ v164): applied at once and kept for the next start-up. */
    private void standby(JSONObject s) {
        if (s == null) return;
        boolean network = s.optBoolean("network", true);
        String m = s.optString("offMode");
        String off = "sleep_key".equals(m) || "black_screen".equals(m) ? m : "device_admin";
        if (!"black_screen".equals(off) && new Prefs(this).blank()) BlackScreenActivity.hide(this); // mode changed: no black screen left behind
        Prefs prefs = new Prefs(this);
        if (prefs.networkStandby() != network || !prefs.offMode().equals(off)) prefs.setStandby(network, off);
        NetworkStandbyManager.get(this).setEnabled(network);
    }

    /**
     * 1.14: open the Factory Menu for a technician. Evidence: the welcome screen is brought to the front first, then the
     * Factory Menu is started; «opened» only if the welcome screen then left the foreground. Changes no setting.
     */
    private void factoryMenu(final long id, final PowerManager pm) {
        if (!pm.isInteractive()) { report(id, false, false, "SCREEN_IS_OFF"); return; }
        MainActivity.bringToFront(this, false, false, "factory-menu");
        background.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!MainActivity.visible) { report(id, true, pm.isInteractive(), "WELCOME_NOT_IN_FRONT"); return; } // → UNVERIFIED
                if (!MenuLock.openFactoryMenu(WakeService.this)) { report(id, false, pm.isInteractive(), "FACTORY_MENU_NOT_AVAILABLE"); return; }
                background.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        boolean opened = !MainActivity.visible;
                        BootLog.add(WakeService.this, "factory menu: " + (opened ? "in front" : "did not come to the front"));
                        try {
                            report(id, true, pm.isInteractive(), opened ? "" : "FACTORY_MENU_NOT_IN_FRONT", new JSONObject().put("opened", opened));
                        } catch (Exception e) {
                            report(id, true, pm.isInteractive(), "REPORT_ERROR");
                        }
                    }
                }, 3_000);
            }
        }, 3_000);
    }

    // ---- 1.20 (v172): the app updates itself from the PMS (see AppUpdater).

    private void appUpdate(final long id, final JSONObject c, final PowerManager pm) {
        final int target = c.optInt("value", 0);
        final String file = c.optString("file", ""), sha = c.optString("sha256", "");
        if (target <= VERSION_CODE) { updateReport(id, true, pm, "", "already " + VERSION_CODE); return; }
        final String url = AppUpdater.downloadUrl(new Prefs(this).screenUrl(), file);
        if (url == null || !AppUpdater.validSha(sha)) { updateReport(id, false, pm, "BAD_REQUEST", "file=" + file); return; }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    BootLog.add(WakeService.this, "update " + id + ": download " + file + " (→ " + target + ")");
                    java.io.File apk = AppUpdater.download(WakeService.this, url, sha);
                    String cmd = AppUpdater.installCommand(apk.getAbsolutePath());
                    if (!SelfAdbProbe.allowed(cmd)) { updateReport(id, false, pm, "PATH_NOT_ALLOWED", apk.getAbsolutePath()); return; }
                    // Saved before installing: the install replaces (and restarts) this app; the new one reports.
                    new Prefs(WakeService.this).setUpdate(id, target);
                    BootLog.add(WakeService.this, "update " + id + ": installing");
                    SelfAdbProbe.Result r = SelfAdbProbe.shell(getFilesDir(), cmd);
                    String out = r.detail == null ? "" : r.detail.trim().replaceAll("\\s+", " ");
                    BootLog.add(WakeService.this, "update " + id + ": " + r.status.name() + " " + out);
                    // «Success»: Android is replacing the app right now; the restarted app reports its versionCode.
                    if (r.status == SelfAdbProbe.Status.PASS && PrivacyParse.success(out)) return;
                    new Prefs(WakeService.this).setUpdate(0, 0);
                    updateReport(id, false, pm, r.status == SelfAdbProbe.Status.PASS ? "INSTALL_FAILED" : "SELF_ADB_" + r.status.name(), out.length() > 300 ? out.substring(0, 300) : out);
                } catch (Exception e) {
                    String code = e.getMessage() != null && e.getMessage().matches("[A-Z0-9_]{2,40}") ? e.getMessage() : "DOWNLOAD_FAILED";
                    BootLog.add(WakeService.this, "update " + id + ": " + code + " " + e.getClass().getSimpleName());
                    updateReport(id, false, pm, code, e.getClass().getSimpleName());
                }
            }
        }, "corali-update").start();
    }

    /** At start: the result of an update that replaced the app (the new versionCode decides it on the PMS). */
    private void updateResult() {
        Prefs prefs = new Prefs(this);
        long id = prefs.updateId();
        if (id <= 0) return;
        int target = prefs.updateTarget();
        prefs.setUpdate(0, 0);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        BootLog.add(this, "update " + id + ": now " + VERSION_CODE + " (target " + target + ")");
        updateReport(id, VERSION_CODE >= target, pm, VERSION_CODE >= target ? "" : "VERSION_NOT_CHANGED", "versionCode " + VERSION_CODE);
    }

    private void updateReport(long id, boolean ok, PowerManager pm, String error, String detail) {
        try {
            report(id, ok, pm.isInteractive(), error, new JSONObject().put("version", VERSION_CODE).put("detail", detail));
        } catch (Exception e) {
            report(id, ok, pm.isInteractive(), error.isEmpty() ? "REPORT_ERROR" : error);
        }
    }

    // ---- 1.18: Settings lock from the PMS: the TV's Settings app disabled / enabled through the TV's own ADB.

    /**
     * MENU_LOCK / MENU_UNLOCK (1.18). The factory «Lock Menu Key» can only be changed with the factory Hotel Mode ON,
     * which uninstalls third-party apps at every start (seen on the HORIZON 112), so it is not used. Instead the app
     * disables (pm disable-user) or enables the TV's Settings app with two fixed Self-ADB commands; nothing else.
     * Works with the screen off and never shows anything on the guest's screen. EXECUTED only when PackageManager
     * reads the target state afterwards and Hotel Status (hotel_enable) is 0; the PMS checks the reported values again.
     */
    private void menuLock(final long id, final boolean lock, final PowerManager pm) {
        final String before = MenuLock.readFull(this);
        final String want = lock ? "lock" : "unlock";
        BootLog.add(this, "settings " + want + " " + id + ": before " + before);
        if (MenuLock.globalInt(this, "hotel_enable") != 0) { lockReport(id, false, pm, "HOTEL_MODE_ON", before, "before=" + before); return; }
        if (MenuLock.lockIs(this, lock)) { lockReport(id, true, pm, "", before, "already " + (lock ? "locked" : "unlocked") + " · " + before); return; }
        // Settings first, then the Play Store (no app installs by guests); on unlock the other way round.
        String[] cmds = lock ? new String[]{SelfAdbProbe.SETTINGS_DISABLE, SelfAdbProbe.STORE_DISABLE} : new String[]{SelfAdbProbe.STORE_ENABLE, SelfAdbProbe.SETTINGS_ENABLE};
        StringBuilder out = new StringBuilder();
        for (String cmd : cmds) {
            if (cmd.contains("com.android.vending") && MenuLock.disabled(this, MenuLock.STORE) == null) continue; // no Play Store on this TV
            SelfAdbProbe.Result r = SelfAdbProbe.shell(getFilesDir(), cmd);
            out.append(r.status.name()).append(r.detail == null ? "" : " " + r.detail.trim().replaceAll("\\s+", " ")).append(" | ");
            if (r.status != SelfAdbProbe.Status.PASS) { lockReport(id, false, pm, "SELF_ADB_" + r.status.name(), MenuLock.readFull(this), "before=" + before + " adb=" + out); return; }
        }
        final String adb = out.toString();
        background.postDelayed(new Runnable() {
            @Override
            public void run() {
                String after = MenuLock.readFull(WakeService.this);
                String detail = "before=" + before + " after=" + after + " adb=" + (adb.length() > 200 ? adb.substring(0, 200) : adb);
                BootLog.add(WakeService.this, "settings " + want + " " + id + ": " + detail);
                String err = MenuLock.globalInt(WakeService.this, "hotel_enable") != 0 ? "HOTEL_MODE_CHANGED"
                        : MenuLock.lockIs(WakeService.this, lock) ? "" : "STATE_NOT_CONFIRMED";
                lockReport(id, err.isEmpty(), pm, err, after, detail);
            }
        }, 1_500);
    }

    private void lockReport(long id, boolean ok, PowerManager pm, String error, String raw, String detail) {
        try {
            report(id, ok, pm.isInteractive(), error, new JSONObject().put("menuLock", raw).put("detail", detail));
        } catch (Exception e) {
            report(id, ok, pm.isInteractive(), error.isEmpty() ? "REPORT_ERROR" : error);
        }
    }

    /** After power-on / reboot: run as a foreground service and make sure the welcome screen ends up visible. */
    static void startAfterBoot(Context c, boolean wake) {
        Intent i = new Intent(c, WakeService.class).putExtra("boot", true).putExtra("power_on", wake);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i); else c.startService(i);
            BootLog.add(c, "service start requested (wake screen: " + (wake ? "yes, daytime" : "no, night") + ")");
        } catch (RuntimeException e) {
            BootLog.add(c, "service start REFUSED: " + e.getClass().getSimpleName());
        }
    }

    // ---- 1.12: is the welcome screen really visible after boot / power-on? Retry, then the TV's own ADB.

    private int checkRound;

    private void scheduleVisibleChecks(final String why, long[] delays) {
        if (background == null) return;
        final int round = ++checkRound;
        for (int n = 0; n < delays.length; n++) {
            final int attempt = n + 1, last = delays.length;
            background.postDelayed(new Runnable() {
                @Override
                public void run() { checkVisible(round, why, attempt, last); }
            }, delays[n]);
        }
    }

    private void checkVisible(int round, String why, int attempt, int last) {
        if (round != checkRound) return; // a newer start-up / power-on took over
        Prefs prefs = new Prefs(this);
        if (!prefs.configured()) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        String tag = why + " check " + attempt + "/" + last + ": ";
        if (BlackScreenActivity.active) {
            BootLog.add(this, tag + "black screen in front (PMS off) — not changed");
            checkRound++;
            return;
        }
        if (MainActivity.visible) {
            BootLog.add(this, tag + "OK — welcome screen visible");
            checkRound++; // stop the remaining checks of this round
            return;
        }
        if (!pm.isInteractive()) {
            BootLog.add(this, tag + "screen off (standby) — it opens when the TV is turned on");
            return;
        }
        StringBuilder who = new StringBuilder();
        if (Foreground.guestAppInFront(this, who)) {
            BootLog.add(this, tag + who + " in front — not interrupting the guest");
            checkRound++;
            return;
        }
        if (attempt < last - 1) {
            BootLog.add(this, tag + "not visible → startActivity again");
            MainActivity.bringToFront(this, false, false, why + "-retry" + attempt);
            return;
        }
        // Android did not bring the app forward (background-start limit or the home screen took over): ask the TV's
        // own ADB (authorised in 1.11) to start it. One fixed command; nothing else can be sent this way.
        BootLog.add(this, tag + "not visible → fallback: TV's own ADB «am start»");
        SelfAdbProbe.Result r = SelfAdbProbe.startWelcomeScreen(getFilesDir());
        BootLog.add(this, "self-ADB am start: " + r.status + " — " + r.detail);
    }

    /** 08:00–22:59 on the TV's clock. */
    static boolean dayTime() {
        int h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY);
        return h >= 8 && h < 23;
    }

    /** After the TV gets power: wake the screen once Android has settled (it often boots into standby). */
    static void startPowerOn(Context c) {
        Intent i = new Intent(c, WakeService.class).putExtra("power_on", true);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i); else c.startService(i);
        } catch (RuntimeException ignored) {
            // Not allowed right now; the screen stays in standby and the guest turns it on with the remote.
        }
    }

    private final Runnable powerOn = new Runnable() {
        @Override
        public void run() {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm.isInteractive()) return;
            BootLog.add(WakeService.this, "power-on: waking the screen (daytime)");
            wakeScreen(pm);
            MainActivity.bringToFront(WakeService.this, false, true, "power-on");
        }
    };

    @SuppressWarnings("deprecation")
    private void wakeScreen(PowerManager pm) {
        PowerManager.WakeLock lock = pm.newWakeLock(PowerManager.FULL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, "CoraliTV:urgent");
        lock.acquire(10_000);
    }

    /** /api/public/tv/<token>/urgent: {urgent, wake, screen:{auto, autoOn, autoOff, cmd:{id,on}}}; null when not set up. */
    private JSONObject check() throws Exception {
        Prefs prefs = new Prefs(this);
        if (!prefs.configured()) return null;
        Uri screen = Uri.parse(prefs.screenUrl());
        String token = screen.getLastPathSegment();
        if (token == null) return null;
        // What the PMS shows comes from here: screen on/off as measured now, app version, screen-off permission.
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        boolean blank = new Prefs(this).blank() && BlackScreenActivity.active;
        String state = "?s=" + (pm.isInteractive() && !blank ? 1 : 0) + (blank ? "&bk=1" : "") + "&v=" + VERSION_CODE + "&a=" + (ScreenAdmin.active(this) ? 1 : 0);
        int vol = volume.percent();
        if (vol >= 0) state += "&vol=" + vol;
        state += "&mute=" + (volume.muted() ? 1 : 0) + "&fixed=" + (volume.fixed() ? 1 : 0);
        if (clamped) { state += "&clamped=1"; clamped = false; }
        // The policy revision this TV holds and applies (the PMS confirms resets / policy changes with it).
        try {
            long rev = new JSONObject(new Prefs(this).soundPolicy()).optLong("rev", 0);
            if (rev > 0) state += "&prev=" + rev;
        } catch (Exception ignored) { }
        // 1.14: the factory menu lock as it really is (enabled states, read without ADB).
        state += "&lk=" + MenuLock.read(this) + "&mk=" + MenuLock.flags(this);
        state += NetworkStandbyManager.get(this).query();
        long bl = PrivacyAgent.baselineAt(this);
        if (bl > 0) state += "&bl=" + bl;
        if (System.currentTimeMillis() - capsSentAt > CAPS_EVERY_MS) {
            state += "&caps=" + Uri.encode(volume.capabilities().toString());
            capsSentAt = System.currentTimeMillis();
        }
        URL url = new URL(screen.getScheme() + "://" + screen.getAuthority() + "/api/public/tv/" + Uri.encode(token) + "/urgent" + state);
        HttpURLConnection http = (HttpURLConnection) url.openConnection();
        try {
            http.setConnectTimeout(15_000);
            http.setReadTimeout(15_000);
            if (http.getResponseCode() != 200) { Log.w(TAG, "check → HTTP " + http.getResponseCode()); return null; }
            InputStream in = http.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[2048];
            for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
            JSONObject r = new JSONObject(buf.toString("UTF-8"));
            return r.optBoolean("ok") ? r : null;
        } finally {
            http.disconnect();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Corali TV", NotificationManager.IMPORTANCE_MIN));
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this);
        }
        Notification n = b.setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setContentTitle("Corali TV")
                .setContentText(Prefs.t("Οθόνη καλωσορίσματος ενεργή", "Welcome screen active"))
                .build();
        startForeground(1, n);
        registerReceiver(screenOn, new IntentFilter(Intent.ACTION_SCREEN_ON));
        // 1.15: the CPU / Wi-Fi locks live in NetworkStandbyManager (on by default; the PMS can switch it off per room).
        NetworkStandbyManager.get(this).setEnabled(new Prefs(this).networkStandby());
        worker = new HandlerThread("corali-urgent");
        worker.start();
        background = new Handler(worker.getLooper());
        volume = new VolumeController(this);
        // A volume change from the remote or another app: check the maximum at once (besides every 20 s).
        volumeWatch = new ContentObserver(background) {
            @Override
            public void onChange(boolean selfChange) { enforceMax(); }
        };
        try { getContentResolver().registerContentObserver(Settings.System.CONTENT_URI, true, volumeWatch); } catch (RuntimeException ignored) { }
        background.post(new Runnable() { @Override public void run() { applyPowerOnVolume(); } });
        background.postDelayed(checkUrgent, 10_000);
        // 1.20: report an update that restarted the app (after the network is up).
        background.postDelayed(new Runnable() { @Override public void run() { updateResult(); } }, 5_000);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getBooleanExtra("boot", false)) {
            BootLog.add(this, "SERVICE running after boot");
            scheduleVisibleChecks("boot", new long[]{4_000, 12_000, 25_000, 45_000, 75_000});
        }
        if (intent != null && intent.getBooleanExtra("power_on", false)) {
            // A few tries: some TVs finish starting (and go to standby) a few seconds after boot.
            for (long delay : new long[]{2_000, 8_000, 20_000}) background.postDelayed(powerOn, delay);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        unregisterReceiver(screenOn);
        if (volumeWatch != null) getContentResolver().unregisterContentObserver(volumeWatch);
        NetworkStandbyManager.get(this).release();
        background.removeCallbacks(checkUrgent);
        background.removeCallbacks(powerOn);
        worker.quit();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}

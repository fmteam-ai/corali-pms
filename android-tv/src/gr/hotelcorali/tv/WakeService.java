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
import android.net.wifi.WifiManager;
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
    static final int VERSION_CODE = 12;
    private static final long CAPS_EVERY_MS = 10 * 60_000;
    private static final long URGENT_CHECK_MS = 20_000;

    private HandlerThread worker;
    private Handler background;
    // Keep the processor and Wi-Fi awake while the screen is off, so the PMS can turn the screen on again.
    private PowerManager.WakeLock cpuLock;
    private WifiManager.WifiLock wifiLock;
    // Sound (v159): volume / mute, the room's sound policy, and when capabilities were last reported.
    private VolumeController volume;
    private volatile boolean clamped;
    private long capsSentAt;
    private ContentObserver volumeWatch;

    private final BroadcastReceiver screenOn = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            Prefs prefs = new Prefs(context);
            if (prefs.configured() && prefs.openOnWake()) MainActivity.bringToFront(context, false, false);
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
        long verifyAfter;
        if ("SCREEN_ON".equals(type)) {
            if (!pm.isInteractive()) wakeScreen(pm);
            MainActivity.bringToFront(this, false, true);
            verifyAfter = 5_000;
        } else if ("SCREEN_OFF".equals(type)) {
            if (!ScreenAdmin.active(this)) { report(id, false, pm.isInteractive(), "NO_SCREEN_OFF_PERMISSION"); return; }
            if (pm.isInteractive() && !ScreenAdmin.screenOff(this)) { report(id, false, pm.isInteractive(), "LOCK_FAILED"); return; }
            verifyAfter = 3_000;
        } else if ("SHOW_WELCOME".equals(type)) {
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
            wakeScreen(pm);
            MainActivity.bringToFront(WakeService.this, false, true);
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
        String state = "?s=" + (pm.isInteractive() ? 1 : 0) + "&v=" + VERSION_CODE + "&a=" + (ScreenAdmin.active(this) ? 1 : 0);
        int vol = volume.percent();
        if (vol >= 0) state += "&vol=" + vol;
        state += "&mute=" + (volume.muted() ? 1 : 0) + "&fixed=" + (volume.fixed() ? 1 : 0);
        if (clamped) { state += "&clamped=1"; clamped = false; }
        // The policy revision this TV holds and applies (the PMS confirms resets / policy changes with it).
        try {
            long rev = new JSONObject(new Prefs(this).soundPolicy()).optLong("rev", 0);
            if (rev > 0) state += "&prev=" + rev;
        } catch (Exception ignored) { }
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
        try {
            cpuLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CoraliTV:online");
            cpuLock.setReferenceCounted(false);
            cpuLock.acquire();
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "CoraliTV:online");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        } catch (RuntimeException ignored) {
            // Without the locks the app still works while the screen is on.
        }
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
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
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
        if (cpuLock != null && cpuLock.isHeld()) cpuLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        background.removeCallbacks(checkUrgent);
        background.removeCallbacks(powerOn);
        worker.quit();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}

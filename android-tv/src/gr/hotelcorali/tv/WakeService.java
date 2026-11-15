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
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Runs while the TV is on (and, holding the processor and Wi-Fi awake, while only the screen is off): brings the welcome screen back when the TV wakes from standby (if enabled) and, every
 * minute, checks for an urgent reception message, which brings Corali TV to the front over Netflix / live TV.
 */
public class WakeService extends Service {
    private static final String CHANNEL = "corali_tv";
    private static final long URGENT_CHECK_MS = 20_000;

    private HandlerThread worker;
    private Handler background;
    // Keep the processor and Wi-Fi awake while the screen is off, so the PMS can turn the screen on again.
    private PowerManager.WakeLock cpuLock;
    private WifiManager.WifiLock wifiLock;

    private final BroadcastReceiver screenOn = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            Prefs prefs = new Prefs(context);
            if (prefs.configured() && prefs.openOnWake()) MainActivity.bringToFront(context, false, false);
        }
    };

    private final Runnable checkUrgent = new Runnable() {
        @Override
        public void run() {
            try {
                JSONObject r = check();
                if (r != null) {
                    urgent(r);
                    screen(r.optJSONObject("screen"));
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
     * Screen on / off from the PMS (TV left powered): acts when the automatic decision changes (arrival / check-in →
     * on, check-out → off) or a new manual command arrives — never fights the guest's own remote in between.
     */
    private void screen(JSONObject s) {
        if (s == null) return;
        Prefs prefs = new Prefs(this);
        String auto = s.isNull("auto") ? "" : s.optString("auto", "");
        Boolean target = null;
        if (!auto.isEmpty() && !auto.equals(prefs.lastScreenAuto())) {
            boolean first = prefs.lastScreenAuto().isEmpty();
            prefs.setLastScreenAuto(auto);
            // The first answer after install only records the state.
            if (!first) {
                if ("on".equals(auto) && s.optBoolean("autoOn")) target = Boolean.TRUE;
                if ("off".equals(auto) && s.optBoolean("autoOff")) target = Boolean.FALSE;
            }
        }
        JSONObject cmd = s.optJSONObject("cmd");
        if (cmd != null) {
            long id = cmd.optLong("id", 0);
            if (id > 0 && id != prefs.lastScreenCmd()) {
                boolean first = prefs.lastScreenCmd() == 0;
                prefs.setLastScreenCmd(id);
                // A command older than 10 minutes (TV was offline) is stale.
                if (!first || System.currentTimeMillis() - id < 600_000) target = cmd.optBoolean("on");
            }
        }
        if (target == null) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (target) {
            if (!pm.isInteractive()) wakeScreen(pm);
            MainActivity.bringToFront(this, false, true);
        } else if (pm.isInteractive()) {
            ScreenAdmin.screenOff(this);
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
        URL url = new URL(screen.getScheme() + "://" + screen.getAuthority() + "/api/public/tv/" + Uri.encode(token) + "/urgent");
        HttpURLConnection http = (HttpURLConnection) url.openConnection();
        try {
            http.setConnectTimeout(15_000);
            http.setReadTimeout(15_000);
            if (http.getResponseCode() != 200) return null;
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

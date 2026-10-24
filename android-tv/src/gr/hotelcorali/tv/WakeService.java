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
 * Runs while the TV is on: brings the welcome screen back when the TV wakes from standby (if enabled) and, every
 * minute, checks for an urgent reception message, which brings Corali TV to the front over Netflix / live TV.
 */
public class WakeService extends Service {
    private static final String CHANNEL = "corali_tv";
    private static final long URGENT_CHECK_MS = 60_000;

    private HandlerThread worker;
    private Handler background;

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
                long[] urgent = urgentMessage();
                long id = urgent[0];
                boolean wake = urgent[1] == 1;
                Prefs prefs = new Prefs(WakeService.this);
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                if (id > 0 && id != prefs.lastUrgent()) {
                    if (pm.isInteractive()) {
                        prefs.setLastUrgent(id);
                        MainActivity.bringToFront(WakeService.this, true, false);
                    } else if (wake) {
                        // "Turn the TV on": wake the screen from standby, then show the message.
                        prefs.setLastUrgent(id);
                        wakeScreen(pm);
                        MainActivity.bringToFront(WakeService.this, true, true);
                    }
                    // Otherwise it waits: when the TV is turned on, the welcome screen opens with the message.
                }
            } catch (Exception ignored) {
                // Offline or server busy: try again next minute.
            }
            background.postDelayed(this, URGENT_CHECK_MS);
        }
    };

    static void start(Context c) {
        Intent i = new Intent(c, WakeService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i); else c.startService(i);
        } catch (RuntimeException ignored) {
            // Not allowed right now (background limits); the next start-up or app launch tries again.
        }
    }

    @SuppressWarnings("deprecation")
    private void wakeScreen(PowerManager pm) {
        PowerManager.WakeLock lock = pm.newWakeLock(PowerManager.FULL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, "CoraliTV:urgent");
        lock.acquire(10_000);
    }

    /** {newest unseen urgent message id (0 when none), 1 when it should turn the TV on} from /api/public/tv/<token>/urgent. */
    private long[] urgentMessage() throws Exception {
        long[] none = {0, 0};
        Prefs prefs = new Prefs(this);
        if (!prefs.configured()) return none;
        Uri screen = Uri.parse(prefs.screenUrl());
        String token = screen.getLastPathSegment();
        if (token == null) return none;
        URL url = new URL(screen.getScheme() + "://" + screen.getAuthority() + "/api/public/tv/" + Uri.encode(token) + "/urgent");
        HttpURLConnection http = (HttpURLConnection) url.openConnection();
        try {
            http.setConnectTimeout(15_000);
            http.setReadTimeout(15_000);
            if (http.getResponseCode() != 200) return none;
            InputStream in = http.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[2048];
            for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
            JSONObject r = new JSONObject(buf.toString("UTF-8"));
            return r.optBoolean("ok") ? new long[]{r.optLong("urgent", 0), r.optBoolean("wake") ? 1 : 0} : none;
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
        worker = new HandlerThread("corali-urgent");
        worker.start();
        background = new Handler(worker.getLooper());
        background.postDelayed(checkUrgent, 10_000);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) { return START_STICKY; }

    @Override
    public void onDestroy() {
        unregisterReceiver(screenOn);
        background.removeCallbacks(checkUrgent);
        worker.quit();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}

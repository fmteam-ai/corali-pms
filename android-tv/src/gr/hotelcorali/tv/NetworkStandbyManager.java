package gr.hotelcorali.tv;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.PowerManager;

import java.lang.reflect.Method;

/**
 * Corali TV 1.15 (PMS v164): one owner for the locks that keep the TV reachable while the screen is off.
 *
 * - CPU: PowerManager.PARTIAL_WAKE_LOCK (never a screen / full wake lock for this purpose).
 * - Wi-Fi: WifiManager.WifiLock in WIFI_MODE_FULL_HIGH_PERF. Deprecated in API 34; on Android 14 it may have no effect
 *   (WIFI_MODE_FULL_LOW_LATENCY only works with the screen on and the app in front, so it does not help in standby).
 *   It is kept as best effort; reachability is MEASURED (validated network + the PMS's view of the 20-second checks),
 *   never assumed from the lock. Wi-Fi is never switched on by the app.
 * - Low Power Standby (Android 13+) can make the system ignore wake locks and block the network; its state is read
 *   with the public PowerManager methods (by reflection: this app is compiled against API 30) and reported.
 *
 * Nothing here changes a system setting.
 */
final class NetworkStandbyManager {
    private static NetworkStandbyManager instance;
    private final Context context;
    private PowerManager.WakeLock cpu;
    private WifiManager.WifiLock wifi;
    private boolean enabled;

    private NetworkStandbyManager(Context c) { context = c.getApplicationContext(); }

    static synchronized NetworkStandbyManager get(Context c) {
        if (instance == null) instance = new NetworkStandbyManager(c);
        return instance;
    }

    synchronized void setEnabled(boolean on) {
        if (on == enabled && (!on || cpuHeld())) return;
        enabled = on;
        if (on) acquire(); else release();
        BootLog.add(context, "network standby " + (on ? "ON" : "OFF") + " (cpu " + cpuHeld() + ", wifi " + wifiHeld() + ")");
    }

    synchronized boolean enabled() { return enabled; }

    @SuppressWarnings("deprecation")
    private void acquire() {
        try {
            if (cpu == null) {
                cpu = ((PowerManager) context.getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CoraliTV:network-standby");
                cpu.setReferenceCounted(false);
            }
            if (!cpu.isHeld()) cpu.acquire();
        } catch (RuntimeException e) {
            BootLog.add(context, "cpu wake lock refused: " + e.getClass().getSimpleName());
        }
        try {
            WifiManager wm = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
            if (wm != null && wm.isWifiEnabled()) {
                if (wifi == null) {
                    wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "CoraliTV:network-standby");
                    wifi.setReferenceCounted(false);
                }
                if (!wifi.isHeld()) wifi.acquire();
            }
        } catch (RuntimeException e) {
            BootLog.add(context, "wifi lock refused: " + e.getClass().getSimpleName());
        }
    }

    synchronized void release() {
        try { if (cpu != null && cpu.isHeld()) cpu.release(); } catch (RuntimeException ignored) { }
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (RuntimeException ignored) { }
    }

    synchronized boolean cpuHeld() { return cpu != null && cpu.isHeld(); }

    synchronized boolean wifiHeld() { return wifi != null && wifi.isHeld(); }

    /** "1" / "0", or "x" when this Android has no such method or it failed. */
    static String lowPowerStandby(Context c, String method) {
        if (Build.VERSION.SDK_INT < 33) return "x";
        try {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            Method m = PowerManager.class.getMethod(method);
            Object v = m.invoke(pm);
            return v instanceof Boolean ? ((Boolean) v ? "1" : "0") : "x";
        } catch (Throwable t) {
            return "x";
        }
    }

    static boolean deviceIdle(Context c) {
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isDeviceIdleMode();
    }

    static boolean networkValidated(Context c) {
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm == null ? null : cm.getActiveNetwork();
            NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Query string for the PMS check: ns, cpu, wl, lps (Low Power Standby on), lpx (this app exempt), idl, nv. */
    String query() {
        return "&ns=" + (enabled() ? 1 : 0) + "&cpu=" + (cpuHeld() ? 1 : 0) + "&wl=" + (wifiHeld() ? 1 : 0)
                + "&lps=" + lowPowerStandby(context, "isLowPowerStandbyEnabled") + "&lpx=" + lowPowerStandby(context, "isExemptFromLowPowerStandby")
                + "&idl=" + (deviceIdle(context) ? 1 : 0) + "&nv=" + (networkValidated(context) ? 1 : 0);
    }
}

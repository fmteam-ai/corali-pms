package gr.hotelcorali.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;

import java.util.Locale;

/** Saved set-up of this TV: the room's screen link, the hotel server and whether to come back on wake. */
final class Prefs {
    static final String DEFAULT_SERVER = "https://booking.hotelcorali.gr";

    private final SharedPreferences p;

    Prefs(Context c) { p = c.getSharedPreferences("corali_tv", Context.MODE_PRIVATE); }

    String screenUrl() { return p.getString("screen_url", ""); }
    String room() { return p.getString("room", ""); }
    String server() { return p.getString("server", DEFAULT_SERVER); }
    boolean openOnWake() { return p.getBoolean("open_on_wake", true); }

    void saveScreen(String url, String room, String server) {
        p.edit().putString("screen_url", url).putString("room", room).putString("server", server).apply();
    }
    void setOpenOnWake(boolean on) { p.edit().putBoolean("open_on_wake", on).apply(); }

    boolean configured() { return screenUrl().startsWith("https://"); }

    /** Android 10+ only lets an app open itself from the background with "Display over other apps". */
    static boolean canAutoStart(Context c) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || Settings.canDrawOverlays(c);
    }

    /** Greek or English texts for the set-up screens, following the TV's language. */
    static String t(String el, String en) {
        return "el".equals(Locale.getDefault().getLanguage()) ? el : en;
    }
}

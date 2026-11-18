package gr.hotelcorali.tv;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.provider.Settings;

/**
 * Corali TV 1.14 (PMS v163). The HORIZON's factory «Lock Menu Key» (com.expressluck.tvfactory, system app) locks by
 * DISABLING the TV's Settings app and the Google TV side panel (two launcher components); hotel_menu_key_lock alone
 * is not proof. This app only READS those three enabled states (PackageManager, no permission, no ADB) and can OPEN the
 * exported Factory Menu for a technician. It never changes a factory setting itself — Android does not allow it.
 *
 * 1.16: also reads the factory's own flags (Settings.Global hotel_menu_key_lock and hotel_enable, readable by any
 * app) and opens the «Engineer Mode Option» page directly, for MenuLockService (Lock / Unlock from the PMS).
 */
final class MenuLock {
    static final String SETTINGS = "com.android.tv.settings";
    static final ComponentName DASHBOARD_ACTIVITY = new ComponentName("com.google.android.apps.tv.launcherx", "com.google.android.apps.tv.launcherx.dashboard.DashboardActivity");
    static final ComponentName DASHBOARD_HANDLER = new ComponentName("com.google.android.apps.tv.launcherx", "com.google.android.apps.tv.launcherx.dashboard.DashboardHandler");
    static final String FACTORY_ACTION = "com.realtek.factory.action.FACTORY_MENU";
    static final ComponentName FACTORY_MENU = new ComponentName("com.expressluck.tvfactory", "com.expressluck.tvfactory.FactoryMenuActivity");

    private MenuLock() {}

    /** "s<n>a<n>h<n>": COMPONENT_ENABLED_STATE (0 default, 1 enabled, 2 disabled, 3 disabled by user, 4 until used) or x. */
    static String read(Context c) {
        PackageManager pm = c.getPackageManager();
        return "s" + app(pm) + "a" + component(pm, DASHBOARD_ACTIVITY) + "h" + component(pm, DASHBOARD_HANDLER);
    }

    /** 1.16: "g<n>e<n>": Settings.Global hotel_menu_key_lock and hotel_enable (Hotel Status), 0..9 or x. */
    static String flags(Context c) {
        return "g" + global(c, "hotel_menu_key_lock") + "e" + global(c, "hotel_enable");
    }

    /** read() + flags(): what a Lock / Unlock command reports back. */
    static String readFull(Context c) { return read(c) + flags(c); }

    static int globalInt(Context c, String name) {
        try { return Settings.Global.getInt(c.getContentResolver(), name, 0); } catch (RuntimeException e) { return -1; }
    }

    private static String global(Context c, String name) {
        int v = globalInt(c, name);
        return v >= 0 && v <= 9 ? String.valueOf(v) : "x";
    }

    /** The three enabled states all «disabled» (LOCKED) or all «enabled / default» (UNLOCKED), as the PMS decides. */
    static boolean matches(Context c, boolean lock) {
        String r = read(c);
        if (r.indexOf('x') >= 0) return false;
        for (int i = 1; i < 6; i += 2) {
            char d = r.charAt(i);
            boolean off = d == '2' || d == '3' || d == '4';
            if (lock != off) return false;
        }
        return globalInt(c, "hotel_menu_key_lock") == (lock ? 1 : 0);
    }

    /**
     * 1.16: the factory menu straight on «Engineer Mode Option» (FactoryMenuActivity.HotelJump: extra startHotel with
     * showHotel = 1; the same exported activity as openFactoryMenu, no permission). A new task, so onCreate runs.
     */
    static boolean openEngineerPage(Context c) {
        Bundle b = new Bundle();
        b.putInt("showHotel", 1);
        Intent i = new Intent(FACTORY_ACTION).setComponent(FACTORY_MENU).putExtra("startHotel", b)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        try {
            c.startActivity(i);
            return true;
        } catch (RuntimeException e) {
            BootLog.add(c, "engineer page REFUSED: " + e.getClass().getSimpleName());
            return false;
        }
    }

    private static String app(PackageManager pm) {
        try { return digit(pm.getApplicationEnabledSetting(SETTINGS)); } catch (RuntimeException e) { return "x"; }
    }

    private static String component(PackageManager pm, ComponentName n) {
        try { return digit(pm.getComponentEnabledSetting(n)); } catch (RuntimeException e) { return "x"; }
    }

    private static String digit(int v) { return v >= 0 && v <= 4 ? String.valueOf(v) : "x"; }

    /** Opens the Factory Menu (exported activity, no permission). False if Android refused or it is not on this TV. */
    static boolean openFactoryMenu(Context c) {
        Intent i = new Intent(FACTORY_ACTION).setComponent(FACTORY_MENU).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
            BootLog.add(c, "factory menu: startActivity sent");
            return true;
        } catch (RuntimeException e) {
            BootLog.add(c, "factory menu REFUSED: " + e.getClass().getSimpleName());
            return false;
        }
    }
}

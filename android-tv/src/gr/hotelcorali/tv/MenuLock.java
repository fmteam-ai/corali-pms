package gr.hotelcorali.tv;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

/**
 * Corali TV 1.14 (PMS v163). The HORIZON's factory «Lock Menu Key» (com.expressluck.tvfactory, system app) locks by
 * DISABLING the TV's Settings app and the Google TV side panel (two launcher components); hotel_menu_key_lock alone
 * is not proof. This app only READS those three enabled states (PackageManager, no permission, no ADB) and can OPEN the
 * exported Factory Menu for a technician. It never changes a factory setting itself — Android does not allow it.
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

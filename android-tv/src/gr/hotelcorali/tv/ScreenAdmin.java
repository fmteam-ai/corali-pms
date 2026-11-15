package gr.hotelcorali.tv;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;

/** "Turn screen off" permission (device admin, force-lock only): lets Corali TV switch the screen off from the PMS. */
public class ScreenAdmin extends DeviceAdminReceiver {
    static ComponentName name(Context c) { return new ComponentName(c, ScreenAdmin.class); }

    static boolean active(Context c) {
        DevicePolicyManager dpm = (DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return dpm != null && dpm.isAdminActive(name(c));
    }

    /** Screen off (backlight off); Android keeps running, so the app can turn it on again. False without the permission. */
    static boolean screenOff(Context c) {
        if (!active(c)) return false;
        try {
            ((DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE)).lockNow();
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }
}

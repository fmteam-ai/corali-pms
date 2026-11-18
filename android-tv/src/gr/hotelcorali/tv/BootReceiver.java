package gr.hotelcorali.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;

/**
 * TV switched on (power back: smart plug / key card / power cut) or app updated: start the service, which shows the
 * welcome screen and checks that it really became visible (1.12: retries, then the TV's own ADB as a fallback).
 * Every step is written to BootLog.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = String.valueOf(intent.getAction());
        Prefs prefs = new Prefs(context);
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        BootLog.add(context, "RECEIVER " + action.replace("android.intent.action.", "") + " · room=" + (prefs.configured() ? prefs.room() : "-")
                + " · overlay=" + (Prefs.canAutoStart(context) ? "yes" : "NO") + " · screen=" + (pm != null && pm.isInteractive() ? "on" : "off"));
        if (!prefs.configured()) { BootLog.add(context, "not set up → nothing to show"); return; }
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            WakeService.start(context);
            return;
        }
        // Light the screen only in the day, so a night-time restart (system update) does not wake a sleeping guest.
        boolean wake = WakeService.dayTime();
        MainActivity.bringToFront(context, false, false, "receiver");
        WakeService.startAfterBoot(context, wake);
    }
}

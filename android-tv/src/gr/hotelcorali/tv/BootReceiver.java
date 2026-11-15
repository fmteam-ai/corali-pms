package gr.hotelcorali.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** TV switched on (power from the key card) or app updated: open the welcome screen and keep the wake watcher running. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Prefs prefs = new Prefs(context);
        if (!prefs.configured()) return;
        WakeService.start(context);
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        // Power came back (smart plug on at arrival / check-in): light the screen too, but only in the day, so a
        // night-time restart of the TV (system update) does not wake a sleeping guest.
        if (WakeService.dayTime()) WakeService.startPowerOn(context);
        MainActivity.bringToFront(context, false, false);
    }
}

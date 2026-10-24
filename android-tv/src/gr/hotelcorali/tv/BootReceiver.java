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
        MainActivity.bringToFront(context, false);
    }
}

package gr.hotelcorali.tv;

import android.content.ContentResolver;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

/**
 * Sound through Android's AudioManager (STREAM_MUSIC: the stream TV apps and the remote's volume keys use on Google
 * TV). Every change is read back, so the PMS shows the real level. Factory Hotel Mode settings are only READ here
 * (for the capability report); nothing vendor-specific is ever written.
 */
final class VolumeController {
    static final int STREAM = AudioManager.STREAM_MUSIC;
    private static final String FACTORY_APP = "com.expressluck.tvfactory";

    private final Context context;
    private final AudioManager audio;

    VolumeController(Context c) {
        context = c.getApplicationContext();
        audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }

    /** Sound cannot be changed by an app (e.g. sound through HDMI ARC to a soundbar). */
    boolean fixed() { return audio == null || audio.isVolumeFixed(); }

    int percent() {
        if (audio == null) return -1;
        int max = audio.getStreamMaxVolume(STREAM);
        return max <= 0 ? -1 : Math.round(audio.getStreamVolume(STREAM) * 100f / max);
    }

    boolean muted() { return audio != null && Build.VERSION.SDK_INT >= 23 && audio.isStreamMute(STREAM); }

    /** Set to a percentage (capped); returns the level read back afterwards. */
    int setPercent(int pct, Integer cap) {
        if (audio == null) return -1;
        int target = Math.max(0, Math.min(100, cap == null ? pct : Math.min(pct, cap)));
        int max = audio.getStreamMaxVolume(STREAM);
        audio.setStreamVolume(STREAM, Math.round(target * max / 100f), 0);
        return percent();
    }

    /** One step up / down (as the remote does), kept under the cap. */
    int step(boolean up, Integer cap) {
        if (audio == null) return -1;
        audio.adjustStreamVolume(STREAM, up ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER, 0);
        if (cap != null && percent() > cap) setPercent(cap, null);
        return percent();
    }

    boolean setMuted(boolean mute) {
        if (audio == null) return false;
        if (Build.VERSION.SDK_INT >= 23) audio.adjustStreamVolume(STREAM, mute ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE, 0);
        else audio.setStreamMute(STREAM, mute);
        return muted();
    }

    /**
     * What this TV can do, each item separately: volume / mute through AudioManager, and — read only — whether the
     * factory app is installed and the values of its Hotel Mode settings, if the TV lets an app read them.
     */
    JSONObject capabilities() {
        JSONObject c = new JSONObject();
        try {
            boolean fixed = fixed();
            c.put("volume", fixed ? "no" : "yes");
            c.put("mute", Build.VERSION.SDK_INT >= 23 && !fixed ? "yes" : "no");
            c.put("fixedVolume", fixed ? "yes" : "no");
            boolean factory;
            try { context.getPackageManager().getPackageInfo(FACTORY_APP, 0); factory = true; } catch (PackageManager.NameNotFoundException e) { factory = false; }
            c.put("factoryApp", factory ? "installed" : "not found");
            c.put("factoryHotelMode", readSetting("hotel_mode"));
            c.put("factoryMaxVolume", readSetting("hotel_max_volume"));
            c.put("factoryPowerVolume", readSetting("hotel_power_volume"));
            c.put("factoryMenuLock", readSetting("hotel_menu_key_lock"));
        } catch (Exception ignored) {
            // Report what could be read.
        }
        return c;
    }

    /** Read-only lookup in the standard settings tables; "not readable" when the TV keeps it private. */
    private String readSetting(String key) {
        ContentResolver cr = context.getContentResolver();
        String v = null;
        try { v = Settings.Global.getString(cr, key); } catch (RuntimeException ignored) { }
        if (v == null) try { v = Settings.System.getString(cr, key); } catch (RuntimeException ignored) { }
        if (v == null) try { v = Settings.Secure.getString(cr, key); } catch (RuntimeException ignored) { }
        if (v == null) return "not readable";
        String clean = v.replaceAll("[^A-Za-z0-9_.:-]", "");
        return "read: " + (clean.length() > 20 ? clean.substring(0, 20) : clean);
    }
}

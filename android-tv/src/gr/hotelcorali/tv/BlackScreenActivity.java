package gr.hotelcorali.tv;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;

/**
 * Corali TV 1.16 — PMS «off» as a black screen (room setting power_off_mode = black_screen, experimental).
 *
 * The HORIZON firmware restores the last power state after a power cut: a TV in standby (remote, lockNow, sleep key)
 * stays fully off, without Android, until someone presses power. With this mode the PMS «off» does not put the TV in
 * standby: the screen shows black with the window backlight at its minimum and the TV stays technically on, so after
 * a power cut it starts again by itself, reconnects to the PMS and comes back to this black screen (Prefs.blank).
 * Any remote key (except volume) leaves it and shows the welcome screen; the remote's power key still puts the TV
 * in real standby, which ends the black screen. It uses more power than standby and the panel may glow slightly:
 * a choice per room, for empty rooms, to be tested first.
 */
public class BlackScreenActivity extends Activity {
    /** true while the black screen is in front (onResume … onPause). */
    static volatile boolean active;
    private static volatile BlackScreenActivity current;

    static void show(Context c, String why) {
        new Prefs(c).setBlank(true);
        BootLog.add(c, "black screen on (" + why + ")");
        Intent i = new Intent(c, BlackScreenActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try { c.startActivity(i); } catch (RuntimeException e) { BootLog.add(c, "black screen REFUSED: " + e.getClass().getSimpleName()); }
    }

    /** Leaves the black screen (PMS ON); the caller brings the welcome screen. */
    static void hide(Context c) {
        new Prefs(c).setBlank(false);
        BlackScreenActivity a = current;
        if (a != null) a.finish();
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        View v = new View(this);
        v.setBackgroundColor(Color.BLACK);
        setContentView(v);
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = 0f; // lowest backlight the TV allows for this window
        getWindow().setAttributes(lp);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        current = this;
    }

    @Override
    protected void onResume() { super.onResume(); active = true; }

    @Override
    protected void onPause() { active = false; super.onPause(); }

    /** Covered or the TV went to real standby: the black screen is over (the welcome screen opens next time). */
    @Override
    protected void onStop() {
        super.onStop();
        if (!isChangingConfigurations() && !isFinishing()) {
            new Prefs(this).setBlank(false);
            BootLog.add(this, "black screen ended (covered or standby)");
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_MUTE) return super.onKeyDown(keyCode, event);
        // A guest (or staff) with the remote: «turn the TV on» = the welcome screen.
        new Prefs(this).setBlank(false);
        BootLog.add(this, "black screen ended by the remote");
        MainActivity.bringToFront(this, false, false, "black-screen-key");
        finish();
        return true;
    }
}

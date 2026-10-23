package gr.hotelcorali.tv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Staff set-up: connect this TV to a room with the 6-digit code from PMS → Corali TV, and allow auto-start. */
public class SetupActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private Prefs prefs;
    private EditText code;
    private EditText server;
    private TextView status;
    private TextView autoStart;
    private Button connect;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = new Prefs(this);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(96, 56, 96, 56);
        box.setBackgroundColor(Color.rgb(15, 52, 62));

        box.addView(text("Corali TV", 40, true));
        box.addView(text(prefs.configured()
                ? Prefs.t("Συνδεδεμένη με το δωμάτιο ", "Connected to room ") + prefs.room()
                : Prefs.t("Η τηλεόραση δεν έχει συνδεθεί ακόμα με δωμάτιο.", "This TV is not connected to a room yet."), 22, false));

        box.addView(text(Prefs.t("Κωδικός από το PMS → Corali TV → «Κωδικός εφαρμογής»", "Code from PMS → Corali TV → “App code”"), 20, false));
        code = new EditText(this);
        code.setInputType(InputType.TYPE_CLASS_NUMBER);
        code.setFilters(new InputFilter[]{new InputFilter.LengthFilter(6)});
        code.setTextSize(34);
        code.setTextColor(Color.WHITE);
        code.setHint("000000");
        code.setHintTextColor(Color.GRAY);
        code.setSingleLine(true);
        box.addView(code, new LinearLayout.LayoutParams(420, -2));

        connect = button(Prefs.t("Σύνδεση", "Connect"));
        connect.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) { redeem(); }
        });
        box.addView(connect);

        status = text("", 20, false);
        status.setTextColor(Color.rgb(242, 196, 109));
        box.addView(status);

        autoStart = text("", 20, false);
        box.addView(autoStart);
        Button allow = button(Prefs.t("Άδεια αυτόματης εκκίνησης", "Allow auto-start"));
        allow.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) { openOverlaySettings(); }
        });
        box.addView(allow);

        CheckBox wake = new CheckBox(this);
        wake.setText(Prefs.t("Άνοιγμα της οθόνης όταν ανάβει η τηλεόραση από αναμονή", "Open the screen when the TV wakes from standby"));
        wake.setTextColor(Color.WHITE);
        wake.setTextSize(20);
        wake.setChecked(prefs.openOnWake());
        wake.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton b, boolean on) {
                prefs.setOpenOnWake(on);
                if (on) WakeService.start(SetupActivity.this); else WakeService.stop(SetupActivity.this);
            }
        });
        box.addView(wake);

        box.addView(text(Prefs.t("Διεύθυνση server (δεν χρειάζεται αλλαγή)", "Server address (no need to change)"), 16, false));
        server = new EditText(this);
        server.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        server.setText(prefs.server());
        server.setTextSize(18);
        server.setTextColor(Color.WHITE);
        server.setSingleLine(true);
        box.addView(server, new LinearLayout.LayoutParams(720, -2));

        if (prefs.configured()) {
            Button back = button(Prefs.t("Επιστροφή στην οθόνη", "Back to the screen"));
            back.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) { finish(); }
            });
            box.addView(back);
        }

        box.addView(text("v" + versionName(), 14, false));

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(15, 52, 62));
        scroll.addView(box);
        setContentView(scroll);
        code.requestFocus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        autoStart.setText(Prefs.canAutoStart(this)
                ? Prefs.t("✓ Αυτόματη εκκίνηση: επιτρέπεται", "✓ Auto-start: allowed")
                : Prefs.t("✗ Αυτόματη εκκίνηση: δεν επιτρέπεται ακόμα — ενεργοποιήστε «Εμφάνιση πάνω από άλλες εφαρμογές».",
                          "✗ Auto-start: not allowed yet — turn on “Display over other apps”."));
    }

    @Override
    public void onBackPressed() {
        // Not set up yet: leave to the TV's home screen instead of returning to an empty welcome screen.
        if (prefs.configured()) super.onBackPressed(); else moveTaskToBack(true);
    }

    private void redeem() {
        final String c = code.getText().toString().trim();
        final String base = server.getText().toString().trim().replaceAll("/+$", "");
        if (!c.matches("\\d{6}")) { status.setText(Prefs.t("Πληκτρολογήστε τους 6 αριθμούς.", "Type the 6 digits.")); return; }
        if (!base.startsWith("https://")) { status.setText(Prefs.t("Ο server πρέπει να ξεκινά με https://", "The server must start with https://")); return; }
        connect.setEnabled(false);
        status.setText(Prefs.t("Σύνδεση…", "Connecting…"));
        new Thread(new Runnable() {
            @Override
            public void run() {
                String error = null, url = null, room = null;
                try {
                    JSONObject r = post(base + "/api/public/tv/setup", new JSONObject().put("code", c).toString());
                    if (r.optBoolean("ok") && r.optString("url").startsWith("https://")) {
                        url = r.getString("url");
                        room = r.optString("roomCode");
                    } else if ("TOO_MANY_ATTEMPTS".equals(r.optString("error"))) {
                        error = Prefs.t("Πολλές προσπάθειες. Δοκιμάστε ξανά σε 30 λεπτά.", "Too many attempts. Try again in 30 minutes.");
                    } else {
                        error = Prefs.t("Λάθος ή ληγμένος κωδικός. Φτιάξτε νέο στο PMS.", "Wrong or expired code. Create a new one in PMS.");
                    }
                } catch (Exception e) {
                    error = Prefs.t("Δεν υπάρχει σύνδεση με τον server. Ελέγξτε το Wi-Fi.", "Cannot reach the server. Check the Wi-Fi.");
                }
                final String fError = error, fUrl = url, fRoom = room;
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        connect.setEnabled(true);
                        if (fError != null) { status.setText(fError); return; }
                        prefs.saveScreen(fUrl, fRoom, base);
                        if (prefs.openOnWake()) WakeService.start(SetupActivity.this);
                        status.setText(Prefs.t("Συνδέθηκε με το δωμάτιο ", "Connected to room ") + fRoom);
                        startActivity(new Intent(SetupActivity.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
                        finish();
                    }
                });
            }
        }).start();
    }

    private static JSONObject post(String address, String body) throws Exception {
        HttpURLConnection http = (HttpURLConnection) new URL(address).openConnection();
        try {
            http.setConnectTimeout(15_000);
            http.setReadTimeout(15_000);
            http.setRequestMethod("POST");
            http.setDoOutput(true);
            http.setRequestProperty("Content-Type", "application/json");
            OutputStream out = http.getOutputStream();
            out.write(body.getBytes(StandardCharsets.UTF_8));
            out.close();
            InputStream in = http.getResponseCode() < 400 ? http.getInputStream() : http.getErrorStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            for (int n; in != null && (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
            return new JSONObject(buf.size() > 0 ? buf.toString("UTF-8") : "{}");
        } finally {
            http.disconnect();
        }
    }

    private void openOverlaySettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));
            } catch (ActivityNotFoundException e2) {
                status.setText(Prefs.t("Αυτή η τηλεόραση δεν έχει τη ρύθμιση. Χρησιμοποιήστε το Projectivy Launcher (άνοιγμα εφαρμογής στην εκκίνηση = Corali TV).",
                        "This TV does not offer the setting. Use Projectivy Launcher (launch app on start-up = Corali TV)."));
            }
        }
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private TextView text(String s, int size, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(Color.WHITE);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, 18, 0, 6);
        return t;
    }

    private Button button(String s) {
        Button b = new Button(this);
        b.setText(s);
        b.setTextSize(20);
        b.setAllCaps(false);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.gravity = Gravity.START;
        lp.topMargin = 8;
        b.setLayoutParams(lp);
        return b;
    }
}

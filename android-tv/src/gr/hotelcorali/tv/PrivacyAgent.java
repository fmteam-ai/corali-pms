package gr.hotelcorali.tv;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Context;
import android.net.Uri;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Corali TV 1.13 (PMS v162): clears THIS TV after a check-out, through its own ADB (Self-ADB), and reports the
 * evidence to the PMS. The PMS keeps the room «pending personal-data clearing» until every step is proven.
 *
 * Steps: clear the data of YouTube / Netflix / Prime Video / Disney+ / YouTube Music (signs the guest out locally);
 * clear the data of apps the guest installed (not in the baseline); approved removals; clear all apps' caches;
 * remove guest profiles (Android users not in the baseline, never user 0); count guest Google accounts and guest
 * Bluetooth pairings (Android lets no app remove those: staff do it, the TV re-checks); back to the welcome home page.
 *
 * Never touched: Wi-Fi, the hotel's Google account, the welcome screen's set-up, sound / Hotel Mode settings,
 * Google / Android / TV-maker apps. Account names and Bluetooth addresses never leave the TV (hashes, counts only).
 */
final class PrivacyAgent {
    static final List<String> APPS = Arrays.asList("com.google.android.youtube.tv", "com.netflix.ninja",
            "com.amazon.amazonvideo.livingroom", "com.disney.disneyplus", "com.google.android.youtube.tvmusic");
    private static final AtomicBoolean RUNNING = new AtomicBoolean(false);

    private PrivacyAgent() {}

    // ---- baseline: saved by staff on the set-up screen with no guest on the TV

    /** Reads and stores the guest-free state. Returns a short summary, or an error text. */
    static String saveBaseline(Context c) {
        File dir = c.getFilesDir();
        SelfAdbProbe.Result third = SelfAdbProbe.shell(dir, "shell:pm list packages -3");
        if (third.status != SelfAdbProbe.Status.PASS) return "✗ ADB: " + third.status;
        SelfAdbProbe.Result users = SelfAdbProbe.shell(dir, "shell:pm list users");
        SelfAdbProbe.Result accounts = SelfAdbProbe.shell(dir, "shell:dumpsys account");
        List<String> acc = accounts.status == SelfAdbProbe.Status.PASS ? PrivacyParse.accountHashes(accounts.detail) : null;
        List<Integer> u = users.status == SelfAdbProbe.Status.PASS ? PrivacyParse.users(users.detail) : new ArrayList<Integer>();
        if (acc == null || !u.contains(0)) return "✗ " + Prefs.t("Δεν διαβάστηκαν λογαριασμοί / προφίλ", "Could not read accounts / profiles");
        List<String> pk = PrivacyParse.packages(third.detail);
        List<String> bt = bonded();
        try {
            long at = System.currentTimeMillis();
            JSONObject b = new JSONObject().put("at", at).put("packages", new JSONArray(pk)).put("accounts", new JSONArray(acc))
                    .put("users", new JSONArray(u)).put("bluetooth", new JSONArray(bt));
            new Prefs(c).setPrivacyBaseline(b.toString());
            BootLog.add(c, "privacy baseline saved: " + pk.size() + " apps, " + acc.size() + " accounts, " + u.size() + " profiles, " + bt.size() + " BT");
            return "✓ " + pk.size() + Prefs.t(" εφαρμογές, ", " apps, ") + acc.size() + Prefs.t(" λογαριασμοί, ", " accounts, ")
                    + u.size() + Prefs.t(" προφίλ, ", " profiles, ") + bt.size() + " Bluetooth";
        } catch (Exception e) {
            return "✗ " + e.getClass().getSimpleName();
        }
    }

    static long baselineAt(Context c) {
        try { return new JSONObject(new Prefs(c).privacyBaseline()).optLong("at", 0); } catch (Exception e) { return 0; }
    }

    // ---- one run, handed out by the PMS in the 20-second check

    static void start(final Context c, final JSONObject task) {
        if (task == null || task.optLong("id", 0) <= 0 || !RUNNING.compareAndSet(false, true)) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try { runTask(c.getApplicationContext(), task); } catch (Exception e) { BootLog.add(c, "privacy run error: " + e.getClass().getSimpleName()); }
                finally { RUNNING.set(false); }
            }
        }, "corali-privacy").start();
    }

    private static void runTask(Context c, JSONObject task) throws Exception {
        long id = task.getLong("id");
        String lease = task.getString("leaseToken");
        File dir = c.getFilesDir();
        JSONObject report = new JSONObject().put("jobId", id).put("leaseToken", lease);
        BootLog.add(c, "privacy job " + id + ": start");

        SelfAdbProbe.Result all = SelfAdbProbe.shell(dir, "shell:pm list packages");
        report.put("adb", all.status.name());
        if (all.status != SelfAdbProbe.Status.PASS) { send(c, report); return; }
        JSONObject base;
        try { base = new JSONObject(new Prefs(c).privacyBaseline()); } catch (Exception e) { base = null; }
        if (base == null || base.optLong("at", 0) <= 0) { report.put("baseline", false); send(c, report); return; }
        report.put("baseline", true);
        List<String> installed = PrivacyParse.packages(all.detail);

        // 1. Streaming apps: clear their data (the guest's sign-in, history, profiles in the app).
        JSONArray results = new JSONArray();
        for (String p : APPS) {
            String status;
            if (!installed.contains(p)) status = "NOT_INSTALLED";
            else status = PrivacyParse.success(run(dir, "shell:pm clear " + p)) ? "CLEARED_LOCAL" : "FAILED";
            results.put(new JSONObject().put("package", p).put("status", status));
        }
        report.put("results", results);

        // 2. Apps the guest installed (not in the baseline): clear their data; approved removals.
        List<String> third = PrivacyParse.packages(run(dir, "shell:pm list packages -3"));
        List<String> guest = new ArrayList<String>();
        for (String p : PrivacyParse.minus(third, strings(base.optJSONArray("packages")))) if (!APPS.contains(p) && !SelfAdbProbe.protectedPackage(p)) guest.add(p);
        JSONArray guestApps = new JSONArray();
        for (String p : guest) guestApps.put(new JSONObject().put("package", p).put("status", PrivacyParse.success(run(dir, "shell:pm clear " + p)) ? "CLEARED_LOCAL" : "FAILED"));
        report.put("guestApps", guestApps);
        JSONArray un = new JSONArray(), todo = task.optJSONArray("uninstall");
        for (int i = 0; todo != null && i < todo.length(); i++) {
            JSONObject t = todo.getJSONObject(i);
            String p = t.optString("package");
            String status = !third.contains(p) ? "NOT_INSTALLED" : !guest.contains(p) ? "BLOCKED_PROTECTED"
                    : PrivacyParse.success(run(dir, "shell:pm uninstall --user 0 " + p)) ? "REMOVED" : "FAILED";
            un.put(new JSONObject().put("id", t.optLong("id")).put("status", status));
        }
        report.put("uninstall", un);

        // 3. Temporary files of all apps.
        SelfAdbProbe.Result cache = SelfAdbProbe.shell(dir, "shell:pm trim-caches 999G");
        report.put("cache", cache.status == SelfAdbProbe.Status.PASS && !cache.detail.contains("Error") && !cache.detail.contains("Exception"));

        // 4. Guest profiles (Android users that are not in the baseline; never user 0).
        List<Integer> baseUsers = ints(base.optJSONArray("users"));
        int removed = 0;
        for (Integer u : PrivacyParse.minus(PrivacyParse.users(run(dir, "shell:pm list users")), baseUsers)) {
            if (u > 0 && PrivacyParse.success(run(dir, "shell:pm remove-user " + u))) removed++;
        }
        SelfAdbProbe.Result users = SelfAdbProbe.shell(dir, "shell:pm list users");
        if (users.status == SelfAdbProbe.Status.PASS && PrivacyParse.users(users.detail).contains(0)) {
            report.put("profiles", PrivacyParse.minus(PrivacyParse.users(users.detail), baseUsers).size());
        }
        report.put("profilesRemoved", removed);

        // 5. Guest Google accounts (counted, never named; staff remove them, the TV re-checks).
        SelfAdbProbe.Result acc = SelfAdbProbe.shell(dir, "shell:dumpsys account");
        List<String> hashes = acc.status == SelfAdbProbe.Status.PASS ? PrivacyParse.accountHashes(acc.detail) : null;
        if (hashes != null) report.put("accounts", PrivacyParse.minus(hashes, strings(base.optJSONArray("accounts"))).size());

        // 6. Guest Bluetooth pairings (counted; the remote is in the baseline).
        report.put("bluetooth", PrivacyParse.minus(bonded(), strings(base.optJSONArray("bluetooth"))).size());

        // 7. Back to the room's welcome home page (its set-up and settings unchanged).
        report.put("welcome", home(c, dir));

        BootLog.add(c, "privacy job " + id + ": done, reporting");
        send(c, report);
    }

    /** Opens the welcome screen's home page; true once MainActivity confirms it (or, with the screen off, it is armed for power-on). */
    private static boolean home(Context c, File dir) throws InterruptedException {
        Prefs prefs = new Prefs(c);
        long since = System.currentTimeMillis();
        prefs.setHomePending(true);
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        boolean on = pm != null && pm.isInteractive();
        if (!on) return true; // TV in standby: the home page opens when it is turned on (SCREEN_ON → MainActivity)
        String o = run(dir, SelfAdbProbe.START_HOME);
        if (!o.contains("Starting") || o.contains("Error")) MainActivity.bringToFront(c, false, false, "privacy-home");
        for (int i = 0; i < 30; i++) {
            if (prefs.homeAt() >= since) return true;
            Thread.sleep(500);
        }
        return false;
    }

    private static String run(File dir, String command) {
        SelfAdbProbe.Result r = SelfAdbProbe.shell(dir, command);
        return r.status == SelfAdbProbe.Status.PASS ? r.detail : "";
    }

    @SuppressWarnings("MissingPermission")
    private static List<String> bonded() {
        List<String> out = new ArrayList<String>();
        try {
            BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
            Set<BluetoothDevice> set = a == null ? null : a.getBondedDevices();
            if (set != null) for (BluetoothDevice d : set) out.add(PrivacyParse.sha("bt|" + d.getAddress()));
        } catch (RuntimeException ignored) {
            // No Bluetooth / not readable: counted as none.
        }
        return PrivacyParse.sorted(out);
    }

    private static List<String> strings(JSONArray a) {
        List<String> out = new ArrayList<String>();
        for (int i = 0; a != null && i < a.length(); i++) out.add(a.optString(i));
        return out;
    }

    private static List<Integer> ints(JSONArray a) {
        List<Integer> out = new ArrayList<Integer>();
        for (int i = 0; a != null && i < a.length(); i++) out.add(a.optInt(i));
        return out;
    }

    private static void send(Context c, JSONObject report) {
        Prefs prefs = new Prefs(c);
        Uri screen = Uri.parse(prefs.screenUrl());
        String token = screen.getLastPathSegment();
        if (token == null) return;
        HttpURLConnection http = null;
        try {
            URL url = new URL(screen.getScheme() + "://" + screen.getAuthority() + "/api/public/tv/" + Uri.encode(token) + "/privacy");
            http = (HttpURLConnection) url.openConnection();
            http.setConnectTimeout(15_000);
            http.setReadTimeout(15_000);
            http.setRequestMethod("POST");
            http.setDoOutput(true);
            http.setRequestProperty("Content-Type", "application/json");
            OutputStream out = http.getOutputStream();
            out.write(report.toString().getBytes("UTF-8"));
            out.close();
            BootLog.add(c, "privacy report → HTTP " + http.getResponseCode());
        } catch (Exception e) {
            BootLog.add(c, "privacy report failed: " + e.getClass().getSimpleName() + " (the PMS retries)");
        } finally {
            if (http != null) http.disconnect();
        }
    }
}

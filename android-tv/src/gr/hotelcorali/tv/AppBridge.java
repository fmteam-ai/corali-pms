package gr.hotelcorali.tv;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;

/**
 * window.CoraliTVApp on the welcome page: which streaming apps (Netflix, YouTube, ...) are installed on this TV, and
 * open one. Only launches apps that have a TV or phone launcher entry; it cannot read or change their data.
 */
public class AppBridge {
    private final Activity activity;

    AppBridge(Activity activity) {
        this.activity = activity;
    }

    private Intent launchIntent(String pkg) {
        PackageManager pm = activity.getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        return i != null ? i : pm.getLaunchIntentForPackage(pkg);
    }

    /** JSON array in, JSON array out: the given package names that can be opened on this TV. */
    @JavascriptInterface
    public String installed(String packagesJson) {
        JSONArray out = new JSONArray();
        try {
            JSONArray in = new JSONArray(packagesJson);
            for (int i = 0; i < in.length() && i < 64; i++) {
                String pkg = in.optString(i, "");
                if (pkg.matches("[a-zA-Z][\\w]*(\\.[a-zA-Z][\\w]*)+") && launchIntent(pkg) != null) out.put(pkg);
            }
        } catch (Exception ignored) {
            // Bad input: nothing is reported as installed.
        }
        return out.toString();
    }

    @JavascriptInterface
    public boolean open(String pkg) {
        if (pkg == null || pkg.equals(activity.getPackageName())) return false;
        final Intent i = launchIntent(pkg);
        if (i == null) return false;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try { activity.startActivity(i); } catch (RuntimeException ignored) { /* app removed meanwhile */ }
            }
        });
        return true;
    }
}

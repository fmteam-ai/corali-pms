package gr.hotelcorali.tv;

import android.content.Context;
import android.net.Uri;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.regex.Pattern;

/**
 * 1.20 (v172): the app updates itself from the PMS (APP_UPDATE). It downloads the APK named by the PMS from its OWN
 * server (the origin of the room's screen link; never another host), checks its SHA-256 against the PMS's value, and
 * installs it with one fixed Self-ADB command (pm install -r, no downgrade). Android installs it only if it is signed
 * with the same key as this app. The install restarts the app; the restarted app reports its new versionCode, and the
 * PMS shows EXECUTED only if that is the target. Nothing is shown on the guest's screen.
 */
final class AppUpdater {
    /** The only file the update is written to (shared storage of this app, readable by the TV's own ADB shell). */
    static final String FILE_NAME = "corali-update.apk";
    private static final Pattern APK = Pattern.compile("[a-z0-9][a-z0-9.-]{0,60}\\.apk");
    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");
    private static final long MAX_BYTES = 30L * 1024 * 1024;

    private AppUpdater() {}

    static boolean validFile(String file) { return file != null && APK.matcher(file).matches(); }
    static boolean validSha(String sha) { return sha != null && SHA256.matcher(sha).matches(); }

    /** The download URL: the screen link's own scheme and host + /downloads/<file>; null if anything is off. */
    static String downloadUrl(String screenUrl, String file) {
        if (!validFile(file) || screenUrl == null) return null;
        Uri u = Uri.parse(screenUrl);
        if (!"https".equals(u.getScheme()) || u.getAuthority() == null || u.getAuthority().isEmpty()) return null;
        return "https://" + u.getAuthority() + "/downloads/" + file;
    }

    /** The install command for the file at {@code path}; it must be one SelfAdbProbe allows. */
    static String installCommand(String path) { return "shell:pm install -r " + path; }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    /** Download to the app's shared files directory and check the hash. Returns the file, or throws with a short code. */
    static File download(Context c, String url, String sha) throws Exception {
        File dir = c.getExternalFilesDir(null);
        if (dir == null) throw new Exception("NO_STORAGE");
        File out = new File(dir, FILE_NAME);
        if (out.exists() && !out.delete()) throw new Exception("OLD_FILE_LOCKED");
        HttpURLConnection http = (HttpURLConnection) new URL(url).openConnection();
        http.setConnectTimeout(20_000);
        http.setReadTimeout(60_000);
        http.setInstanceFollowRedirects(false);
        try {
            if (http.getResponseCode() != 200) throw new Exception("HTTP_" + http.getResponseCode());
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            InputStream in = http.getInputStream();
            FileOutputStream fo = new FileOutputStream(out);
            long total = 0;
            try {
                byte[] buf = new byte[16 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) throw new Exception("TOO_LARGE");
                    md.update(buf, 0, n);
                    fo.write(buf, 0, n);
                }
            } finally {
                fo.close();
                in.close();
            }
            if (!hex(md.digest()).equals(sha)) { out.delete(); throw new Exception("HASH_MISMATCH"); }
            out.setReadable(true, false);
            return out;
        } finally {
            http.disconnect();
        }
    }
}

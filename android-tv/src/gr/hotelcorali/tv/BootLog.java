package gr.hotelcorali.tv;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 1.12 pilot: what happened at start-up (receiver, service, each attempt to show the welcome screen, and whether it
 * became visible), kept in the app's private storage (last 120 lines) so it survives a reboot and can be read on the
 * set-up screen. Also in logcat: adb logcat -s CoraliBoot. Contains no guest data, codes or keys.
 */
final class BootLog {
    static final String TAG = "CoraliBoot";
    private static final int KEEP = 120;
    private static final String FILE = "boot_log.txt";

    private BootLog() {}

    static synchronized void add(Context c, String msg) {
        Log.i(TAG, msg);
        try {
            List<String> lines = lines(c);
            lines.add(new SimpleDateFormat("dd/MM HH:mm:ss", Locale.US).format(new Date()) + "  " + msg);
            while (lines.size() > KEEP) lines.remove(0);
            StringBuilder sb = new StringBuilder();
            for (String l : lines) sb.append(l).append('\n');
            File f = new File(c.getFilesDir(), FILE + ".tmp");
            FileOutputStream out = new FileOutputStream(f);
            try { out.write(sb.toString().getBytes(StandardCharsets.UTF_8)); } finally { out.close(); }
            if (!f.renameTo(new File(c.getFilesDir(), FILE))) Log.w(TAG, "boot log not saved");
        } catch (Exception e) {
            Log.w(TAG, "boot log: " + e);
        }
    }

    /** The last {@code n} lines, newest last. */
    static synchronized String tail(Context c, int n) {
        List<String> lines = lines(c);
        StringBuilder sb = new StringBuilder();
        for (int i = Math.max(0, lines.size() - n); i < lines.size(); i++) sb.append(lines.get(i)).append('\n');
        return sb.toString();
    }

    private static List<String> lines(Context c) {
        File f = new File(c.getFilesDir(), FILE);
        if (!f.isFile()) return new ArrayList<String>();
        try {
            byte[] raw = new byte[(int) Math.min(f.length(), 64 * 1024)];
            FileInputStream in = new FileInputStream(f);
            try { int off = 0; while (off < raw.length) { int r = in.read(raw, off, raw.length - off); if (r < 0) break; off += r; } } finally { in.close(); }
            String s = new String(raw, StandardCharsets.UTF_8).trim();
            return s.isEmpty() ? new ArrayList<String>() : new ArrayList<String>(Arrays.asList(s.split("\n")));
        } catch (Exception e) {
            return new ArrayList<String>();
        }
    }
}

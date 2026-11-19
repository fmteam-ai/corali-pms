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
 * became visible), kept in the app's private storage so it survives a reboot and can be read on the set-up screen.
 * 1.19: only the last 24 hours are kept (each line starts with its time in ms; older lines and lines without a time,
 * from older versions, are dropped). Also in logcat: adb logcat -s CoraliBoot. Contains no guest data, codes or keys.
 */
final class BootLog {
    static final String TAG = "CoraliBoot";
    /** Lines older than this are dropped. */
    static final long KEEP_MS = 24L * 60 * 60 * 1000;
    /** Safety cap on the number of lines (a TV that logs in a loop). */
    private static final int MAX_LINES = 400;
    private static final String FILE = "boot_log.txt";

    private BootLog() {}

    static synchronized void add(Context c, String msg) {
        Log.i(TAG, msg);
        try {
            long now = System.currentTimeMillis();
            List<String> lines = recent(lines(c), now);
            lines.add(now + "|" + new SimpleDateFormat("dd/MM HH:mm:ss", Locale.US).format(new Date(now)) + "  " + msg.replace('\n', ' '));
            while (lines.size() > MAX_LINES) lines.remove(0);
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
        List<String> lines = recent(lines(c), System.currentTimeMillis());
        StringBuilder sb = new StringBuilder();
        for (int i = Math.max(0, lines.size() - n); i < lines.size(); i++) sb.append(text(lines.get(i))).append('\n');
        return sb.toString();
    }

    /** The lines of the last 24 hours (a line is «<ms>|<text>»); undated or older lines are dropped. */
    static List<String> recent(List<String> lines, long now) {
        List<String> out = new ArrayList<String>();
        for (String l : lines) {
            long at = at(l);
            if (at > 0 && now - at <= KEEP_MS && at <= now + 60_000L) out.add(l);
        }
        return out;
    }

    /** The line's time in ms, or 0 when it has none. */
    static long at(String line) {
        int bar = line.indexOf('|');
        if (bar <= 0) return 0;
        try { return Long.parseLong(line.substring(0, bar)); } catch (NumberFormatException e) { return 0; }
    }

    /** What is shown: the line without its time in ms. */
    static String text(String line) {
        int bar = line.indexOf('|');
        return bar > 0 && at(line) > 0 ? line.substring(bar + 1) : line;
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

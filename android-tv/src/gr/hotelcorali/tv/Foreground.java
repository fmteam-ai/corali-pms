package gr.hotelcorali.tv;

import android.content.Context;

import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Corali TV 1.15: which app is in front, read through the TV's own ADB (dumpsys activity activities, read-only), so
 * the welcome screen is never pushed over a guest's Google Cast / YouTube / other app. Only the home screen, the
 * screensaver or nothing count as «free» to show the welcome screen.
 */
final class Foreground {
    static final List<String> HOME = Arrays.asList("com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher",
            "com.google.android.leanbacklauncher", "com.google.android.apps.tv.dreamx", "com.android.systemui", "gr.hotelcorali.tv");
    private static final Pattern TOP = Pattern.compile("(?:topResumedActivity|mResumedActivity|ResumedActivity)[:=]\\s*ActivityRecord\\{\\S+ u\\d+ ([a-zA-Z0-9_.]+)/");

    private Foreground() {}

    /** The package in front, or null if it could not be read. */
    static String topPackage(Context c) {
        SelfAdbProbe.Result r = SelfAdbProbe.shell(c.getFilesDir(), "shell:dumpsys activity activities");
        if (r.status != SelfAdbProbe.Status.PASS) return null;
        return parse(r.detail);
    }

    static String parse(String dump) {
        Matcher m = TOP.matcher(dump);
        return m.find() ? m.group(1) : null;
    }

    /** True only when a guest app is known to be in front (unknown → false: the old behaviour applies). */
    static boolean guestAppInFront(Context c, StringBuilder who) {
        String p = topPackage(c);
        if (p == null) return false;
        if (who != null) who.append(p);
        return !HOME.contains(p);
    }
}

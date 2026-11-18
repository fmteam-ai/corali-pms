package gr.hotelcorali.tv;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 1.13: reading the TV's own ADB output for the check-out clearing. Pure (tested on the JVM). Account names and
 * Bluetooth addresses are only ever kept as SHA-256 hashes, compared with the TV's guest-free baseline, and only the
 * COUNT of differences leaves the TV.
 */
final class PrivacyParse {
    private static final Pattern PACKAGE = Pattern.compile("[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z0-9_]+)+");
    private static final Pattern USER = Pattern.compile("UserInfo\\{(\\d+):");
    private static final Pattern ACCOUNT = Pattern.compile("Account \\{name=(.+?), type=([^}\\s]+)\\}");

    private PrivacyParse() {}

    /** "package:x.y" lines of pm list packages. */
    static List<String> packages(String out) {
        TreeSet<String> set = new TreeSet<String>();
        for (String line : out.split("\\r?\\n")) {
            line = line.trim();
            if (line.startsWith("package:") && PACKAGE.matcher(line.substring(8)).matches()) set.add(line.substring(8));
        }
        return new ArrayList<String>(set);
    }

    /** User ids of pm list users. */
    static List<Integer> users(String out) {
        TreeSet<Integer> set = new TreeSet<Integer>();
        Matcher m = USER.matcher(out);
        while (m.find()) set.add(Integer.parseInt(m.group(1)));
        return new ArrayList<Integer>(set);
    }

    /** Hashes of the accounts in dumpsys account (all users), or null if the output is not an account dump. */
    static List<String> accountHashes(String out) {
        if (!out.contains("Accounts:") && !out.contains("Account {")) return null;
        TreeSet<String> set = new TreeSet<String>();
        Matcher m = ACCOUNT.matcher(out);
        while (m.find()) set.add(sha(m.group(1) + "|" + m.group(2)));
        return new ArrayList<String>(set);
    }

    static boolean success(String out) {
        return out != null && out.trim().startsWith("Success") && !out.contains("Failure") && !out.contains("Exception");
    }

    static <T> List<T> minus(List<T> now, List<T> baseline) {
        List<T> out = new ArrayList<T>();
        for (T x : now) if (!baseline.contains(x)) out.add(x);
        return out;
    }

    static String sha(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b & 0xff));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static List<String> sorted(List<String> in) {
        List<String> out = new ArrayList<String>(in);
        Collections.sort(out);
        return out;
    }
}

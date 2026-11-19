package gr.hotelcorali.tv;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAKeyGenParameterSpec;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Corali TV 1.11 pilot — check that this app can reach the TV's own ADB (127.0.0.1:5555), authenticate, and run ONE
 * fixed read-only command: {@code pm list packages -3}. 1.12 adds a second fixed command, used only when the welcome
 * screen did not appear after boot: {@code am start} of this app's own MainActivity. No other command exists.
 *
 * Plain ADB wire protocol (no third-party library): CNXN → AUTH (signature, then public key if the TV does not know
 * it yet: the TV shows "Allow debugging?") → OPEN "shell:…" → WRTE… → CLSE. The host and the command are constants;
 * there is no way to pass another host or command. The RSA key lives only in the app's private storage.
 */
public final class SelfAdbProbe {
    static final String HOST = "127.0.0.1";
    static final int PORT = 5555;
    static final String COMMAND = "shell:pm list packages -3";
    /** 1.12: open the welcome screen when Android did not bring it forward after boot. */
    static final String START_WELCOME = "shell:am start -n gr.hotelcorali.tv/.MainActivity --es src self-adb";
    /** 1.13: back to the room's welcome home page after a check-out clearing. */
    static final String START_HOME = "shell:am start -n gr.hotelcorali.tv/.MainActivity --ez home true --es src privacy";
    static final String DUMP_ACTIVITIES = "shell:dumpsys activity activities";
    static final String DUMP_POWER = "shell:dumpsys power";
    static final String KEY_WAKEUP = "shell:input keyevent KEYCODE_WAKEUP";
    static final String KEY_SLEEP = "shell:input keyevent KEYCODE_SLEEP";
    /** 1.18: Settings lock from the PMS — the TV's Settings app off / on for user 0. Two fixed commands, nothing else. */
    static final String SETTINGS_DISABLE = "shell:pm disable-user --user 0 com.android.tv.settings";
    static final String SETTINGS_ENABLE = "shell:pm enable --user 0 com.android.tv.settings";
    /** 1.18: and the Play Store, so guests cannot install apps (APK files need «unknown apps» in the locked Settings). */
    static final String STORE_DISABLE = "shell:pm disable-user --user 0 com.android.vending";
    static final String STORE_ENABLE = "shell:pm enable --user 0 com.android.vending";

    // 1.13 (v162): the check-out clearing. A closed list of command shapes, each argument checked; nothing else can
    // be sent. Never the hotel's or Android's own packages, never user 0, never Wi-Fi / settings / accounts commands.
    private static final String PKG = "[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z0-9_]+)+";
    private static final Pattern[] ALLOWED = {
        Pattern.compile("shell:pm list packages( -3)?"),
        Pattern.compile("shell:pm list users"),
        Pattern.compile("shell:dumpsys account"),
        Pattern.compile("shell:pm trim-caches 999G"),
        Pattern.compile("shell:pm clear (" + PKG + ")"),
        Pattern.compile("shell:pm uninstall --user 0 (" + PKG + ")"),
        Pattern.compile("shell:pm remove-user [1-9][0-9]{1,4}"),
    };
    /** Packages no command may clear or remove: this app, Google's / Android's / the TV maker's (except the two YouTube apps). */
    static boolean protectedPackage(String p) {
        if (p.equals("com.google.android.youtube.tv") || p.equals("com.google.android.youtube.tvmusic")) return false;
        return p.equals("gr.hotelcorali.tv") || p.startsWith("com.google.") || p.startsWith("com.android.") || p.startsWith("android")
                || p.startsWith("com.realtek.") || p.startsWith("com.expressluck.") || p.startsWith("com.mediatek.") || p.startsWith("com.amlogic.");
    }
    static boolean allowed(String command) {
        if (COMMAND.equals(command) || START_WELCOME.equals(command) || START_HOME.equals(command)) return true;
        // 1.15 (v164): read-only power / foreground state, and the TV's own sleep / wake keys (what the remote sends).
        if (DUMP_ACTIVITIES.equals(command) || DUMP_POWER.equals(command) || KEY_WAKEUP.equals(command) || KEY_SLEEP.equals(command)) return true;
        if (SETTINGS_DISABLE.equals(command) || SETTINGS_ENABLE.equals(command) || STORE_DISABLE.equals(command) || STORE_ENABLE.equals(command)) return true;
        for (Pattern pattern : ALLOWED) {
            java.util.regex.Matcher m = pattern.matcher(command);
            if (!m.matches()) continue;
            return m.groupCount() == 0 || m.group(1) == null || !protectedPackage(m.group(1));
        }
        return false;
    }

    /** One allowed command through the TV's own ADB (no approval wait); on PASS {@code detail} is the raw output. */
    public static Result shell(File privateDir, String command) {
        if (!allowed(command)) return new Result(Status.COMMAND_FAILED, false, Collections.<String>emptyList(), "NOT_ALLOWED");
        return exec(privateDir, HOST, PORT, 5000, command);
    }

    static Result shell(File privateDir, String host, int port, String command) {
        if (!allowed(command)) return new Result(Status.COMMAND_FAILED, false, Collections.<String>emptyList(), "NOT_ALLOWED");
        return exec(privateDir, host, port, 5000, command);
    }
    private static final Pattern PACKAGE = Pattern.compile("[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z0-9_]+)+");

    static final int A_CNXN = 0x4e584e43, A_AUTH = 0x48545541, A_OPEN = 0x4e45504f, A_OKAY = 0x59414b4f,
            A_CLSE = 0x45534c43, A_WRTE = 0x45545257, A_STLS = 0x534c5453;
    private static final int VERSION = 0x01000001, MAX_DATA = 256 * 1024;
    private static final int AUTH_TOKEN = 1, AUTH_SIGNATURE = 2, AUTH_RSAPUBLICKEY = 3;
    private static final byte[] SHA1_DIGEST_INFO = {0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14};

    public enum Status { PASS, PORT_CLOSED, AUTH_REJECTED, TIMEOUT, TLS_REQUIRED, COMMAND_FAILED, PROTOCOL_ERROR }

    public static final class Result {
        public final Status status;
        /** true: the TV already trusted this app's key (no "Allow debugging?" prompt this time). */
        public final boolean keyAlreadyTrusted;
        public final List<String> packages;
        public final String detail;
        Result(Status status, boolean keyAlreadyTrusted, List<String> packages, String detail) {
            this.status = status;
            this.keyAlreadyTrusted = keyAlreadyTrusted;
            this.packages = Collections.unmodifiableList(new ArrayList<String>(packages));
            this.detail = detail;
        }
    }

    private SelfAdbProbe() {}

    /** Worker thread only. {@code authWaitMs}: how long to wait for someone to accept "Allow debugging?" on the TV. */
    public static Result run(File privateDir, int authWaitMs) {
        return run(privateDir, HOST, PORT, authWaitMs);
    }

    /** Package-private for the JVM test against a fake adbd; the app only calls {@link #run(File, int)}. */
    static Result run(File privateDir, String host, int port, int authWaitMs) {
        Result r = exec(privateDir, host, port, authWaitMs, COMMAND);
        if (r.status != Status.PASS) return r;
        List<String> packages = new ArrayList<String>();
        for (String line : r.detail.split("\\r?\\n")) {
            line = line.trim();
            if (line.startsWith("package:") && PACKAGE.matcher(line.substring(8)).matches()) packages.add(line.substring(8));
        }
        Collections.sort(packages);
        if (!packages.contains("gr.hotelcorali.tv"))
            return new Result(Status.COMMAND_FAILED, r.keyAlreadyTrusted, packages, "Η λίστα δεν περιέχει το Corali TV (λάθος συσκευή ή απάντηση)");
        return new Result(Status.PASS, r.keyAlreadyTrusted, packages, "Επιτυχής σύνδεση ADB στην ίδια TV — μόνο ανάγνωση");
    }

    /** Opens this app's welcome screen through the TV's own ADB. Does not wait for an approval prompt (5 s). */
    public static Result startWelcomeScreen(File privateDir) {
        return startWelcomeScreen(privateDir, HOST, PORT);
    }

    static Result startWelcomeScreen(File privateDir, String host, int port) {
        Result r = exec(privateDir, host, port, 5000, START_WELCOME);
        if (r.status != Status.PASS) return r;
        String out = r.detail;
        boolean ok = out.contains("Starting") && !out.contains("Error");
        String first = out.trim().split("\\r?\\n")[0];
        return new Result(ok ? Status.PASS : Status.COMMAND_FAILED, r.keyAlreadyTrusted, Collections.<String>emptyList(),
                (first.length() > 120 ? first.substring(0, 120) : first));
    }

    /** Runs one of the two constant commands above; on PASS {@code detail} holds the raw output. */
    private static Result exec(File privateDir, String host, int port, int authWaitMs, String command) {
        List<String> none = Collections.emptyList();
        Socket socket = new Socket();
        boolean trusted = false;
        try {
            try {
                socket.connect(new InetSocketAddress(host, port), 2500);
            } catch (IOException e) {
                return new Result(Status.PORT_CLOSED, false, none, "Δεν υπάρχει ADB στη θύρα " + port + " (κλειστό μετά από επανεκκίνηση;)");
            }
            Key key = Key.loadOrCreate(privateDir);
            DataInputStream in = new DataInputStream(socket.getInputStream());
            OutputStream out = socket.getOutputStream();
            long deadline = System.currentTimeMillis() + 8000;
            socket.setSoTimeout(1000);
            write(out, A_CNXN, VERSION, MAX_DATA, "host::\0".getBytes(StandardCharsets.UTF_8));
            boolean sentSignature = false, sentKey = false;
            while (true) {
                Msg m = read(in, deadline, socket);
                if (m == null) return new Result(Status.TIMEOUT, false, none, sentKey
                        ? "Δεν εγκρίθηκε εγκαίρως το «Να επιτρέπεται ο εντοπισμός σφαλμάτων;» στην TV"
                        : "Η TV δεν απάντησε στη σύνδεση ADB");
                if (m.cmd == A_CNXN) { trusted = sentSignature && !sentKey; break; }
                if (m.cmd == A_STLS) return new Result(Status.TLS_REQUIRED, false, none, "Η TV ζητά ασύρματο εντοπισμό σφαλμάτων με TLS (δεν υποστηρίζεται στο pilot)");
                if (m.cmd != A_AUTH || m.arg0 != AUTH_TOKEN) return new Result(Status.PROTOCOL_ERROR, false, none, "Απρόσμενη απάντηση ADB");
                if (!sentSignature) {
                    write(out, A_AUTH, AUTH_SIGNATURE, 0, key.sign(m.data));
                    sentSignature = true;
                } else if (!sentKey) {
                    write(out, A_AUTH, AUTH_RSAPUBLICKEY, 0, key.adbPublicKey());
                    sentKey = true;
                    deadline = System.currentTimeMillis() + authWaitMs; // the TV now shows "Allow debugging?"
                } else {
                    return new Result(Status.AUTH_REJECTED, false, none, "Η TV απέρριψε το κλειδί της εφαρμογής");
                }
            }
            if (!allowed(command)) throw new IllegalArgumentException("command");
            write(out, A_OPEN, 1, 0, (command + "\0").getBytes(StandardCharsets.UTF_8));
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            deadline = System.currentTimeMillis() + 10000;
            while (true) {
                Msg m = read(in, deadline, socket);
                if (m == null) return new Result(Status.TIMEOUT, trusted, none, "Η εντολή δεν ολοκληρώθηκε εγκαίρως");
                if (m.cmd == A_OKAY) continue;
                if (m.cmd == A_WRTE) {
                    if (output.size() + m.data.length > 1024 * 1024) return new Result(Status.COMMAND_FAILED, trusted, none, "Υπερβολικά μεγάλη απάντηση");
                    output.write(m.data);
                    write(out, A_OKAY, 1, m.arg0, new byte[0]);
                    continue;
                }
                if (m.cmd == A_CLSE) break;
                return new Result(Status.PROTOCOL_ERROR, trusted, none, "Απρόσμενη απάντηση ADB στην εντολή");
            }
            return new Result(Status.PASS, trusted, none, new String(output.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new Result(Status.PROTOCOL_ERROR, trusted, none, "Σφάλμα: " + e.getClass().getSimpleName());
        } finally {
            try { socket.close(); } catch (IOException ignored) { }
        }
    }

    // ---- wire format: 6 little-endian uint32 (command, arg0, arg1, length, byte-sum, command ^ 0xffffffff) + payload

    static final class Msg {
        final int cmd, arg0, arg1; final byte[] data;
        Msg(int cmd, int arg0, int arg1, byte[] data) { this.cmd = cmd; this.arg0 = arg0; this.arg1 = arg1; this.data = data; }
    }

    static void write(OutputStream out, int cmd, int arg0, int arg1, byte[] data) throws IOException {
        int sum = 0;
        for (byte b : data) sum += b & 0xff;
        byte[] h = new byte[24];
        int[] v = {cmd, arg0, arg1, data.length, sum, ~cmd};
        for (int i = 0; i < 6; i++) le(h, i * 4, v[i]);
        out.write(h);
        out.write(data);
        out.flush();
    }

    /** null on deadline. The socket's 1 s read timeout lets the loop check the deadline. */
    static Msg read(DataInputStream in, long deadline, Socket socket) throws IOException {
        byte[] h = new byte[24];
        int got = 0;
        while (got < 24) {
            if (System.currentTimeMillis() > deadline) return null;
            try {
                int n = in.read(h, got, 24 - got);
                if (n < 0) throw new IOException("closed");
                got += n;
            } catch (SocketTimeoutException e) { /* check the deadline */ }
        }
        int cmd = le(h, 0), len = le(h, 12);
        if (le(h, 20) != ~cmd || len < 0 || len > MAX_DATA) throw new IOException("bad header");
        byte[] data = new byte[len];
        int off = 0;
        while (off < len) {
            if (System.currentTimeMillis() > deadline) return null;
            try {
                int n = in.read(data, off, len - off);
                if (n < 0) throw new IOException("closed");
                off += n;
            } catch (SocketTimeoutException e) { /* check the deadline */ }
        }
        return new Msg(cmd, le(h, 4), le(h, 8), data);
    }

    private static void le(byte[] b, int off, int v) {
        b[off] = (byte) v; b[off + 1] = (byte) (v >>> 8); b[off + 2] = (byte) (v >>> 16); b[off + 3] = (byte) (v >>> 24);
    }

    private static int le(byte[] b, int off) {
        return (b[off] & 0xff) | (b[off + 1] & 0xff) << 8 | (b[off + 2] & 0xff) << 16 | (b[off + 3] & 0xff) << 24;
    }

    // ---- the app's own ADB key (RSA 2048), kept in private app storage

    static final class Key {
        final BigInteger n, d, e;
        Key(BigInteger n, BigInteger d, BigInteger e) { this.n = n; this.d = d; this.e = e; }

        static Key loadOrCreate(File dir) throws Exception {
            File priv = new File(dir, "corali_self_adb.pk8");
            KeyFactory kf = KeyFactory.getInstance("RSA");
            if (priv.isFile()) {
                byte[] raw = new byte[(int) priv.length()];
                InputStream is = new FileInputStream(priv);
                try { new DataInputStream(is).readFully(raw); } finally { is.close(); }
                RSAPrivateKey k = (RSAPrivateKey) kf.generatePrivate(new PKCS8EncodedKeySpec(raw));
                return new Key(k.getModulus(), k.getPrivateExponent(), RSAKeyGenParameterSpec.F4);
            }
            KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
            g.initialize(new RSAKeyGenParameterSpec(2048, RSAKeyGenParameterSpec.F4));
            KeyPair kp = g.generateKeyPair();
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("no private storage");
            File tmp = new File(dir, "corali_self_adb.pk8.tmp");
            OutputStream os = new FileOutputStream(tmp);
            try { os.write(kp.getPrivate().getEncoded()); } finally { os.close(); }
            if (!tmp.renameTo(priv)) throw new IOException("cannot store key");
            RSAPublicKey pub = (RSAPublicKey) kp.getPublic();
            return new Key(pub.getModulus(), ((RSAPrivateKey) kp.getPrivate()).getPrivateExponent(), pub.getPublicExponent());
        }

        /** PKCS#1 v1.5 signature of the token as a SHA-1 digest (what adbd verifies). */
        byte[] sign(byte[] token) {
            int k = 256;
            byte[] em = new byte[k];
            em[0] = 0; em[1] = 1;
            int ps = k - 3 - SHA1_DIGEST_INFO.length - token.length;
            for (int i = 0; i < ps; i++) em[2 + i] = (byte) 0xff;
            em[2 + ps] = 0;
            System.arraycopy(SHA1_DIGEST_INFO, 0, em, 3 + ps, SHA1_DIGEST_INFO.length);
            System.arraycopy(token, 0, em, 3 + ps + SHA1_DIGEST_INFO.length, token.length);
            return fixed(new BigInteger(1, em).modPow(d, n), k, false);
        }

        /** Android's RSAPublicKey struct (len, n0inv, n, rr, e; little-endian), base64 + " name\0". */
        byte[] adbPublicKey() {
            BigInteger r32 = BigInteger.ONE.shiftLeft(32);
            long n0inv = r32.subtract(n.mod(r32).modInverse(r32)).mod(r32).longValue();
            BigInteger rr = BigInteger.ONE.shiftLeft(4096).mod(n);
            byte[] s = new byte[4 + 4 + 256 + 256 + 4];
            le(s, 0, 64);
            le(s, 4, (int) n0inv);
            System.arraycopy(fixed(n, 256, true), 0, s, 8, 256);
            System.arraycopy(fixed(rr, 256, true), 0, s, 264, 256);
            le(s, 520, e.intValue());
            return (base64(s) + " corali-tv@gr.hotelcorali.tv\0").getBytes(StandardCharsets.UTF_8);
        }

        private static byte[] fixed(BigInteger v, int len, boolean littleEndian) {
            byte[] raw = v.toByteArray(), out = new byte[len];
            int copy = Math.min(raw.length, len);
            System.arraycopy(raw, raw.length - copy, out, len - copy, copy);
            if (littleEndian) for (int i = 0; i < len / 2; i++) { byte t = out[i]; out[i] = out[len - 1 - i]; out[len - 1 - i] = t; }
            return out;
        }
    }

    static String base64(byte[] b) {
        final String A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < b.length; i += 3) {
            int v = (b[i] & 0xff) << 16 | (i + 1 < b.length ? (b[i + 1] & 0xff) << 8 : 0) | (i + 2 < b.length ? b[i + 2] & 0xff : 0);
            sb.append(A.charAt(v >>> 18 & 63)).append(A.charAt(v >>> 12 & 63))
              .append(i + 1 < b.length ? A.charAt(v >>> 6 & 63) : '=').append(i + 2 < b.length ? A.charAt(v & 63) : '=');
        }
        return sb.toString();
    }
}

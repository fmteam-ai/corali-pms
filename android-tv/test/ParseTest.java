package gr.hotelcorali.tv;

import java.util.Arrays;
import java.util.List;

/** JVM checks of PrivacyParse and the Self-ADB command allowlist (1.13). Exits 1 on the first failure. */
public class ParseTest {
  static void check(boolean ok, String what) { if (!ok) { System.out.println("FAIL " + what); System.exit(1); } System.out.println("ok   " + what); }
  public static void main(String[] a) {
    check(PrivacyParse.packages("package:com.netflix.ninja\npackage:gr.hotelcorali.tv\r\npackage:bad name\nfoo\n").equals(Arrays.asList("com.netflix.ninja", "gr.hotelcorali.tv")), "packages");
    check(PrivacyParse.users("Users:\n\tUserInfo{0:Owner:c13} running\n\tUserInfo{10:Επισκέπτης:410}\n").equals(Arrays.asList(0, 10)), "users");
    String dump = "Accounts: 2\n    Account {name=hotel@example.com, type=com.google}\n    Account {name=guest@example.com, type=com.google}\nUser UserInfo{10:x:0}:\n  Accounts: 0\n";
    List<String> h = PrivacyParse.accountHashes(dump);
    check(h != null && h.size() == 2 && !h.toString().contains("@"), "account hashes, no names");
    List<String> base = PrivacyParse.accountHashes("Accounts: 1\n    Account {name=hotel@example.com, type=com.google}\n");
    check(PrivacyParse.minus(h, base).size() == 1, "one guest account vs baseline");
    check(PrivacyParse.accountHashes("Error: Can't find service") == null, "not an account dump → unknown");
    check(PrivacyParse.success("Success\n") && !PrivacyParse.success("Failed\n") && !PrivacyParse.success(""), "success");
    String[] ok = {"shell:pm list packages", "shell:pm list packages -3", "shell:pm list users", "shell:dumpsys account", "shell:pm trim-caches 999G",
        "shell:pm clear com.netflix.ninja", "shell:pm clear com.google.android.youtube.tv", "shell:pm uninstall --user 0 com.spotify.tv.android", "shell:pm remove-user 10",
        SelfAdbProbe.START_HOME, SelfAdbProbe.START_WELCOME};
    for (String c : ok) check(SelfAdbProbe.allowed(c), "allowed: " + c);
    String[] no = {"shell:pm clear gr.hotelcorali.tv", "shell:pm clear com.google.android.gms", "shell:pm clear com.android.providers.settings", "shell:pm clear com.realtek.tv",
        "shell:pm remove-user 0", "shell:pm remove-user 1", "shell:pm uninstall com.spotify.tv.android", "shell:pm clear com.netflix.ninja; reboot", "shell:pm clear com.netflix.ninja\nreboot",
        "shell:settings put global wifi_on 0", "shell:svc wifi disable", "shell:reboot", "shell:pm clear android", "shell:cmd wifi forget-network 0", "shell:am start -a android.settings.SETTINGS"};
    for (String c : no) check(!SelfAdbProbe.allowed(c), "refused: " + c.replace("\n", "\\n"));
    System.out.println("ALL OK");
  }
}

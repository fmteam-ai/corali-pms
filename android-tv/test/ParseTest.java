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
    // 1.15: foreground app from dumpsys activity activities, and the new fixed commands
    check("com.google.android.youtube.tv".equals(Foreground.parse("  ResumedActivity: ActivityRecord{6f2b1c7 u0 com.google.android.youtube.tv/com.google.android.apps.youtube.tv.activity.MainActivity t42}\n")), "foreground: youtube");
    check("com.google.android.apps.mediashell".equals(Foreground.parse("    topResumedActivity=ActivityRecord{a1 u0 com.google.android.apps.mediashell/.MediaShellActivity t9}")), "foreground: cast receiver");
    check(Foreground.parse("nothing here") == null, "foreground: unknown → null");
    check(Foreground.HOME.contains("com.google.android.apps.tv.launcherx") && !Foreground.HOME.contains("com.google.android.youtube.tv"), "home list");
    for (String c : new String[]{"shell:dumpsys activity activities", "shell:dumpsys power", "shell:input keyevent KEYCODE_WAKEUP", "shell:input keyevent KEYCODE_SLEEP"}) check(SelfAdbProbe.allowed(c), "allowed: " + c);
    for (String c : new String[]{"shell:input keyevent KEYCODE_HOME", "shell:input keyevent 26", "shell:input text x", "shell:dumpsys wifi", "shell:cmd power set-low-power-standby-enabled false", "shell:svc power stayon true"}) check(!SelfAdbProbe.allowed(c), "refused: " + c);
    // 1.18: Settings lock — exactly two fixed commands; no other package, no other user, no settings writes.
    for (String c : new String[]{SelfAdbProbe.SETTINGS_DISABLE, SelfAdbProbe.SETTINGS_ENABLE, SelfAdbProbe.STORE_DISABLE, SelfAdbProbe.STORE_ENABLE}) check(SelfAdbProbe.allowed(c), "allowed: " + c);
    for (String c : new String[]{"shell:pm disable com.android.tv.settings", "shell:pm disable-user --user 10 com.android.tv.settings",
        "shell:pm disable-user --user 0 com.android.tv.settings; reboot", "shell:pm enable --user 0 com.google.android.apps.tv.launcherx", "shell:settings put secure accessibility_enabled 1",
        "shell:appops set gr.hotelcorali.tv ACCESS_RESTRICTED_SETTINGS allow", "shell:settings put global hotel_menu_key_lock 1", "shell:settings put global hotel_enable 1",
        "shell:pm disable-user com.android.tv.settings", "shell:pm disable-user --user 0 com.google.android.youtube.tv", "shell:pm uninstall com.android.vending"}) check(!SelfAdbProbe.allowed(c), "refused: " + c);
    // 1.19: the start-up log keeps only the last 24 hours; undated lines (older versions) are dropped.
    long now = 1_800_000_000_000L, hr = 3_600_000L;
    List<String> kept = BootLog.recent(Arrays.asList((now - 25 * hr) + "|old", "19/11 14:02:23  no time", (now - 23 * hr) + "|day", now + "|now", "x|bad"), now);
    check(kept.equals(Arrays.asList((now - 23 * hr) + "|day", now + "|now")), "boot log: last 24 h only");
    check(BootLog.text(now + "|19/11 15:39:42  MainActivity created").equals("19/11 15:39:42  MainActivity created") && BootLog.text("plain").equals("plain"), "boot log: shown without the ms");
    System.out.println("ALL OK");
  }
}

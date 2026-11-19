package gr.hotelcorali.tv;

import android.accessibilityservice.AccessibilityService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

/**
 * Corali TV 1.16: the factory «Lock Menu Key» from the PMS, without ADB.
 *
 * The HORIZON's factory app (com.expressluck.tvfactory, system UID) is the only code allowed to lock the menu: it
 * disables com.android.tv.settings and the Google TV side panel, which needs system rights no other app has. It
 * exports no service, receiver or API for this. It does export its menu activity, which opens the «Engineer Mode
 * Option» page directly (intent extra startHotel = {showHotel: 1}); the «Lock Menu Key» row there has its own view id
 * (com.expressluck.tvfactory:id/lock_menu_key) and changes value with the remote's ► key (StatePreference.onKeyDown
 * → next state → HotelModelManager.setLockMenuKey). This accessibility service does exactly what a technician does
 * with the remote, on that one row only:
 *   1. find the row by its view id (exactly one, labelled «Lock Menu Key»), read its value (On / Off);
 *   2. if it differs from the target: give the row the focus, check again that the focused view IS that row, send ►;
 *   3. read the value again; then leave the menu with Back.
 * It never touches any other row — in particular never «Engineer Mode Enable» (hotel_enable / Hotel Status). It only
 * listens to the factory app's windows (packageNames in res/xml/menu_lock_service.xml) and does nothing unless the
 * PMS command armed it, for at most JOB_MS. The PMS success is decided afterwards from what Android reports
 * (WakeService.menuLock): hotel_menu_key_lock and the enabled states of the Settings app / side panel.
 */
public final class MenuLockService extends AccessibilityService {
    static final String FACTORY_PKG = "com.expressluck.tvfactory";
    static final String ROW_ID = FACTORY_PKG + ":id/lock_menu_key";
    static final String VALUE_ID = FACTORY_PKG + ":id/preference_value";
    static final String ROW_LABEL = "Lock Menu Key";
    /** AccessibilityService.GLOBAL_ACTION_DPAD_RIGHT / _BACK (API 33; constants, as the app is built against API 30). */
    static final int DPAD_RIGHT = 19;
    static final int SDK_DPAD = 33;
    static final long JOB_MS = 15_000;
    private static final int MAX_PRESSES = 2;

    /** One armed request at a time (from WakeService); read and written on the main thread. */
    static final class Job {
        final boolean lock;
        final long deadline;
        int presses;
        boolean focusAsked;
        boolean sawFactory;
        volatile boolean done;
        volatile String result = "";
        volatile String screenValue = "";
        Job(boolean lock, long deadline) { this.lock = lock; this.deadline = deadline; }
    }

    private static volatile Job job;
    private static volatile MenuLockService instance;
    private final Handler main = new Handler(Looper.getMainLooper());

    static ComponentName component(Context c) { return new ComponentName(c, MenuLockService.class); }

    /** Is this service switched on in Android's accessibility settings (and bound)? */
    static boolean enabled(Context c) {
        String list = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (list == null) return false;
        String full = component(c).flattenToString(), shortName = component(c).flattenToShortString();
        for (String s : list.split(":")) if (s.equalsIgnoreCase(full) || s.equalsIgnoreCase(shortName)) return true;
        return false;
    }

    static boolean connected() { return instance != null; }

    /**
     * Switches this service on through the TV's own ADB (authorised once, Corali TV 1.11), keeping every service that
     * is already on. Only used when it is off; PASS does not mean bound yet — the caller checks connected().
     */
    static String enableViaSelfAdb(Context c) {
        String current = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        StringBuilder list = new StringBuilder();
        if (current != null) {
            for (String s : current.split(":")) {
                if (s.isEmpty() || s.equalsIgnoreCase(SelfAdbProbe.MENU_LOCK_SERVICE)) continue;
                if (!s.matches("[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+")) return "A11Y_LIST_UNEXPECTED";
                list.append(s).append(':');
            }
        }
        list.append(SelfAdbProbe.MENU_LOCK_SERVICE);
        // Installed by a downloader → «restricted»: Android would drop the service from the list at once.
        SelfAdbProbe.Result r = SelfAdbProbe.shell(c.getFilesDir(), SelfAdbProbe.ALLOW_RESTRICTED);
        if (r.status != SelfAdbProbe.Status.PASS) return "SELF_ADB_" + r.status;
        r = SelfAdbProbe.shell(c.getFilesDir(), "shell:settings put secure enabled_accessibility_services " + list);
        if (r.status != SelfAdbProbe.Status.PASS) return "SELF_ADB_" + r.status;
        r = SelfAdbProbe.shell(c.getFilesDir(), SelfAdbProbe.A11Y_ON);
        if (r.status != SelfAdbProbe.Status.PASS) return "SELF_ADB_" + r.status;
        // Read back: Android removes a service it does not accept (restricted, or not a valid service).
        try { Thread.sleep(1_500); } catch (InterruptedException ignored) { }
        return enabled(c) ? "" : "A11Y_REMOVED_BY_ANDROID";
    }

    static Job arm(boolean lock) {
        Job j = new Job(lock, System.currentTimeMillis() + JOB_MS);
        job = j;
        final MenuLockService s = instance;
        if (s != null) s.main.postDelayed(new Runnable() { @Override public void run() { s.step(); } }, 1_500);
        return j;
    }

    static void disarm() { job = null; }

    @Override
    protected void onServiceConnected() {
        instance = this;
        BootLog.add(this, "menu lock service connected");
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        Job j = job;
        if (j == null || j.done || event == null) return;
        if (event.getPackageName() == null || !FACTORY_PKG.contentEquals(event.getPackageName())) return;
        main.removeCallbacksAndMessages(null);
        main.postDelayed(new Runnable() { @Override public void run() { step(); } }, 300);
    }

    @Override
    public void onInterrupt() { }

    private void step() {
        final Job j = job;
        if (j == null || j.done) return;
        if (System.currentTimeMillis() > j.deadline) { finish(j, j.sawFactory ? "LOCK_ROW_NOT_FOUND" : "ENGINEER_PAGE_NOT_SHOWN"); return; }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null || !FACTORY_PKG.contentEquals(root.getPackageName())) { retry(); return; }
        j.sawFactory = true;
        List<AccessibilityNodeInfo> rows = root.findAccessibilityNodeInfosByViewId(ROW_ID);
        if (rows == null || rows.isEmpty()) { retry(); return; }
        if (rows.size() != 1) { finish(j, "LOCK_ROW_AMBIGUOUS"); return; }
        AccessibilityNodeInfo row = rows.get(0);
        if (row.findAccessibilityNodeInfosByText(ROW_LABEL).isEmpty()) { finish(j, "LOCK_ROW_LABEL_MISMATCH"); return; }
        String value = valueOf(row);
        j.screenValue = value;
        String want = j.lock ? "On" : "Off";
        if (want.equalsIgnoreCase(value)) { finish(j, "OK"); return; }
        if (!"On".equalsIgnoreCase(value) && !"Off".equalsIgnoreCase(value)) { finish(j, "LOCK_VALUE_UNREADABLE"); return; }
        if (j.presses >= MAX_PRESSES) { finish(j, "KEY_NO_EFFECT"); return; }
        if (Build.VERSION.SDK_INT < SDK_DPAD) { finish(j, "ANDROID_TOO_OLD"); return; }
        if (!row.isFocused()) {
            if (j.focusAsked) { finish(j, "FOCUS_REFUSED"); return; }
            j.focusAsked = true;
            if (!row.performAction(AccessibilityNodeInfo.ACTION_FOCUS)) { finish(j, "FOCUS_REFUSED"); return; }
            retry();
            return;
        }
        // The ► key goes to the focused view: send it only when that is, at this moment, the «Lock Menu Key» row.
        AccessibilityNodeInfo focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (focused == null || !ROW_ID.equals(focused.getViewIdResourceName())) { finish(j, "FOCUS_NOT_ON_LOCK_ROW"); return; }
        j.presses++;
        BootLog.add(this, "menu lock: «Lock Menu Key» " + value + " → ► (" + want + ")");
        if (!performGlobalAction(DPAD_RIGHT)) { finish(j, "KEY_REFUSED"); return; }
        main.postDelayed(new Runnable() { @Override public void run() { step(); } }, 1_200);
    }

    private void retry() {
        main.postDelayed(new Runnable() { @Override public void run() { step(); } }, 700);
    }

    private static String valueOf(AccessibilityNodeInfo row) {
        List<AccessibilityNodeInfo> v = row.findAccessibilityNodeInfosByViewId(VALUE_ID);
        if (v == null || v.size() != 1 || v.get(0).getText() == null) return "";
        return v.get(0).getText().toString().trim();
    }

    /** Ends the job and leaves the Factory Menu with Back (at most three times, only while it is in front). */
    private void finish(Job j, String result) {
        j.result = result;
        j.done = true;
        if (job == j) job = null;
        BootLog.add(this, "menu lock: " + result + " (screen value «" + j.screenValue + "»)");
        leave(3);
    }

    private void leave(final int left) {
        if (left <= 0) return;
        main.postDelayed(new Runnable() {
            @Override
            public void run() {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root == null || root.getPackageName() == null || !FACTORY_PKG.contentEquals(root.getPackageName())) return;
                performGlobalAction(GLOBAL_ACTION_BACK);
                leave(left - 1);
            }
        }, 500);
    }
}

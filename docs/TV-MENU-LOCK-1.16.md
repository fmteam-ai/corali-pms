# Lock / Unlock Menu από το PMS: Corali TV 1.16 (HORIZON 43HQ8590U/D)

Συμπληρώνει το `TV-SETTINGS-LOCK-ASSESSMENT.md`. Πηγή: απομεταγλώττιση του `TvEplFactoryGTV.apk` (`com.expressluck.tvfactory` V2.2.36, system UID).

**Κατάσταση:** ο κώδικας είναι έτοιμος και οι δοκιμές στον server πέρασαν. **Δεν έχει δοκιμαστεί ακόμα σε πραγματική TV.** Μέχρι να περάσουν οι δοκιμές της ενότητας 6 στη 112, το Lock/Unlock από το PMS **δεν θεωρείται ολοκληρωμένο**.

## 1. Πώς αλλάζει και αποθηκεύεται το Lock Menu Key στο εργοστασιακό app

Η διαδρομή στο μενού είναι: Engineer Mode Option → γραμμή `id/lock_menu_key`.

1. Η γραμμή είναι ένα `StatePreference` με τιμές Off/On.
2. Το πλήκτρο ► (`onKeyDown` 22) καλεί `nextState` και μετά `HotelLogic.onPreferenceIndexChange`.
3. Αυτό καλεί `HotelModelManager.setLockMenuKey(v)`, που με τη σειρά του καλεί `HotelModeUtils.b(true, v)`.
4. Η `b(true, v)` κάνει τέσσερις αλλαγές:
   - `PackageManager.setApplicationEnabledSetting("com.android.tv.settings", 2 | 1)`
   - απενεργοποίηση ή ενεργοποίηση των `launcherx/.dashboard.DashboardActivity` και `DashboardHandler`
   - `Settings.Global hotel_menu_key_lock = 1 | 0`
   - `hotel.bin` θέση 3

Αυτές οι αλλαγές θέλουν δικαιώματα συστήματος.

**Ανεξάρτητο από το Hotel Mode:** το Lock Menu Key δουλεύει και με το Hotel Status OFF. Αντίθετα, αν κάποιος γυρίσει το Hotel Status σε OFF, η `setHotelMode(0)` μηδενίζει και το κλείδωμα.

## 2. Υπάρχει vendor API / service / broadcast για τρίτες εφαρμογές;

**Όχι.** Τα εξαγόμενα στοιχεία της εργοστασιακής εφαρμογής είναι:

| Στοιχείο | Τι κάνει |
|---|---|
| `FactoryMenuActivity` | Ανοίγει μενού |
| `BootUpReceiver` (`BOOT_COMPLETED`, `SETUP_HOTEL_MODE`) | Εφαρμόζει τις ρυθμίσεις μόνο με Hotel Status = 1, που απαγορεύεται |
| `BootcompleteService` | `onBind` → null |
| `PackageInstallService`, `LogCatService` | Άσχετα και επικίνδυνα. **Δεν χρησιμοποιούνται.** |

Δεν υπάρχει AIDL, provider ή receiver που να καλεί τη `setLockMenuKey`. Η εγγραφή από άλλη εφαρμογή, ακόμα και μέσω `adb shell`, απορρίπτεται από το Android, γιατί χρειάζεται `CHANGE_COMPONENT_ENABLED_STATE` για άλλο πακέτο και κατάσταση `DISABLED`.

**Το εξαγόμενο που χρησιμοποιούμε:** η `FactoryMenuActivity.HotelJump()`. Με extra `startHotel = Bundle{showHotel: 1}` ανοίγει **απευθείας** τη σελίδα Engineer Mode Option. Είναι η ίδια διεπαφή που ήδη χρησιμοποιεί το «Άνοιγμα Factory Menu», χωρίς άδεια και χωρίς ADB.

## 3. Ο μηχανισμός της 1.16: υπηρεσία προσβασιμότητας

Η `MenuLockService` κάνει ό,τι ο τεχνικός με το τηλεχειριστήριο, **μόνο** στη γραμμή `lock_menu_key`:

1. Ο Agent ελέγχει πρώτα τις προϋποθέσεις και σταματά αν κάποια δεν ισχύει:
   - το Hotel Status (`hotel_enable`) είναι 0,
   - η οθόνη είναι αναμμένη,
   - καμία εφαρμογή επισκέπτη δεν είναι μπροστά.
2. Αν η TV είναι ήδη στην κατάσταση-στόχο, επιστρέφει αμέσως επιτυχία.
3. Ανοίγει τη σελίδα Engineer Mode Option.
4. Η υπηρεσία ψάχνει τη γραμμή με το view id `com.expressluck.tvfactory:id/lock_menu_key`:
   - πρέπει να υπάρχει **ακριβώς μία** γραμμή, με την ετικέτα «Lock Menu Key»,
   - διαβάζει την τιμή της (`id/preference_value`, On ή Off).
5. Αν η τιμή διαφέρει από τον στόχο:
   - βάζει την επιλογή στη γραμμή,
   - ξαναελέγχει ότι η επιλογή είναι **αυτή ακριβώς** η γραμμή,
   - στέλνει ► (`GLOBAL_ACTION_DPAD_RIGHT`, Android 13+).
   - Στέλνει το πολύ 2 πατήματα και δεν αγγίζει ποτέ άλλη γραμμή.
6. Βγαίνει από το μενού με Back και φέρνει μπροστά τη Welcome Screen.
7. Ο Agent διαβάζει ξανά από το Android:
   - `hotel_menu_key_lock`,
   - `hotel_enable`,
   - τις καταστάσεις της εφαρμογής Ρυθμίσεων και των δύο τμημάτων του launcher.

   Τα στέλνει όλα στο PMS μαζί με τον κωδικό του βήματος.
8. **Το PMS αποφασίζει μόνο του** (`menuLockVerdict`). Δίνει EXECUTED μόνο αν ισχύουν όλα:
   - Ρυθμίσεις και πλαϊνό πάνελ στην κατάσταση-στόχο (LOCKED ή UNLOCKED),
   - `hotel_menu_key_lock` = 1 ή 0,
   - `hotel_enable` = 0.

   Σε κάθε άλλη περίπτωση δίνει FAILED με συγκεκριμένο κωδικό. Χωρίς κατάσταση δίνει UNVERIFIED.

**Περιορισμοί της υπηρεσίας:**
- Βλέπει μόνο τα παράθυρα του `com.expressluck.tvfactory` (`packageNames`).
- Δρα μόνο όταν την ενεργοποιήσει εντολή του PMS, για έως 15″.
- Τη συνδέει μόνο το Android (`BIND_ACCESSIBILITY_SERVICE`).

**Ενεργοποίηση της υπηρεσίας, μία φορά ανά TV:** ο Agent την ενεργοποιεί αυτόματα μέσω του Self-ADB της TV (εγκεκριμένο από την 1.11), κρατώντας όσες υπηρεσίες είναι ήδη ενεργές. Το allowlist επιτρέπει μόνο λίστα που περιέχει τη δική του υπηρεσία, και `accessibility_enabled 1`. Αν δεν υπάρχει Self-ADB, ενεργοποιείται χειροκίνητα: Ρυθμίσεις → Προσβασιμότητα → «Corali TV — κλείδωμα μενού», **πριν** κλειδώσει το μενού. Οι ίδιες οι εντολές Lock/Unlock δεν χρησιμοποιούν ADB.

**Κωδικοί σφάλματος:**

| Κατηγορία | Κωδικοί |
|---|---|
| Προϋποθέσεις | `SCREEN_IS_OFF`, `GUEST_APP_IN_FRONT`, `HOTEL_MODE_ON` |
| Υπηρεσία | `ACCESSIBILITY_OFF`, `ACCESSIBILITY_NOT_CONNECTED` |
| Μενού | `FACTORY_MENU_NOT_AVAILABLE`, `ENGINEER_PAGE_NOT_SHOWN` |
| Γραμμή | `LOCK_ROW_NOT_FOUND`, `LOCK_ROW_AMBIGUOUS`, `LOCK_ROW_LABEL_MISMATCH`, `LOCK_VALUE_UNREADABLE` |
| Πλήκτρο / επιλογή | `FOCUS_REFUSED`, `FOCUS_NOT_ON_LOCK_ROW`, `KEY_REFUSED`, `KEY_NO_EFFECT` |
| Επαλήθευση | `STATE_NOT_CONFIRMED`, `STATE_PARTIAL`, `NO_RESULT`, `HOTEL_MODE_CHANGED` (κρίσιμο) |
| Συμβατότητα | `ANDROID_TOO_OLD` |

## 4. PMS

Βρίσκεται στο Corali TV → «Ήχος & Hotel Mode» → στήλη «Κλείδωμα μενού».

- **Εντολές:**
  - «🔒 Κλείδωμα» / «🔓 Ξεκλείδωμα» ανά δωμάτιο,
  - «Κλείδωμα / Ξεκλείδωμα μενού στα επιλεγμένα» για μαζική εντολή.
- **Επιβεβαίωση:** ζητείται πάντα. Για περισσότερα από ένα δωμάτια πληκτρολογείτε και τον αριθμό των δωματίων.
- **Δικαιώματα:** μόνο Owner/Admin (`integrations.write` και ρόλος owner/admin). Αλλιώς `OWNER_ADMIN_ONLY` ή `FORBIDDEN`.
- **Όριο:** 30 αιτήματα ανά 15′ ανά χρήστη.
- **Καταγραφή:** στο ιστορικό ενεργειών (`menu_lock`).
- **Προϋπόθεση:** Corali TV ≥ 1.16 (versionCode 17), αλλιώς `LOCK_APP_TOO_OLD`.
- **Αποτέλεσμα:** κάθε εντολή δείχνει ✓ μόνο με την επιβεβαίωση του §3.8, αλλιώς τον λόγο αποτυχίας.
- **Ενημέρωση κατάστασης:** η κατάσταση LOCKED/UNLOCKED ενημερώνεται και σε κάθε έλεγχο της TV (≈20″), με τις παραμέτρους `lk` και `mk`.

## 5. Επιπτώσεις του κλειδώματος (απαίτηση 8)

**Δεν επηρεάζονται:**
- το PMS Agent, η Welcome Screen και το Self-ADB, γιατί είναι εφαρμογές του Corali,
- το YouTube και το Google Cast, γιατί είναι ξεχωριστά πακέτα,
- ένταση, Back και Home.

**Δεν ανοίγουν πλέον** οι Ρυθμίσεις της TV (μαζί και Wi-Fi και Προσβασιμότητα) και το πλαϊνό πάνελ / γρανάζι του Google TV. Αυτός είναι ο σκοπός του κλειδώματος.

**Πρέπει να ελεγχθεί στην TV:** το πλήκτρο Input (πηγές) και το Power.

## 6. Δοκιμές στη 112 (εκκρεμούν, απαιτούνται πριν από την παραγωγή)

1. **Εγκατάσταση και ενεργοποίηση:** εγκατάσταση της 1.16 και έλεγχος ότι η υπηρεσία ενεργοποιείται αυτόματα (BootLog: «menu lock service connected»).
2. **Κλείδωμα:** Κλείδωμα από το PMS → ✓.
   - Η TV δείχνει LOCKED.
   - Οι Ρυθμίσεις και το γρανάζι δεν ανοίγουν.
   - Το Factory Menu δείχνει Lock Menu Key = On και Hotel Status = Off.
3. **Ξεκλείδωμα:** Ξεκλείδωμα → ✓, UNLOCKED, οι Ρυθμίσεις ανοίγουν.
4. **Άρνηση με εφαρμογή επισκέπτη:** με το YouTube ανοιχτό → `GUEST_APP_IN_FRONT`, χωρίς διακοπή του επισκέπτη.
5. **Άρνηση με σβηστή οθόνη:** → `SCREEN_IS_OFF`.
6. **Διατήρηση:** η κατάσταση LOCKED μένει μετά από:
   - standby → Power ON από το PMS,
   - επανεκκίνηση,
   - διακοπή ρεύματος.
7. **Επιπτώσεις:** με κλειδωμένο μενού λειτουργούν Welcome Screen, PMS ON/OFF, Cast από κινητό, YouTube, ένταση, Back, Home, Input.
8. **Ρόλοι:** Reception → `FORBIDDEN`. Admin και Owner → επιτρέπεται.

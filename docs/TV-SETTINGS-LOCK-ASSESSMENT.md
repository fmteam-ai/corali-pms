# Lock / Unlock TV Settings — τεχνική αναφορά (HORIZON 43HQ8590U/D, TvEplFactoryGTV.apk V2.2.36)

Πηγή: ανάλυση του `TvEplFactoryGTV.apk` (`com.expressluck.tvfactory`, versionName V2.2.36, `sharedUserId=android.uid.system`) με απομεταγλώττιση (androguard 4.1.4). Δεν έγινε καμία αλλαγή στην TV.

## 1. Πώς υλοποιείται πραγματικά το «Lock Menu Key»

`HotelModelManager.setLockMenuKey(int v)` → `a.a.b(true, v)` (κλάση HotelModeUtils). Με `v=1` (On):

1. `PackageManager.setApplicationEnabledSetting("com.android.tv.settings", COMPONENT_ENABLED_STATE_DISABLED (2), DONT_KILL_APP)` — **απενεργοποιεί ολόκληρη την εφαρμογή Ρυθμίσεων της TV**. Με Off: `COMPONENT_ENABLED_STATE_ENABLED (1)`.
2. `setComponentEnabledSetting` → **απενεργοποιεί** (On) / ενεργοποιεί (Off) δύο τμήματα του Google TV launcher:
   `com.google.android.apps.tv.launcherx/.dashboard.DashboardActivity` και `.dashboard.DashboardHandler` (το πλαϊνό πάνελ / «γρανάζι»).
3. `Settings.Global.putInt("hotel_menu_key_lock", 1|0)`.
4. Γράφει την τιμή στη θέση **3** του `/mnt/vendor/impdata/hotel.bin` μέσω `com.realtek.tv.Factory.writeConfigFile` (API του firmware, μόνο για system).

Η μέθοδος είναι **εσωτερικός κώδικας** της εργοστασιακής εφαρμογής: δεν υπάρχει εξαγόμενο service / receiver / provider / AIDL που να την καλεί. Δεν επανεφαρμόζεται στην εκκίνηση· το κλείδωμα επιβιώνει της επανεκκίνησης επειδή το Android θυμάται ποιες εφαρμογές/τμήματα είναι απενεργοποιημένα.

**Γιατί το `hotel_menu_key_lock` έδειξε 0:** είναι μόνο μία από τις 4 εγγραφές· το μενού δείχνει την τιμή του `hotel.bin`. Η **πραγματική** κατάσταση είναι το αν είναι απενεργοποιημένο το `com.android.tv.settings` και τα δύο τμήματα του launcher.

## 2. Μπορεί ο Corali TV Agent να το ελέγξει χωρίς πρόσθετα προνόμια;

| Ενέργεια | Corali TV (UID 10075) | Self-ADB (shell, UID 2000) |
|---|---|---|
| Κλήση `setLockMenuKey` | **Όχι** (κώδικας μέσα σε system εφαρμογή, χωρίς εξωτερική διεπαφή) | **Όχι** |
| Απενεργοποίηση `com.android.tv.settings` ως «DISABLED» (όπως το εργοστάσιο) | **Όχι** | **Όχι** — το Android επιτρέπει στο shell μόνο `DISABLED_USER` (`pm disable-user`), όχι `DISABLED` |
| Απενεργοποίηση των 2 τμημάτων του launcher | **Όχι** | **Όχι** — το Android δεν επιτρέπει στο shell αλλαγή μεμονωμένων τμημάτων εφαρμογών (μόνο σε test εφαρμογές) |
| Ξεκλείδωμα κλειδώματος που έγινε από το εργοστασιακό μενού | **Όχι** | **Όχι** — από κατάσταση `DISABLED` το shell δεν μπορεί να αλλάξει τίποτα |
| `hotel.bin` | **Όχι** | **Όχι** |
| **Ανάγνωση της πραγματικής κατάστασης** (`getApplicationEnabledSetting` / `getComponentEnabledSetting`) | **Ναι**, χωρίς ADB και χωρίς άδειες | Ναι |
| Άνοιγμα του Factory Menu (`com.realtek.factory.action.FACTORY_MENU`, εξαγόμενο) | **Ναι**, χωρίς ADB | Ναι |

**Απάντηση: ο Agent δεν μπορεί να κάνει το εργοστασιακό Lock / Unlock, ούτε με το Self-ADB.** Μπορεί όμως να **διαβάζει αξιόπιστα** την πραγματική κατάσταση και να **ανοίγει το Factory Menu** για τεχνικό (ανάκτηση) — και τα δύο χωρίς ADB.

Το `pm disable-user com.android.tv.settings` μέσω Self-ADB **δεν είναι ισοδύναμο**: αφήνει ανοιχτό το πλαϊνό πάνελ του Google TV, εξαρτάται από το ADB (ο διακόπτης ADB βρίσκεται μέσα στις Ρυθμίσεις που θα κλείδωνε), και δεν μπορεί να αναιρέσει εργοστασιακό κλείδωμα. Δεν το υλοποιώ χωρίς ρητή έγκρισή σας και δοκιμή.

## 3. ⚠ Σημαντικά ευρήματα ασφάλειας στο εργοστασιακό APK

1. **Εργοστασιακό Hotel Mode = καταστροφή του Corali TV.** Αν ενεργοποιηθεί το Hotel Mode του Factory Menu (`hotel.bin` θέση 0 = 1), σε **κάθε εκκίνηση** η εφαρμογή:
   - **απεγκαθιστά όλες τις εφαρμογές τρίτων** εκτός από Prime Video και Disney+ — **μαζί και το Corali TV**,
   - κάνει `pm clear` σε YouTube / Netflix / Amazon.
   ➜ **Μην ενεργοποιήσετε το εργοστασιακό Hotel Mode** στις τηλεοράσεις με Corali TV. (Στη 112 το Corali TV επιβιώνει τις επανεκκινήσεις, άρα σήμερα είναι ανενεργό.) Το Lock Menu Key δεν εξαρτάται από αυτό.
2. Η εργοστασιακή εφαρμογή (system UID) έχει **εξαγόμενα στοιχεία χωρίς άδεια**:
   - `hotel.BootUpReceiver` με την ενέργεια `com.realtek.hotelmenu.SETUP_HOTEL_MODE` — οποιαδήποτε εφαρμογή μπορεί να προκαλέσει την παραπάνω μαζική απεγκατάσταση όταν το Hotel Mode είναι ενεργό,
   - `utils.PackageInstallService` — εγκαθιστά APK από διαδρομή που δίνει ο καλών, **με δικαιώματα συστήματος**,
   - `user.LogCatService`.
   Είναι κενά ασφαλείας του firmware (μια εφαρμογή που θα εγκαταστήσει ένας επισκέπτης θα μπορούσε να τα εκμεταλλευτεί). **Δεν τα χρησιμοποιούμε.** Προτείνεται αναφορά στην Expressluck / τον προμηθευτή για διόρθωση firmware.

## 4. Προτεινόμενη ασφαλής αρχιτεκτονική

**Τώρα (υλοποιήσιμο, χωρίς ADB, χωρίς ρίσκο):**
- **Read Actual Status** στο PMS από τον Agent: `LOCKED` (Ρυθμίσεις DISABLED **και** τα 2 τμήματα launcher απενεργοποιημένα), `UNLOCKED`, `PARTIAL` (μόνο κάποια από αυτά), `UNKNOWN` (δεν διαβάστηκε / TV εκτός σύνδεσης), με ώρα ανάγνωσης.
- **Emergency Recovery:** εντολή PMS «Άνοιγμα Factory Menu στην TV» για τεχνικό στο δωμάτιο (Engineer Mode Option → Lock Menu Key → Off), με επιβεβαίωση από την ανάγνωση κατάστασης.
- **Lock / Unlock από το PMS:** `UNSUPPORTED` — κουμπιά απενεργοποιημένα με εξήγηση.

**Για πλήρες απομακρυσμένο Lock / Unlock** χρειάζεται ένα από:
- **Επίσημη διεπαφή Expressluck/Realtek** (π.χ. εξαγόμενο service/receiver προστατευμένο με άδεια `signature` για εγκεκριμένο πιστοποιητικό, ή ενσωμάτωση Corali TV ως system app υπογεγραμμένη από τον κατασκευαστή). Αυτό είναι το σωστό αίτημα προς τον προμηθευτή.
- **Device Owner** (ξεχωριστή αξιολόγηση/έγκριση: απαιτεί TV χωρίς λογαριασμούς κατά τη ρύθμιση· δίνει `setApplicationHidden` και περιορισμούς χρήστη — άλλος μηχανισμός, θέλει δικές του δοκιμές).

## 5. Δοκιμές
Οι δοκιμές της ενότητας 6 της προδιαγραφής (Lock/Unlock από PMS) **δεν μπορούν να γίνουν**, γιατί δεν υπάρχει αποδεδειγμένος μηχανισμός. Για την ανάγνωση κατάστασης / ανάκτηση: μετά την υλοποίηση, στη 112 με Lock Menu Key On/Off από το Factory Menu και έλεγχο ότι το PMS δείχνει LOCKED/UNLOCKED, και μετά από επανεκκίνηση.

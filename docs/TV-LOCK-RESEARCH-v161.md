# Hotel Corali — HORIZON 112: Menu Lock / Channel Scan Lock

**Κατάσταση: offline forensic analysis + ελεγμένος μηχανισμός verification (4/4 tests).**
**Δεν έχει εγκατασταθεί νέο PMS / APK. Ο vendor writer δεν υπάρχει. Μην παρουσιάζετε αυτό το πακέτο ως λειτουργικό Lock/Unlock.**

## 1. Επιβεβαιωμένα δεδομένα από το πραγματικό `TvEplFactoryGTV.apk`

Το APK `com.expressluck.tvfactory` (Android API 34, versionName `V2.2.36`)
δηλώνει `android:sharedUserId="android.uid.system"` στο manifest. Ο απλός
Corali TV Agent ΔΕΝ αποκτά τα ίδια δικαιώματα. Διαθέτει exported
`FactoryMenuActivity` για εμφάνιση εργοστασιακού μενού, ΟΧΙ επιβεβαιωμένο
intent ή δημόσιο API για να αλλάξει κλειδώματα.

Εξετάστηκαν τα bytecodes:

- `com/test/hotelmodel/hotel/HotelModelManager.setLockMenuKey(int)` → helper
  `a/a.b(boolean,int)` → `TvInputManagerHelper.disableApplication("com.android.tv.settings",...)`
  (`PackageManager.setApplicationEnabledSetting`), `TvInputUtils.enableApplication`
  (`PackageManager.setComponentEnabledSetting`) για
  `com.google.android.apps.tv.launcherx/.dashboard.DashboardActivity` και
  `.dashboard.DashboardHandler`, `Settings.Global.putInt("hotel_menu_key_lock", ...)`
  και `Realtek Factory.writeConfigFile(...)` στο vendor config.
- `HotelModelManager.setChannelScanKey(int)` →
  `Settings.Global.putInt("hotel_channel_lock", ...)` +
  `Factory.writeConfigFile(...)`.
- `Factory.readConfigFile("/mnt/vendor/impdata/hotel.bin")` διαβάζει τη
  μόνιμη κατάσταση. Default raw config:
  `0 0 100 0 0 0 20 0 0 0 0 0 0 0 0 0 0 0 0 0 0`.
  `CommonConstants.CHLOCK_STATUS_INDEX = 1` και
  `MENULOCK_STATUS_INDEX = 3` (zero-based). Άρα τα πεδία 2 και 4
  αντιστοίχως σε απλή ανάγνωση χωρισμένη με κενά.
- Το exported `BootUpReceiver` ακούει `com.realtek.hotelmenu.SETUP_HOTEL_MODE`
  και διαβάζει εργοστασιακές παραμέτρους. Δεν είναι τεκμηριωμένη εντολή
  `SET_MENU_LOCK` ή `SET_CHANNEL_SCAN_LOCK`.

**Προσοχή στη σημασιολογία των τιμών**: Για πραγματικό On/Off πρέπει να
συγκριθούν snapshots όταν το UI είναι On και Off. Δεν θεωρούμε αυθαίρετα
ότι 0=ξεκλείδωτο και 1=κλειδωμένο σε ΚΑΘΕ πηγή.

## 2. Πραγματικά αποτελέσματα δοκιμών τηλεόρασης (από χειροκίνητη επιβεβαίωση)

- `Lock Menu Key = On`: κανονικές Ρυθμίσεις Google TV δεν ανοίγουν.
- `Lock Menu Key = Off`: οι Ρυθμίσεις ανοίγουν.
- `Channel Scan Lock = On`: Auto Scan και Manual Scan δεν ανοίγουν.
- `Channel Scan Lock = Off`: και οι δύο ανοίγουν.
- Όταν το menu ήταν On, `settings get global hotel_menu_key_lock` έδειχνε
  `0`, και `pm list packages -d` δεν εμφάνιζε `com.android.tv.settings`.
  Επομένως κανένα από αυτά, μόνο του, δεν είναι αξιόπιστο readback.

## 3. Ασφαλής συλλογή πραγματικού state (χωρίς αλλαγές)

Με TV On και ADB ενεργό, σε Windows PowerShell:

```powershell
& "$env:USERPROFILE\Desktop\platform-tools\adb.exe" connect 192.168.10.120:5555
& ".\Corali-Horizon-Lock-Probe.ps1" -Label baseline
```

Η εντολή διαβάζει ΜΟΝΟ Android Global settings, τοπικά στοιχεία
PackageManager και, εφόσον επιτρέπεται, **μόνο τα πεδία 2 και 4** του
`hotel.bin` χωρίς να εμφανίζει ή να ανεβάζει ολόκληρο το αρχείο (ενδέχεται
να περιέχει και κωδικό εργοστασιακού Hotel Mode).

Για να επιβεβαιωθούν raw mappings, μετά από κάθε δοκιμή που ήδη ξέρει να
επαναφέρει ο τεχνικός, χρησιμοποιούνται διαφορετικά labels:
`-Label menu-on`, `-Label scan-on`. Για ανθεκτικότητα απαιτείται και
`-Label after-reboot` στην ίδια κατάσταση μετά από επανεκκίνηση.
Η δοκιμή αυτή **δεν ενεργοποιεί κανένα κλείδωμα**.

## 4. Πώς γίνεται σωστά στο PMS

### Δομή εντολής

`POST ...` (οριστική διαδρομή μόνο αφού ενσωματωθεί στον πραγματικό
κώδικα v160): `{roomId, kind, desired, idempotencyKey}`.

Απαιτούνται ρόλοι/δικαιώματα Owner/Admin, έλεγχος room→owner, CSRF/origin,
κρυπτογραφημένη αυθεντικοποίηση Agent, per-room policy rev, audit και
unique idempotency. Τα actions δεν επιτρέπεται να εκτελούνται από
ξενοδοχειακούς επισκέπτες/άγνωστους clients.

Η κατάσταση είναι:

`PENDING → DELIVERED → VERIFIED` ή `UNVERIFIED` / `FAILED` /
`OFFLINE` / `UNSUPPORTED`.

`VERIFIED` επιτρέπεται ΜΟΝΟ όταν ο εξουσιοδοτημένος OEM writer καταγράψει
την εντολή, ο vendor readback επιβεβαιώσει τη μόνιμη κατάσταση και το
runtime readback επιβεβαιώσει το πραγματικό αποτέλεσμα. Το ACK μόνο του
δεν αρκεί. Αν η κατάσταση δεν μπορεί να διαβαστεί, ο server εμφανίζει
`UNVERIFIED`. `UNKNOWN` και `UNVERIFIED` δεν μετατρέπονται σε `OFF`.

### Σημερινός τεχνικός περιορισμός

Η εργοστασιακή εφαρμογή είναι system-UID. Ο Corali Agent δεν μπορεί να
επικαλείται αυτόματα `Factory.writeConfigFile` ή να τροποποιεί components
άλλης εφαρμογής χωρίς αντίστοιχα OEM/system/MDM δικαιώματα. Τα
`settings put global ...` και `pm disable-user ...` μέσω debugging shell
δεν αναπαράγουν εγγυημένα την πλήρη εργοστασιακή διαδικασία και μπορεί
να χαθούν ή να ασυμφωνήσουν μετά από reboot. **Δεν προτείνονται ως
production λύση**. Τυχόν αλλαγή vendor APK / shared UID χωρίς υπογραφή
κατασκευαστή δεν είναι αποδεκτή.

Η σωστή production διαδρομή είναι **υπογεγραμμένο OEM bridge** ή
επίσημο API/SDK από Expressluck–Realtek/HORIZON, με μόνο δύο επιτρεπόμενες
εντολές, readback των δύο lock states, και μηχανισμό έκτακτης επαναφοράς.
Εναλλακτικά μπορεί να εξεταστεί εταιρικό Device Owner/MDM για software
περιορισμούς, αλλά **δεν είναι ισοδύναμο** με τις δύο εργοστασιακές
λειτουργίες και απαιτεί χωριστή δοκιμή στο Android 14.

## 5. Περιεχόμενα πακέτου

- `Corali-Horizon-Lock-Probe.ps1`: **λειτουργικό, read-only** diagnostic.
- `lock-state-machine.mjs`: tested secure contract για παραλαβή,
  OEM capability gate, γράψιμο και readback. **Δεν περιλαμβάνει
  πραγματικό vendor writer**.
- `tests/locks.test.mjs`: 4 offline tests (`node --test tests/locks.test.mjs`).
- `sql/TV-LOCK-REFERENCE.sql`: βάση audit/κατάστασης, **reference-only**, όχι
  εφαρμοσμένη migration. Πρέπει να ελεγχθεί έναντι του ακριβούς v160 schema.

## 6. Πρότυπα αποδοχής πριν από πραγματική ενεργοποίηση

1. TV 112 σε δύο κατευθύνσεις (ON→OFF και OFF→ON) για κάθε lock.
2. Readback μόνιμης κατάστασης + πραγματικού runtime effect.
3. Επαναφορά μετά από reboot και μετά από διακοπή ρεύματος.
4. Offline/timeout αποτυπώνονται ως `OFFLINE` ή `UNVERIFIED` (ποτέ επιτυχία).
5. Ενεργοποίηση emergency unlock από εξουσιοδοτημένο τεχνικό.
6. Welcome Screen, Wi-Fi, channel list, volume 8/30 και TV token αμετάβλητα.
7. Αποτυχία μη εξουσιοδοτημένου χρήστη, no cross-room/tenant writes.
8. Μόνο μετά, pilot → υπόλοιπα δωμάτια.

## 7. Τι δεν έγινε

Δεν έγινε απομακρυσμένη αλλαγή στην πραγματική TV (δεν υπάρχει
άμεση σύνδεση εδώ), ούτε έγινε μεταγλώττιση/υπογραφή Corali TV 1.11,
ούτε πραγματική ανάπτυξη PMS v161. Από τα ανεβασμένα αρχεία υπάρχει
compiled PMS v159 και προδιαγραφές v160, **όχι πλήρης source/build για
τον Android Agent v160**. Οποιαδήποτε δήλωση «εγκαταστάθηκε» θα ήταν
ανακριβής.

# Corali TV — Καθαρισμός στο check-out (GDPR), εφαρμογές επισκέπτη, δυνατότητες TV (PMS v161)

Ενσωμάτωση του «Hotel Corali TV PMS Unified Staging v161» στο PMS. Πιλοτική TV: HORIZON 43HQ8590U/D, δωμάτιο 112.
**Τίποτα από τη v161 δεν έχει δοκιμαστεί ακόμα στη HORIZON μέσα από το PMS.** Μέχρι να γίνει, η λειτουργία μένει απενεργοποιημένη (κανένα δωμάτιο με καθαρισμό, gateway σε `dryRun`).

## 1. Κατάσταση ανά απαίτηση

| # | Απαίτηση | Κατάσταση |
|---|---|---|
| 1 | Αυτόματος καθαρισμός YouTube, Netflix, Prime Video, Disney+, YouTube Music στο check-out | **Υλοποιήθηκε**, δοκιμάστηκε στο περιβάλλον ανάπτυξης. Στη HORIZON (εκτός PMS) έχει επιβεβαιωθεί `pm clear` για YouTube· Netflix / Prime Video ελεγμένα από το kit· Disney+ / YouTube Music δεν έχουν δοκιμαστεί: το gateway **δεν ξεκινά σε κανονική λειτουργία** (`dryRun:false`) πριν δοκιμαστούν και δηλωθούν (`unverifiedAppPilotsApproved:true`), γιατί κάθε check-out καθαρίζει και τις 5 μαζί |
| 2 | Εντοπισμός & ασφαλής αφαίρεση εφαρμογών επισκέπτη | **Υλοποιήθηκε**: εντοπισμός με διαφορά από τη λίστα αναφοράς (baseline) της TV· αφαίρεση **μόνο** με έγκριση προσωπικού, μία-μία. Εκκρεμεί δοκιμή στη 112 |
| 3 | Προστασία λογαριασμού Google ξενοδοχείου, Corali TV, Welcome Screen, Hotel Mode | Καμία ενέργεια δεν αγγίζει λογαριασμούς ή αυτές τις εφαρμογές (προστατευμένη λίστα σε PMS **και** gateway). Το **κλείδωμα** αφαίρεσης λογαριασμού από επισκέπτη δεν είναι εφικτό χωρίς OEM/MDM → `NOT_FULLY_VERIFIED` |
| 4 | Menu Lock / Channel Scan Lock | **Δεν υλοποιήθηκε**: δεν υπάρχει επιβεβαιωμένος ασφαλής μηχανισμός (`OEM_BRIDGE_REQUIRED`). Χειροκίνητα από το Factory Menu. Βλ. `docs/TV-LOCK-RESEARCH-v161.md` |
| 5 | Power ON μέσω Wi-Fi χωρίς υλικό | **Πειραματικός έλεγχος** `cast-wake.mjs` (ίδιο αίτημα με το Cast του κινητού που ήδη ξυπνά την TV). Δεν χρησιμοποιείται από το PMS μέχρι να αποδειχθεί → `UNSUPPORTED` |
| 6 | Πραγματική κατάσταση, σφάλματα, ιστορικό ανά δωμάτιο | **Υλοποιήθηκε**: PMS → Corali TV → «Καθαρισμός στο check-out (GDPR)» |

## 2. Αρχιτεκτονική

```
Check-out κράτησης (πραγματική αλλαγή κατάστασης σε checked_out)
   ↓ trigger PostgreSQL — μία εργασία ανά (κράτηση, δωμάτιο), μόνο αν το δωμάτιο έχει «καθαρισμό»
tv_privacy_jobs (QUEUED)
   ↑↓ HTTPS POST /api/gateway/tv-privacy  (Bearer TV_PRIVACY_BRIDGE_TOKEN, μόνο στο PMS)
Υπολογιστής-gateway στο ξενοδοχείο (Windows, Node, μόνο εξερχόμενες συνδέσεις)
   ↓ ADB στο τοπικό δίκτυο — έλεγχος android_id πριν από κάθε ενέργεια
HORIZON: pm clear για τις εγκεκριμένες εφαρμογές · λίστα εφαρμογών τρίτων
   ↓ αποτέλεσμα ανά εφαρμογή + νέες εφαρμογές επισκέπτη
PMS: κατάσταση, ιστορικό, «Αφαίρεση» (έγκριση), «Ελέγχθηκε» (προσωπικό)
```

- Η TV δεν στέλνει κωδικούς, emails ή ιστορικό. Το PMS δεν δέχεται ποτέ αυθαίρετο όνομα πακέτου για καθαρισμό· η λίστα είναι σταθερή στον κώδικα.
- Πριν από **κάθε** διαγραφή το gateway ξαναζητά άδεια (`authorize`): αν έχει κάνει check-in νέος επισκέπτης → `BLOCKED_NEW_GUEST`, χωρίς διαγραφές.
- Lease ανά εργασία: αν το gateway πέσει, η εργασία λήγει (`UNVERIFIED`) και δεν φαίνεται ποτέ ως επιτυχής.
- Το «καθαρίστηκε τοπικά» **δεν** είναι πιστοποιημένη αποσύνδεση: το προσωπικό ανοίγει τις εφαρμογές και πατά «Ελέγχθηκε».

### Καταστάσεις
`QUEUED` · `RUNNING` · `DRY_RUN` (καμία διαγραφή) · `CLEARED_LOCAL_NEEDS_REVIEW` · `PARTIAL` · `FAILED` · `BLOCKED_NEW_GUEST` · `BLOCKED_UNREGISTERED` · `BLOCKED_SECURITY` (λάθος TV / android_id) · `UNVERIFIED`.
Αφαίρεση εφαρμογής: `APPROVED` → `RUNNING` → `REMOVED` / `NOT_INSTALLED` / `FAILED` / `BLOCKED_*`.

### Εφαρμογή επισκέπτη — πότε επιτρέπεται η αφαίρεση
Όλα μαζί: (α) την ανέφερε το gateway γι' αυτή την εργασία ως νέα σε σχέση με το baseline, (β) δεν είναι προστατευμένη (Google/Android/Realtek/Expressluck, Corali TV, οι 5 εφαρμογές streaming), (γ) η εργασία δεν είναι σε εξέλιξη ή μπλοκαρισμένη, (δ) δεν έχει μπει νέος επισκέπτης, (ε) στη TV ξαναελέγχεται ότι είναι εφαρμογή τρίτου και όχι στο baseline. Εκτελείται `pm uninstall --user 0` (ποτέ factory reset). Με το gateway σε `dryRun` δεν αφαιρείται τίποτα (`FAILED · DRY_RUN_NO_REMOVAL`).

## 3. Αλλαγές βάσης (εφαρμόζονται αυτόματα, μόνο προσθήκες)
- `tv_screens.privacy_clear` (0/1, προεπιλογή 0 = καμία αλλαγή συμπεριφοράς)
- `tv_privacy_jobs`, `tv_privacy_gateway`, `tv_privacy_uninstalls`
- συνάρτηση + trigger `trg_tv_privacy_checkout` στον πίνακα `bookings` (AFTER UPDATE OF status): δημιουργεί εργασία μόνο σε μετάβαση checked-in → `checked_out`, με `room_id`, ενεργή TV και `privacy_clear=1`. Δεν αλλάζει την κράτηση.

## 4. API
- `GET /api/pms/tv-privacy` (reservations.read): εργασίες, δωμάτια, gateway.
- `POST /api/pms/tv-privacy` (origin + session + audit `tv_privacy`):
  `{"action":"room","roomId":2,"enabled":true}` (integrations.write) ·
  `{"action":"review","jobId":1}` (reservations.write) ·
  `{"action":"retry","jobId":1}` (integrations.write) ·
  `{"action":"approve_uninstall","jobId":1,"package":"com.spotify.tv.android"}` (integrations.write).
- `POST /api/gateway/tv-privacy` — μόνο για το gateway, μόνο στο PMS (όχι στο site κρατήσεων), Bearer με `timingSafeEqual`. ops: `claim`, `authorize`, `report`, `claim_uninstall`, `report_uninstall`.

## 5. Εγκατάσταση
1. **PMS + site κρατήσεων**: πακέτο v161 όπως πάντα (web installer ή `INSTALL-CPANEL.sh`). Το schema εφαρμόζεται αυτόματα. Χωρίς άλλη ρύθμιση: η ενότητα εμφανίζεται, ο καθαρισμός είναι ανενεργός, όλα τα υπόλοιπα όπως στη v160.
2. **Token γέφυρας** (μόνο στο PMS): στο cPanel → File Manager → `runtime.env` της εφαρμογής PMS, προσθέστε
   `TV_PRIVACY_BRIDGE_TOKEN=<τυχαίο, ≥ 32 χαρακτήρες>` και κάντε Restart. Δημιουργία στον υπολογιστή:
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
   **Μην το στείλετε σε chat/email.** Το ίδιο ακριβώς token μπαίνει μόνο στον υπολογιστή-gateway.
3. **Gateway (Windows, μένει ανοιχτός, στο ίδιο δίκτυο με τις TV)**: αποσυμπιέστε `corali-tv-privacy-gateway-v161.zip`, εγκαταστήστε Node 22+ και Android platform-tools. Αντιγράψτε `gateway/config.example.json` → `gateway/config.json`:
   - `roomMap`: κλειδί = **εσωτερικό** `rooms.id` του 112, όχι «112» (συνδεδεμένοι στο PMS, ανοίξτε `/api/pms/tv-privacy` και δείτε το `room_id` δίπλα στο `"room_code":"112"`), `serial` = IP:5555 της TV, `androidId` από
     `adb shell settings get secure android_id`, `baselineFile` = λίστα εφαρμογών της TV χωρίς επισκέπτη
     (`adb shell pm list packages -3 > baseline\tv112-third-party-baseline.txt`, από τη Γραμμή εντολών cmd — όχι PowerShell).
   - `dryRun: true` αρχικά. `unverifiedAppPilotsApproved: false` μέχρι να δοκιμαστούν Disney+ / YouTube Music.
   - Μεταβλητές περιβάλλοντος Windows: `TV_PRIVACY_BRIDGE_TOKEN`, `ADB_PATH` (πλήρης διαδρομή `adb.exe`).
   - Εκκίνηση: `node gateway\worker.mjs`. Στο PMS το gateway πρέπει να φανεί «● συνδεδεμένο · δοκιμαστική λειτουργία».
4. Ασφάλεια δικτύου: το ADB (5555) να είναι προσβάσιμο **μόνο** από τον υπολογιστή-gateway (δίκτυο διαχείρισης / VLAN, όχι το Wi-Fi επισκεπτών).
5. PMS → Corali TV → «Καθαρισμός στο check-out»: τσεκάρετε **μόνο το 112**.

## 6. Πειραματικό Power ON (cast-wake)
Με την TV σε αναμονή (μετά από 1, 5, 15, 60 λεπτά): `node gateway\cast-wake.mjs 192.168.10.120`.
Καταγράψτε αν άναψε η οθόνη και σε πόσα δευτερόλεπτα. Αν δουλεύει αξιόπιστα και μετά από 60′, το προσθέτουμε ως μέθοδο ρεύματος `cast` στο PMS. Αν όχι, Power ON μένει `UNSUPPORTED` (μόνο με το τηλεχειριστήριο ή IR blaster).

## 7. Δοκιμές

**Περιβάλλον ανάπτυξης (PostgreSQL + Next.js), όλα επιτυχή:**
- 349 αυτόματα tests (16 νέα για τη v161: ταξινόμηση αποτελεσμάτων, ασφαλείς εργασίες, νέος επισκέπτης, εφαρμογές επισκέπτη / προστατευμένες, adapter αφαίρεσης, Cast framing, δυνατότητες, ίδιο αρχείο κανόνων σε PMS και gateway), έλεγχος schema (140 πίνακες), typecheck, lint, production build.
- Trigger: αλλαγή ημερομηνίας → καμία εργασία ✓ · check-out → μία εργασία ✓ · επανάληψη check-out → καμία διπλή ✓ · δωμάτιο χωρίς «καθαρισμό» → καμία ✓
- Γέφυρα: χωρίς / λάθος token → 401 ✓ · δεύτερο claim → τίποτα ✓ · λάθος lease → απόρριψη ✓ · report → `CLEARED_LOCAL_NEEDS_REVIEW` ✓ · δεύτερο report → απόρριψη ✓ · άγνωστο op → 400 ✓ · route στο site κρατήσεων → 404 ✓
- Εφαρμογές επισκέπτη: φιλτράρονται gms και μη έγκυρα ονόματα ✓ · προστατευμένη → `PROTECTED_PACKAGE` ✓ · μη αναφερθείσα → `NOT_ALLOWED` ✓ · έγκυρη → `APPROVED` → `REMOVED` ✓ · μετά από νέο check-in → `BLOCKED_NEW_GUEST` / `NOT_ALLOWED` ✓
- «Ελέγχθηκε» μία φορά ✓ · σελίδα `/pms/tv` χωρίς σφάλματα, Ήχος & Hotel Mode αμετάβλητα ✓

**HORIZON 112 — εκκρεμεί (με τη σειρά):**
1. Gateway σε `dryRun`: δοκιμαστική κράτηση στο 112 → check-in → check-out → `DRY_RUN`, καμία διαγραφή.
2. Λάθος `androidId` στο config → `BLOCKED_SECURITY`.
3. `dryRun:false`, με **δοκιμαστικούς** λογαριασμούς YouTube / Netflix / Prime Video → `CLEARED_LOCAL_NEEDS_REVIEW` → άνοιγμα κάθε εφαρμογής: κανένας προηγούμενος λογαριασμός.
4. Έλεγχος: λογαριασμός Google ξενοδοχείου, Corali TV, Welcome Screen, Wi-Fi, ένταση/όριο, κανάλια, Cast — αμετάβλητα.
5. Εγκατάσταση μιας δοκιμαστικής εφαρμογής → εμφανίζεται στις «Εφαρμογές επισκέπτη» → «Αφαίρεση» → `REMOVED`.
6. Νέο check-in πριν τρέξει το gateway → `BLOCKED_NEW_GUEST`.
7. TV κλειστή στο check-out → η εργασία περιμένει, δεν δείχνει ποτέ επιτυχία.
8. Disney+ / YouTube Music: χωριστή δοκιμή → `unverifiedAppPilotsApproved:true` (προϋπόθεση για το βήμα 3).
9. cast-wake (§6).

## 8. Rollback
Πακέτο v160. Οι πίνακες/στήλες της v161 μένουν χωρίς χρήση. Αν θέλετε να σταματήσει κάθε δημιουργία εργασιών χωρίς rollback: αποεπιλέξτε τα δωμάτια ή σταματήστε το gateway (οι εργασίες μένουν `QUEUED`, τίποτα δεν διαγράφεται). Πλήρης αφαίρεση trigger (προαιρετικά):
`DROP TRIGGER IF EXISTS trg_tv_privacy_checkout ON bookings;`

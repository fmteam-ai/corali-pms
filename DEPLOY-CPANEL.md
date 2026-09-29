# Hotel Corali PMS v47 — αυτόματη ασφαλής εγκατάσταση cPanel

## Προτεινόμενη εγκατάσταση για τον συγκεκριμένο server

Χρησιμοποιήστε τον προσωρινό γραφικό web installer. Η PHP `exec` πρέπει να είναι διαθέσιμη μόνο κατά την εγκατάσταση στο PHP-FPM pool του `hotelcorali.gr` και να απενεργοποιηθεί ξανά αμέσως μετά.

## Γραφικός web installer

Η διορθωμένη έκδοση περιλαμβάνει προσωρινό web installer τύπου WordPress. Ανεβάστε:

- `corali-pms-cpanel-v47-root.tar.gz` και το `.sha256` στον `/home/corali/`
- μόνο το `corali-web-installer-v47.php` ως `/home/corali/public_html/corali-installer.php`

Μην ανεβάσετε το `corali-web-installer-v47-access.txt`. Ανοίξτε το τοπικά και επισκεφθείτε την ιδιωτική διεύθυνση μίας χρήσης που περιέχει. Εναλλακτικά, ανοίξτε απευθείας τον installer και επικολλήστε τον προσωπικό κωδικό στη φόρμα. Επιλέξτε **Ελληνικά** ή **English** πριν την έναρξη. Ο web installer εντοπίζει το EA/CloudLinux Node.js του cPanel, εκτελεί προέλεγχο, checksum, backup PostgreSQL, migrations, δύο runtime tests, atomic swap και rollback. Μετά την εγκατάσταση προσφέρει ασφαλή δημιουργία/ανάκτηση του κύριου owner και επαναφορά 2FA χωρίς terminal. Αν οι παλιοί `/home/corali/releases` ή `/home/corali/backups` έχουν λάθος ιδιοκτησία, χρησιμοποιεί ιδιωτικούς εναλλακτικούς φακέλους μέσα στο εγγράψιμο `/home/corali/apps`. Μετά τον έλεγχο σύνδεσης πατήστε «Κλείδωμα και διαγραφή installer» και απενεργοποιήστε ξανά την PHP `exec`.

Αν εμφανιστεί «Ο installer είναι κλειδωμένος», έχει οριστικοποιηθεί παλαιότερη εγκατάσταση. Κάθε νέο πακέτο αποκτά δικό του κλείδωμα με βάση το checksum του αρχείου. Ανεβάστε **μαζί** τον νέο installer, το νέο αρχείο πρόσβασης (μόνο τοπικά, ποτέ στον server), το νέο archive και το νέο checksum. Μην διαγράψετε το ιδιωτικό `locked` του παλιού installer για να παρακάμψετε το μήνυμα.

Αν ο προέλεγχος δείξει ότι η PHP `exec` είναι απενεργοποιημένη ή ότι ο ενεργός φάκελος `/home/corali/apps` δεν είναι εγγράψιμος, δεν γίνεται καμία αλλαγή.

Η v47 ενημερώνει μαζί τις δύο ενεργές εφαρμογές:

- `/home/corali/apps/corali-pms`
- `/home/corali/apps/corali-booking`

Ο installer διατηρεί ξεχωριστά τα δύο `runtime.env`, επιβεβαιώνει ότι έχουν το ίδιο `PMS_DOCUMENT_KEY`, δημιουργεί PostgreSQL backup, εφαρμόζει idempotent migrations, εκτελεί δύο runtime smoke tests, δημιουργεί application backups, κάνει atomic swap, διορθώνει ownership/permissions και επανεκκινεί το Passenger. Αν αποτύχει βήμα μετά το swap, επαναφέρει αυτόματα τις προηγούμενες εφαρμογές.

## 1. Ανέβασμα και checksum

Ανεβάστε τα παρακάτω στο `/home/corali/`:

- `corali-pms-cpanel-v47-root.tar.gz`
- `corali-pms-cpanel-v47-root.tar.gz.sha256`

Στο Terminal:

```bash
cd /home/corali
sha256sum -c corali-pms-cpanel-v47-root.tar.gz.sha256
```

Πρέπει να εμφανιστεί `OK`. Αν αποτύχει, μη συνεχίσετε.

## 2. Καθαρή εξαγωγή

```bash
mkdir -p /home/corali/releases/corali-v47
tar -xzf /home/corali/corali-pms-cpanel-v47-root.tar.gz \
  -C /home/corali/releases/corali-v47
```

Μην αντιγράψετε `runtime.env` στον release φάκελο. Ο installer το παίρνει αυτόματα από κάθε ενεργή εφαρμογή.

## 3. Μία εντολή εγκατάστασης

Ως `root`:

```bash
cd /home/corali/releases/corali-v47
bash INSTALL-CPANEL.sh
```

Ελέγξτε τις διαδρομές που εμφανίζονται και πληκτρολογήστε ακριβώς:

```text
INSTALL
```

Για μη διαδραστική εκτέλεση:

```bash
bash INSTALL-CPANEL.sh --yes
```

## Παράμετροι installer

```text
--pms-root PATH       ενεργός φάκελος PMS
--booking-root PATH   ενεργός φάκελος booking
--user USER           cPanel Unix user
--pms-url URL         δημόσιο PMS URL
--booking-url URL     δημόσιο booking URL
--backup-dir PATH     φάκελος ασφαλών αντιγράφων
--yes                 εκτέλεση χωρίς ερώτηση επιβεβαίωσης
--skip-db-backup      μόνο αν έχει ήδη ληφθεί ανεξάρτητο PostgreSQL backup
```

Τα defaults είναι ήδη σωστά για τον server του Hotel Corali. Το `--skip-db-backup` δεν πρέπει να χρησιμοποιείται χωρίς επιβεβαιωμένο εξωτερικό DB backup.

## 4. Τελικός έλεγχος

Μετά το `INSTALLATION COMPLETE — v47`, ανοίξτε από browser:

```text
https://pms.hotelcorali.gr/api/health
https://booking.hotelcorali.gr/api/health
```

Και τα δύο πρέπει να επιστρέφουν `"ok":true` και `"version":"v47"`. Ο έλεγχος γίνεται από browser επειδή το ModSecurity/Cloudflare μπορεί να επιστρέψει 406 σε server-side `curl`.

Ελέγξτε επίσης login/2FA/profile, σημειώσεις και ειδοποιήσεις, μία δοκιμαστική κράτηση, folio/check-in/out, room grid, housekeeping, `/book` στα Ελληνικά και Αγγλικά και πληρωμή μόνο σε Stripe test mode. Η v47 δεν προσφέρει Viva ως μέθοδο πληρωμής επισκέπτη.

Η δρομολόγηση πρέπει να είναι:

- `https://pms.hotelcorali.gr/` → `/login`
- `https://booking.hotelcorali.gr/` → `/book`
- τα `/login`, `/pms/*` και `/api/pms/*` δεν εκτίθενται από το Booking app.

## Rollback

Ο installer δημιουργεί manifest και εμφανίζει την ακριβή εντολή rollback. Παράδειγμα:

```bash
bash /home/corali/apps/corali-pms/ROLLBACK-CPANEL.sh \
  /home/corali/backups/corali-deployment-v47-TIMESTAMP.manifest
```

Το rollback επαναφέρει και τις δύο εφαρμογές. Δεν επαναφέρει αυτόματα τη βάση, επειδή οι migrations είναι additive και η επαναφορά παλιού dump θα μπορούσε να διαγράψει νεότερες κρατήσεις.

## Πρώτος owner και χαμένο 2FA

Μόνο αν δεν υπάρχει owner:

```bash
cd /home/corali/apps/corali-pms
bash scripts/create-admin.sh hcorali "Hotel Corali" admin@hotelcorali.gr
```

Για ρητή επαναφορά χαμένου 2FA:

```bash
cd /home/corali/apps/corali-pms
node --env-file=runtime.env scripts/reset-admin-2fa.mjs hcorali CONFIRM
```

Η επαναφορά 2FA ακυρώνει τις ενεργές συνεδρίες. Ενεργοποιήστε ξανά το 2FA αμέσως από το Προφίλ.

## Cron γενεθλίων

Καθημερινά στις 09:00 ώρα Ελλάδας:

```bash
cd /home/corali/apps/corali-pms && node --env-file=runtime.env scripts/run-birthday-automation.mjs
```

## Μυστικά και TLS

Τα βασικά server secrets (`PMS_DOCUMENT_KEY`, session secret, database credentials) παραμένουν στα προστατευμένα `runtime.env` με mode 600. Τα κλειδιά παρόχων που εισάγονται από την οθόνη PMS αποθηκεύονται κρυπτογραφημένα στην PostgreSQL με το κοινό `PMS_DOCUMENT_KEY` των δύο εφαρμογών. Η παλιά παραμετροποίηση παρόχων μέσω `runtime.env` λειτουργεί ως εφεδρεία όταν δεν υπάρχει εγγραφή PMS. Τα κλειδιά δεν περιλαμβάνονται στο archive ή στο deployment manifest. Με `DATABASE_SSL=true` η επικύρωση πιστοποιητικού παραμένει ενεργή· για ιδιωτική CA ορίστε `DATABASE_SSL_CA=/absolute/path/ca.pem`.

### Αυτόματη είσπραξη υπολοίπου (Stripe, cron)

Στις κρατήσεις με προκαταβολή, το Stripe αποθηκεύει την κάρτα (ο επισκέπτης ενημερώνεται στη φόρμα και στη σελίδα πληρωμής). Ο worker χρεώνει το υπόλοιπο όταν η άφιξη απέχει όσες ημέρες ορίζει η πολιτική πληρωμής (προεπιλογή 7· απενεργοποιείται από PMS → Πολιτική πληρωμής). Αποτυχίες ή κρατήσεις χωρίς κάρτα ειδοποιούν την υποδοχή για αποστολή συνδέσμου πληρωμής. Μέγιστο 3 προσπάθειες, με απόσταση 24 ωρών. Ημερήσιο cron **σε ένα μόνο PMS instance**:

```bash
cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-balance-collection.mjs >> /home/corali/logs/corali-balance.log 2>&1
```

Το Viva.com μπορεί να ρυθμιστεί στις Συνδέσεις· η ολοκλήρωση κράτησης είναι ανεξάρτητη από πάροχο (lib/booking-fulfillment.ts) ώστε να προστεθεί αργότερα ως επιλογή πληρωμής.

### myDATA (ΑΑΔΕ)

Ρύθμιση στο PMS → Συνδέσεις → ΑΑΔΕ / myDATA: περιβάλλον (dev για δοκιμές, prod για παραγωγή), ΑΦΜ ξενοδοχείου, σειρές αποδείξεων/τιμολογίων, κατηγορία ΦΠΑ διαμονής (2 = 13%) και extras, και **κατηγορία «λοιπών φόρων» για το τέλος ανθεκτικότητας στην κλιματική κρίση** (υποχρεωτική όταν χρεώνεται το τέλος). Οι κωδικοί πρέπει να επιβεβαιωθούν από τον λογιστή πριν περάσετε σε prod. Τα παραστατικά (απόδειξη 11.2 για επισκέπτη, τιμολόγιο 2.1 για εταιρεία/πρακτορείο με ελληνικό ΑΦΜ) εκδίδονται από το folio της κράτησης. Ο διακομιστής πρέπει να επιτρέπει εξερχόμενες κλήσεις προς mydataapidev.aade.gr / mydatapi.aade.gr. Cron επαναποστολής ανά 10 λεπτά, **σε ένα μόνο PMS instance**:

```bash
cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-mydata-queue.mjs >> /home/corali/logs/corali-mydata.log 2>&1
```

### Social media (Facebook / Instagram)

Στο PMS → Συνδέσεις → Facebook / Instagram: pageId, instagramAccountId, graphVersion (π.χ. v21.0), appSecret, pageAccessToken και verifyToken. Webhook του Meta app (Messenger & Instagram messaging): `https://booking.hotelcorali.gr/api/webhooks/meta` με το ίδιο verifyToken. Οι αναρτήσεις δημοσιεύονται μόνο μετά από έγκριση· cron ανά 5 λεπτά, **σε ένα μόνο PMS instance**:

```bash
cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-social-publisher.mjs >> /home/corali/logs/corali-social.log 2>&1
```

### Channel Manager (Booking.com, Expedia, Airbnb)

Ο συγχρονισμός γίνεται μέσω Channex (λογαριασμός και σύνδεση των OTA εκεί). Στο PMS → Συνδέσεις → Channel Manager συμπληρώστε property id, environment (production ή staging) και API key, και αντιστοιχίστε κάθε τύπο δωματίου με το room type id του Channex. Cron ανά 5 λεπτά, **σε ένα μόνο PMS instance**:

```bash
cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-channel-sync.mjs >> /home/corali/logs/corali-channels.log 2>&1
```

Μετά την πρώτη ρύθμιση πατήστε «Πλήρης συγχρονισμός διαθεσιμότητας». Αν χρησιμοποιείτε άλλον Channel Manager, αλλάζει μόνο ο adapter (scripts/run-channel-sync.mjs).

### Διαγραφή στοιχείων ταυτότητας (GDPR, cron)

Ημερομηνία γέννησης και αριθμός διαβατηρίου/ταυτότητας από το online pre-check-in διαγράφονται οριστικά 3 χρόνια μετά την τελευταία αναχώρηση του επισκέπτη. Προσθέστε **σε ένα μόνο PMS instance** ημερήσιο cron (π.χ. 03:15):

```bash
cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-data-retention.mjs >> /home/corali/logs/corali-retention.log 2>&1
```

Κάθε εκτέλεση καταγράφεται στο «Ιστορικό ενεργειών» (retention.purge). Η ίδια διαγραφή εκτελείται επίσης από το ημερήσιο birthday cron.

### Αυτοματοποιημένα μηνύματα (cron)

Μετά τη ρύθμιση των παρόχων και την ενεργοποίηση από PMS → Αυτόματα μηνύματα, προσθέστε **σε ένα μόνο PMS instance** cPanel cron ανά λεπτό:

```bash
cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-message-automations.mjs >> /home/corali/logs/corali-automations.log 2>&1
```

Χρησιμοποιήστε την πραγματική διαδρομή Node.js της εγκατάστασής σας. Ο worker δεν πρέπει να εκτελείται και στο booking instance. Η αποστολή confirmation καθυστερεί έως την επόμενη εκτέλεση (συνήθως ≤1 λεπτό). Πριν ενεργοποιήσετε WhatsApp, καταχωρίστε εγκεκριμένα Meta templates για κάθε ενεργό γεγονός και γλώσσα και βεβαιωθείτε ότι ο επισκέπτης έχει συναινέσει. Παρακολουθείτε το ιστορικό αποστολών στο PMS και τη λειτουργία του cron.

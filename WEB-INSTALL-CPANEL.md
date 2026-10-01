# Hotel Corali PMS — web installer cPanel

Ο web installer λειτουργεί σαν τον οδηγό εγκατάστασης του WordPress. Δεν χρειάζεται το **Setup Node.js App** και δεν ζητά κωδικούς βάσης ή API keys: χρησιμοποιεί με ασφάλεια τα υπάρχοντα `runtime.env` των δύο εφαρμογών.

> Απαραίτητη προϋπόθεση: η PHP `exec` πρέπει να είναι προσωρινά διαθέσιμη μόνο στο PHP-FPM pool του `hotelcorali.gr` και ο PHP χρήστης να έχει δικαίωμα εγγραφής στο `/home/corali/apps`. Μετά την επιτυχημένη εγκατάσταση, προσθέστε ξανά την `exec` στα disabled functions.

## Αρχεία

Χρειάζονται τέσσερα αρχεία:

1. `corali-pms-cpanel-v53-root.tar.gz`
2. `corali-pms-cpanel-v53-root.tar.gz.sha256`
3. `corali-web-installer-v53.php`
4. `corali-web-installer-v53-access.txt`

Το τέταρτο αρχείο περιέχει την προσωπική διεύθυνση μίας χρήσης. **Δεν ανεβαίνει στον server και δεν αποστέλλεται σε τρίτους.**

## Βήμα 1 — Ανέβασμα release

Με το cPanel File Manager ανεβάστε στον φάκελο `/home/corali/`:

- `corali-pms-cpanel-v53-root.tar.gz`
- `corali-pms-cpanel-v53-root.tar.gz.sha256`

Μην τα αποσυμπιέσετε.

## Βήμα 2 — Ανέβασμα web installer

Ανεβάστε μόνο το `corali-web-installer-v53.php` στον:

```text
/home/corali/public_html/
```

και μετονομάστε το σε:

```text
corali-installer.php
```

## Βήμα 3 — Άνοιγμα ιδιωτικής διεύθυνσης

Ανοίξτε τοπικά το `corali-web-installer-v53-access.txt` και αντιγράψτε ολόκληρη την ιδιωτική διεύθυνση HTTPS στον browser. Αν το cPanel ή ο browser αφαιρέσει το query parameter, ανοίξτε απευθείας το `https://www.hotelcorali.gr/corali-installer.php` και επικολλήστε στη φόρμα τον κωδικό του βήματος 4. Μην τον φωτογραφίσετε και μην τον μοιραστείτε.

Ο installer θα αφαιρέσει αμέσως τον κωδικό από τη γραμμή διεύθυνσης και θα εμφανίσει τον προέλεγχο.

Στην πρώτη οθόνη επιλέξτε **Ελληνικά** ή **English**. Η επιλογή διατηρείται σε όλη τη διαδικασία και μεταφράζει τον προέλεγχο, τα κουμπιά, τις οδηγίες, την ανάκτηση διαχειριστή και τον τελικό έλεγχο. Το τεχνικό log παραμένει αυτούσιο για αξιόπιστη διάγνωση.

## Βήμα 4 — Προέλεγχος

Όλα τα σημεία πρέπει να έχουν πράσινο ✓. Ο έλεγχος καλύπτει:

- HTTPS και PHP 8.1+
- εκτέλεση PHP ως χρήστης `corali`
- Node.js 22+ από το PATH ή από την επίσημη εγκατάσταση EA/CloudLinux του cPanel
- `bash`, `tar`, `pg_dump`, `sha256sum` και `nohup`
- SHA-256 και εσωτερική δομή archive
- ενεργούς φακέλους PMS και Booking
- αναγνώσιμα προστατευμένα `runtime.env`
- ίδιο `PMS_DOCUMENT_KEY` στις δύο εφαρμογές
- εγγράψιμο φάκελο apps· αν τα παλιά `releases`/`backups` δεν είναι εγγράψιμα, χρησιμοποιούνται αυτόματα ιδιωτικοί φάκελοι `.corali-releases`/`.corali-backups` μέσα στο apps

Αν υπάρχει κόκκινο ✕, δεν γίνεται καμία αλλαγή. Μην πατήσετε εγκατάσταση πριν διορθωθεί ο συγκεκριμένος έλεγχος.

## Βήμα 5 — Εγκατάσταση

Πατήστε **Έναρξη εγκατάστασης** και αφήστε ανοιχτή τη σελίδα. Θα εμφανιστούν ζωντανά:

1. preparation των δύο stages
2. package/settings verification
3. PostgreSQL backup
4. additive/idempotent migrations
5. απομονωμένα runtime health tests
6. ασφαλή ownership/permissions
7. atomic swap PMS και Booking
8. Passenger restart
9. τελική επαλήθευση

Αν αποτύχει βήμα μετά το swap, ενεργοποιείται αυτόματο rollback και για τις δύο εφαρμογές.

## Βήμα 6 — Πρόσβαση διαχειριστή PMS

Μετά την επιτυχημένη εγκατάσταση, συμπληρώστε στον installer:

- όνομα χρήστη με πεζούς λατινικούς χαρακτήρες,
- ονοματεπώνυμο,
- email,
- νέο κωδικό τουλάχιστον 14 χαρακτήρων και επιβεβαίωση.

Ο installer δημιουργεί ή ενημερώνει τον κύριο owner, ακυρώνει τις παλιές συνεδρίες, καθαρίζει το προσωρινό login lockout και μηδενίζει το παλιό 2FA/recovery codes. Ο κωδικός περνά σε προσωρινό αρχείο mode `600`, δεν προστίθεται στη γραμμή εντολών και διαγράφεται αμέσως μετά. Συνδεθείτε χωρίς 2FA και ενεργοποιήστε νέο 2FA από το Προφίλ.

## Βήμα 7 — Τελικός έλεγχος και διαγραφή

Μετά την ένδειξη επιτυχίας ανοίξτε από τα κουμπιά του installer:

- `https://pms.hotelcorali.gr/login`
- `https://booking.hotelcorali.gr/book`

Τα αντίστοιχα health endpoints πρέπει επίσης να δείχνουν:

- `https://pms.hotelcorali.gr/api/health`
- `https://booking.hotelcorali.gr/api/health`

```json
{"ok":true,"version":"v53"}
```

Τέλος, πατήστε **Κλείδωμα και διαγραφή installer**. Επιβεβαιώστε στο File Manager ότι δεν υπάρχει πλέον:

```text
/home/corali/public_html/corali-installer.php
```

Στο WHM προσθέστε αμέσως ξανά την `exec` στη ρύθμιση **Disable Functions** του PHP-FPM pool του `hotelcorali.gr`.

## Ασφάλεια

- Ο κωδικός πρόσβασης είναι τυχαίος 256-bit και στο PHP αποθηκεύεται μόνο το SHA-256 hash του.
- Χρησιμοποιούνται secure/HttpOnly/SameSite session cookie, CSRF token, CSP, no-store και anti-framing headers.
- Τα logs αποκρύπτουν database URLs, passwords και API secrets.
- Το archive επαληθεύεται πριν εξαχθεί.
- Ο installer κλειδώνει μετά την επιτυχία και επιχειρεί να διαγράψει μόνο το δικό του προσωρινό PHP αρχείο.
- Αν η PHP δεν επιτρέπει ασφαλή εκτέλεση διεργασιών, ο προέλεγχος σταματά πριν από οποιαδήποτε αλλαγή.

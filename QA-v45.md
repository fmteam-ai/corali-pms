# Hotel Corali PMS v45 — αναφορά ελέγχου παράδοσης

Ημερομηνία: 27/09/2026

## Στόχος v45

Η v45 διορθώνει τη διαδικασία εγκατάστασης και προσθέτει ενιαίο, ελεγχόμενο deployment για τις δύο ξεχωριστές Passenger εφαρμογές `corali-pms` και `corali-booking`.

Η συσκευασία `v45` εκτελεί το απομονωμένο health check με τον εγγενή HTTP client του Node.js, προετοιμάζει/επικυρώνει τα δύο runtime environments και τα εφαρμόζει ως έγκυρη πηγή ρυθμίσεων πάνω από τυχόν παλιές Passenger μεταβλητές. Επιπλέον απομονώνει αυστηρά τα PMS/Booking routes, προσθέτει δίγλωσσο web installer και ασφαλή ανάκτηση του κύριου owner/2FA χωρίς terminal.

## Αποτελέσματα ελέγχων

| Έλεγχος | Αποτέλεσμα |
|---|---|
| Unit/security tests | 18/18 επιτυχία |
| TypeScript strict typecheck | 0 errors |
| ESLint | 0 errors, 0 warnings |
| Next.js production build | Επιτυχία, 47 routes |
| PostgreSQL schema δύο φορές | Επιτυχία, 48 πίνακες / idempotent |
| Critical DB writes | Επιτυχία για booking, folio, tokens και rules |
| Dependency audit | 0 γνωστά vulnerabilities |
| Package secret exclusions | Επιτυχία, χωρίς `runtime.env` ή production keys |
| Package extraction | Επιτυχία από καθαρό archive |
| Installed-mode verification | Επιτυχία με `runtime.env` mode 600 |
| Runtime environment preparation | Origins, roles και missing session secret διορθώνονται μόνο στα stages |
| Passenger environment precedence | Το προστατευμένο `runtime.env` αντικαθιστά ελεγχόμενα παλιές inherited τιμές όπως `DATABASE_URL` |
| Blank optional provider values | Επιτυχία: κενά Stripe/SMTP/API πεδία μετατρέπονται σε μη ορισμένα |
| PMS isolated runtime smoke test | Επιτυχία: `ok=true`, `version=v45` |
| Booking isolated runtime smoke test | Επιτυχία: `ok=true`, `version=v45` |
| Runtime test με εχθρικά proxy variables | Επιτυχία: απευθείας σύνδεση με τον εγγενή Node HTTP client |
| Production archive HTTP smoke | PMS `/` → `/login`, Booking `/` και `/login` → `/book`, widgets/font διαθέσιμα |
| Route isolation | Booking επιστρέφει 404 για `/api/auth/*` και `/api/pms/*`, PMS επιστρέφει 404 για public booking APIs |
| Security headers | `nosniff` και `DENY framing` ενεργά |
| CSRF Origin/Fetch Metadata | Missing signals, invalid origin, `cross-site` και `none` απορρίπτονται |
| PMS/auth route coverage | Όλα τα POST/PUT/PATCH/DELETE routes καλούν το CSRF guard |
| Key mismatch preflight | Επιτυχία: διακοπή πριν από οποιαδήποτε αλλαγή |
| PostgreSQL backup test | Password μόνο μέσω environment, dump mode 600 |
| Installer simulated upgrade | PMS και booking atomic swap επιτυχές |
| Installer simulated failure | Αυτόματο rollback και των δύο εφαρμογών επιτυχές |
| Web installer one-time access | Τυχαίο token 256-bit, μόνο SHA-256 hash στο PHP |
| Web installer ασφάλεια | HTTPS, secure session, SameSite, CSRF, CSP, no-store και self-delete |
| Web installer preflight | PHP user, Node.js, commands, paths, archive SHA-256/layout και κοινό document key |
| Web installer γλώσσες | Ελληνικά/English σε πρόσβαση, προέλεγχο, ενέργειες, admin recovery και τελικό έλεγχο |
| Web installer PHP structure | Ισορροπημένα PHP sections, strings, comments και delimiters πριν την παραγωγή |
| Admin recovery validation | Κανονικοποίηση/validation στοιχείων, ελάχιστος κωδικός 14 χαρακτήρων |
| Admin recovery transaction | Commit σε επιτυχία, rollback σε DB failure, reset 2FA/recovery codes και ανάκληση όλων των sessions |
| Admin password handling | Προσωρινό αρχείο mode 600, ποτέ σε command arguments/log/browser, άμεση διαγραφή |
| cPanel Node.js discovery | Αυτόματος εντοπισμός EA/CloudLinux Node.js 22+ όταν λείπει από το PHP-FPM PATH |
| Web installer directory fallback | Ασφαλείς ιδιωτικοί release/backup φάκελοι μέσα στο εγγράψιμο apps χωρίς `chmod 777` |
| Local Greek fonts | Ω/ω διαθέσιμα στο bundled DejaVu Sans |

Το SHA-256 καταγράφεται στο ξεχωριστό `corali-pms-cpanel-v45-root.tar.gz.sha256`, ώστε να επαληθεύεται πριν από την εξαγωγή.

## Ασφάλεια εγκατάστασης

- Το package verification εκτελείται πριν αντιγραφούν production secrets.
- Το installed verification επιτρέπει `runtime.env` μόνο με mode 600 και απαιτούμενα keys.
- Τα δύο υπάρχοντα `runtime.env` διατηρούνται χωριστά.
- Η εγκατάσταση σταματά πριν από αλλαγές αν τα `PMS_DOCUMENT_KEY` δεν συμφωνούν.
- Δημιουργείται PostgreSQL custom-format backup μέσω `pg_dump` χωρίς εμφάνιση password στη γραμμή εντολών.
- Οι migrations εκτελούνται πριν το swap και είναι additive/idempotent.
- Και οι δύο εφαρμογές ξεκινούν σε προσωρινή localhost port και περνούν πραγματικό `/api/health` test.
- Το swap κρατά δύο πλήρη application backups.
- Οποιαδήποτε αποτυχία κατά το swap προκαλεί αυτόματο application rollback.
- Δημιουργείται προστατευμένο deployment manifest χωρίς μυστικά.

## Εξωτερικές συνδέσεις

Stripe, Viva.com, WhatsApp Business, SMTP, myDATA, Channel Manager, OpenAI και social APIs απαιτούν πραγματικά test/live credentials και provider onboarding. Η v45 δεν εμφανίζει connector ως ενεργό χωρίς την απαιτούμενη παραμετροποίηση. Η τελική end-to-end πιστοποίηση αυτών των υπηρεσιών γίνεται σε sandbox/test mode πριν από production χρήση.

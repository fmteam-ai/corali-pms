# Hotel Corali PMS v204 — έκθεση ελέγχου ποιότητας

**Αποτέλεσμα: PASS** · 20/20 ροές PASS · 24/11/2026, 12:14:05 π.μ.

**Αποδοχή έκδοσης: ⛔ NOT ACCEPTED** — Stripe test: card payment succeeds and the amount matches: NOT RUN · Stripe test: the same request twice (idempotency key) creates one payment: NOT RUN · Stripe test: refund and reconciliation of the balance: NOT RUN · Stripe test: declined card is reported, not booked: NOT RUN · Viva demo: OAuth token: NOT RUN · Channex staging: properties and room types readable: NOT RUN · WhatsApp Cloud API: test phone number reachable: NOT RUN (απαιτεί PASS και στους εξωτερικούς παρόχους σε sandbox)

- **Τελικό πακέτο προς εγκατάσταση:** `corali-pms-cpanel-v204-root.tar.gz` · SHA-256 `b0a4a0a3b36d0dbc03b121a6a141390504502a657ecc5693def76a448b9625f0`
  - Ελέγχθηκε το archive SHA-256 `851398083ffce72e281555d4c3e6b49888b1f9e4bbda20ba470ba85c9ee101b0` (6140 αρχεία, contentHash `bda317a30645a2c6…`); το τελικό είναι τα ίδια αρχεία + `RELEASE-EVIDENCE.json` (το αποδεικτικό αυτού του ελέγχου). Ο έλεγχος μετά την εγκατάσταση επαληθεύει κάθε αρχείο.
- Κώδικας: commit `09d8c5e` · Node v22.23.5 · PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) (temporary cluster)
- Αναπαραγωγή: `node scripts/release-qa.mjs corali-pms-cpanel-v204-root.tar.gz v204` (νέα βάση PostgreSQL, οι εφαρμογές του πακέτου σε λειτουργία, πραγματικά αιτήματα HTTP και το cron του πακέτου).

| # | Κρίσιμη ροή | Αποτέλεσμα | Τι αποδεικνύει | Λεπτομέρειες | ms |
|---|---|---|---|---|---|
| F01 | Βάση δεδομένων: εγκατάσταση σχήματος και επανάληψη μεταναστεύσεων (idempotent) | ✅ PASS |  | 182 πίνακες, δύο εφαρμογές του σχήματος χωρίς σφάλμα · PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) (temporary cluster) | 3654 |
| F02 | Εφαρμογές πακέτου: εκκίνηση PMS και Booking, έλεγχος υγείας και έκδοσης | ✅ PASS |  | PMS και Booking v204: υγιείς | 1654 |
| F03 | Διαθεσιμότητα σελίδας κρατήσεων: πωλήσιμο / σε προετοιμασία / εκτός λειτουργίας (σήμερα και αύριο) | ✅ PASS |  | σήμερα: 101 (έτοιμο), 104 (έτοιμο σε 30′) · αύριο: +102 · 103 εκτός λειτουργίας ποτέ | 57 |
| F04 | Διαθεσιμότητα προς OTA (channel manager): ίδιος κανόνας με τη σελίδα κρατήσεων | ✅ PASS |  | σήμερα 101:1 102:0 103:0 104:1 · αύριο 102:1 103:0 | 103 |
| F05 | POS → folio: χρέωση δωματίου, επανάληψη χωρίς διπλή χρέωση, ακύρωση με αντιλογισμό | ✅ PASS |  | €19.00 στο folio μία φορά · επανάληψη = duplicate · λάθος κλειδί 401 · ακύρωση → 0 | 129 |
| F06 | Stripe webhook: υπογεγραμμένο event, διπλή παράδοση → μία κράτηση, μία πληρωμή, λάθος υπογραφή απορρίπτεται | ✅ PASS |  | 2 παραδόσεις → 1 κράτηση, 1 συναλλαγή, 1 πληρωμή €300 στο folio · λάθος υπογραφή απορρίφθηκε | 66 |
| F07 | Συμφωνία οικονομικών: καθαρή μετά τις F05–F06, εντοπίζει τεχνητή απόκλιση | ✅ PASS |  | σύνολα: πάροχοι €300.00 = folio online €300.00 · ορφανή πληρωμή €42 εντοπίστηκε | 17 |
| F08 | Guest Journey: έλεγχος πριν την άφιξη, ειδοποίηση μία φορά, ανάκτηση, ιστορικό, επιβεβαίωση | ✅ PASS |  | δωμάτιο μη έτοιμο → αποτυχία + 1 ειδοποίηση → έγκριση → επιτυχία · αποτυχημένο email → αυτόματη επανάληψη | 41 |
| F09 | Cron πακέτου: ολοκληρώνεται, υπενθύμιση υπολοίπου 1 μέρα πριν την αναχώρηση, καταγραφή κάθε βήματος · χωρίς SMTP η υπενθύμιση ΔΕΝ μετριέται ως παραδομένη | ✅ PASS | JOB_EXECUTION_PASS<br>FAILURE_HANDLING_PASS<br>DELIVERY_NOT_TESTED | υπενθύμιση υπολοίπου: failed (SMTP_NOT_CONFIGURED — χωρίς SMTP στη δοκιμή) · 12 βήματα cron καταγράφηκαν · heartbeat: έναρξη + ολοκλήρωση σε 79 ms, 12 βήματα OK | 211 |
| F10 | Κλείδωμα Cloudflare: 403 χωρίς κλειδί, δεκτό με το σωστό κλειδί, λάθος κλειδί → 403, συμπεριφορά όταν σταματήσει το κλειδί, άμεση ειδοποίηση, ανάκτηση από τον server · smoke PMS και Booking | ✅ PASS |  | χωρίς κλειδί 403 · λάθος κλειδί 403 · σωστό κλειδί 200/401 · open_all: άνοιγμα μετά από 30′ + άμεση ειδοποίηση · protect_admin: πελάτες ανοιχτά, διαχείριση 403 · ανάκτηση με scripts/edge-lock.mjs off (καταγράφηκε) | 90107 |
| F12 | Κέντρο αξιοπιστίας + Alert Intelligence: ανενεργός Channel Manager → μία πληροφορία, κανένα email· ενεργοποιημένος → ένα κρίσιμο συμβάν, επανάληψη αποστολής | ✅ PASS |  | μη ρυθμισμένος: μία πληροφορία, 0 email, η εγγραφή διατηρήθηκε · ενεργοποιημένος με αποτυχία: ένα κρίσιμο συμβάν sync:ota, 1 email · «Μεταβολή διαθεσιμότητας 2026-12-04 → 2026-12-06 (qa) δεν έχε…» μπήκε ξανά σε συγχρονισμό | 620 |
| F13 | Cron: βήμα που τρέχει ακόμη δεν ξανατρέχει παράλληλα · αποτυχημένη αποστολή ειδοποίησης καταγράφεται και επαναλαμβάνεται (όχι παράδοση) | ✅ PASS | JOB_EXECUTION_PASS<br>FAILURE_HANDLING_PASS<br>DELIVERY_NOT_TESTED | «Guest messages» παραλείφθηκε (κρατούσε η προηγούμενη εκτέλεση), 1 βήμα · αποτυχημένη αποστολή ειδοποίησης καταγράφηκε και ξαναπρογραμματίστηκε: email → SMTP_NOT_CONFIGURED · push → fetch failed | 257 |
| F14 | Αντίγραφο ασφαλείας: κρυπτογραφημένο backup, δοκιμαστική επαναφορά σε ξεχωριστή βάση, μέτρηση εγγραφών, αλλοιωμένο αρχείο απορρίπτεται | ✅ PASS |  | backup corali-db-2026-11-23-22-12-30.dump.enc · επαναφορά σε corali_rehearsal: bookings 4, rooms 4, folio_entries 3, payment_transactions 1, pms_staff_users 0, fiscal_documents 0, guest_checkins 0 = ζωντανή βάση · 10 έλεγχοι OK · βάση δοκιμής άδειασε · αλλοιωμένο αρχείο → failed | 1892 |
| F15 | Έλεγχος μετά την εγκατάσταση: κάθε ON CONFLICT στη βάση, πίνακες σχήματος, αποτυχία όταν λείπει μοναδικό index | ✅ PASS |  | ! Αποδεικτικό QA πακέτου: το πακέτο δεν έχει RELEASE-EVIDENCE.json · ✓ ON CONFLICT στη βάση παραγωγής: 72 εντολές με κατάλληλο μοναδικό index · ✓ Πίνακες σχήματος: 182 πίνακες · χωρίς το index → η εγκατάσταση σταματά | 262 |
| F16 | Συμφωνία OTA: διαθεσιμότητα που στάλθηκε ≠ τρέχουσα εντοπίζεται και ξαναστέλνεται | ✅ PASS |  | 124 ημέρες×τύποι · qa-101 2026-12-14: στάλθηκε 3, PMS 0 → μπήκε σε αποστολή | 208 |
| F17 | Δοκιμαστική επαναφορά: αρνείται τη βάση παραγωγής με άλλο όνομα και ξένη βάση · καθαρίζει ακόμη κι όταν αποτύχει στη μέση | ✅ PASS |  | άλλο όνομα της παραγωγής → άρνηση (η παραγωγή ανέγγιχτη, 4 κρατήσεις) · ξένη βάση (invoices) → άρνηση · αποτυχία μετά την επαναφορά → η βάση δοκιμής άδειασε (μόνο ο δείκτης «corali_rehearsal_target») | 2213 |
| F18 | Channel sync πακέτου απέναντι σε ψεύτικο Channex: μόνο όσα στάλθηκαν γίνονται «sent», πέρα από 500 ημέρες OUT_OF_RANGE, warnings → αποτυχία, μερική ανάγνωση ≠ συμφωνία | ✅ PASS |  | μόνο μακρινή ημερομηνία → καμία αποστολή, out_of_range · κανονική → sent · παρελθόν → skipped · διάστημα στο όριο → sent έως +500 και το υπόλοιπο out_of_range · warnings → failed · ανάγνωση: 1 ίδιες, 243 δεν επιστράφηκαν → όχι συμφωνία · κανάλι «Booking.com (QA)» CHANNEL_NOT_VERIFIED | 1524 |
| F19 | Εμπειρία πελάτη: Comfort Score δωματίου με πελάτη, επιβεβαιωμένη παράδοση μετά το check-out, επαναλαμβανόμενη αιτία → εργασία συντήρησης | ✅ PASS |  | δωμάτιο QA9 με πελάτη: δείκτης 35 (Τεχνικό πρόβλημα, Θερμοκρασία δωματίου) · παράδοση: χωρίς στοιχεία απορρίφθηκε, με τα στοιχεία → verified · νέα σοβαρή βλάβη → επιβεβαιωμένο αλλά «τώρα δεν είναι έτοιμο» · αιτία «Δωμάτιο QA9: «Κλιματιστικό» 3 φορές σε 3 διαφορετικές διαμονές» → εργασία συντήρησης #2 (μία φορά) | 72 |
| F20 | Corali Sentinel (μόνο ανάγνωση) + Fly.io watchdog: συμβάν με αποδεικτικά και αναφορά, επιβεβαιωμένη αποκατάσταση, υπογεγραμμένο heartbeat, ειδοποίηση σε διακοπή | ✅ PASS | SENTINEL_READ_ONLY_PASS<br>INCIDENT_REPORT_PASS<br>RECOVERY_VERIFIED_PASS<br>WATCHDOG_ALERT_PASS | συμβάν sync:ota (critical, εγγραφή #20) με αποδεικτικά και αναφορά → αποκατάσταση επιβεβαιώθηκε · δεδομένα παραγωγής αμετάβλητα · heartbeat υπογεγραμμένο και επαληθευμένο από τον watchdog · διακοπή → 2 ειδοποίηση(εις) σε ανεξάρτητο παραλήπτη | 866 |
| F11 | Αυτόματα tests του κώδικα (unit / integration) | ✅ PASS |  | 526/526 PASS | 87198 |

**Επίπεδα τεκμηρίωσης αποστολών:** `JOB_EXECUTION_PASS` — ο αυτοματισμός εκτελέστηκε · `FAILURE_HANDLING_PASS` — η αποτυχημένη αποστολή καταγράφηκε με την αιτία της και μπήκε σε επανάληψη · `DELIVERY_CONFIRMED` — το μήνυμα παραδόθηκε / επιβεβαιώθηκε από τον πάροχο. Οι εσωτερικές ροές τρέχουν χωρίς πραγματικό πάροχο, άρα `DELIVERY_NOT_TESTED`· επιβεβαιωμένη παράδοση προκύπτει μόνο από τους ελέγχους παρόχων σε sandbox (παρακάτω).

## Εξωτερικοί πάροχοι (sandbox)

Τρέχουν με κλειδιά δοκιμής (`node scripts/provider-sandbox-e2e.mjs`): Stripe test mode, Viva demo, Channex staging, WhatsApp test number. Χωρίς κλειδί: NOT RUN — δεν θεωρείται PASS.

| Ροή | Έλεγχος | Αποτέλεσμα | Λεπτομέρειες |
|---|---|---|---|
| payments | Stripe test: card payment succeeds and the amount matches | ⏸ NOT RUN | missing STRIPE_TEST_SECRET_KEY |
| payments | Stripe test: the same request twice (idempotency key) creates one payment | ⏸ NOT RUN | missing STRIPE_TEST_SECRET_KEY |
| payments | Stripe test: refund and reconciliation of the balance | ⏸ NOT RUN | missing STRIPE_TEST_SECRET_KEY |
| payments | Stripe test: declined card is reported, not booked | ⏸ NOT RUN | missing STRIPE_TEST_SECRET_KEY |
| payments | Viva demo: OAuth token | ⏸ NOT RUN | missing VIVA_DEMO_CLIENT_ID, VIVA_DEMO_CLIENT_SECRET |
| channel manager | Channex staging: properties and room types readable | ⏸ NOT RUN | missing CHANNEX_STAGING_API_KEY |
| messaging | WhatsApp Cloud API: test phone number reachable | ⏸ NOT RUN | missing WHATSAPP_TEST_TOKEN, WHATSAPP_TEST_PHONE_ID |

# Hotel Corali PMS v192 — έκθεση ελέγχου ποιότητας

**Αποτέλεσμα: PASS** · 18/18 ροές PASS · 23/11/2026, 2:32:11 μ.μ.

**Αποδοχή έκδοσης: ⛔ NOT ACCEPTED** — Stripe test: card payment succeeds and the amount matches: NOT RUN · Stripe test: the same request twice (idempotency key) creates one payment: NOT RUN · Stripe test: refund and reconciliation of the balance: NOT RUN · Stripe test: declined card is reported, not booked: NOT RUN · Viva demo: OAuth token: NOT RUN · Channex staging: properties and room types readable: NOT RUN · WhatsApp Cloud API: test phone number reachable: NOT RUN (απαιτεί PASS και στους εξωτερικούς παρόχους σε sandbox)

- Πακέτο: `corali-pms-cpanel-v192-root.tar.gz` · SHA-256 `56b8d1b51dcd9a84de2ec9b91f8be09272fdeeeada3992cf716a9076bf332da4`
- Κώδικας: commit `e2ec232` · Node v22.23.5 · PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) (temporary cluster)
- Αναπαραγωγή: `node scripts/release-qa.mjs corali-pms-cpanel-v192-root.tar.gz v192` (νέα βάση PostgreSQL, οι εφαρμογές του πακέτου σε λειτουργία, πραγματικά αιτήματα HTTP και το cron του πακέτου).

| # | Κρίσιμη ροή | Αποτέλεσμα | Λεπτομέρειες | ms |
|---|---|---|---|---|
| F01 | Βάση δεδομένων: εγκατάσταση σχήματος και επανάληψη μεταναστεύσεων (idempotent) | ✅ PASS | 170 πίνακες, δύο εφαρμογές του σχήματος χωρίς σφάλμα · PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) (temporary cluster) | 6066 |
| F02 | Εφαρμογές πακέτου: εκκίνηση PMS και Booking, έλεγχος υγείας και έκδοσης | ✅ PASS | PMS και Booking v192: υγιείς | 1415 |
| F03 | Διαθεσιμότητα σελίδας κρατήσεων: πωλήσιμο / σε προετοιμασία / εκτός λειτουργίας (σήμερα και αύριο) | ✅ PASS | σήμερα: 101 (έτοιμο), 104 (έτοιμο σε 30′) · αύριο: +102 · 103 εκτός λειτουργίας ποτέ | 61 |
| F04 | Διαθεσιμότητα προς OTA (channel manager): ίδιος κανόνας με τη σελίδα κρατήσεων | ✅ PASS | σήμερα 101:1 102:0 103:0 104:1 · αύριο 102:1 103:0 | 105 |
| F05 | POS → folio: χρέωση δωματίου, επανάληψη χωρίς διπλή χρέωση, ακύρωση με αντιλογισμό | ✅ PASS | €19.00 στο folio μία φορά · επανάληψη = duplicate · λάθος κλειδί 401 · ακύρωση → 0 | 134 |
| F06 | Stripe webhook: υπογεγραμμένο event, διπλή παράδοση → μία κράτηση, μία πληρωμή, λάθος υπογραφή απορρίπτεται | ✅ PASS | 2 παραδόσεις → 1 κράτηση, 1 συναλλαγή, 1 πληρωμή €300 στο folio · λάθος υπογραφή απορρίφθηκε | 69 |
| F07 | Συμφωνία οικονομικών: καθαρή μετά τις F05–F06, εντοπίζει τεχνητή απόκλιση | ✅ PASS | σύνολα: πάροχοι €300.00 = folio online €300.00 · ορφανή πληρωμή €42 εντοπίστηκε | 17 |
| F08 | Guest Journey: έλεγχος πριν την άφιξη, ειδοποίηση μία φορά, ανάκτηση, ιστορικό, επιβεβαίωση | ✅ PASS | δωμάτιο μη έτοιμο → αποτυχία + 1 ειδοποίηση → έγκριση → επιτυχία · αποτυχημένο email → αυτόματη επανάληψη | 54 |
| F09 | Cron πακέτου: ολοκληρώνεται, υπενθύμιση υπολοίπου 1 μέρα πριν την αναχώρηση, καταγραφή κάθε βήματος | ✅ PASS | υπενθύμιση υπολοίπου: failed (SMTP_NOT_CONFIGURED — χωρίς SMTP στη δοκιμή) · 11 βήματα cron καταγράφηκαν · heartbeat: έναρξη + ολοκλήρωση σε 87 ms, 11 βήματα OK | 247 |
| F10 | Κλείδωμα Cloudflare + έλεγχοι εγκατάστασης (smoke) για PMS και Booking | ✅ PASS | smoke OK και για τις δύο με το κλείδωμα ενεργό · αίτημα χωρίς κλειδί: HTTP 200 | 1910 |
| F12 | Κέντρο αξιοπιστίας: εντοπίζει μεταβολή διαθεσιμότητας που δεν συγχρονίστηκε και την ξαναστέλνει | ✅ PASS | εντοπίστηκε («Μεταβολή διαθεσιμότητας 2026-12-03 → 2026-12-05 (qa) δεν έχει συγχρονι…») και μπήκε ξανά σε συγχρονισμό · 10 περιοχές ελέγχθηκαν | 107 |
| F13 | Cron: βήμα που τρέχει ακόμη δεν ξανατρέχει παράλληλα · ειδοποιήσεις με επιβεβαίωση παράδοσης και επανάληψη | ✅ PASS | «Guest messages» παραλείφθηκε (κρατούσε η προηγούμενη εκτέλεση), 1 βήμα · παράδοση: email → SMTP_NOT_CONFIGURED (νέα προσπάθεια) · push → fetch failed (νέα προσπάθεια) | 222 |
| F14 | Αντίγραφο ασφαλείας: κρυπτογραφημένο backup, δοκιμαστική επαναφορά σε ξεχωριστή βάση, μέτρηση εγγραφών, αλλοιωμένο αρχείο απορρίπτεται | ✅ PASS | backup corali-db-2026-11-23-12-31-31.dump.enc · επαναφορά σε corali_rehearsal: bookings 4, rooms 4, folio_entries 3, payment_transactions 1, pms_staff_users 0, fiscal_documents 0, guest_checkins 0 = ζωντανή βάση · 10 έλεγχοι OK · βάση δοκιμής άδειασε · αλλοιωμένο αρχείο → failed | 1828 |
| F15 | Έλεγχος μετά την εγκατάσταση: κάθε ON CONFLICT στη βάση, πίνακες σχήματος, αποτυχία όταν λείπει μοναδικό index | ✅ PASS | ! Αποδεικτικό QA πακέτου: το πακέτο δεν έχει RELEASE-EVIDENCE.json · ✓ ON CONFLICT στη βάση παραγωγής: 64 εντολές με κατάλληλο μοναδικό index · ✓ Πίνακες σχήματος: 170 πίνακες · χωρίς το index → η εγκατάσταση σταματά | 202 |
| F16 | Συμφωνία OTA: διαθεσιμότητα που στάλθηκε ≠ τρέχουσα εντοπίζεται και ξαναστέλνεται | ✅ PASS | 124 ημέρες×τύποι · qa-101 2026-12-13: στάλθηκε 3, PMS 0 → μπήκε σε αποστολή | 140 |
| F17 | Δοκιμαστική επαναφορά: αρνείται τη βάση παραγωγής με άλλο όνομα και ξένη βάση · καθαρίζει ακόμη κι όταν αποτύχει στη μέση | ✅ PASS | άλλο όνομα της παραγωγής → άρνηση (η παραγωγή ανέγγιχτη, 4 κρατήσεις) · ξένη βάση (invoices) → άρνηση · αποτυχία μετά την επαναφορά → η βάση δοκιμής άδειασε (μόνο ο δείκτης «corali_rehearsal_target») | 1974 |
| F18 | Channel sync πακέτου απέναντι σε ψεύτικο Channex: μόνο όσα στάλθηκαν γίνονται «sent», πέρα από 500 ημέρες OUT_OF_RANGE, warnings → αποτυχία, μερική ανάγνωση ≠ συμφωνία | ✅ PASS | μόνο μακρινή ημερομηνία → καμία αποστολή, out_of_range · κανονική → sent · παρελθόν → skipped · διάστημα στο όριο → sent έως +500 και το υπόλοιπο out_of_range · warnings → failed · ανάγνωση: 1 ίδιες, 243 δεν επιστράφηκαν → όχι συμφωνία · κανάλι «Booking.com (QA)» CHANNEL_NOT_VERIFIED | 889 |
| F11 | Αυτόματα tests του κώδικα (unit / integration) | ✅ PASS | 452/452 PASS | 35280 |

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

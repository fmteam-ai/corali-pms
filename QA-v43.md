# Hotel Corali PMS v43 — Έλεγχος παράδοσης

Ημερομηνία ελέγχου: 27/09/2026

## Αποτελέσματα

| Έλεγχος | Αποτέλεσμα |
|---|---|
| Unit tests ασφάλειας/δικαιωμάτων/2FA/housekeeping/payment policy | 9/9 επιτυχία |
| TypeScript strict typecheck | Επιτυχία, 0 errors |
| ESLint | Επιτυχία, 0 errors και 0 warnings |
| Next.js production build | Επιτυχία, 47 routes |
| PostgreSQL schema | Εφαρμογή δύο φορές επιτυχής, 48 tables |
| Schema critical writes | Επιτυχία για booking, folio, tokens, rules |
| Dependency audit | 0 γνωστά vulnerabilities |
| Package structure/secret exclusions | Επιτυχία |
| Production package smoke test | `/`, `/login`, `/book`, `/manage-booking`, widgets και fonts επιτυχία |
| Security headers | nosniff, DENY framing, referrer, permissions και COOP ενεργά |
| Ελληνικά Ω/ω | Τοπικό DejaVu Sans regular/bold με πλήρες Greek Unicode range |

## Λειτουργίες που ελέγχθηκαν στον κώδικα

- Owner login, Argon2 password, rate limiting, TOTP setup/confirm/disable και one-time recovery codes.
- RBAC για Owner/Admin/Reception/Housekeeping/Readonly και owner isolation σε queries.
- Profile, logout, sticky notes και λειτουργικό notification bell.
- Reservation list/detail, νέα χειροκίνητη κράτηση, drag-and-drop tape chart, overbooking guard, optimistic versioning και quick actions.
- Check-in/check-out, room move, audit trail και αυτόματη δημιουργία departure cleaning task.
- Folio χρεώσεων/πληρωμών/adjustments, payer split (guest/company/agency) και ενημέρωση υπολοίπου.
- Guest CRM, ιστορικό, lifetime value και preferences.
- Ασφαλές guest manage link, μηνύματα επισκέπτη, PMS inbox και ειδοποίηση του ξενοδοχείου μέσω SMTP όταν είναι ρυθμισμένο.
- Pre-check-in link, αριθμός ταυτότητας/διαβατηρίου και ημερομηνία γέννησης με AES-256-GCM encryption.
- Birthday workflow: μόνο 18+, consent ανά channel, email/WhatsApp, BIRTHDAY10 10%, non-combinable, μία αποστολή/έτος, διατήρηση έως 3 χρόνια από τελευταία διαμονή.
- Housekeeping mobile-responsive board, πλήρες checklist, δυναμικοί χρήστες/συνήθεις αναθέσεις και υποχρεωτική έγκριση από δεύτερο υπάλληλο.
- Booking engine: δίγλωσσα extras/charges, selected room, special requests, δύο μήνες δίπλα-δίπλα σε desktop, σημερινή ημερομηνία, αυτόματη μετάβαση check-in → check-out, direct web rate και αναλυτική χρέωση ανά multiplier.
- Flexible cancellation policy ανά περίοδο, direct/non-refundable plans, special prices, minimum/maximum stay και arrival/departure restrictions.
- Full-payment window πριν την άφιξη με ενεργοποίηση/απενεργοποίηση και επεξεργάσιμες ημέρες.
- Room categories, bilingual characteristics, extras/upsells και inactive future Breakfast option.
- Occupancy, ADR, RevPAR, revenue/channel reports.
- TLS certificate validation, CA support, overlap/check-in indexes, widget input hardening και PMS/booking key fingerprint check.

## Συνδέσεις που χρειάζονται παραγωγικά credentials

Ο κώδικας εμφανίζει με ακρίβεια αν κάθε connector είναι ρυθμισμένος. Δεν χαρακτηρίζει καμία εξωτερική υπηρεσία ως «συνδεδεμένη» χωρίς τα πραγματικά credentials και επιτυχή δοκιμή.

- Stripe: χρειάζονται secret key, webhook secret και test transaction.
- Viva.com: χρειάζονται merchant/client credentials και production onboarding.
- WhatsApp Business: access token, Phone Number ID και εγκεκριμένα Meta templates.
- Email: SMTP host/username/password/from.
- myDATA: αδειοδοτημένος provider και token.
- Channel Manager/OTA: provider API key, endpoint, property/room/rate mappings και certification του provider.
- OpenAI/social APIs: ξεχωριστά production keys, permissions και platform review.

Οι παραπάνω υπηρεσίες δεν μπορούν να πιστοποιηθούν end-to-end χωρίς λογαριασμούς και test/live credentials. Η ενεργοποίησή τους πρέπει να γίνει πρώτα σε sandbox/test mode και μετά σε production.

## Πακέτο

- `corali-pms-cpanel-v43-root.tar.gz`
- SHA-256 καταγράφεται στο συνοδευτικό `corali-pms-cpanel-v43-root.tar.gz.sha256`.
- Δεν περιέχει `runtime.env`, production secrets, `.git` ή `Passengerfile.json`.

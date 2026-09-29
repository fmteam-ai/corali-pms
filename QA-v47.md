# Hotel Corali PMS v47 — release verification

## Scope in this package

- **Room plan:** status colours from the specification, unpaid-balance border, housekeeping state per room, stays spanning all nights, date navigation, occupancy, quick menu with date change, double-click new reservation; moves into out-of-order rooms are rejected.
- **Overview:** Greek/English staff interface (instant toggle), live notifications over server-sent events with polling fallback, global quick search (name, reference, room, phone), 7/30-day forecast, month calendar, one-click check-in/out for today and tomorrow.
- **Roles and audit:** Owner / Manager / Reception / Housekeeping / Read-only defaults per specification, module × action permission matrix, delete and financial-report permissions, unified audit log (user, IP, action, resource, before/after), every 403 and every login/failure/lockout recorded, sign-out everywhere, Argon2id parallelism 4.
- **Folio:** nightly rates with per-night payer, charge categories (accommodation, extras, taxes/fees, adjustments, discounts), split billing guest/company/agency with billing details, printable folio; totals and balances are computed from the ledger.
- **Pre-check-in and CRM:** submissions visible on the reservation (masked document number, audited reveal), 3-year identity-data retention job, guest profiles with lifetime value, dietary needs, allergies, tags; personal single-use non-stackable birthday codes for consenting adults in six languages.
- **Housekeeping:** 12-point checklist, dirty status and auto-assignment at check-out, repair + second-person sign-off to return out-of-order rooms to service, mobile board; photos are never stored.
- **Booking engine:** direct website rate (default −5%, configurable) against the standard rate, promo codes validated server-side, charge breakdown per unit (e.g. climate fee per night), accessibility notice on results; rate widget fixed and available in six languages.
- **Payments:** Stripe remains the default gateway; deposit bookings keep the card (guest informed) and the balance is charged automatically N days before arrival; provider-neutral fulfilment so Viva.com can be added later.
- **myDATA:** receipts (11.2) and invoices (2.1) from the folio per payer, sequential series, MARK/UID/QR, retry queue, cancellation.
- **Channel manager (Channex):** availability outbox on every change, OTA reservation import with room assignment and acknowledgement.
- **Rule-based suggestions:** upsell recommendations (never breakfast) and dynamic pricing suggestions that require manager approval.
- **Social media:** approval-gated Facebook/Instagram publishing, TikTok marked for manual upload, Facebook/Instagram DM inbox with staff-sent booking replies.

## New cron jobs (PMS instance only)

`run-data-retention.mjs` (daily), `run-balance-collection.mjs` (daily), `run-mydata-queue.mjs` (every 10 minutes), `run-channel-sync.mjs` (every 5 minutes), `run-social-publisher.mjs` (every 5 minutes). See DEPLOY-CPANEL.md.

## Verification gate

`bash scripts/package-cpanel.sh` runs unit tests, strict TypeScript, ESLint, dependency audit, production build, PostgreSQL schema/idempotency checks, backup test, archive HTTP smoke, installer success and simulated rollback, web-installer and runtime environment tests.

## Behaviour changes to note before installing

- Reception no longer edits rates, catalogue or connections and no longer sees reports; Read-only no longer sees financial data or connections (specification defaults). Grant exceptions per user in Users & permissions.
- The website shows the standard rate struck through and charges the direct rate (−5% by default). Adjust or switch off in PMS → Rates.
- The shared BIRTHDAY10 code is retired in favour of personal codes.

## Limits before production use

Verify with real accounts on the server: Stripe test mode (including a deposit booking and an automatic balance charge), myDATA in the AADE dev environment with the accountant's VAT and climate-fee codes, Channex staging, and the Meta app permissions. The server must allow outbound HTTPS to the AADE, Stripe, Channex and Meta hosts.

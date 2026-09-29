# Hotel Corali PMS v46 — release verification

## Scope in this package

- PMS provider configuration UI with encrypted credentials and audit entries.
- Stripe as the only online guest payment gateway; SMTP uses PMS settings when configured.
- Stripe webhook checks signed event, paid status, amount, currency and original booking metadata before fulfillment.
- Multi-room booking price and per-room folio allocation corrections.
- Reservation lifecycle validation, room ownership checks and shared room locks/payment holds.
- Reports date selection and per-night monthly allocation.
- Front desk occupancy, arrivals/departures, open housekeeping, balances, extras and net daily folio receipts with automatic refresh.
- PMS editing of room prices, plans, special prices and restrictions; six-language booking form and editable automation templates.
- Accurate sum of individual room prices and room-specific special prices for multi-room checkout.
- Reports comparison with the prior equal-length period and room-level stay/revenue breakdown.
- Public availability PostgreSQL binding fix; all eight availability queries and literal SQL placeholder counts checked.
- Protected PMS dashboard schema diagnostic and graceful warning for a failing dashboard panel; Hotel Corali logo in Booking and PMS.
- Existing v45 PMS, booking, installer and rollback foundation retained.

## Verification gate

Run `bash scripts/package-cpanel.sh` from source. It runs unit tests, strict TypeScript, ESLint, dependency audit, production build, PostgreSQL schema/idempotency checks, backup test, archive HTTP smoke, installer simulated success and rollback, web-installer static checks and runtime environment tests. The release archive and SHA-256 file are emitted only after those checks succeed.

## Limits before production use

The automated tests do not certify the entire 20-section specification. Tax receipts/invoices and myDATA, OTA channel sync, social publishing, AI functions, complete PMS translations and all live provider workflows remain incomplete. Viva credentials may be configured and tested but Viva is not offered to guests for payments. Read REQUIREMENTS-STATUS.md before considering production use.

Use Stripe test-mode keys first. Verify a test booking from checkout through the signed webhook and PMS folio, including a two-room booking and failed payment, on the actual server. Configure the webhook events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Do not switch to live keys until these tests pass.

The reported post-login `/pms` error is not yet proven fixed on the real server. After installing, open `/api/pms/diagnostics` while logged in and preserve the Node/Passenger error log if `/pms` still fails. A clean local schema passed all dashboard queries, but only the production log can identify production-only data/schema faults.

The installer retains the current runtime.env files and performs a database backup before additive migrations. Keep its backup manifest for rollback. Test both PMS and Booking health endpoints and owner login after installation.

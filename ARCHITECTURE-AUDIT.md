# Hotel Corali PMS / Booking — architecture review, 29 September 2026

This review covers the v46 source and observed production diagnostics. It is not a production acceptance certificate.

## Current topology

Two Passenger applications use the same Next.js build and PostgreSQL database. `APP_ROLE=pms` serves authenticated `/pms` and `/api/pms`; `APP_ROLE=booking` serves the public Booking pages and `/api/public`. Both retain separate protected `runtime.env` files. The installer stages both builds, backs up the database, applies additive migrations, runs local smoke checks against the configured database, swaps applications, and restarts Passenger.

## Reproduced production failures

| Area | Evidence | Action |
|---|---|---|
| PMS overview | Authenticated diagnostics returned `dashboard_13` with PostgreSQL `42601`. | Removed the extras query expression; subsequent user screenshot showed overview without the loading warning. |
| Booking availability | Diagnostics confirmed all eight SQL queries execute, but `publicAvailability` fails while processing returned rows. | Hardened parsing of translation objects and JSON arrays; added a test with legacy `'null'` JSON and invalid translation values. Production success remains unverified. |
| Room inventory | Authenticated diagnostics reported `activeRooms: 8`; the specification calls for 20. | Requires the real room codes, types, capacities and prices. Do not invent inventory. |

## Root architectural weaknesses and changes

1. **Deployment acceptance:** A health check only confirmed database reachability. It could pass with a broken public booking search. The staged Booking application now performs a real two-night availability request against its configured database; an unsuccessful response stops installation before the application swap. The integration test verifies that the previous applications remain active when this gate fails.
2. **Data boundary:** Stored JSON text was cast to expected types without checking its actual shape. A valid JSON scalar such as `null` could make `.length` or `.includes` throw; a numeric translation could make `.trim` throw. The Booking path now validates these shapes and falls back to an empty list or translated default.
3. **Diagnostics:** Initial diagnostics only checked a subset of columns, while the public API suppressed all failure details. Authenticated diagnostics now execute the actual dashboard and availability queries, identify each failed query without returning guest data, and distinguish a data-processing type error from selected known price errors. The public API logs the exception on the server and returns a non-cacheable 503 for operational failures.
4. **Session routing:** The PMS cookie uses `SameSite=Strict`. Opening a protected API URL from a separate site can return `UNAUTHENTICATED` even if the PMS is open. Diagnostics should be reached by same-site navigation in the logged-in browser. A permanent internal diagnostics link would improve operator access.

## Verification coverage and limits

The source tests cover role isolation, SQL bindings, migrations, several booking and folio invariants, access control, and six-language copy. The new runtime availability test executes the actual service against a PostgreSQL-compatible database seeded with malformed legacy JSON. The cPanel package test runs staged applications and simulates a deployment failure and rollback.

The production PostgreSQL contents, Passenger configuration, Stripe webhook, SMTP, WhatsApp templates, tax invoices/myDATA, OTA channel manager, social APIs, and the full 20-room inventory have **not** been verified end-to-end. Sections 16–19 and multiple items elsewhere in `REQUIREMENTS-STATUS.md` remain incomplete. A successful local package build does not establish that the complete original requirement list is functional.

## Release gate

Do not label a package final until the staged availability request succeeds on the server, a real non-payment booking flow is tested safely, the authenticated dashboard diagnostics have no failures, the 20 real rooms are reconciled, and the remaining requirements are implemented and separately verified with their providers.

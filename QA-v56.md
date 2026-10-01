# Hotel Corali PMS v56 — release verification

## Scope in this package

### New in v56
- **Offers & promotions (PMS → Pricing → Offers, VikBooking “special prices”):** discount or surcharge, % or fixed € per night, by period, weekdays, rooms (category tick selects its rooms) and rate plans, minimum nights, “check-in must be within the period”, rounding to whole euros, different values for longer stays (e.g. 7+ nights 15%). Marked as a promotion, an offer shows a badge and its text (6 languages) in the booking engine, with the pre-promotion price struck through and the saving; last-minute (arrival within N days) and early-booking (at least N days ahead) windows. Templates (last minute, early booking, long stay), edit, duplicate, delete, running/upcoming/ended status.
- **Discount coupons (PMS → Pricing → Discount coupons):** create, edit, enable/disable and delete promo codes: random readable code, % or fixed € off the room price, booking window, optional stay window and blackout periods, maximum uses, stacking with the direct discount, restriction to one email. Uses, pending checkouts and (with financial permission) room revenue per code; birthday codes listed separately (disable/delete only). Duplicate codes are refused.
- **Dashboard forecast insight:** below 50% occupancy for the shown range, “Create promotion” opens a prefilled promotion for those dates.
- “Special prices & restrictions” is now “Booking restrictions”, linking to the new screens. Table buttons stay readable on hover.

### New in v55
- **Dashboard spacing (VikBooking-style):** widgets are packed like masonry (each widget spans the rows its height needs, holes filled), with smaller gaps, padding and headers.
- **AI assistant widget** on the dashboard (after Booking details, also added to saved layouts): staff ask about arrivals/departures, occupancy, unpaid balances (only with financial permission), unread guest messages, housekeeping, or ask for guest reply drafts. Read-only snapshot of live data; Claude with the Anthropic key from Integrations, built-in answers otherwise.
- **Booking engine:** the room description is taken from the first room of the card that has one (it disappeared when the first room had none).
- **Overview “(rooms)” failure:** the room count/type query is rewritten without array aggregation.

### New in v54
- **Booking-engine cards show the photos of their rooms:** a card (one room type) takes the photos of the first room that has photos and the characteristics of all its rooms, so a room with photos is no longer hidden behind a first room without any (e.g. room 112 in the “Deluxe Double Room” card).
- **Room availability check:** a “Category” column and a list of which rooms each booking-engine card contains, with the rule for moving a room to another card (change its room type).

### New in v53
- **Guest self-service (“My booking”):** guests sign in with booking number + email (rate-limited, generic error) and can change dates or cancel within the reservation & cancellation policy: refundable rates until the free-cancellation deadline (new price for the same room type and rate; a higher price adds to the balance with a payment link, a lower one flags a refund to reception); cancellation always possible before arrival, refunding what was paid only when free cancellation applies. Every change is audited, synced to channels and notified to reception. Link “My booking” in the booking engine header.
- **AI assistant in the booking form:** chat in six languages. With an Anthropic key (PMS → Integrations → “Anthropic (Claude)” or `ANTHROPIC_API_KEY`) it answers with Claude (`claude-opus-5-5`, low effort, cached system prompt with hotel facts, room categories, characteristics, extras and the policy, plus the guest’s current search); without a key or if the API fails it answers from the policy text and the current search. It cannot book or change anything; rate-limited per IP.
- **Last-minute bookings:** notice in the guest details (highlighted when it applies) and a “Last-minute bookings” section in the policy pop-up in all languages, also with customised policy texts.
- **Non-refundable rate:** the policy pop-up shows the non-refundable rule instead of “Free cancellation until 7 days”.
- **PMS → Rooms → Room availability check:** for dates and guests, every room with offered / not offered and why (inactive, out of order, capacity, booking with reference, online payment hold, minimum stay, closed dates, restriction, no price, not enough rooms), and a warning when rooms of different categories share a room type and appear in one card.

### New in v52
- **Climate resilience fee** is always charged per room per night: the booking engine and checkout enforce it whatever mode is stored, and the migration now also matches Greek capitals (e.g. «Κλιματική») on C-locale databases.
- **Booking engine:** only the logo above the title (location line removed); rate options use a name | price | button grid so long words (e.g. «διανυκτερεύσεις») never cover the Select button, stacked on phones; the non-refundable rate shows the struck-through flexible price and “You save”, like the direct website rate.

- **PMS header:** the notifications panel (and other header drop-downs) now opens above the sticky menu bar.
- **Overview “some data could not be loaded”:** the notice now names the failing sections; databases created before sticky-note colours get the missing `pms_dashboard_notes.color` column; diagnostics also check the dashboard layout, notes, maintenance, season prices, minimum stay and room photo tables.

- **Guest pre-check-in page:** hotel logo on top; the three consent checkboxes sit before their text; drop-downs and text areas match the other fields; languages show their country flag (also in the booking engine); phone with country flag and calling code (defaults to the guest language’s country) saved in international format, as in the booking form.

- **Pre-filled check-in:** the guest’s personal check-in link opens with the booking number, stay dates and nights, room, party and the guest’s name, email and phone (country code split out) already filled in; an earlier submission is loaded for updating. Only for an active, unexpired link; identity-document data is never returned. An invalid or expired link shows a clear message. The booking appears as a summary card: booking number in the header, arrival and departure as date blocks (weekday, day, month, year) with the nights between them, then room and guests; stacks cleanly on phones.

- **Multiple rooms in the booking engine:** a slower response from an earlier search can no longer replace newer fields (only the latest search is shown), so e.g. 4 adults / 2 rooms never shows a one-room price; once searched, results refresh automatically when dates, party, rooms or language change; the breakdown reads “€87.50 × 5 nights × 2 rooms”.

- **Several rooms of one category:** a room without a base price (0 €) is charged at its category price instead of adding a free room to the total (4 adults / 2 rooms showed a one-room total); a category without any price is not offered; the PMS rooms screen and diagnostics (`unpricedRooms`) flag rooms without a base price.

- **Room characteristics:** picking an icon fills the name in six languages (editable); “Add standard characteristics” creates the usual set (A/C, Wi-Fi, TV, fridge, safe …) in one click; new panel “Characteristics for many rooms” adds or removes several characteristics on many rooms at once (select all, per room type or single rooms), keeping each room’s other characteristics.

### New in v51
- **Minimum stay per room category:** PMS → Pricing → Minimum stay sets minimum nights per category all year and for periods (checked on the arrival date), with add/edit/delete. A period overrides the all-year value, a category overrides “all categories”, the shorter overlapping period wins. The booking engine hides categories that need more nights and tells the guest the minimum in six languages; PMS bookings are not restricted.

### New in v50
- **Season prices (VikBooking-style Rates Overview):** PMS → Pricing → Season prices shows a grid of room types (optionally each room) × days with the nightly price; click two cells to set a price for that period. Season prices apply to all rooms, a room type or specific rooms, optionally on chosen weekdays, and can be edited or deleted. Priority: specific rooms › room type › all rooms, then the shorter period, then the latest change. Offers apply on top.
- **Special prices & restrictions** can now be deleted.
- **Direct-booking discount (−5%)** applies only to the Direct website rate, once (no longer to every plan, no double discount).
- **Last-minute bookings:** bookings made less than 7 days before arrival pay the full amount at booking on every plan.
- **Booking engine:** hotel logo inside the hero above “Piso Livadi · Paros”; hover feedback on every option (rates, dates, buttons, gallery, extras).
- **PMS:** hover feedback on buttons, links, table rows, cards, tape-chart bars and inputs.
- **Room photos:** photos upload one at a time with progress (each resized to 1600 px), so large batches no longer fail on the web-server body limit; clear error reasons (too large, no permission, not found).
- **Rooms screen shows every image the booking engine uses:** uploaded photos and existing image links (e.g. from the old website) appear together, can be reordered (first = cover) and removed; a broken image shows ⚠️ instead of a blank tile.
- **Characteristics:** a new characteristic can be created with a name in any language (Greek or English filled from it); failures show the exact reason.

### New in v49
- **PMS look & navigation:** VikBooking-style grouped top menu (Global, Rooms, Pricing, Bookings, Management, PMS) and a customizable widget dashboard (sticky notes, booking lookup, forecast, arriving/departing, check availability, bookings calendar, latest bookings, rooms today, finance, housekeeping, notifications) saved per user.
- **Rooms:** add/edit/deactivate/delete rooms, characteristics with icons in six languages, photo upload/reorder/cover; the booking engine shows photos (gallery) and characteristics.
- **Payments & receipts/invoices** register with net takings per method, myDATA status and CSV export.
- **Deposits & policies:** payment terms per rate plan (deposit %, full prepayment, balance at end of free cancellation / N days before / at the hotel), applied at checkout and by the balance worker; reservation & cancellation policy text per language shown in a booking-engine pop-up.
- **Booking engine:** nightly price × nights, phone with country calling code and flag, checkboxes before their text, no duplicate access banner; climate resilience fee per room per night.

- **Room plan:** status colours from the specification, unpaid-balance border, housekeeping state per room, stays spanning all nights, date navigation, occupancy, quick menu with date change, double-click new reservation; moves into out-of-order rooms are rejected.
- **Overview:** Greek/English staff interface (instant toggle), live notifications over server-sent events with polling fallback, global quick search (name, reference, room, phone), 7/30-day forecast, month calendar, one-click check-in/out for today and tomorrow.
- **Roles and audit:** Owner / Manager / Reception / Housekeeping / Read-only defaults per specification, module × action permission matrix, delete and financial-report permissions, unified audit log (user, IP, action, resource, before/after), every 403 and every login/failure/lockout recorded, sign-out everywhere, Argon2id parallelism 4.
- **Folio:** nightly rates with per-night payer, charge categories (accommodation, extras, taxes/fees, adjustments, discounts), split billing guest/company/agency with billing details, printable folio; totals and balances are computed from the ledger.
- **Pre-check-in and CRM:** submissions visible on the reservation (masked document number, audited reveal), 3-year identity-data retention job, guest profiles with lifetime value, dietary needs, allergies, tags; personal single-use non-stackable birthday codes for consenting adults in six languages, with configurable discount, booking window, allowed stay dates and excluded periods (e.g. 20/07–20/08) enforced by the booking engine.
- **Housekeeping & maintenance:** 12-point checklist, dirty status and auto-assignment at check-out, mobile board (48 px+ targets, dark/light). Defects are logged as maintenance notices (minor / major / out of order) with camera photos; major and out-of-order take the room out of service and block bookings. Notices are never deleted (database trigger): they are resolved with mandatory notes, optional labour/cost/vendor and a post-repair state (clean & ready or touch-up clean), signed off by someone other than the reporter. Tape chart shows an animated ⚠️/🛠️ badge, hover card and a resolution modal with photo lightbox; Maintenance queue page.
- **Booking engine:** direct website rate (default −5%, configurable) against the standard rate, promo codes validated server-side, charge breakdown per unit (e.g. climate fee per night), accessibility notice on results; rate widget fixed and available in six languages.
- **Payments:** Stripe remains the default gateway; deposit bookings keep the card (guest informed) and the balance is charged automatically N days before arrival; provider-neutral fulfilment so Viva.com can be added later.
- **myDATA:** receipts (11.2) and invoices (2.1) from the folio per payer, sequential series, MARK/UID/QR, retry queue, cancellation.
- **Channel manager (Channex):** availability outbox on every change, OTA reservation import with room assignment and acknowledgement.
- **Arrival instructions & transfers:** PMS Settings → Arrival instructions with templates per mode (boat, flight, car, taxi/transit) and hub in six languages; fixed transfer prices per vehicle; guests choose mode, hub and transfer in online check-in, see the instructions, and the transfer can be charged to the folio automatically.
- **Guest messaging:** 72-hour pre-arrival message with the guest's arrival instructions, arrival-day welcome, pre-departure message, birthday offers (18+), email and WhatsApp. Post-stay review shield: 4–5★ → Google/TripAdvisor, 1–3★ → private recovery form and a Guest feedback page for management.
- **Revenue strategy:** pace & pickup by stay month vs same time last year (cancellation time is now recorded), pace curve, channel net yield after commissions and payment fees, competitor rate tracker for up to 5 hotels (rate-shopping API or manual entry) whose index tempers dynamic pricing suggestions.
- **Rule-based suggestions:** upsell recommendations (never breakfast; extras bought on earlier stays rank first, addable to the folio from the reservation) and dynamic pricing suggestions that require manager approval.
- **Social media:** approval-gated Facebook/Instagram publishing, TikTok marked for manual upload; Facebook/Instagram/TikTok DM inbox where dates in a guest's message produce a draft reply with live availability, prices and a prefilled booking link, sent only after reception approval.

## New cron jobs (PMS instance only)

`run-data-retention.mjs` (daily), `run-balance-collection.mjs` (daily), `run-mydata-queue.mjs` (every 10 minutes), `run-channel-sync.mjs` (every 5 minutes), `run-social-publisher.mjs` (every 5 minutes), `run-rate-shopper.mjs` (daily, optional). See DEPLOY-CPANEL.md.

## Verification gate

`bash scripts/package-cpanel.sh` runs unit tests, strict TypeScript, ESLint, dependency audit, production build, PostgreSQL schema/idempotency checks, backup test, archive HTTP smoke, installer success and simulated rollback, web-installer and runtime environment tests.

## Behaviour changes to note before installing

- Reception no longer edits rates, catalogue or connections and no longer sees reports; Read-only no longer sees financial data or connections (specification defaults). Grant exceptions per user in Users & permissions.
- The website shows the standard rate struck through and charges the direct rate (−5% by default). Adjust or switch off in PMS → Rates.
- The shared BIRTHDAY10 code is retired in favour of personal codes.
- Housekeeping and Reception gain the new `maintenance.resolve` permission (resolve defects); Read-only does not.
- Existing message-automation settings keep working; the three new messages are switched on by default but only send once automations are saved again with templates (defaults are pre-filled).
- Fixed: the review message was scheduled far in the future because BIGINT settings were read as text.

## Limits before production use

Verify with real accounts on the server: Stripe test mode (including a deposit booking and an automatic balance charge), myDATA in the AADE dev environment with the accountant's VAT and climate-fee codes, Channex staging, and the Meta app permissions. The server must allow outbound HTTPS to the AADE, Stripe, Channex and Meta hosts.

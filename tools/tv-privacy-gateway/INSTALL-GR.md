> **PMS v161:** ο κώδικας PMS (SQL, endpoint `/api/gateway/tv-privacy`, κανόνες, οθόνη) είναι ήδη ενσωματωμένος — τα βήματα αντιγραφής αρχείων στο PMS (§3.2–3.4) **δεν χρειάζονται**. Τα δωμάτια ενεργοποιούνται από το PMS (Corali TV → «Καθαρισμός στο check-out»), όχι με `TV_PRIVACY_ALLOWED_ROOM_IDS`. Πλήρεις οδηγίες: `docs/TV-PRIVACY-v161.md`. Από αυτόν τον φάκελο χρειάζεται μόνο το gateway (`gateway/`, `shared/`, `baseline/`).

# Hotel Corali PMS — Guest Check-out / Clear App Data (GDPR)

**Παραδοτέο:** εφαρμοσμένο code-level integration kit με SQL trigger, Next.js bearer endpoint, Windows on-prem outbound-polling ADB bridge, tests. **Όχι παραγωγικά εγκατεστημένη έκδοση PMS/TV.** Τελευταίο πλήρες διαθέσιμο PMS πακέτο για έλεγχο: v159 *compiled cPanel release*, όχι πλήρης πηγαίος κώδικας v160. Αυτά πρέπει να ενσωματωθούν / δοκιμαστούν πάνω στο πραγματικό source v160+ πριν από εγκατάσταση.

## 1. Τι είναι ήδη επιβεβαιωμένο
- HORIZON 112: `adb shell pm clear com.google.android.youtube.tv` επέστρεψε `Success`. Στη χειροκίνητη επανεκκίνηση YouTube δεν εμφανίστηκε ο προηγούμενος προσωπικός λογαριασμός, ενώ παρέμεινε ο λογαριασμός Hotel Corali. Αυτό αφορά **μόνο το πραγματικό YouTube pilot test**.
- Netflix package `com.netflix.ninja`: γνωστό από το περιβάλλον TV, **δεν έχει δοκιμαστεί** εδώ με δοκιμαστικό λογαριασμό.
- `dpm list-owners`: `no owners`. Ο συμβατικός Corali TV Agent δεν μπορεί να εκτελεί `DevicePolicyManager.clearApplicationUserData()` χωρίς εξουσιοδότηση.
- `pm clear` από **εξουσιοδοτημένο ADB shell** είναι λειτουργική εναλλακτική, όχι Android API διαθέσιμο στον Agent.

## 2. Αρχιτεκτονική

```
PMS booking checkout (actual status transition)
     ↓ SQL trigger, one job per (owner,booking,room)
PostgreSQL tv_privacy_jobs
     ↑↓ HTTPS POST /api/gateway/tv-privacy (strong bearer token)
Windows trusted LAN gateway (node worker; outbound-only HTTPS)
     ↓ authenticated ADB session on isolated admin network
HORIZON 112: `pm clear` two approved packages only
     ↓ local result per app
PMS: CLEARED_LOCAL_NEEDS_REVIEW / FAILED / BLOCKED / DRY_RUN
     ↓ human verification of app screen + Google account protection
Room eligible for new guest (staff procedure / future integration)
```

No passwords, guest emails, YouTube history or Netflix tokens leave the TV. The bridge request contains booking numeric ID and room numeric ID, app package IDs and opaque lease token; hotel account info is not transmitted.

## 3. Before merging the files
1. Back up PMS + PostgreSQL. Review `bookings.status` exact checkout value (`checked_out`), `bookings.checked_out_at` timestamps (ms), `tv_screens` and `rooms` mappings, checkout SQL flow, multi-room reservations, and Next middleware. The trigger only handles single resolved `bookings.room_id`; multi-room reservations need an explicit adapter and **must not silently be considered fully cleaned**.
2. Add `sql/001_checkout_tv_privacy.sql` as a **reviewed additive migration** (do not run blindly on live database). The trigger creates jobs only on actual status transition to `checked_out` after check-in; it will not fire when someone merely edits a departure date.
3. Copy folder `shared/` to root `shared/` of **PMS source tree**.
4. Copy `pms/lib/tv-privacy-server.mjs` to root `lib/tv-privacy-server.mjs` and copy `pms/app/api/gateway/tv-privacy/route.js` to root `app/api/gateway/tv-privacy/route.js`. **After copying**, adjust import in `lib/tv-privacy-server.mjs` from `../../shared/privacy-core.mjs` to `../shared/privacy-core.mjs`, because staging kit has different folder nesting. The Next endpoint's import `../../../../../lib/tv-privacy-server.mjs` is already correct from `app/api/gateway/tv-privacy/route.js`.
5. PMS-only environment (private `runtime.env`, NEVER in browser, never in a file uploaded here):

```
TV_PRIVACY_BRIDGE_TOKEN=<random 48+ character secret>
TV_PRIVACY_ALLOWED_ROOM_IDS=<internal rooms.id, not room number 112>
PMS_OWNER_ID=<actual owner_id, e.g. hotel-corali if confirmed>
APP_ROLE=pms
```

Generate the bearer token on a trusted machine using Node: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` (64 hex chars). The gateway MUST use exactly the same token via private Windows environment; do not embed it in client JavaScript.
6. On the on-prem Windows PC that remains on during room checkouts, copy `gateway/` + `shared/` maintaining folder nesting. Install Node 22+ and Android platform-tools. Create private `gateway/config.json` based on `config.example.json`. Set `serial` to the TV's **current IP:port when the TV is installed at the hotel**; do NOT hardcode the home IP in production. Set `roomMap` key to the **internal database room ID** of room `112` and `androidId` obtained on that same TV using the read-only command:

```bat
"C:\Users\Tosh\Desktop\platform-tools\adb.exe" shell settings get secure android_id
```

Do **not** paste the PMS bearer token or Google password in chat. Use a restricted admin LAN / management VLAN, firewall the ADB ports to the single gateway. Prefer TLS authenticated wireless ADB pairing if supported; an always-on unauthenticated legacy TCP/5555 endpoint is unsuitable on a guest-accessible Wi-Fi network.
7. In private Windows environment set `TV_PRIVACY_BRIDGE_TOKEN`, `ADB_PATH` (full path to `adb.exe`), and optionally `CORALI_TV_PRIVACY_CONFIG` (absolute path to `config.json`). Start `node gateway/worker.mjs` only after PMS route and migration are deployed in a staging environment. Starts with `dryRun:true`; never clears data in dry-run.
8. On a dedicated trial reservation for room 112, confirm one job created on actual checkout, no job on date edit, no duplicate on repeated checkout, claimed only for intended room, rejects mismatched Android ID. On dry-run result `DRY_RUN`, then explicitly set `dryRun:false` for the controlled pilot with no real guest logged in. Test both YouTube and Netflix using **dummy personal accounts**, then re-open apps and check no previous account appears.
9. Security gate: confirm OS Hotel Corali Google account intact; that user cannot open account management or switch/remove hotel account. Factory `Lock Menu Key` is currently manual and not guaranteed to block every account-management path. Never claim account is "locked" without demonstrating every relevant route or implementing an MDM/OEM policy. Do not put active guest data at risk when testing.
10. Only after a complete pilot should the Windows worker be configured as an auto-start managed task/service with restricted local account and rotating logs; do not rely on a browser tab or personal laptop being on.

## 4. Operational result states
| State | Interpretation |
| --- | --- |
| QUEUED | Actual checkout happened; waiting for gateway |
| RUNNING | Gateway claimed a leased job |
| DRY_RUN | Identity and inventory checked; no deletions |
| CLEARED_LOCAL_NEEDS_REVIEW | Both approved packages cleared or not installed; **not** full guest signout proof |
| PARTIAL / FAILED | Some or all package wipes failed; inspect |
| BLOCKED_NEW_GUEST | Another guest checked in after this checkout; no further wipes allowed |
| BLOCKED_UNREGISTERED | TV mapping or reservation state changed |
| BLOCKED_SECURITY | ADB identity invalid or another security gate rejected |
| UNVERIFIED | Incomplete evidence or attempts expired |

**Do not label "TV Ready" for a new guest until the app sign-ins and protected hotel Google account are manually verified** (and proper PMS staff-verified status UI is integrated). An ADB `Success` alone proves only local package-data clearing.

## 5. Prime Video, Disney+, other apps
Not automatically included. They must first be identified on the HORIZON with `adb shell pm list packages` and tested individually. Expand the fixed allowlist in **both** `shared/privacy-core.mjs` and the policy/mapping after review. Never accept arbitrary package strings from the PMS or bridge API. If the TV has other app sessions, the cleaning policy is not complete until those packages are added and tested.

## 6. Additional acceptance gates
- Confirmation that checkout transition is committed; worker never acts while new booking is checked in.
- TV offline: job stays queued, never reports success.
- Retry after gateway crash: `lease` expires; re-authorization just before *each* wipe, no stale job after a new check-in.
- Room 112 should be mapped using `rooms.id`, not `rooms.code`. TV's `android_id` verified on every write; new DHCP IP alone does not authorize another TV.
- App-specific manual verification after each `pm clear`; no OS account clear and no Factory Reset.
- Google account, Hotel Welcome app, Wi-Fi, Hotel Mode, audio caps, channel list and Cast retain original state.
- Stored lease/job results contain no personal viewer history, access tokens, passwords or Gmail data.
- Add staff-facing PMS UI and authenticated staff review gate **in actual v160 source**; no working UI or full v160 rollout is included in this kit.

## 7. Known limitations
1. The current v160 source, its installed middleware and production DB, and hotel LAN are not accessible for an end-to-end deployment. The downloadable package is an integration kit, **not** a complete updated PMS or APK.
2. Device Owner: none. We do NOT grant privileged app rights or silently modify the Google OS account. This is an external trusted ADB gateway model, not in-app native clearing.
3. The SQL trigger assumes the live reservation update uses `status='checked_out'`. Verify in staging before rollout. Multi-room reservations are excluded when no direct single `room_id` exists.
4. The local ADB gateway must stay online and physically network-isolated. Compromise of ADB may allow full Android device control. Prefer OEM/MDM solution long term.
5. Confirmation of local app clearing is not formal GDPR compliance certification. Privacy notice, retention policies and security of the operator PC also need evaluation.

## 8. Read-only pilot before connecting to PMS
Once the `config.json` room mapping, correct Android ID and ADB_PATH are in place, run:

```cmd
node gateway/local-pilot.mjs --room-id <INTERNAL_DB_ROOM_ID>
```

Without `--clear`, this checks identity and installed packages only. It does not delete anything. When you are deliberately testing with dummy guest accounts and the TV has no genuine active guest session, run:

```cmd
node gateway/local-pilot.mjs --room-id <INTERNAL_DB_ROOM_ID> --clear
```

The script requires typing exactly `CLEAR 112` (if the room label in config is `112`) before any deletion. It only clears YouTube and Netflix data, and still reports `CLEARED_LOCAL_NEEDS_REVIEW`, never full sign-out confirmation.

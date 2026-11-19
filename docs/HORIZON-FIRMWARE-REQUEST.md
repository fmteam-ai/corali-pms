# Firmware request: HORIZON 43HQ8590U/D (Google TV, Realtek) — power-on after AC power loss, hotel use

**From:** Hotel Corali, Pisso Livadi, Paros, Greece
**To:** Expressluck / HORIZON technical support
**Factory app:** `com.expressluck.tvfactory` V2.2.36 (TvEplFactoryGTV.apk)
**Android:** 14 (Google TV)

## 1. Use case

We use these TVs in hotel rooms with our own app ("Corali TV": welcome screen, check-out privacy clearing, remote power on/off from our hotel management system over Wi-Fi). The app must be running whenever the TV has mains power, so that the hotel system can reach the TV. This works in normal standby. It does **not** work after a mains power cut.

## 2. Observed behaviour (tested on 18–19/11/2026)

- Factory Menu → Design Mode → **PowerOnMode = Direct**. The value is stored: `Factory.getPowerOnMode()` returns 0 after a reboot.
- **The TV was on when the mains power was removed for 3 minutes:** the TV starts by itself when power returns. Correct.
- **The TV was in standby when the mains power was removed for 3 minutes:** the TV stays completely off when power returns. The standby LED is on, but Android does not boot and the network is down. It only starts when someone presses power on the remote.
- The standby was entered in two ways, with the same result in both cases:
  - the remote power key,
  - `DevicePolicyManager.lockNow()` from the hotel app.

So "Direct" behaves like "Memory" (last state). In the factory app, `FactoryMainApi.setPowerOnMode` passes 0 for Direct, the same value that "Factory Test" sets so that TVs power on directly on the production line. We therefore expect **Direct = always power on after AC power-up**.

## 3. Requests (any one solves our problem; listed in order of preference)

**A. Power-on to standby with Android running ("silent boot").**
An additional PowerOnMode value, e.g. 3 = "Standby (network)". On AC power-up the TV boots Android in quiescent mode:
- no backlight, no sound, no boot logo,
- Wi-Fi connected, apps' `BOOT_COMPLETED` delivered,
- then it stays in normal standby, where it can be woken by `PowerManager` wake-up or `KEYCODE_WAKEUP`.

If supported by the bootloader, `androidboot.quiescent=1` (`ro.boot.quiescent`) would be suitable.

**B. Direct = always on.**
With PowerOnMode = Direct, power the TV on after every AC power-up, regardless of the state before the power cut, as the production-line setting does.

**C. A documented, permission-protected interface.**
An interface (service or broadcast with a signature-level or privileged permission) through which an approved hotel app can:
- set the PowerOnMode,
- turn the backlight off and on (e.g. `PQ.setBacklight`),
- set Lock Menu Key.

We would sign a certificate or allow-list agreement if required.

## 4. Security observations in TvEplFactoryGTV V2.2.36 (for your information)

The factory app runs as `android.uid.system` and exports these components **without a permission**:

| Component | Risk |
|---|---|
| `com.expressluck.tvfactory.utils.PackageInstallService` | Installs an APK from a path given by the caller, with system rights. |
| `com.expressluck.tvfactory.user.LogCatService` | Exported without protection. |
| `com.expressluck.tvfactory.hotel.BootUpReceiver`, action `com.realtek.hotelmenu.SETUP_HOTEL_MODE` | When Hotel Mode is on, any app can trigger the mass uninstall of third-party apps. |

Any app installed by a guest could misuse them. We recommend protecting them with a signature permission.

## 5. Contact / test unit

We can test a firmware build on one TV (room 112) and report the results.

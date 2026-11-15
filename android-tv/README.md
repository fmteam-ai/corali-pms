# Corali TV — Android TV / Google TV app

Shows a room's Corali TV welcome screen (`/tv/<token>` on the booking site) full screen and opens it by itself when the
TV starts or wakes from standby.

- **Install:** on the TV, Downloader app → `booking.hotelcorali.gr/tvapp` (served from `public/downloads/corali-tv.apk`).
- **Connect to a room:** PMS → Corali TV → "App code" (6 digits, one use, 30 minutes) → type it on the TV.
  The app calls `POST /api/public/tv/setup` and keeps the returned screen link.
- **Auto-start:** Android 10+ needs "Display over other apps" for the app (button on the set-up screen). Without it,
  Projectivy Launcher can launch Corali TV at start-up.
- **Set-up screen again:** hold Back for 3 seconds. A short Back goes to the TV's home screen.

## Build

No Gradle or Google SDK manager needed (see `scripts/build-tv-app.sh`):

```
apt install aapt dalvik-exchange zipalign apksigner      # provides /usr/lib/android-sdk/build-tools/debian
ANDROID_JAR=/path/to/android-30/android.jar \
CORALI_TV_KEYSTORE=/path/to/corali-tv.jks CORALI_TV_KEYSTORE_PASS=… \
scripts/build-tv-app.sh
```

Current: 1.9 (versionCode 10) — sound (v159): `VolumeController` (AudioManager STREAM_MUSIC) runs `SET_VOLUME` / `VOLUME_UP` / `VOLUME_DOWN` / `MUTE` / `UNMUTE` and reports the level read back; every check sends `vol`, `mute`, `fixed`, `clamped` and every 10 min `caps` (factory Hotel Mode settings READ only, never written); the room's sound policy from the check answer is kept and applied: power-on volume at screen-on / start, maximum (software, best effort) on every volume change and every 20 s. 1.8 (versionCode 9) — PMS screen commands with confirmation (v158): every check sends `?s=<screen on>&v=<versionCode>&a=<screen-off permission>`; a command (`SCREEN_ON` / `SCREEN_OFF` / `SHOW_WELCOME`, run once per id) is reported back to `POST /api/public/tv/<token>/command` with the screen state measured afterwards (`PowerManager.isInteractive()`), so the PMS shows EXECUTED only when the screen really changed. Log tag `CoraliTV` (`adb logcat -s CoraliTV`). Keep `WakeService.VERSION_CODE` equal to `android:versionCode`. 1.7 (versionCode 8) — screen on / off from the PMS with the TV left powered: a foreground service holds a partial wake lock + Wi-Fi lock, checks `/api/public/tv/<token>/urgent` every 20 s and acts when the automatic decision (arrival / check-in → on, check-out → off) or a manual PMS command changes; off = `DevicePolicyManager.lockNow()` (device admin, force-lock only: "Allow turning the screen off" on the set-up screen). The remote's Power key cannot be intercepted by an app; 1.6 (versionCode 7) — the TV screen lights up by itself when the TV gets power (smart plug on at arrival / check-in), 08:00–23:00 on the TV clock (needs "Turn screen on" / "Display over other apps" allowed for Corali TV); 1.5 added Assistant tab voice (window.CoraliTVVoice: speech recognition through the remote's microphone, answers read aloud); 1.4 added the Apps tab bridge (window.CoraliTVApp). Raise `android:versionCode` in `AndroidManifest.xml` for every new build. Updates must be signed with the same
keystore (kept by the hotel, never in this repository), otherwise Android will not install them over the old app.

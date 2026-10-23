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

Raise `android:versionCode` in `AndroidManifest.xml` for every new build. Updates must be signed with the same
keystore (kept by the hotel, never in this repository), otherwise Android will not install them over the old app.

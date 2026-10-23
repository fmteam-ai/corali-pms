#!/usr/bin/env bash
# Builds the Corali TV app (android-tv/) into public/downloads/corali-tv.apk without Gradle or the Google SDK manager:
# aapt2 + javac + dx + zipalign + apksigner (Debian/Ubuntu: apt install aapt dalvik-exchange zipalign apksigner,
# which provide /usr/lib/android-sdk/build-tools/debian) and an API 30 android.jar.
#
#   ANDROID_JAR=/path/android-30.jar CORALI_TV_KEYSTORE=/path/corali-tv.jks CORALI_TV_KEYSTORE_PASS=… scripts/build-tv-app.sh
#
# Updates must be signed with the same keystore, or Android refuses to install them over the old app. The keystore
# and its password are kept outside the repository.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/android-tv"
BT="${ANDROID_BUILD_TOOLS:-/usr/lib/android-sdk/build-tools/debian}"
: "${ANDROID_JAR:?set ANDROID_JAR to an API 30 android.jar}"
: "${CORALI_TV_KEYSTORE:?set CORALI_TV_KEYSTORE to the signing keystore}"
: "${CORALI_TV_KEYSTORE_PASS:?set CORALI_TV_KEYSTORE_PASS}"
OUT="$ROOT/public/downloads/corali-tv.apk"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/gen" "$WORK/classes" "$(dirname "$OUT")"

"$BT/aapt2" compile --dir "$APP/res" -o "$WORK/res.zip"
"$BT/aapt2" link -I "$ANDROID_JAR" --manifest "$APP/AndroidManifest.xml" --java "$WORK/gen" \
  --min-sdk-version 24 --target-sdk-version 30 -o "$WORK/unsigned.apk" "$WORK/res.zip"

find "$APP/src" "$WORK/gen" -name '*.java' > "$WORK/sources.txt"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$ANDROID_JAR" -d "$WORK/classes" @"$WORK/sources.txt"
"$BT/dx" --dex --min-sdk-version=24 --output="$WORK/classes.dex" "$WORK/classes"
(cd "$WORK" && zip -q -j unsigned.apk classes.dex)

"$BT/zipalign" -f -p 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
"$BT/apksigner" sign --v4-signing-enabled false --ks "$CORALI_TV_KEYSTORE" --ks-pass env:CORALI_TV_KEYSTORE_PASS --out "$OUT" "$WORK/aligned.apk"
"$BT/apksigner" verify --print-certs "$OUT" | head -3
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"

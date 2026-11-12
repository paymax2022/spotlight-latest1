#!/bin/bash
set -euo pipefail

# React Native AAB (Android App Bundle) Build Script — for Play Store upload.
# Mirrors build-apk.sh's environment/signing/config checks exactly (see that
# script's own comments for the "why" behind each one); the differences are
# only where the .aab format itself differs from a plain .apk:
#   - `bundleRelease` instead of `assembleRelease`.
#   - Output lives under android/app/build/outputs/bundle/release/*.aab.
#   - An .aab is signed with the JAR signing scheme (jarsigner), not the APK
#     Signing Scheme v2/v3 apksigner checks — Play (or bundletool locally)
#     generates the final installable APKs from it later, at which point
#     THEY get the v2/v3 signature. Verifying here still proves the upload
#     artifact carries the right certificate before it ever reaches Play.
#   - The JS bundle and native libs live under a `base/` module prefix inside
#     the zip, not at the archive root like an APK.

JAVA_HOME=/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export JAVA_HOME

# Expo picks its .env files from NODE_ENV. Set it explicitly: if it is unset,
# @expo/env falls back to only `.env.local` and `.env` and silently skips
# `.env.production` entirely.
if [[ -n "${1:-}" ]]; then
  export NODE_ENV="$1"
fi
NODE_ENV_EXPLICIT="${NODE_ENV:-}"

# arm64-v8a only: Play devices are all arm64 now. Override for a local
# multi-ABI test bundle: REACT_NATIVE_ARCHS=arm64-v8a,x86_64 ./build-aab.sh
REACT_NATIVE_ARCHS="${REACT_NATIVE_ARCHS:-arm64-v8a}"
export REACT_NATIVE_ARCHS

# `npx expo prebuild --clean` wipes android/local.properties, which is where
# gradle normally reads sdk.dir from. Without it the build dies with
# "SDK location not found. Define a valid SDK location with an ANDROID_HOME
# environment variable or by setting the sdk.dir path in .../local.properties".
if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
  for sdk_candidate in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" /usr/local/share/android-sdk; do
    if [[ -d "$sdk_candidate" ]]; then
      export ANDROID_HOME="$sdk_candidate"
      break
    fi
  done
fi

# @sentry/react-native hooks a source-map upload into every release build and
# hard-fails gradle when it has no credentials:
#   error: An organization ID or slug is required (provide with --org)
# Source maps are never packaged into the bundle, so skipping the upload
# changes nothing about the artifact — it only leaves crashes unsymbolicated
# in Sentry for builds made without credentials.
if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
  SENTRY_UPLOAD="skipped (no SENTRY_AUTH_TOKEN)"
else
  SENTRY_UPLOAD="enabled"
fi

# Production signing. Without this gradle signs release with app/debug.keystore
# (CN=Android Debug): Play rejects those uploads outright. The keystore lives
# in $HOME — never in android/, which `expo prebuild --clean` deletes in full,
# and never in the repo, because it is the one file that must not leak.
# Credentials are exported from the private properties file and read by
# Gradle from its environment; nothing in this script prints them.
RELEASE_SIGNING_PROPS="${PAYMAX_RELEASE_SIGNING_PROPS:-$HOME/.android-keystores/paymax-release.properties}"
if [[ -f "$RELEASE_SIGNING_PROPS" ]]; then
  set -a
  . "$RELEASE_SIGNING_PROPS"
  set +a
fi

# Failing here rather than after the build: gradle only warns when credentials
# are unusable and quietly falls back to the debug key.
MISSING_SIGNING_VARS=""
for signing_var in PAYMAX_RELEASE_STORE_FILE PAYMAX_RELEASE_KEY_ALIAS PAYMAX_RELEASE_STORE_PASSWORD PAYMAX_RELEASE_KEY_PASSWORD; do
  if [[ -z "${!signing_var:-}" ]]; then
    MISSING_SIGNING_VARS="${MISSING_SIGNING_VARS}${MISSING_SIGNING_VARS:+, }$signing_var"
  fi
done
if [[ -z "$MISSING_SIGNING_VARS" && ! -f "$PAYMAX_RELEASE_STORE_FILE" ]]; then
  MISSING_SIGNING_VARS="PAYMAX_RELEASE_STORE_FILE (set to a path that does not exist)"
fi

if [[ -n "$MISSING_SIGNING_VARS" ]]; then
  if [[ "${ALLOW_DEBUG_SIGNING:-0}" == "1" ]]; then
    SIGNING_DESC="DEBUG key (ALLOW_DEBUG_SIGNING=1; missing: $MISSING_SIGNING_VARS)"
  else
    echo "❌ Release signing credentials unavailable: $MISSING_SIGNING_VARS" >&2
    echo "   Expected in $RELEASE_SIGNING_PROPS (override with PAYMAX_RELEASE_SIGNING_PROPS)," >&2
    echo "   or in the environment under those exact names." >&2
    echo "   The keystore lives outside android/ because 'expo prebuild --clean' wipes it." >&2
    echo "   For a throwaway debug-signed bundle: ALLOW_DEBUG_SIGNING=1 ./build-aab.sh" >&2
    exit 1
  fi
else
  SIGNING_DESC="$(basename "$PAYMAX_RELEASE_STORE_FILE"), alias $PAYMAX_RELEASE_KEY_ALIAS"
fi

cd "$(dirname "$0")"
PROJECT_DIR="$PWD"

# Auto-detect environment: if neither $1 nor NODE_ENV was explicitly given,
# default to production if .env.production exists, or fallback to staging if .env.staging exists.
if [[ -z "$NODE_ENV_EXPLICIT" ]]; then
  if [[ -f .env.production ]]; then
    export NODE_ENV="production"
  elif [[ -f .env.staging ]]; then
    export NODE_ENV="staging"
    echo "ℹ️  NODE_ENV unset; defaulting to NODE_ENV=staging (.env.staging found)"
  else
    export NODE_ENV="production"
  fi
else
  export NODE_ENV="$NODE_ENV_EXPLICIT"
fi

ENV_FILE=".env.${NODE_ENV}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE not found — a release build has no API URLs to bake in." >&2
  if [[ "$ENV_FILE" == ".env.production" && -f .env.staging ]]; then
    echo "   Tip: To build staging, run: ./build-aab.sh staging (or NODE_ENV=staging ./build-aab.sh)" >&2
  fi
  exit 1
fi

# `|| true`: under `set -e`+pipefail a non-matching grep would abort the script
# before it could print the explanatory error below.
EXPECTED_API="$(grep -E '^EXPO_PUBLIC_API_BASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
EXPECTED_SUPABASE="$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"

if [[ -z "$EXPECTED_API" ]]; then
  echo "❌ EXPO_PUBLIC_API_BASE_URL is not set in $ENV_FILE." >&2
  exit 1
fi

# A higher-priority file would silently override $ENV_FILE. Refuse to build blind.
for shadow in ".env.${NODE_ENV}.local" ".env.local"; do
  if [[ -f "$shadow" ]] && grep -qE '^EXPO_PUBLIC_(API_BASE_URL|SUPABASE_URL)=' "$shadow"; then
    echo "❌ $shadow sets API/Supabase URLs and OUTRANKS $ENV_FILE." >&2
    echo "   Expo precedence: .env.<mode>.local > .env.local > .env.<mode> > .env" >&2
    echo "   Rename it to .env.development.local so it applies to dev only." >&2
    exit 1
  fi
done

# Every *_USE_MOCK flag referenced anywhere in source must be "false" in
# $ENV_FILE — a flag left unset defaults to MOCK (see client.ts per module), so
# a missed one ships fixture data in the release build with nothing in the
# build log to say so.
if ! node scripts/check-env-mocks.mjs "$ENV_FILE"; then
  echo "❌ $ENV_FILE fails the mock-data gate above — fix it before building." >&2
  exit 1
fi

# A release AAB's configured base URLs must be reachable from a device. Checked
# here, at the source of truth and before the build, rather than only by grepping
# the finished bundle: Expo bakes exactly the values in $ENV_FILE (shadowing files
# were refused above), and the historic failure was a loopback value baked as the
# API base. `EXPO_PUBLIC_LOCAL_*` is exempt: those are the runtime server switch's
# Local URL *templates*, whose host the developer edits on the device (see
# src/lib/serverProfile.ts and the bundle check below for why they cannot be caught
# by a string scan).
LOOPBACK_RE='(localhost|127\.0\.0\.1|10\.0\.2\.2):[0-9]+'
BAKED_LOOPBACK=""
while IFS= read -r line; do
  key="${line%%=*}"
  [[ "$key" == EXPO_PUBLIC_LOCAL_* ]] && continue
  pair="$(printf '%s' "${line#*=}" | grep -oE "$LOOPBACK_RE" | head -1 || true)"
  if [[ -n "$pair" ]]; then
    BAKED_LOOPBACK="${BAKED_LOOPBACK}${key} = ${pair}"$'\n'
  fi
done < <(grep -E '^EXPO_PUBLIC_[A-Z0-9_]+=' "$ENV_FILE" || true)

if [[ -n "$BAKED_LOOPBACK" ]]; then
  if [[ "${ALLOW_LOOPBACK_CONFIG:-0}" == "1" ]]; then
    echo "⚠️  $ENV_FILE bakes loopback base URLs (ALLOW_LOOPBACK_CONFIG=1, install will not" >&2
    echo "    reach the backend from a real device):" >&2
    printf '%s' "$BAKED_LOOPBACK" | sed 's/^/      /' >&2
  else
    echo "❌ $ENV_FILE bakes loopback base URLs — a device cannot reach them:" >&2
    printf '%s' "$BAKED_LOOPBACK" | sed 's/^/      /' >&2
    echo "   This is the \"internet connection issue\" bug. Set the remote URLs in $ENV_FILE," >&2
    echo "   or, for a deliberate on-device dev build, ALLOW_LOOPBACK_CONFIG=1 ./build-aab.sh." >&2
    exit 1
  fi
fi

echo "🔨 Building React Native AAB..."
echo "   JAVA_HOME: $JAVA_HOME"
echo "   NODE_ENV:  $NODE_ENV  (env file: $ENV_FILE)"
echo "   API base:  $EXPECTED_API"
echo "   Supabase:  $EXPECTED_SUPABASE"
echo "   ABIs:      $REACT_NATIVE_ARCHS"
echo "   Sentry:    $SENTRY_UPLOAD"
echo "   Signing:   $SIGNING_DESC"
echo ""

EXPECTED_ANDROID_PACKAGE="com.spotlight.paymax"
CONFIGURED_ANDROID_PACKAGE="$(node -e 'process.stdout.write(require("./app.json").expo.android.package)')"
if [[ "$CONFIGURED_ANDROID_PACKAGE" != "$EXPECTED_ANDROID_PACKAGE" ]]; then
  echo "❌ app.json Android package must be $EXPECTED_ANDROID_PACKAGE (found $CONFIGURED_ANDROID_PACKAGE)." >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" && ! -f android/local.properties ]]; then
  echo "❌ Android SDK not found. Set ANDROID_HOME, or put sdk.dir=<path> in android/local.properties." >&2
  exit 1
fi

# Keep generated native identifiers in sync with app.json on both APK and AAB
# build paths; otherwise Gradle can package a stale applicationId.
npx expo prebuild --platform android --no-install
GENERATED_ANDROID_PACKAGE="$(sed -nE "s/^[[:space:]]*applicationId ['\"]([^'\"]+)['\"].*/\\1/p" android/app/build.gradle | tail -1)"
if [[ "$GENERATED_ANDROID_PACKAGE" != "$EXPECTED_ANDROID_PACKAGE" ]]; then
  echo "❌ Generated Android applicationId is ${GENERATED_ANDROID_PACKAGE:-missing}; expected $EXPECTED_ANDROID_PACKAGE." >&2
  exit 1
fi

# React Native caches autolinking config without hashing app.json, so a package
# change can leave its generated entry point referring to the previous package.
rm -rf android/build/generated/autolinking

# See build-apk.sh's identical step for why .cxx is dropped before `clean`.
rm -rf android/app/.cxx

if [[ "${ALLOW_DEBUG_SIGNING:-0}" == "1" ]]; then
  echo "⚠️  ALLOW_DEBUG_SIGNING=1 — the AAB will be signed with the debug key and is NOT publishable."
fi

cd android
./gradlew --no-daemon clean bundleRelease \
  -PreactNativeArchitectures="$REACT_NATIVE_ARCHS" \
  -PreleaseAbis="$REACT_NATIVE_ARCHS"
cd "$PROJECT_DIR"

AAB="$(find android/app/build/outputs/bundle/release -name '*.aab' -type f | head -1 || true)"
if [[ -z "$AAB" ]]; then
  echo "❌ Build reported success but produced no AAB." >&2
  exit 1
fi

echo ""
echo "🔍 Verifying baked-in configuration: $AAB"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

AAB_PACKAGE="$(unzip -p "$AAB" base/manifest/AndroidManifest.xml | strings | awk 'previous == "package" && package == "" { if (match($0, /^[[:alnum:]_.]+/)) package = substr($0, RSTART, RLENGTH) } { previous = $0 } END { print package }')"
if [[ "$AAB_PACKAGE" != "$EXPECTED_ANDROID_PACKAGE" ]]; then
  echo "❌ AAB package is ${AAB_PACKAGE:-missing}; expected $EXPECTED_ANDROID_PACKAGE." >&2
  exit 1
fi
echo "   ✅ Android package: $AAB_PACKAGE"

# The JS bundle lives under a module prefix (base/, not the archive root like
# an APK) — find it by name rather than assuming the exact path.
BUNDLE_ENTRY="$(unzip -Z1 "$AAB" '*assets/index.android.bundle' 2>/dev/null | head -1 || true)"
if [[ -z "$BUNDLE_ENTRY" ]]; then
  echo "❌ AAB contains no JS bundle (no */assets/index.android.bundle entry)." >&2
  exit 1
fi
unzip -o -q "$AAB" "$BUNDLE_ENTRY" -d "$WORK"
BUNDLE="$WORK/$BUNDLE_ENTRY"

fail=0

# 1. The remote host must actually be present in the shipped bundle.
EXPECTED_HOST="$(printf '%s' "$EXPECTED_API" | sed -E 's#^https?://##; s#/.*$##')"
if grep -aq "$EXPECTED_HOST" "$BUNDLE"; then
  echo "   ✅ API host present: $EXPECTED_HOST"
else
  echo "   ❌ API host MISSING from bundle: $EXPECTED_HOST" >&2
  fail=1
fi

# 2. No loopback backend URL may survive as a *configured base URL*.
#
#    A plain "any loopback host:port" scan is no longer satisfiable: since PR #799
#    (runtime Remote/Local server switch) the Local URL *templates* are
#    compile-time constants — DEFAULT_LOCAL_* in src/lib/serverProfile.ts and
#    resolveApiBaseUrl()'s default argument — so Metro interns "http://localhost:3000",
#    ":8091" and ":54321" into EVERY release bundle, production included, where they
#    are inert because isSwitchAvailable() only ever enables the switch for an
#    explicitly non-production EXPO_PUBLIC_APP_ENV. So the pairs the app itself
#    declares as Local templates are allowed here, and the check stays pointed at
#    rogue loopback on a known backend port (the admin console's 3001 has no
#    template excuse). `getDevUrl()` also contains the bare literals "127.0.0.1" and
#    "10.0.2.2" as replace() arguments, which is why only host:port pairs match.
#    What the values actually baked as *config* are is checked before the build
#    above — that is the check that catches the original bug; a bundle scan cannot,
#    because a baked loopback is indistinguishable from a template literal.
LOCAL_TEMPLATE_PAIRS="$(grep -hoE '(localhost|127\.0\.0\.1|10\.0\.2\.2):[0-9]{1,5}' \
  src/lib/serverProfile.ts src/lib/apiBaseUrl.ts | sort -u || true)"
while IFS= read -r line; do
  pair="$(printf '%s' "${line#*=}" | grep -oE '(localhost|127\.0\.0\.1|10\.0\.2\.2):[0-9]{1,5}' | head -1 || true)"
  if [[ -n "$pair" ]]; then
    LOCAL_TEMPLATE_PAIRS="${LOCAL_TEMPLATE_PAIRS}${LOCAL_TEMPLATE_PAIRS:+$'\n'}${pair}"
  fi
done < <(grep -E '^EXPO_PUBLIC_LOCAL_[A-Z0-9_]+=' "$ENV_FILE" || true)

BACKEND_LOOPBACK="$(grep -aoE '(localhost|127\.0\.0\.1|10\.0\.2\.2):(3000|3001|8091|54321)([^0-9]|$)' "$BUNDLE" \
  | sed -E 's/[^0-9]+$//' | sort -u || true)"
ROGUE_LOOPBACK=""
if [[ -n "$BACKEND_LOOPBACK" ]]; then
  if [[ -z "$LOCAL_TEMPLATE_PAIRS" ]]; then
    ROGUE_LOOPBACK="$BACKEND_LOOPBACK"
  else
    ROGUE_LOOPBACK="$(printf '%s\n' "$BACKEND_LOOPBACK" | grep -vxF -f <(printf '%s\n' "$LOCAL_TEMPLATE_PAIRS") || true)"
  fi
fi

if [[ -n "$ROGUE_LOOPBACK" ]]; then
  echo "   ❌ Loopback backend URLs baked into the release bundle:" >&2
  printf '%s\n' "$ROGUE_LOOPBACK" | sed 's/^/      /' >&2
  echo "      A device cannot reach these — this is the \"internet connection issue\" bug." >&2
  echo "      (Local server-switch templates are exempt; here: $(printf '%s\n' "$LOCAL_TEMPLATE_PAIRS" | sort -u | tr '\n' ' '))" >&2
  fail=1
else
  echo "   ✅ No loopback backend URLs beyond the Local server-switch templates"
fi

# 3. Only the requested ABIs may ship. Native libs live under a module prefix
#    (base/lib/<abi>/*.so), same reasoning as build-apk.sh's ABI check.
EXPECTED_ABIS="$(printf '%s' "$REACT_NATIVE_ARCHS" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep . | sort -u)"
ACTUAL_ABIS="$(unzip -Z1 "$AAB" '*/lib/*/*.so' 2>/dev/null | sed -E 's#.*/lib/([^/]+)/.*#\1#' | sort -u)"
if [[ -z "$ACTUAL_ABIS" ]]; then
  echo "   ❌ AAB contains no native libraries at all." >&2
  fail=1
elif ! diff <(printf '%s\n' "$EXPECTED_ABIS") <(printf '%s\n' "$ACTUAL_ABIS") >/dev/null; then
  echo "   ❌ ABI mismatch — requested [$REACT_NATIVE_ARCHS], AAB has:" >&2
  printf '%s\n' "$ACTUAL_ABIS" | sed 's/^/      /' >&2
  fail=1
else
  echo "   ✅ ABIs as requested: $(printf '%s' "$ACTUAL_ABIS" | tr '\n' ' ')"
fi

# 4. The AAB must carry the production certificate. Bundles are JAR-signed
#    (jarsigner), not APK-Signature-Scheme-signed (apksigner) — bundletool /
#    Play generate the final installable APK(s) from this later, and THOSE
#    get the v2/v3 signature. jarsigner still proves the right keystore/alias
#    signed this upload artifact before it ever reaches Play.
JARSIGNER="$JAVA_HOME/bin/jarsigner"
if [[ ! -x "$JARSIGNER" ]]; then
  JARSIGNER="$(command -v jarsigner || true)"
fi

if [[ -z "$JARSIGNER" ]]; then
  echo "   ❌ jarsigner not found (checked \$JAVA_HOME/bin and PATH) — cannot prove how this AAB is signed." >&2
  fail=1
else
  # Plain `-verify` (no -verbose/-certs) is the reliable pass/fail signal —
  # exit 0 means every entry's signature checks out. The "signed in JarFile
  # but is not signed in JarInputStream" lines it can still print are a
  # known jarsigner quirk with modern AAB/APK content (timestamped/metadata
  # entries jarsigner's streaming verifier does not fully understand) and are
  # not a real problem; found 2026-09-26 chasing a false "MISCONFIGURED" on a
  # build that was actually fine. -verbose/-certs is a SEPARATE call purely to
  # extract which certificate signed it, for the log — its own exit code is
  # not used for pass/fail.
  JARSIGNER_RC=0
  "$JARSIGNER" -verify "$AAB" > "$WORK/jarsigner-verify.txt" 2>&1 || JARSIGNER_RC=$?
  SIGNER_REPORT="$("$JARSIGNER" -verify -verbose -certs "$AAB" 2>&1 || true)"
  # jarsigner indents this line under each entry — no anchor, since the exact
  # leading whitespace is an implementation detail, not something to pin.
  SIGNER_LINE="$(printf '%s\n' "$SIGNER_REPORT" | grep -m1 'X\.509,' | sed 's/^[[:space:]]*//' || true)"
  CERT_REPORT="$(keytool -printcert -jarfile "$AAB" 2>&1 || true)"
  SIGNER_SHA1="$(printf '%s\n' "$CERT_REPORT" | grep -m1 -E 'SHA1:' | sed -E 's/.*SHA1:[[:space:]]*//' | tr -d ':' | tr '[:lower:]' '[:upper:]' || true)"
  EXPECTED_UPLOAD_CERT_SHA1="A455D923C471689ED3127ED327548ABBDA1B2799"
  if [[ "$JARSIGNER_RC" -ne 0 || -z "$SIGNER_LINE" ]]; then
    echo "   ❌ jarsigner could not verify the AAB's signature:" >&2
    tail -20 "$WORK/jarsigner-verify.txt" | sed 's/^/      /' >&2
    fail=1
  elif [[ "$SIGNER_LINE" == *"CN=Android Debug"* ]]; then
    if [[ "${ALLOW_DEBUG_SIGNING:-0}" == "1" ]]; then
      echo "   ⚠️  DEBUG-signed (allowed by ALLOW_DEBUG_SIGNING=1) — not publishable."
    else
      echo "   ❌ DEBUG-signed: $SIGNER_LINE" >&2
      echo "      Play rejects debug uploads. Check $RELEASE_SIGNING_PROPS." >&2
      fail=1
    fi
  elif [[ "$SIGNER_SHA1" != "$EXPECTED_UPLOAD_CERT_SHA1" ]]; then
    echo "   ❌ Wrong upload certificate SHA-1: ${SIGNER_SHA1:-unavailable}" >&2
    echo "      Play expects A4:55:D9:23:C4:71:68:9E:D3:12:7E:D3:27:54:8A:BB:DA:1B:27:99." >&2
    fail=1
  else
    echo "   ✅ Signed with Play upload certificate (SHA-1 A4:55:D9:23:C4:71:68:9E:D3:12:7E:D3:27:54:8A:BB:DA:1B:27:99): $SIGNER_LINE"
  fi
fi

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "❌ AAB built but is MISCONFIGURED. Do not upload it." >&2
  exit 1
fi

# Gradle always writes to the same path regardless of NODE_ENV, so building
# staging then production (or vice versa) silently overwrites the first
# one — found 2026-09-26 right after building both back to back. An
# env-suffixed copy INSIDE android/app/build/outputs isn't enough either:
# `gradlew clean` (which this script always runs) deletes that whole
# outputs/bundle/release/ directory up front, so the other environment's
# stamped copy died on the very next build regardless. Copy out to a
# directory `clean` never touches; the original stays where Gradle put it
# for anything that expects that exact path (e.g. an IDE's "locate bundle"
# action), but only survives until the next build of either environment.
ARTIFACT_DIR="release-artifacts"
mkdir -p "$ARTIFACT_DIR"
STAMPED_AAB="$ARTIFACT_DIR/app-release-${NODE_ENV}.aab"
cp "$AAB" "$STAMPED_AAB"

echo ""
echo "✅ Build complete and verified!"
echo "AAB location:"
echo "  $AAB"
echo "  $STAMPED_AAB  (env-stamped copy, outside android/ — survives \`gradlew clean\` on the next build)"

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
export NODE_ENV="${NODE_ENV:-production}"

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
# Credentials are read into the environment here and passed to gradle as
# project properties; nothing in this script prints them.
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

ENV_FILE=".env.${NODE_ENV}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE not found — a release build has no API URLs to bake in." >&2
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

echo "🔨 Building React Native AAB..."
echo "   JAVA_HOME: $JAVA_HOME"
echo "   NODE_ENV:  $NODE_ENV  (env file: $ENV_FILE)"
echo "   API base:  $EXPECTED_API"
echo "   Supabase:  $EXPECTED_SUPABASE"
echo "   ABIs:      $REACT_NATIVE_ARCHS"
echo "   Sentry:    $SENTRY_UPLOAD"
echo "   Signing:   $SIGNING_DESC"
echo ""

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" && ! -f android/local.properties ]]; then
  echo "❌ Android SDK not found. Set ANDROID_HOME, or put sdk.dir=<path> in android/local.properties." >&2
  exit 1
fi

# See build-apk.sh's identical step for why .cxx is dropped before `clean`.
rm -rf android/app/.cxx

if [[ "${ALLOW_DEBUG_SIGNING:-0}" == "1" ]]; then
  echo "⚠️  ALLOW_DEBUG_SIGNING=1 — the AAB will be signed with the debug key and is NOT publishable."
fi

cd android
./gradlew clean bundleRelease \
  -PreactNativeArchitectures="$REACT_NATIVE_ARCHS" \
  -PreleaseAbis="$REACT_NATIVE_ARCHS" \
  -PPAYMAX_RELEASE_STORE_FILE="${PAYMAX_RELEASE_STORE_FILE:-}" \
  -PPAYMAX_RELEASE_KEY_ALIAS="${PAYMAX_RELEASE_KEY_ALIAS:-}" \
  -PPAYMAX_RELEASE_STORE_PASSWORD="${PAYMAX_RELEASE_STORE_PASSWORD:-}" \
  -PPAYMAX_RELEASE_KEY_PASSWORD="${PAYMAX_RELEASE_KEY_PASSWORD:-}"
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

# 2. No loopback host may survive as a *configured base URL* — see
#    build-apk.sh's identical check for why this matches host:port pairs only.
if grep -aoE '(localhost|127\.0\.0\.1|10\.0\.2\.2):(8091|54321|3000|3001)' "$BUNDLE" | sort -u | grep -q .; then
  echo "   ❌ Loopback backend URLs baked into the release bundle:" >&2
  grep -aoE '(localhost|127\.0\.0\.1|10\.0\.2\.2):(8091|54321|3000|3001)' "$BUNDLE" | sort -u | sed 's/^/      /' >&2
  echo "      A device cannot reach these — this is the \"internet connection issue\" bug." >&2
  fail=1
else
  echo "   ✅ No loopback backend URLs in bundle"
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
  else
    echo "   ✅ Signed with: $SIGNER_LINE"
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

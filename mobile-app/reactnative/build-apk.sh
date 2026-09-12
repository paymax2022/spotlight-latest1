#!/bin/bash
set -euo pipefail

# React Native APK Build Script
# Sets up Java environment, builds a release APK, then VERIFIES what got baked in.
#
# Why the verification step exists (2026-09-11):
#   A release APK shipped with `http://localhost:8091` as its API base and zero
#   references to the remote backend, so the app showed "internet connection
#   issue" on an emulator. Cause: `.env.local` outranks `.env.production` in
#   Expo's precedence (.env.<mode>.local > .env.local > .env.<mode> > .env), and
#   `getDevUrl()` short-circuits on `if (!__DEV__) return url`, so nothing
#   rewrites a loopback host in a release build. The env file was renamed to
#   `.env.development.local`; this check is the backstop that catches any
#   recurrence BEFORE the APK reaches a device.

JAVA_HOME=/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export JAVA_HOME

# Expo picks its .env files from NODE_ENV. Set it explicitly: if it is unset,
# @expo/env falls back to only `.env.local` and `.env` and silently skips
# `.env.production` entirely.
export NODE_ENV="${NODE_ENV:-production}"

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

echo "🔨 Building React Native APK..."
echo "   JAVA_HOME: $JAVA_HOME"
echo "   NODE_ENV:  $NODE_ENV  (env file: $ENV_FILE)"
echo "   API base:  $EXPECTED_API"
echo "   Supabase:  $EXPECTED_SUPABASE"
echo ""

cd android
./gradlew clean assembleRelease
cd "$PROJECT_DIR"

APK="$(find android/app/build/outputs/apk -name '*.apk' -type f | head -1 || true)"
if [[ -z "$APK" ]]; then
  echo "❌ Build reported success but produced no APK." >&2
  exit 1
fi

echo ""
echo "🔍 Verifying baked-in configuration: $APK"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -o -q "$APK" 'assets/index.android.bundle' -d "$WORK"
BUNDLE="$WORK/assets/index.android.bundle"

if [[ ! -f "$BUNDLE" ]]; then
  echo "❌ APK contains no JS bundle at assets/index.android.bundle." >&2
  exit 1
fi

fail=0

# 1. The remote host must actually be present in the shipped bundle.
EXPECTED_HOST="$(printf '%s' "$EXPECTED_API" | sed -E 's#^https?://##; s#/.*$##')"
if grep -aq "$EXPECTED_HOST" "$BUNDLE"; then
  echo "   ✅ API host present: $EXPECTED_HOST"
else
  echo "   ❌ API host MISSING from bundle: $EXPECTED_HOST" >&2
  fail=1
fi

# 2. No loopback host may survive as a *configured base URL*. `getDevUrl()`
#    legitimately contains the literals "127.0.0.1" and "10.0.2.2" as replace()
#    arguments, so match host:port pairs, which only appear in baked config.
if grep -aoE '(localhost|127\.0\.0\.1|10\.0\.2\.2):(8091|54321|3000|3001)' "$BUNDLE" | sort -u | grep -q .; then
  echo "   ❌ Loopback backend URLs baked into the release bundle:" >&2
  grep -aoE '(localhost|127\.0\.0\.1|10\.0\.2\.2):(8091|54321|3000|3001)' "$BUNDLE" | sort -u | sed 's/^/      /' >&2
  echo "      A device cannot reach these — this is the \"internet connection issue\" bug." >&2
  fail=1
else
  echo "   ✅ No loopback backend URLs in bundle"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "❌ APK built but is MISCONFIGURED. Do not install it." >&2
  exit 1
fi

echo ""
echo "✅ Build complete and verified!"
echo "APK location:"
find android/app/build/outputs/apk -name "*.apk" -type f

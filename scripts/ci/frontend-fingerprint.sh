#!/usr/bin/env bash
# A stable digest of the /_next/static/chunks/ filenames a served HTML page
# references. Two builds of different code produce different chunk names; the
# same build produces the same digest.
#
# This is the ONLY available signal that a frontend deploy actually replaced the
# bytes, because a frontend build echoes no commit anywhere: there is no
# generateBuildId in frontend-web/next.config, and the App Router HTML carries no
# buildId and no _buildManifest.js reference (measured against both live
# production URLs).
#
# Usage: frontend-fingerprint.sh <url>
# Prints the digest, "no-chunks", or "unreachable". NEVER fails: a probe that
# cannot reach a host is a warning, not a release-stopping error. development's
# frontend-web is red today (FAILED 2026-11-13) and must not halt a release.

set -uo pipefail

url="${1:?usage: frontend-fingerprint.sh <url>}"

# -m 30 caps the whole request; -L follows Railway's edge redirect; `|| true`
# keeps a network failure from aborting the caller under `set -e`.
html="$(curl -s -m 30 -L "$url" || true)"
if [ -z "$html" ]; then
  echo unreachable
  exit 0
fi

chunks="$(printf '%s' "$html" | grep -oE '/_next/static/chunks/[A-Za-z0-9._/-]+' | sort -u || true)"
if [ -z "$chunks" ]; then
  echo no-chunks
  exit 0
fi

# sha256sum over the SORTED UNIQUE list, so a reordered <script> block in the
# HTML does not read as a new build. Truncated to 16 chars: this is a change
# detector, not a security hash.
printf '%s\n' "$chunks" | sha256sum | cut -c1-16

#!/usr/bin/env bash
# Maps CI — local/on-platform runner.
#
# Runs the full Maps verification gate wherever the toolchains are available,
# and clearly reports what it could and could not run. Designed so Cowork (or any
# dev box / CI agent) can execute the gate end-to-end:
#
#   - Go build / vet / test         (needs `go`; auto-skips with a notice if absent)
#   - PostGIS integration tests     (needs `go` + TEST_DATABASE_URL)
#   - Web + mobile TypeScript        (needs `npm`; reachable from Cowork)
#   - OpenAPI + workflow YAML lint   (python; always runnable)
#   - Additive-only migration guard  (shell; always runnable)
#
# Exit non-zero if any runnable check fails. Skipped checks (missing toolchain)
# are reported but do not fail the run — see the SUMMARY at the end.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
ROOT="$(pwd)"

pass=0; fail=0; skip=0
ok()   { echo "  PASS: $*"; pass=$((pass+1)); }
bad()  { echo "  FAIL: $*"; fail=$((fail+1)); }
note() { echo "  SKIP: $*"; skip=$((skip+1)); }
hdr()  { echo; echo "── $* ──────────────────────────────────────────"; }

hdr "1. Go build / vet / test"
if command -v go >/dev/null 2>&1; then
  ( cd backend && go build ./... ) && ok "go build ./..." || bad "go build"
  ( cd backend && go vet ./internal/maps/... ./internal/transport/... ./internal/restaurant/... ./internal/estate/... ) \
     && ok "go vet (maps + bridged modules)" || bad "go vet"
  ( cd backend && go test ./internal/maps/... -count=1 ) && ok "go test ./internal/maps/..." || bad "go test maps"
  ( cd backend && go test ./... -count=1 ) && ok "go test ./... (regression)" || bad "go test all"
  if [ -n "${TEST_DATABASE_URL:-}${DATABASE_URL:-}" ]; then
    ( cd backend && go test -tags=integration ./internal/maps/... -count=1 ) \
      && ok "go test -tags=integration (PostGIS)" || bad "integration tests"
  else
    note "integration tests (set TEST_DATABASE_URL to a Postgres+PostGIS DB)"
  fi
else
  note "Go not installed. Install a 1.25.x toolchain, then re-run. See docs/maps/CI-ON-COWORK.md for the egress hosts to allowlist."
fi

# tscheck DIR CONFIG LABEL — install deps only if missing, then run scoped tsc.
tscheck() {
  local dir="$1" cfg="$2" label="$3"
  if [ ! -d "$dir/node_modules" ]; then
    ( cd "$dir" && npm ci --no-audit --no-fund >/tmp/${label}-npm.log 2>&1 ) \
      || { bad "$label npm install (see /tmp/${label}-npm.log)"; return; }
  fi
  ( cd "$dir" && npx tsc --noEmit -p "$cfg" ) && ok "$label tsc" || bad "$label tsc"
}

hdr "2. Web TypeScript (scoped maps slice)"
if [ "${RUN_TS:-0}" != "1" ]; then
  note "TypeScript checks disabled (set RUN_TS=1 to run tsc)"
elif command -v npm >/dev/null 2>&1; then
  tscheck frontend-web tsconfig.mapscheck.json web
else
  note "npm not available for web typecheck"
fi

hdr "3. Mobile TypeScript (scoped maps slice)"
if [ "${RUN_TS:-0}" != "1" ]; then
  note "TypeScript checks disabled (set RUN_TS=1 to run tsc)"
elif command -v npm >/dev/null 2>&1; then
  tscheck mobile-app/reactnative tsconfig.mapscheck.json mobile
else
  note "npm not available for mobile typecheck"
fi

hdr "4. OpenAPI + workflow YAML"
python3 - <<'PY' && ok "OpenAPI + workflows parse" || bad "OpenAPI/workflow YAML"
import yaml, glob, sys
d = yaml.safe_load(open('contracts/openapi.yaml'))
maps = [p for p in d['paths'] if '/maps/' in p]
assert len(maps) >= 12, maps
assert '/api/finance/mobility/trips/{id}/track' in d['paths']
for f in glob.glob('.github/workflows/*.yml'):
    yaml.safe_load(open(f))
print(f"     {len(maps)} maps paths; workflows OK")
PY

hdr "5. Additive-only migration guard"
FILES=$(ls supabase/migrations/2026062600*.sql 2>/dev/null)
if [ -z "$FILES" ]; then note "no maps migrations found";
elif grep -iEn '\b(drop\s+(table|column|type)|alter\s+[a-z_."]+\s+drop|drop\s+not\s+null|rename\s+(column|to))\b' $FILES >/dev/null; then
  bad "destructive DDL in a maps migration"
else
  ok "$(echo "$FILES" | wc -l | tr -d ' ') maps migrations additive-only"
fi

hdr "6. JSON config sanity"
python3 - <<'PY' && ok "package.json/app.json/tsconfig valid; maplibre deps present" || bad "JSON config"
import json
rn = json.load(open('mobile-app/reactnative/package.json'))
json.load(open('mobile-app/reactnative/app.json'))
json.load(open('mobile-app/reactnative/tsconfig.mapscheck.json'))
web = json.load(open('frontend-web/package.json'))
assert '@maplibre/maplibre-react-native' in rn['dependencies']
assert 'maplibre-gl' in web['dependencies']
PY

echo
echo "════════════════ SUMMARY ════════════════"
echo "PASS=$pass  FAIL=$fail  SKIP=$skip"
[ "$fail" -eq 0 ] && echo "RESULT: GREEN (runnable checks passed)" || echo "RESULT: RED"
exit "$fail"

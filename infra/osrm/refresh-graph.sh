#!/usr/bin/env bash
# Near-zero-downtime refresh of the OSRM graph from the latest OSM extract.
# Builds into a staging dir, then atomically swaps it in and recreates the
# container. Keeps the previous graph in ./data.old for fast rollback.
#
# Run weekly (see osrm-refresh.timer) or manually:  ./refresh-graph.sh
set -euo pipefail
cd "$(dirname "$0")"

STAGING="./data.new"
LIVE="./data"
PREV="./data.old"

echo "→ Building fresh graph into $STAGING"
rm -rf "$STAGING"
./prepare-graph.sh "$STAGING"

echo "→ Swapping graphs"
rm -rf "$PREV"
[ -d "$LIVE" ] && mv "$LIVE" "$PREV"
mv "$STAGING" "$LIVE"

echo "→ Recreating OSRM container"
docker compose up -d --force-recreate osrm

echo "→ Verifying health"
if ./health.sh; then
  echo "✓ Refresh complete. Previous graph retained in $PREV"
else
  echo "✗ Health check failed — rolling back to $PREV" >&2
  rm -rf "$LIVE"
  mv "$PREV" "$LIVE"
  docker compose up -d --force-recreate osrm
  exit 1
fi

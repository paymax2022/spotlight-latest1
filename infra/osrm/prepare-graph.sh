#!/usr/bin/env bash
# Build the OSRM routing graph from a Nigeria OSM extract (MLD pipeline).
# Usage:  ./prepare-graph.sh [DATA_DIR]
#   DATA_DIR defaults to ./data. Override the source/profile/image via env:
#     PBF_URL   (default: Geofabrik nigeria-latest)
#     PROFILE   (default: /opt/car.lua — driving)
#     IMAGE     (default: osrm/osrm-backend:v5.27.1)
set -euo pipefail

DATA_DIR="${1:-./data}"
PBF_URL="${PBF_URL:-https://download.geofabrik.de/africa/nigeria-latest.osm.pbf}"
PROFILE="${PROFILE:-/opt/car.lua}"
IMAGE="${IMAGE:-osrm/osrm-backend:v5.27.1}"

mkdir -p "$DATA_DIR"
ABS_DATA="$(cd "$DATA_DIR" && pwd)"

echo "→ Downloading extract: $PBF_URL"
curl -fSL --retry 3 -o "$ABS_DATA/nigeria.osm.pbf" "$PBF_URL"

run() { docker run --rm -t -v "$ABS_DATA:/data" "$IMAGE" "$@"; }

echo "→ osrm-extract (profile: $PROFILE)"
run osrm-extract -p "$PROFILE" /data/nigeria.osm.pbf
echo "→ osrm-partition"
run osrm-partition /data/nigeria.osrm
echo "→ osrm-customize"
run osrm-customize /data/nigeria.osrm

echo "✓ Graph ready in $ABS_DATA (nigeria.osrm*). Start with: docker compose up -d"

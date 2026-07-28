# Self-hosted OSRM — routing backend for MapService

OSRM is the OpenStack routing engine behind the MapService `route`, `matrix`
(dispatch), and `matchToRoad` (live tracking) primitives. The Go backend's OSRM
adapter calls it; clients never do. This directory deploys and maintains it.

```
infra/osrm/
  docker-compose.yml        # runs osrm-routed (MLD), localhost-only
  prepare-graph.sh          # build the graph from a Nigeria OSM extract
  refresh-graph.sh          # near-zero-downtime weekly rebuild + rollback
  health.sh                 # liveness probe (a real Lagos route)
  systemd/                  # weekly refresh timer + service
```

## 1. First-time setup

```bash
cd infra/osrm
./prepare-graph.sh ./data     # downloads nigeria-latest.osm.pbf, extract/partition/customize
docker compose up -d          # starts osrm-routed on 127.0.0.1:5000
./health.sh                   # expect: OSRM healthy
```

Build needs Docker and a few GB of RAM; the Nigeria extract processes in minutes.
For all-Nigeria coverage beyond Lagos, the default Geofabrik extract already
covers the whole country — no change needed. To restrict to a smaller area, pass
a clipped `.pbf` via `PBF_URL`.

## 2. Wire the backend

Point the MapService OSRM adapter at this service and enable maps:

```
FEATURE_MAPS_ENABLED=true
MAPS_OSRM_BASE_URL=http://127.0.0.1:5000      # same host
# or, if the API runs in the same compose/private network:
# MAPS_OSRM_BASE_URL=http://osrm:5000
```

With `MAPS_OSRM_BASE_URL` blank, MapService falls back to the deterministic mock
router (fine for dev, not production). No code change to switch — config only.

## 3. Security (important)

- **Never expose OSRM publicly.** It has no auth or rate limiting. The compose
  binds `127.0.0.1:5000`; if the backend runs elsewhere, use a private network,
  VPC, or SSH tunnel — not a public port.
- All client routing goes through the authenticated `/api/finance/maps/*` proxy,
  which also enforces the cost guard. OSRM itself is an internal dependency.
- `--max-table-size 10000` caps matrix size (100×100); raise only with capacity
  planning, since matrix cost is `origins × destinations`.

## 4. Keeping the map current

OSM changes constantly. Refresh weekly so routes reflect new/closed roads:

```bash
# Manual
./refresh-graph.sh            # builds into ./data.new, swaps, recreates, verifies, rolls back on failure

# Automated (systemd)
sudo cp systemd/osrm-refresh.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now osrm-refresh.timer
systemctl list-timers osrm-refresh.timer
```

`refresh-graph.sh` keeps the previous graph in `./data.old` and auto-rolls back
if the post-swap health check fails.

## 5. Monitoring

- Liveness: run `health.sh` from your monitor (cron/Nagios/Prometheus blackbox);
  it asserts a real Lagos route returns `"code":"Ok"`.
- Container: `docker compose ps` / `docker logs spotlight-osrm`; the compose
  healthcheck restarts on repeated failure.
- Capacity: watch CPU + memory during peak dispatch; OSRM is CPU-bound on
  `table`/`match`. Scale by running multiple OSRM replicas behind an internal
  load balancer and pointing `MAPS_OSRM_BASE_URL` at it.

## 6. Upgrading OSRM

Pin the image tag in `docker-compose.yml` (currently `v5.27.1`). A graph built by
one OSRM version must be served by the same major version — after bumping the
image, always re-run `prepare-graph.sh` (or `refresh-graph.sh`) before serving.

## 7. Profiles

Default profile is driving (`/opt/car.lua`). For other modes (cycling/walking),
build a second graph in a separate dir/instance with `PROFILE=/opt/bicycle.lua`
(or `foot.lua`) and route MapService's `route`/`matrix` profile to it — the
adapter already forwards the `profile` option.

#!/usr/bin/env bash
# start-postgres-service.sh — start a postgres-family container from a step
# instead of a workflow `services:` block.
#
# Why: a `services:` image is pulled by the runner BEFORE the first step
# executes, so a Docker Hub 429/timeout there fails the whole job at "Initialize
# containers" with no chance to retry. postgis/postgis is community-published —
# Docker Hub only, no official ECR Public/GHCR mirror — so mirroring is not an
# option and the pull has to be retried instead. Starting the container from a
# step lets the pull go through with-retry.sh.
#
# The configuration below mirrors the old `services:` block 1:1 (POSTGRES_* env,
# host port, pg_isready health gate), so when Docker Hub is healthy the
# behaviour is identical to the declarative service it replaces.
#
# Usage:  scripts/ci/start-postgres-service.sh <image> <container-name>
# Env:    POSTGRES_USER (paymax)  POSTGRES_PASSWORD (paymax)
#         POSTGRES_DB (paymax)    POSTGRES_PORT (5432, host-side)
set -euo pipefail

IMAGE="${1:?usage: start-postgres-service.sh IMAGE NAME}"
NAME="${2:?usage: start-postgres-service.sh IMAGE NAME}"
PGUSER="${POSTGRES_USER:-paymax}"
PGPASS="${POSTGRES_PASSWORD:-paymax}"
PGDB="${POSTGRES_DB:-paymax}"
PORT="${POSTGRES_PORT:-5432}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$HERE/with-retry.sh" docker pull "$IMAGE"

# Idempotent: a re-run (retried job) replaces any leftover container.
docker rm -f "$NAME" >/dev/null 2>&1 || true

docker run -d --name "$NAME" \
  -e "POSTGRES_USER=$PGUSER" -e "POSTGRES_PASSWORD=$PGPASS" -e "POSTGRES_DB=$PGDB" \
  -p "127.0.0.1:${PORT}:5432" \
  --health-cmd "pg_isready -U $PGUSER" \
  --health-interval 10s --health-timeout 5s --health-retries 5 \
  "$IMAGE" >/dev/null

# Same readiness contract the `services:` health check gave the job: do not
# proceed until pg_isready inside the container passes.
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$NAME")"
  case "$status" in
    healthy) echo "$NAME is healthy ($IMAGE)"; exit 0 ;;
    unhealthy)
      docker logs "$NAME" 2>&1 | tail -30
      echo "::error::$NAME reported unhealthy" >&2
      exit 1
      ;;
  esac
  sleep 2
done
docker logs "$NAME" 2>&1 | tail -30
echo "::error::timed out waiting for $NAME to become healthy" >&2
exit 1

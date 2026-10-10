#!/usr/bin/env bash
# mirror-docker-base-images.sh — pre-pull a Dockerfile's FROM images through the
# AWS ECR Public mirror of the Docker Official Images, then tag them under
# their docker.io names so a subsequent `docker build` resolves every FROM
# locally and never touches Docker Hub's anonymous rate limit.
#
# public.ecr.aws/docker/library/* carries the SAME digests Docker Hub ships for
# its Official Images (alpine, golang, postgres, node, redis, …) but with no
# anonymous pull quota — same content, different registry. Tagging the mirror
# pull under the docker.io name keeps backend/Dockerfile untouched: `docker
# build` prefers the local image store when a FROM reference resolves there.
#
# Fallback order per image:
#   1. retried pull from public.ecr.aws/docker/library/<name>
#   2. retried pull of the plain name (docker.io) — covers an ECR outage too
# Namespaced images (postgis/postgis, gcr.io/distroless/*) have no ECR library
# mirror; they are pulled from their own registry through with-retry only.
#
# Usage: scripts/ci/mirror-docker-base-images.sh [Dockerfile]
#        (default: backend/Dockerfile)
set -euo pipefail

DOCKERFILE="${1:-backend/Dockerfile}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# FROM <image> [AS <stage>] — collect stage names first so `FROM build`
# self-references are not mistaken for registry images. `|| true`: a Dockerfile
# with no matching line must not trip set -e on grep's exit 1.
stages="$(grep -E '^FROM[[:space:]]' "$DOCKERFILE" | \
  awk '{for (i=1;i<=NF;i++) if (tolower($i)=="as") print $(i+1)}' | sort -u || true)"

{ grep -E '^FROM[[:space:]]' "$DOCKERFILE" || true; } | awk '{print $2}' | sort -u | while read -r image; do
  [ -z "$image" ] && continue
  case "$image" in
    *\$*)    echo "  skip $image (ARG indirection — cannot resolve statically)"; continue ;;
    scratch) echo "  skip scratch"; continue ;;
  esac
  if printf '%s\n' "$stages" | grep -qx "$image"; then
    continue # local build-stage reference, not a registry image
  fi

  case "$image" in
    */*)
      # Namespaced image — not a Docker Official Image, so no ECR library
      # mirror exists. Pull from its own registry with retries.
      "$HERE/with-retry.sh" docker pull "$image"
      ;;
    *)
      mirror="public.ecr.aws/docker/library/${image}"
      if "$HERE/with-retry.sh" docker pull "$mirror"; then
        docker tag "$mirror" "$image"
        echo "  mirrored $image via ECR Public"
      else
        echo "::warning::ECR mirror pull failed for $image — falling back to a retried docker.io pull" >&2
        "$HERE/with-retry.sh" docker pull "$image"
      fi
      ;;
  esac
done

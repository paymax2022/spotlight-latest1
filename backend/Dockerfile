# Base image must satisfy backend/go.mod's `go` directive. The official golang
# images set GOTOOLCHAIN=local, so an older image CANNOT auto-download a newer
# toolchain the way a CI runner does — it fails with
#   go: go.mod requires go >= 1.26.6 (running go 1.25.14; GOTOOLCHAIN=local)
# This broke main once already: 1b64f24c raised go.mod to 1.26.6 for a security
# bump while this line still said 1.25, and nothing caught it until
# integration-verify's docker build, which only runs on push:main. When you bump
# the go directive, bump this line in the SAME commit.
FROM golang:1.26-alpine AS build
WORKDIR /app
COPY . .

# Bake the git SHA into the binary so a DEPLOYED server can report what it is
# running (GET /api/v1/public/build). It cannot discover this itself: the runtime
# image has no .git, which is why internal/platform/buildinfo.Describe returns
# nothing there. Without this, the only external probe was /public/health, whose
# body is identical on every build — so it could never distinguish "deployed"
# from "did not deploy".
#
# Two ways to supply it, both optional; an unset value builds fine and the
# endpoint honestly reports source "unknown" rather than a guess:
#   - docker build --build-arg BUILD_COMMIT=$(git rev-parse HEAD)
#   - a BUILD_COMMIT file in the build context (how CI does it, since Railway
#     builds this Dockerfile itself from an uploaded directory and we cannot set
#     a build arg on its side).
ARG BUILD_COMMIT=""

RUN COMMIT="${BUILD_COMMIT}" \
 && if [ -z "$COMMIT" ] && [ -f BUILD_COMMIT ]; then COMMIT="$(cat BUILD_COMMIT)"; fi \
 && LDFLAGS="-X spotlight/backend/internal/platform/buildinfo.injectedCommit=${COMMIT}" \
 && go mod download \
 && go build -ldflags "$LDFLAGS" -o server ./cmd/server \
 # Marketplace worker binaries (built alongside the API from the SAME image so
 # "build once, deploy many" holds; compose selects which one to run via command).
 && go build -o marketplace-indexer ./cmd/marketplace-indexer \
 && go build -o marketplace-cron ./cmd/marketplace-cron \
 # Transport Trip Scheduling worker — built from the SAME image ("build once,
 # deploy many"); compose runs it via `command: ["/app/transport-scheduler"]`
 # behind the `transport-scheduling` profile and FEATURE_TRANSPORT_SCHEDULING_ENABLED.
 && go build -o transport-scheduler ./cmd/transport-scheduler

FROM alpine:3.20
WORKDIR /app
# curl is used by the compose healthchecks (ES) and is handy for indexer/cron probes.
RUN apk add --no-cache curl
COPY --from=build /app/server /app/server
COPY --from=build /app/marketplace-indexer /app/marketplace-indexer
COPY --from=build /app/marketplace-cron /app/marketplace-cron
COPY --from=build /app/transport-scheduler /app/transport-scheduler
# Run as a non-root user (trivy DS-0002). The binaries are world-readable and
# the service binds 8080, so no privileged port and nothing to chown — the
# process simply does not need root to execute a static Go binary.
RUN addgroup -S app && adduser -S -G app app
USER app
EXPOSE 8080
# GET /api/v1/public/health — deliberately unauthenticated (router.go), so the
# probe itself needs no credentials. curl is already installed above for this.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f "http://localhost:${APP_PORT:-8080}/api/v1/public/health" || exit 1
CMD ["/app/server"]

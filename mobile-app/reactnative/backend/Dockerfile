# syntax=docker/dockerfile:1

# ── Build stage ───────────────────────────────────────────────────────────────
# Pinned toolchain; stdlib-only module so the build is fully reproducible offline.
FROM golang:1.22-alpine AS build
WORKDIR /src

# Module cache layer (no external deps, but keeps caching correct if any are added).
COPY go.mod ./
RUN go mod download

COPY . .
# Static, stripped binary — no CGO, so it runs on a scratch/distroless base.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/crypto-service ./cmd/server

# ── Runtime stage ─────────────────────────────────────────────────────────────
# Distroless static + nonroot: no shell, no package manager, minimal CVE surface,
# runs as an unprivileged user. Pin to a digest in production.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /

COPY --from=build /out/crypto-service /crypto-service

# Readiness/liveness: HTTP GET /healthz (use an orchestrator probe — the image
# has no shell, so there is intentionally no Docker HEALTHCHECK here).
EXPOSE 8080
ENV PORT=8080
USER nonroot:nonroot

ENTRYPOINT ["/crypto-service"]

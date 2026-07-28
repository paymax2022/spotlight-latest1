# Multi-stage build for the deterministic fake-provider service (RAILS_MODE=fake).
# Stage 1: compile a static binary. Stage 2: minimal non-root runtime.

# ── build ─────────────────────────────────────────────────────────────────────
FROM golang:1.25-alpine AS build
WORKDIR /src

# go.mod first for layer caching. There are no external deps (stdlib only), so no
# go.sum / module download step is required.
COPY go.mod ./
COPY main.go ./

# CGO off → fully static binary that runs on a scratch/distroless base.
ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /out/fakes .

# ── runtime ───────────────────────────────────────────────────────────────────
FROM alpine:3.20
# Non-root user (defense-in-depth; this service never needs privileges).
RUN addgroup -S fakes && adduser -S -G fakes fakes
COPY --from=build /out/fakes /usr/local/bin/fakes

USER fakes
EXPOSE 9100
ENTRYPOINT ["/usr/local/bin/fakes"]

# Multi-stage build: compile Go backend binaries
FROM golang:1.25-alpine AS build
WORKDIR /app
COPY backend/ .
RUN go mod download \
 && go build -o server ./cmd/server \
 && go build -o marketplace-indexer ./cmd/marketplace-indexer \
 && go build -o marketplace-cron ./cmd/marketplace-cron \
 && go build -o transport-scheduler ./cmd/transport-scheduler

# Runtime: minimal Alpine image with compiled binaries
FROM alpine:3.20
WORKDIR /app
RUN apk add --no-cache curl ca-certificates
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
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s \
  CMD curl -f http://localhost:8080/api/v1/public/health || exit 1
CMD ["/app/server"]

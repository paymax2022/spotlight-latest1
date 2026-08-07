FROM golang:1.25-alpine AS build
WORKDIR /app
COPY . .
RUN go mod download \
 && go build -o server ./cmd/server \
 # Marketplace worker binaries (built alongside the API from the SAME image so
 # "build once, deploy many" holds; compose selects which one to run via command).
 && go build -o marketplace-indexer ./cmd/marketplace-indexer \
 && go build -o marketplace-cron ./cmd/marketplace-cron \
 # Transport Trip Scheduling worker — built from the SAME image ("build once,
 # deploy many"); compose runs it via `command: ["/app/transport-scheduler"]`
 # behind the `transport-scheduling` profile and FEATURE_TRANSPORT_SCHEDULING_ENABLED.
 && go build -o transport-scheduler ./cmd/transport-scheduler

FROM alpine:3.24
WORKDIR /app
# curl is used by the compose healthchecks (ES) and is handy for indexer/cron probes.
RUN apk add --no-cache curl
COPY --from=build /app/server /app/server
COPY --from=build /app/marketplace-indexer /app/marketplace-indexer
COPY --from=build /app/marketplace-cron /app/marketplace-cron
COPY --from=build /app/transport-scheduler /app/transport-scheduler
EXPOSE 8080
CMD ["/app/server"]

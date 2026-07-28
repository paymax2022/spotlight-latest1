# Observability Setup Guide — Paymax × Spotlight Super App

**Last updated:** 2026-06-23  
**Owner:** Platform Engineering  

---

## 1. What to Monitor

| Signal | Why it matters |
|--------|---------------|
| **Authz failures** | Spike → attempted privilege escalation or misconfigured RBAC |
| **Security event spikes** | Sudden increase in `suspicious_login` / `failed_auth` events → possible brute-force |
| **Wallet mutation errors** | Any error in the money path is P1+; must be caught within seconds |
| **Payment webhook failures** | Failed Paystack webhooks → money credited without payment, or payment lost |
| **KYC state transitions** | Unexpected `rejected → approved` transitions could indicate fraud |
| **API 5xx rate** | General system health; any sustained 5xx needs investigation |
| **DB connection pool** | Exhaustion causes cascading failures across all services |

---

## 2. Prometheus Metrics (Go)

Add `github.com/prometheus/client_golang` to the Go module:

```bash
cd backend
go get github.com/prometheus/client_golang/prometheus
go get github.com/prometheus/client_golang/prometheus/promhttp
```

### 2.1 Metric Definitions

Create `backend/internal/platform/metrics/metrics.go`:

```go
package metrics

import "github.com/prometheus/client_golang/prometheus"

var (
    // AuthzDeniedTotal counts RBAC permission denials.
    // Labels: route (e.g. "/api/v1/wallet/topup"), permission (e.g. "wallet:topup")
    AuthzDeniedTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "spotlight_authz_denied_total",
            Help: "Total number of RBAC authorisation denials.",
        },
        []string{"route", "permission"},
    )

    // SecurityEventsTotal counts entries written to the security_events table.
    // Labels: event_type (e.g. "suspicious_login", "failed_auth", "password_reset")
    SecurityEventsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "spotlight_security_events_total",
            Help: "Total number of security events emitted.",
        },
        []string{"event_type"},
    )

    // WalletMutationsTotal counts wallet mutation attempts (topup, debit, transfer).
    // Labels: status ("success" | "error" | "idempotency_replay")
    WalletMutationsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "spotlight_wallet_mutations_total",
            Help: "Total wallet mutation attempts.",
        },
        []string{"status"},
    )

    // PaymentWebhookTotal counts inbound Paystack webhook events.
    // Labels: event ("charge.success" | "transfer.success" | etc.), status ("ok" | "hmac_fail" | "duplicate" | "error")
    PaymentWebhookTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "spotlight_payment_webhook_total",
            Help: "Total inbound payment webhook events.",
        },
        []string{"event", "status"},
    )
)

// Register registers all custom metrics with the default Prometheus registry.
func Register() {
    prometheus.MustRegister(
        AuthzDeniedTotal,
        SecurityEventsTotal,
        WalletMutationsTotal,
        PaymentWebhookTotal,
    )
}
```

### 2.2 Wiring Metrics into Gin

In `backend/internal/app/router.go` (or wherever the Gin engine is initialised):

```go
import (
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "spotlight/backend/internal/platform/metrics"
)

func NewRouter() *gin.Engine {
    metrics.Register()

    r := gin.New()
    // Expose /metrics endpoint (restrict to internal network in production)
    r.GET("/metrics", gin.WrapH(promhttp.Handler()))
    // ... rest of routes
    return r
}
```

### 2.3 Instrumentation Examples

**RBAC middleware** (`backend/internal/middleware/authorization.go`):
```go
// After permission check fails:
metrics.AuthzDeniedTotal.WithLabelValues(c.FullPath(), requiredPermission).Inc()
```

**Wallet service** (`backend/internal/finance/wallet/service.go`):
```go
// On successful mutation:
metrics.WalletMutationsTotal.WithLabelValues("success").Inc()

// On error:
metrics.WalletMutationsTotal.WithLabelValues("error").Inc()

// On idempotency key replay:
metrics.WalletMutationsTotal.WithLabelValues("idempotency_replay").Inc()
```

**Security event emission** (wherever `security_events` rows are inserted):
```go
metrics.SecurityEventsTotal.WithLabelValues(eventType).Inc()
```

**Paystack webhook handler** (`frontend-web/app/api/webhooks/paystack/route.ts` — Next.js, not Go):
> For the Next.js webhook handler, emit metrics by posting to an internal Go `/internal/metrics/webhook` endpoint, or use a Next.js-compatible metrics library (e.g., `prom-client` npm package).

---

## 3. Alert Rules (PromQL)

Add these to your Prometheus `alert_rules.yml`:

```yaml
groups:
  - name: spotlight_authz
    rules:
      - alert: AuthzDenialRateHigh
        expr: |
          rate(spotlight_authz_denied_total[1m]) * 60 > 100
        for: 5m
        labels:
          severity: page
          team: platform
        annotations:
          summary: "Authz denial rate > 100/min for 5 minutes"
          description: "Route {{ $labels.route }} is generating excessive RBAC denials. Possible privilege escalation attempt."

  - name: spotlight_security
    rules:
      - alert: SecurityEventSpike
        expr: |
          rate(spotlight_security_events_total[1m]) * 60 > 10
        for: 2m
        labels:
          severity: alert
          team: security
        annotations:
          summary: "Security events > 10/min"
          description: "Event type {{ $labels.event_type }} is spiking. Possible attack in progress."

  - name: spotlight_wallet
    rules:
      - alert: WalletMutationErrorRateHigh
        expr: |
          rate(spotlight_wallet_mutations_total{status="error"}[5m])
            /
          rate(spotlight_wallet_mutations_total[5m]) > 0.05
        for: 3m
        labels:
          severity: page
          team: finance
        annotations:
          summary: "Wallet mutation error rate > 5%"
          description: "More than 5% of wallet mutations are failing. Immediate investigation required."

  - name: spotlight_payments
    rules:
      - alert: PaymentWebhookFailureRateHigh
        expr: |
          rate(spotlight_payment_webhook_total{status="error"}[5m])
            /
          rate(spotlight_payment_webhook_total[5m]) > 0.02
        for: 5m
        labels:
          severity: page
          team: finance
        annotations:
          summary: "Payment webhook failure rate > 2%"
          description: "Paystack webhooks are failing at > 2%. Risk of uncredited or double-credited payments."

      - alert: PaymentWebhookHmacFailures
        expr: |
          increase(spotlight_payment_webhook_total{status="hmac_fail"}[10m]) > 5
        labels:
          severity: alert
          team: security
        annotations:
          summary: "HMAC verification failures on payment webhooks"
          description: "Possible webhook spoofing attempt or misconfigured Paystack secret."
```

---

## 4. Grafana Dashboard (JSON Snippet)

Minimal dashboard JSON with four panels. Import via Grafana → Dashboards → Import → paste JSON:

```json
{
  "title": "Spotlight Super App — Core Signals",
  "uid": "spotlight-core",
  "schemaVersion": 39,
  "panels": [
    {
      "id": 1,
      "title": "Authz Denials / min",
      "type": "timeseries",
      "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 },
      "targets": [
        {
          "expr": "rate(spotlight_authz_denied_total[1m]) * 60",
          "legendFormat": "{{ route }} — {{ permission }}"
        }
      ]
    },
    {
      "id": 2,
      "title": "Security Events / min",
      "type": "timeseries",
      "gridPos": { "x": 12, "y": 0, "w": 12, "h": 8 },
      "targets": [
        {
          "expr": "rate(spotlight_security_events_total[1m]) * 60",
          "legendFormat": "{{ event_type }}"
        }
      ]
    },
    {
      "id": 3,
      "title": "Wallet Mutations — Success vs Error",
      "type": "timeseries",
      "gridPos": { "x": 0, "y": 8, "w": 12, "h": 8 },
      "targets": [
        {
          "expr": "rate(spotlight_wallet_mutations_total[1m]) * 60",
          "legendFormat": "{{ status }}"
        }
      ]
    },
    {
      "id": 4,
      "title": "Payment Webhooks — Status Breakdown",
      "type": "timeseries",
      "gridPos": { "x": 12, "y": 8, "w": 12, "h": 8 },
      "targets": [
        {
          "expr": "rate(spotlight_payment_webhook_total[1m]) * 60",
          "legendFormat": "{{ event }} / {{ status }}"
        }
      ]
    }
  ],
  "time": { "from": "now-3h", "to": "now" },
  "refresh": "30s"
}
```

---

## 5. Log-Based Alerts

The Go Gin backend logs JSON by default. Ensure all structured fields are present so log-based alerting can filter on them.

### 5.1 Required JSON Log Fields

Every log line emitted by the Go backend should include:

```json
{
  "time": "2026-06-23T10:00:00Z",
  "level": "error",
  "service": "spotlight-api",
  "route": "/api/v1/wallet/topup",
  "method": "POST",
  "status": 500,
  "user_id": "usr_xxx",
  "request_id": "req_xxx",
  "error": "ledger imbalance detected",
  "module": "wallet"
}
```

### 5.2 CloudWatch Logs Filter Patterns

If running on AWS, create metric filters in CloudWatch Logs:

```
# 5xx errors
{ $.status >= 500 }

# Wallet errors specifically
{ $.module = "wallet" && $.level = "error" }

# RBAC denials
{ $.level = "warn" && $.module = "rbac" && $.status = 403 }

# Security events
{ $.module = "security" && $.level = "warn" }

# Payment webhook failures
{ $.module = "webhook" && $.level = "error" }
```

### 5.3 GCP Cloud Logging Filters

```
# 5xx on money routes
resource.type="gce_instance"
jsonPayload.status>=500
jsonPayload.route=~"/api/v1/(wallet|transfers|finance).*"

# Security events spike
jsonPayload.module="security"
jsonPayload.level="warn"

# Webhook HMAC failures
jsonPayload.module="webhook"
jsonPayload.error=~".*hmac.*"
```

### 5.4 Alert Thresholds for Log-Based Alerts

| Metric | Threshold | Action |
|--------|-----------|--------|
| 5xx count on `/api/v1/wallet/*` | > 10 in 5 min | Page finance on-call |
| `hmac` in webhook error logs | > 3 in 10 min | Alert security on-call |
| `ledger imbalance` in logs | Any occurrence | Page finance on-call immediately (P0) |
| `connection pool` in error logs | > 5 in 5 min | Alert platform on-call |
| Auth `403` count | > 200 in 1 min | Alert security on-call |

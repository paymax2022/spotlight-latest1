// Package metrics exposes drop-in business metrics for the money path, emitted via
// OpenTelemetry to Cloud Monitoring (wired in internal/platform/observability).
//
// These are safe to call from anywhere: when no MeterProvider is configured (local
// dev), OTel's global no-op meter makes every call a cheap no-op. Instruments are
// created lazily and route to the real provider once observability.Init sets it
// (OTel's global meter delegates), so import order never matters.
//
// Recommended call sites (add where the money path already makes these decisions):
//   - RecordPaymentResult      → after a Paystack charge/verify resolves
//   - RecordMoneyMovement      → on wallet fund / transfer / payout completion
//   - RecordLedgerInvariantBreach → wherever a double-entry/balance check fails
//     (SLO target: 0 — alert immediately)
package metrics

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const meterName = "paymax-backend"

var (
	once          sync.Once
	paymentResult metric.Int64Counter
	moneyMovement metric.Int64Counter
	ledgerBreach  metric.Int64Counter
)

func instruments() {
	once.Do(func() {
		m := otel.Meter(meterName)
		paymentResult, _ = m.Int64Counter("paymax.payment.result",
			metric.WithDescription("Payment attempts by provider and result"))
		moneyMovement, _ = m.Int64Counter("paymax.money.movement",
			metric.WithDescription("Wallet/transfer/payout movements by type and result"))
		ledgerBreach, _ = m.Int64Counter("paymax.ledger.invariant_breach",
			metric.WithDescription("Ledger invariant breaches detected — SLO target is 0"))
	})
}

// RecordPaymentResult increments the payment counter; success=false marks failures.
func RecordPaymentResult(ctx context.Context, provider string, success bool) {
	instruments()
	result := "success"
	if !success {
		result = "failure"
	}
	paymentResult.Add(ctx, 1, metric.WithAttributes(
		attribute.String("provider", provider),
		attribute.String("result", result),
	))
}

// RecordMoneyMovement counts a money movement by type (e.g. "fund","transfer",
// "payout") and result (e.g. "completed","reversed","failed").
func RecordMoneyMovement(ctx context.Context, movementType, result string) {
	instruments()
	moneyMovement.Add(ctx, 1, metric.WithAttributes(
		attribute.String("type", movementType),
		attribute.String("result", result),
	))
}

// RecordLedgerInvariantBreach flags a double-entry/balance invariant violation.
// This must never fire in a healthy system — wire an alert on it.
func RecordLedgerInvariantBreach(ctx context.Context, kind string) {
	instruments()
	ledgerBreach.Add(ctx, 1, metric.WithAttributes(attribute.String("kind", kind)))
}

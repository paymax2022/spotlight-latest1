package orchestration

import "context"

// ProviderQuote is an adapter's raw priced offer for a corridor (provider-native
// rate, before Paymax spread). Money is already normalized to minor units.
type ProviderQuote struct {
	Provider    string
	Corridor    string
	Rail        Rail
	Rate        float64 // provider mid/all-in rate, units of dest per 1 unit of source
	ProviderFee Money   // fee charged by the provider (source currency)
	RailFee     Money   // network/rail fee (source currency)
	Reliability float64 // rolling reliability score in [0,1] (breaker/latency aware)
	Viable      bool    // false if provider can't settle this corridor/rail
}

// ExecuteResult is the outcome of executing a conversion/transfer via a provider.
type ExecuteResult struct {
	ProviderRef  string
	ExecutedRate float64
	Destination  Money
	Status       string // "settled" | "paid" | "processing" | "failed"
}

// CollectionResult is a provisioned inbound account.
type CollectionResult struct {
	ProviderRef string
	Details     map[string]interface{}
}

// Provider is the abstraction every FX/payment provider adapter implements
// (spec §10). Adapters map the normalized contract onto each provider's native
// API, normalize money/status, and verify webhooks.
type Provider interface {
	Name() string

	// Supports reports whether the provider can settle (corridor, rail).
	Supports(corridor string, rail Rail) bool

	// Quote returns a provider-native priced offer for the corridor/amount.
	Quote(ctx context.Context, source, dest string, amountMinor int64, amountType AmountType, rail Rail) (*ProviderQuote, error)

	// ExecuteConversion moves value between two held balances at the quoted rate.
	ExecuteConversion(ctx context.Context, q *Quote, idempotencyKey string) (*ExecuteResult, error)

	// ExecuteTransfer pays out to a beneficiary/rail (optionally with embedded FX).
	ExecuteTransfer(ctx context.Context, q *Quote, dest Destination, idempotencyKey string) (*ExecuteResult, error)

	// CreateCollection provisions an inbound virtual account / IBAN.
	CreateCollection(ctx context.Context, currency, accountType, customerID string) (*CollectionResult, error)

	// VerifyWebhookSignature validates an inbound provider webhook.
	VerifyWebhookSignature(payload []byte, signature string) bool
}

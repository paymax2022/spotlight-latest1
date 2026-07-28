// Package adapters provides concrete orchestration.Provider implementations.
//
// These adapters are deterministic (no external credentials required) so the
// orchestration layer is fully runnable in dev/test. In production each method
// maps onto the provider's real REST API; the public method set is unchanged.
package adapters

import (
	"context"
	"strings"

	"github.com/google/uuid"

	orch "spotlight/backend/internal/orchestration"
)

// Eversend favours wholesale FX and USD/EUR inbound (spec §3). Tighter spreads,
// strong East/pan-African MoMo & bank corridors, USD/EUR IBANs (ACH/SEPA).
type Eversend struct {
	prod      bool
	feeBPS    int
	reliability float64
}

// NewEversend builds the Eversend adapter.
func NewEversend(prod bool) *Eversend {
	return &Eversend{prod: prod, feeBPS: 25, reliability: 0.98}
}

func (e *Eversend) Name() string { return "eversend" }

var eversendCurrencies = map[string]bool{"USD": true, "EUR": true, "GBP": true, "NGN": true, "GHS": true, "KES": true, "USDC": true, "USDT": true}

func (e *Eversend) Supports(corridor string, rail orch.Rail) bool {
	parts := strings.SplitN(corridor, "-", 2)
	if len(parts) != 2 {
		return false
	}
	if !eversendCurrencies[parts[0]] || !eversendCurrencies[parts[1]] {
		return false
	}
	// Eversend does not issue NGN virtual accounts (Maplerad's strength).
	return true
}

func (e *Eversend) Quote(ctx context.Context, source, dest string, amountMinor int64, amountType orch.AmountType, rail orch.Rail) (*orch.ProviderQuote, error) {
	mid := orch.MidRate(source, dest)
	if mid == 0 {
		return &orch.ProviderQuote{Provider: e.Name(), Corridor: orch.Corridor(source, dest), Rail: rail, Viable: false}, nil
	}
	// Eversend's wholesale book gives a slightly better mid on FX corridors.
	rate := mid * 1.0008
	src := amountMinor
	if amountType == orch.AmountDestination {
		src = int64(float64(amountMinor) / rate)
	}
	var railFee int64
	if rail == orch.RailIBAN {
		railFee = 150
	}
	return &orch.ProviderQuote{
		Provider:    e.Name(),
		Corridor:    orch.Corridor(source, dest),
		Rail:        rail,
		Rate:        rate,
		ProviderFee: orch.NewMoney(int64(float64(src)*float64(e.feeBPS)/10_000.0), source),
		RailFee:     orch.NewMoney(railFee, source),
		Reliability: e.reliability,
		Viable:      e.Supports(orch.Corridor(source, dest), rail),
	}, nil
}

func (e *Eversend) ExecuteConversion(ctx context.Context, q *orch.Quote, idempotencyKey string) (*orch.ExecuteResult, error) {
	return &orch.ExecuteResult{
		ProviderRef:  "evs_" + uuid.New().String()[:10],
		ExecutedRate: q.AllInRate,
		Destination:  q.Destination,
		Status:       "settled",
	}, nil
}

func (e *Eversend) ExecuteTransfer(ctx context.Context, q *orch.Quote, dest orch.Destination, idempotencyKey string) (*orch.ExecuteResult, error) {
	return &orch.ExecuteResult{
		ProviderRef:  "evs_" + uuid.New().String()[:10],
		ExecutedRate: q.AllInRate,
		Destination:  q.Destination,
		Status:       "processing",
	}, nil
}

func (e *Eversend) CreateCollection(ctx context.Context, currency, accountType, customerID string) (*orch.CollectionResult, error) {
	details := map[string]interface{}{
		"account_name": "Paymax / Customer",
		"iban":         "GB29NWBK60161331926819",
		"bic":          "NWBKGB2L",
		"rails":        railsForCurrency(currency),
	}
	return &orch.CollectionResult{ProviderRef: "evs_col_" + uuid.New().String()[:8], Details: details}, nil
}

func (e *Eversend) VerifyWebhookSignature(payload []byte, signature string) bool {
	// Production: HMAC verify against the Eversend signing secret.
	return signature != ""
}

func railsForCurrency(currency string) []string {
	if strings.ToUpper(currency) == "EUR" {
		return []string{"SEPA"}
	}
	return []string{"ACH"}
}

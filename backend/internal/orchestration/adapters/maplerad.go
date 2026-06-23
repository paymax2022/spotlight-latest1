package adapters

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	orch "spotlight/backend/internal/orchestration"
)

// MapleradFX favours NGN, USD (FEDWIRE/ACH), Francophone mobile money (XAF),
// issuing and NGN virtual-account collections (spec §3).
type MapleradFX struct {
	prod        bool
	feeBPS      int
	reliability float64
}

// NewMapleradFX builds the Maplerad FX adapter.
func NewMapleradFX(prod bool) *MapleradFX {
	return &MapleradFX{prod: prod, feeBPS: 25, reliability: 0.97}
}

func (m *MapleradFX) Name() string { return "maplerad" }

var mapleradCurrencies = map[string]bool{"NGN": true, "USD": true, "XAF": true, "GHS": true, "EUR": true, "USDC": true, "USDT": true}

func (m *MapleradFX) Supports(corridor string, rail orch.Rail) bool {
	parts := strings.SplitN(corridor, "-", 2)
	if len(parts) != 2 {
		return false
	}
	return mapleradCurrencies[parts[0]] && mapleradCurrencies[parts[1]]
}

func (m *MapleradFX) Quote(ctx context.Context, source, dest string, amountMinor int64, amountType orch.AmountType, rail orch.Rail) (*orch.ProviderQuote, error) {
	mid := orch.MidRate(source, dest)
	if mid == 0 {
		return &orch.ProviderQuote{Provider: m.Name(), Corridor: orch.Corridor(source, dest), Rail: rail, Viable: false}, nil
	}
	// Maplerad is competitive on NGN/Francophone corridors; neutral elsewhere.
	rate := mid
	src := amountMinor
	if amountType == orch.AmountDestination {
		src = int64(float64(amountMinor) / rate)
	}
	var railFee int64
	if rail == orch.RailStablecoin {
		railFee = 50
	}
	return &orch.ProviderQuote{
		Provider:    m.Name(),
		Corridor:    orch.Corridor(source, dest),
		Rail:        rail,
		Rate:        rate,
		ProviderFee: orch.NewMoney(int64(float64(src)*float64(m.feeBPS)/10_000.0), source),
		RailFee:     orch.NewMoney(railFee, source),
		Reliability: m.reliability,
		Viable:      m.Supports(orch.Corridor(source, dest), rail),
	}, nil
}

func (m *MapleradFX) ExecuteConversion(ctx context.Context, q *orch.Quote, idempotencyKey string) (*orch.ExecuteResult, error) {
	return &orch.ExecuteResult{
		ProviderRef:  "mpl_" + uuid.New().String()[:10],
		ExecutedRate: q.AllInRate,
		Destination:  q.Destination,
		Status:       "settled",
	}, nil
}

func (m *MapleradFX) ExecuteTransfer(ctx context.Context, q *orch.Quote, dest orch.Destination, idempotencyKey string) (*orch.ExecuteResult, error) {
	return &orch.ExecuteResult{
		ProviderRef:  "mpl_" + uuid.New().String()[:10],
		ExecutedRate: q.AllInRate,
		Destination:  q.Destination,
		Status:       "processing",
	}, nil
}

func (m *MapleradFX) CreateCollection(ctx context.Context, currency, accountType, customerID string) (*orch.CollectionResult, error) {
	details := map[string]interface{}{
		"account_name":   "Paymax / Customer",
		"account_number": fmt.Sprintf("99%08d", uuid.New().ID()%100000000),
		"bank_name":      "Providus Bank",
	}
	return &orch.CollectionResult{ProviderRef: "mpl_col_" + uuid.New().String()[:8], Details: details}, nil
}

func (m *MapleradFX) VerifyWebhookSignature(payload []byte, signature string) bool {
	return signature != ""
}

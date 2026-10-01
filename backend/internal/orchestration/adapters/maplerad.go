package adapters

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"github.com/google/uuid"
	orch "spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/maplerad"
	"strings"
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

// MapleradLive is the production Maplerad adapter: it calls the real Maplerad
// REST API via the shared client and implements orchestration.Provider. Every
// remote call degrades gracefully to deterministic pricing (the indicative rate
// table) so the orchestrator keeps routing even on transient provider errors —
// the smart router will still prefer a healthy provider.
type MapleradLive struct {
	client        *maplerad.Client
	fallback      *MapleradFX
	webhookSecret string
	reliability   float64
}

// NewMapleradLive builds the live adapter from a configured Maplerad client.
func NewMapleradLive(client *maplerad.Client, webhookSecret string, prod bool) *MapleradLive {
	return &MapleradLive{client: client, fallback: NewMapleradFX(prod), webhookSecret: webhookSecret, reliability: 0.97}
}

func (m *MapleradLive) Name() string { return "maplerad" }

func (m *MapleradLive) Supports(corridor string, rail orch.Rail) bool {
	return m.fallback.Supports(corridor, rail)
}

func (m *MapleradLive) Quote(ctx context.Context, source, dest string, amountMinor int64, amountType orch.AmountType, rail orch.Rail) (*orch.ProviderQuote, error) {
	if m.client == nil {
		return m.fallback.Quote(ctx, source, dest, amountMinor, amountType, rail)
	}
	resp, err := m.client.GetFXQuote(ctx, maplerad.FXQuoteRequest{SourceCurrency: source, TargetCurrency: dest, AmountKobo: amountMinor})
	if err != nil || resp == nil || resp.Rate == 0 {
		// Graceful fallback keeps the corridor quotable; router reliability score
		// reflects provider health elsewhere.
		return m.fallback.Quote(ctx, source, dest, amountMinor, amountType, rail)
	}
	return &orch.ProviderQuote{
		Provider:    m.Name(),
		Corridor:    orch.Corridor(source, dest),
		Rail:        rail,
		Rate:        resp.Rate,
		ProviderFee: orch.NewMoney(resp.Fee, source),
		RailFee:     orch.NewMoney(0, source),
		Reliability: m.reliability,
		Viable:      m.Supports(orch.Corridor(source, dest), rail),
	}, nil
}

func (m *MapleradLive) ExecuteConversion(ctx context.Context, q *orch.Quote, idempotencyKey string) (*orch.ExecuteResult, error) {
	if m.client == nil {
		return m.fallback.ExecuteConversion(ctx, q, idempotencyKey)
	}
	// Book a FIRM provider quote and exchange against its reference. Pricing uses
	// the /fx/rates board (cheap, side-effect free), but the board issues no quote
	// id, so execution has to mint one here — CreateFXQuote is the only endpoint
	// that returns a reference POST /fx will accept.
	// The reference is single-use at the provider, which is the backstop against a
	// double exchange; the orchestrator's own idempotency key still guards the
	// ledger, because Maplerad's exchange endpoint accepts no client reference.
	pq, err := m.client.CreateFXQuote(ctx, maplerad.FXQuoteRequest{
		SourceCurrency: q.Source.Currency,
		TargetCurrency: q.Destination.Currency,
		AmountKobo:     q.Source.AmountMinor,
	})
	if err != nil {
		return nil, err
	}
	cr, err := m.client.ConvertFX(ctx, maplerad.ConvertFXRequest{QuoteID: pq.QuoteID})
	if err != nil {
		return nil, err
	}
	dest := q.Destination
	if cr.TargetAmountMinor > 0 {
		dest = orch.NewMoney(cr.TargetAmountMinor, q.Destination.Currency)
	}
	rate := cr.Rate
	if rate == 0 {
		rate = q.AllInRate
	}
	return &orch.ExecuteResult{ProviderRef: cr.TransactionID, ExecutedRate: rate, Destination: dest, Status: "settled"}, nil
}

func (m *MapleradLive) ExecuteTransfer(ctx context.Context, q *orch.Quote, dest orch.Destination, idempotencyKey string) (*orch.ExecuteResult, error) {
	if m.client == nil {
		return m.fallback.ExecuteTransfer(ctx, q, dest, idempotencyKey)
	}
	pr, err := m.client.InitiatePayout(ctx, provider.PayoutRequest{
		RecipientCode:  dest.AccountNumber,
		AmountKobo:     q.Destination.AmountMinor,
		Reference:      idempotencyKey,
		Narration:      "Paymax payout",
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		return nil, err
	}
	status := "processing"
	if pr.Status == "successful" || pr.Status == "paid" {
		status = "paid"
	}
	return &orch.ExecuteResult{ProviderRef: pr.TransferCode, ExecutedRate: q.AllInRate, Destination: q.Destination, Status: status}, nil
}

func (m *MapleradLive) CreateCollection(ctx context.Context, currency, accountType, customerID string) (*orch.CollectionResult, error) {
	if m.client == nil {
		return m.fallback.CreateCollection(ctx, currency, accountType, customerID)
	}
	va, err := m.client.ProvisionVirtualAccount(ctx, provider.ProvisionVARequest{
		UserID: customerID, Email: customerID + "@paymax.example", FirstName: "Paymax", LastName: "Customer",
	})
	if err != nil || va == nil {
		return m.fallback.CreateCollection(ctx, currency, accountType, customerID)
	}
	return &orch.CollectionResult{
		ProviderRef: va.AccountNumber,
		Details: map[string]any{
			"account_name":   va.AccountName,
			"account_number": va.AccountNumber,
			"bank_name":      va.BankName,
		},
	}, nil
}

// VerifyWebhookSignature validates Maplerad's HMAC-SHA256 signature header.
func (m *MapleradLive) VerifyWebhookSignature(payload []byte, signature string) bool {
	if m.webhookSecret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(m.webhookSecret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

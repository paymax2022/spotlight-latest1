package adapters

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"

	orch "spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/maplerad"
)

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
	// Re-quote at execution and convert against the provider quote id (within our
	// already-locked tolerance), then normalize the result.
	pq, err := m.client.GetFXQuote(ctx, maplerad.FXQuoteRequest{SourceCurrency: q.Source.Currency, TargetCurrency: q.Destination.Currency, AmountKobo: q.Source.AmountMinor})
	if err != nil {
		return nil, err
	}
	cr, err := m.client.ConvertFX(ctx, maplerad.ConvertFXRequest{
		QuoteID: pq.QuoteID, SourceCurrency: q.Source.Currency, TargetCurrency: q.Destination.Currency,
		AmountKobo: q.Source.AmountMinor, Reference: idempotencyKey,
	})
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
		Details: map[string]interface{}{
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

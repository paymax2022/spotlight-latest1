package adapters

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"math"

	orch "spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/provider/eversend"
)

// EversendLive is the production Eversend adapter. Eversend works in MAJOR units;
// this adapter converts to/from the orchestration minor-unit convention. Every
// remote call degrades gracefully to deterministic pricing on error.
type EversendLive struct {
	client        *eversend.Client
	fallback      *Eversend
	webhookSecret string
	reliability   float64
}

// NewEversendLive builds the live adapter from a configured Eversend client.
func NewEversendLive(client *eversend.Client, webhookSecret string, prod bool) *EversendLive {
	return &EversendLive{client: client, fallback: NewEversend(prod), webhookSecret: webhookSecret, reliability: 0.98}
}

func (e *EversendLive) Name() string { return "eversend" }

func (e *EversendLive) Supports(corridor string, rail orch.Rail) bool {
	return e.fallback.Supports(corridor, rail)
}

func minorToMajor(m int64) float64 { return float64(m) / 100.0 }
func majorToMinor(f float64) int64 { return int64(math.Round(f * 100.0)) }

func (e *EversendLive) Quote(ctx context.Context, source, dest string, amountMinor int64, amountType orch.AmountType, rail orch.Rail) (*orch.ProviderQuote, error) {
	if e.client == nil {
		return e.fallback.Quote(ctx, source, dest, amountMinor, amountType, rail)
	}
	q, err := e.client.CreateQuotation(ctx, source, dest, minorToMajor(amountMinor))
	if err != nil || q == nil || q.Rate == 0 {
		return e.fallback.Quote(ctx, source, dest, amountMinor, amountType, rail)
	}
	var railFee int64
	if rail == orch.RailIBAN {
		railFee = 150
	}
	return &orch.ProviderQuote{
		Provider:    e.Name(),
		Corridor:    orch.Corridor(source, dest),
		Rail:        rail,
		Rate:        q.Rate,
		ProviderFee: orch.NewMoney(majorToMinor(q.Fee), source),
		RailFee:     orch.NewMoney(railFee, source),
		Reliability: e.reliability,
		Viable:      e.Supports(orch.Corridor(source, dest), rail),
	}, nil
}

func (e *EversendLive) ExecuteConversion(ctx context.Context, q *orch.Quote, idempotencyKey string) (*orch.ExecuteResult, error) {
	if e.client == nil {
		return e.fallback.ExecuteConversion(ctx, q, idempotencyKey)
	}
	quote, err := e.client.CreateQuotation(ctx, q.Source.Currency, q.Destination.Currency, minorToMajor(q.Source.AmountMinor))
	if err != nil {
		return nil, err
	}
	res, err := e.client.Exchange(ctx, quote.Token)
	if err != nil {
		return nil, err
	}
	dest := q.Destination
	if res.ToAmount > 0 {
		dest = orch.NewMoney(majorToMinor(res.ToAmount), q.Destination.Currency)
	}
	rate := res.Rate
	if rate == 0 {
		rate = q.AllInRate
	}
	return &orch.ExecuteResult{ProviderRef: res.TransactionID, ExecutedRate: rate, Destination: dest, Status: "settled"}, nil
}

func (e *EversendLive) ExecuteTransfer(ctx context.Context, q *orch.Quote, dest orch.Destination, idempotencyKey string) (*orch.ExecuteResult, error) {
	if e.client == nil {
		return e.fallback.ExecuteTransfer(ctx, q, dest, idempotencyKey)
	}
	res, err := e.client.Payout(ctx, dest.Currency, dest.AccountNumber, dest.Counterparty.Name, minorToMajor(q.Destination.AmountMinor), idempotencyKey)
	if err != nil {
		return nil, err
	}
	status := "processing"
	if res.Status == "successful" || res.Status == "paid" || res.Status == "completed" {
		status = "paid"
	}
	return &orch.ExecuteResult{ProviderRef: res.TransactionID, ExecutedRate: q.AllInRate, Destination: q.Destination, Status: status}, nil
}

func (e *EversendLive) CreateCollection(ctx context.Context, currency, accountType, customerID string) (*orch.CollectionResult, error) {
	if e.client == nil || accountType != "iban" {
		return e.fallback.CreateCollection(ctx, currency, accountType, customerID)
	}
	iban, err := e.client.CreateIBAN(ctx, currency)
	if err != nil || iban == nil {
		return e.fallback.CreateCollection(ctx, currency, accountType, customerID)
	}
	return &orch.CollectionResult{
		ProviderRef: iban.IBAN,
		Details: map[string]interface{}{
			"account_name": iban.AccountName,
			"iban":         iban.IBAN,
			"bic":          iban.BIC,
			"rails":        iban.Rails,
		},
	}, nil
}

// VerifyWebhookSignature validates Eversend's HMAC-SHA256 signature header.
func (e *EversendLive) VerifyWebhookSignature(payload []byte, signature string) bool {
	if e.webhookSecret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(e.webhookSecret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

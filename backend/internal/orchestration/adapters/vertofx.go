package adapters

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/google/uuid"

	orch "spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/provider/vertofx"
)

// vertoFeeBPS is Spotlight's markup on Verto trades, in basis points. It is both
// the provider fee shown on quotes and the fxMarkup.markupPerc sent on trades.
const vertoFeeBPS int64 = 20

// vertoCurrencies is the Verto/Atlas set (spec §19.4): virtual-account
// currencies, auto-created wallets, and Inline-FX-only currencies. The exact
// per-rail list is config pulled from Verto; this is the safe superset gate.
var vertoCurrencies = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "AUD": true, "NGN": true,
	"KES": true, "TZS": true, "AED": true, "XOF": true, "XAF": true,
	"GHS": true, "RWF": true, "ZAR": true, "DKK": true, "UGX": true,
	"INR": true, "EGP": true, "ETB": true, "BDT": true, "PKR": true, "IDR": true,
}

func vertoSupports(corridor string) bool {
	parts := strings.SplitN(strings.ToUpper(corridor), "-", 2)
	return len(parts) == 2 && vertoCurrencies[parts[0]] && vertoCurrencies[parts[1]]
}

func pow10(n int) *big.Int { return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil) }

// vertoMinorToMajor converts orchestration minor units to Verto's integer major
// units. Verto's client takes whole major units, so a fractional-major amount
// cannot be represented: it is rejected (fail closed) rather than truncated.
func vertoMinorToMajor(minor int64, currency string) (int64, error) {
	div := pow10(orch.MinorExponent(currency)).Int64()
	if minor < 0 || minor%div != 0 {
		return 0, fmt.Errorf("vertofx: %d minor %s is not a whole number of major units", minor, currency)
	}
	return minor / div, nil
}

// vertoMajorToMinor is the exact inverse of vertoMinorToMajor.
func vertoMajorToMinor(major int64, currency string) int64 {
	return major * pow10(orch.MinorExponent(currency)).Int64()
}

func bigToInt64(n *big.Int) (int64, error) {
	if !n.IsInt64() {
		return 0, errors.New("vertofx: amount overflow")
	}
	return n.Int64(), nil
}

// convertFloor converts srcMinor at ratePPM (dest per 1 source, x1e6) to dest
// minor units, rounding DOWN (customer-receives never over-credits). Integer
// math only, via big.Int so large amounts cannot overflow mid-computation.
func convertFloor(srcMinor, ratePPM int64, srcExp, dstExp int) (int64, error) {
	num := new(big.Int).Mul(big.NewInt(srcMinor), big.NewInt(ratePPM))
	num.Mul(num, pow10(dstExp))
	den := new(big.Int).Mul(big.NewInt(1_000_000), pow10(srcExp))
	return bigToInt64(num.Quo(num, den))
}

// convertCeilSource returns the source minor units needed so that
// convertFloor(source) >= dstMinor (destination-amount quotes round UP).
func convertCeilSource(dstMinor, ratePPM int64, srcExp, dstExp int) (int64, error) {
	if ratePPM <= 0 {
		return 0, errors.New("vertofx: non-positive rate")
	}
	num := new(big.Int).Mul(big.NewInt(dstMinor), big.NewInt(1_000_000))
	num.Mul(num, pow10(srcExp))
	den := new(big.Int).Mul(big.NewInt(ratePPM), pow10(dstExp))
	q, r := new(big.Int).QuoRem(num, den, new(big.Int))
	if r.Sign() > 0 {
		q.Add(q, big.NewInt(1))
	}
	return bigToInt64(q)
}

func feeCeil(amountMinor int64) int64 {
	return (amountMinor*vertoFeeBPS + 9_999) / 10_000
}

// VertoFX is the deterministic Verto adapter (no credentials needed).
type VertoFX struct {
	prod        bool
	reliability float64
}

// NewVertoFX builds the deterministic adapter.
func NewVertoFX(prod bool) *VertoFX { return &VertoFX{prod: prod, reliability: 0.97} }

func (v *VertoFX) Name() string { return "vertofx" }

func (v *VertoFX) Supports(corridor string, rail orch.Rail) bool { return vertoSupports(corridor) }

func (v *VertoFX) Quote(ctx context.Context, source, dest string, amountMinor int64, amountType orch.AmountType, rail orch.Rail) (*orch.ProviderQuote, error) {
	corridor := orch.Corridor(source, dest)
	mid := orch.MidRate(source, dest)
	if mid == 0 || !v.Supports(corridor, rail) {
		return &orch.ProviderQuote{Provider: v.Name(), Corridor: corridor, Rail: rail, Viable: false}, nil
	}
	src := amountMinor
	if amountType == orch.AmountDestination {
		src = int64(float64(amountMinor) / mid)
	}
	return &orch.ProviderQuote{
		Provider:    v.Name(),
		Corridor:    corridor,
		Rail:        rail,
		Rate:        mid,
		ProviderFee: orch.NewMoney(feeCeil(src), source),
		RailFee:     orch.NewMoney(0, source),
		Reliability: v.reliability,
		Viable:      true,
	}, nil
}

func (v *VertoFX) ExecuteConversion(ctx context.Context, q *orch.Quote, idempotencyKey string) (*orch.ExecuteResult, error) {
	return &orch.ExecuteResult{ProviderRef: "vfx_" + uuid.New().String()[:10], ExecutedRate: q.AllInRate, Destination: q.Destination, Status: "settled"}, nil
}

func (v *VertoFX) ExecuteTransfer(ctx context.Context, q *orch.Quote, dest orch.Destination, idempotencyKey string) (*orch.ExecuteResult, error) {
	return &orch.ExecuteResult{ProviderRef: "vfx_" + uuid.New().String()[:10], ExecutedRate: q.AllInRate, Destination: q.Destination, Status: "processing"}, nil
}

func (v *VertoFX) CreateCollection(ctx context.Context, currency, accountType, customerID string) (*orch.CollectionResult, error) {
	return &orch.CollectionResult{
		ProviderRef: "vfx_col_" + uuid.New().String()[:8],
		Details: map[string]any{
			"account_name": "Paymax / Customer",
			"currency":     strings.ToUpper(currency),
		},
	}, nil
}

// VerifyWebhookSignature fails closed: the deterministic adapter has no secret.
func (v *VertoFX) VerifyWebhookSignature(payload []byte, signature string) bool { return false }

// VertoFXLive is the production adapter over the VertoFX client. Verto works in
// whole major units; this adapter converts at the boundary and degrades to the
// deterministic VertoFX for pricing when the client is absent or errors.
type VertoFXLive struct {
	client        *vertofx.Client
	fallback      *VertoFX
	webhookSecret string
	reliability   float64
}

// NewVertoFXLive builds the live adapter from a configured client.
func NewVertoFXLive(client *vertofx.Client, webhookSecret string, prod bool) *VertoFXLive {
	return &VertoFXLive{client: client, fallback: NewVertoFX(prod), webhookSecret: webhookSecret, reliability: 0.97}
}

func (v *VertoFXLive) Name() string { return "vertofx" }

func (v *VertoFXLive) Supports(corridor string, rail orch.Rail) bool {
	return v.fallback.Supports(corridor, rail)
}

func (v *VertoFXLive) Quote(ctx context.Context, source, dest string, amountMinor int64, amountType orch.AmountType, rail orch.Rail) (*orch.ProviderQuote, error) {
	if v.client == nil {
		return v.fallback.Quote(ctx, source, dest, amountMinor, amountType, rail)
	}
	corridor := orch.Corridor(source, dest)
	srcExp, dstExp := orch.MinorExponent(source), orch.MinorExponent(dest)

	// The rate lookup is indicative; Verto takes whole major units, so floor.
	lookup := amountMinor
	lookupCur := source
	if amountType == orch.AmountDestination {
		lookupCur = dest
	}
	rateAmount := lookup / pow10(orch.MinorExponent(lookupCur)).Int64()
	rate, err := v.client.GetFXRate(ctx, strings.ToUpper(source), strings.ToUpper(dest), rateAmount)
	if err != nil || rate.RatePPM <= 0 {
		return v.fallback.Quote(ctx, source, dest, amountMinor, amountType, rail)
	}

	src := amountMinor
	if amountType == orch.AmountDestination {
		if src, err = convertCeilSource(amountMinor, rate.RatePPM, srcExp, dstExp); err != nil {
			return nil, err
		}
	}
	received, err := convertFloor(src, rate.RatePPM, srcExp, dstExp)
	if err != nil {
		return nil, err
	}
	return &orch.ProviderQuote{
		Provider:    v.Name(),
		Corridor:    corridor,
		Rail:        rail,
		Rate:        float64(rate.RatePPM) / 1_000_000.0, // display only; amounts use integer PPM math
		ProviderFee: orch.NewMoney(feeCeil(src), source),
		RailFee:     orch.NewMoney(0, source),
		Reliability: v.reliability,
		// A sub-unit rate that floors the customer's receipt to zero is not a quote.
		Viable: v.Supports(corridor, rail) && received > 0,
	}, nil
}

func (v *VertoFXLive) trade(ctx context.Context, q *orch.Quote, targetAccount, paymentType, idempotencyKey string) (*orch.ExecuteResult, error) {
	if idempotencyKey == "" {
		return nil, errors.New("vertofx: idempotency key required")
	}
	srcMajor, err := vertoMinorToMajor(q.Source.AmountMinor, q.Source.Currency)
	if err != nil {
		return nil, err
	}
	rate, err := v.client.GetFXRate(ctx, q.Source.Currency, q.Destination.Currency, srcMajor)
	if err != nil {
		return nil, err
	}
	tr, err := v.client.CreateFXTrade(ctx, vertofx.TradeInput{
		PaymentID:       idempotencyKey,
		PaymentType:     paymentType,
		SourceAmount:    srcMajor,
		VfxToken:        rate.VfxToken,
		TargetAccountID: targetAccount,
		FXMarkup:        vertofx.FXMarkup{MarkupType: "percentage", MarkupPerc: vertoFeeBPS},
	})
	if err != nil {
		return nil, err
	}
	dest := q.Destination
	if got, cerr := convertFloor(q.Source.AmountMinor, rate.RatePPM, orch.MinorExponent(q.Source.Currency), orch.MinorExponent(q.Destination.Currency)); cerr == nil && got > 0 {
		dest = orch.NewMoney(got, q.Destination.Currency)
	}
	executed := q.AllInRate
	if rate.RatePPM > 0 {
		executed = float64(rate.RatePPM) / 1_000_000.0
	}
	return &orch.ExecuteResult{ProviderRef: tr.ID, ExecutedRate: executed, Destination: dest, Status: vertoStatus(tr.Status)}, nil
}

func vertoStatus(s string) string {
	switch strings.ToLower(s) {
	case "completed", "successful", "settled", "paid":
		return "settled"
	case "failed", "rejected", "cancelled":
		return "failed"
	default:
		return "processing"
	}
}

func (v *VertoFXLive) ExecuteConversion(ctx context.Context, q *orch.Quote, idempotencyKey string) (*orch.ExecuteResult, error) {
	if v.client == nil {
		return v.fallback.ExecuteConversion(ctx, q, idempotencyKey)
	}
	return v.trade(ctx, q, "", "convertWalletPayout", idempotencyKey)
}

func (v *VertoFXLive) ExecuteTransfer(ctx context.Context, q *orch.Quote, dest orch.Destination, idempotencyKey string) (*orch.ExecuteResult, error) {
	if v.client == nil {
		return v.fallback.ExecuteTransfer(ctx, q, dest, idempotencyKey)
	}
	return v.trade(ctx, q, dest.AccountNumber, "payout", idempotencyKey)
}

func (v *VertoFXLive) CreateCollection(ctx context.Context, currency, accountType, customerID string) (*orch.CollectionResult, error) {
	if v.client == nil {
		return v.fallback.CreateCollection(ctx, currency, accountType, customerID)
	}
	f, err := v.client.CreateFundingDetails(ctx, "", strings.ToUpper(currency))
	if err != nil {
		return v.fallback.CreateCollection(ctx, currency, accountType, customerID)
	}
	return &orch.CollectionResult{
		ProviderRef: f.Reference,
		Details: map[string]any{
			"account_name":   f.AccountName,
			"account_number": f.AccountNumber,
			"bank_name":      f.BankName,
			"bank_code":      f.BankCode,
			"currency":       strings.ToUpper(currency),
		},
	}, nil
}

// VerifyWebhookSignature delegates to the client's HMAC-SHA256 check; no client
// means no secret, so it fails closed.
func (v *VertoFXLive) VerifyWebhookSignature(payload []byte, signature string) bool {
	if v.client == nil {
		return false
	}
	return v.client.VerifyWebhookSignature(payload, signature)
}

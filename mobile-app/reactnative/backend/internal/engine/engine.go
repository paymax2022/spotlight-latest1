// Package engine holds the pricing/fee math and id helpers. The quote builders
// are ported 1:1 from the mobile cryptoFormatters so the client's live preview
// and the server's executed numbers always agree (Rule 2: execute against a
// server quote, never an assumed price).
package engine

import (
	"fmt"
	"math"
	"strconv"
	"sync/atomic"
	"time"

	"paymax/crypto-backend/internal/domain"
)

// ── Fee / spread config (server-authoritative; never sent by the client) ─────

const (
	PaymaxFeeBps   = 90 // 0.90%
	ProviderFeeBps = 20 // 0.20%
	SwapSpreadBps  = 80 // 0.80%
	SwapFeeBps     = 30 // 0.30%

	QuoteExpirySeconds = 60
)

// SpreadBps returns the buy/sell spread for a risk rating, in basis points.
func SpreadBps(risk string) int64 {
	switch risk {
	case "low":
		return 50
	case "high":
		return 140
	default:
		return 90 // medium
	}
}

func riskScore(risk string) int {
	switch risk {
	case "high":
		return 64
	case "low":
		return 18
	default:
		return 38
	}
}

// ── Time + id helpers ─────────────────────────────────────────────────────────

var seq uint64

// Now returns an RFC3339 UTC timestamp (parses cleanly as a JS Date).
func Now() string { return time.Now().UTC().Format(time.RFC3339) }

// Expiry returns an ISO timestamp `seconds` in the future.
func Expiry(seconds int) string {
	return time.Now().Add(time.Duration(seconds) * time.Second).UTC().Format(time.RFC3339)
}

// NewID returns a unique, prefixed id (e.g. "cq_1f3a").
func NewID(prefix string) string {
	n := atomic.AddUint64(&seq, 1)
	return fmt.Sprintf("%s_%s", prefix, strconv.FormatInt(time.Now().UnixNano()+int64(n), 36))
}

// NewRef returns a short user-facing reference (e.g. "PMX-CR-481920").
func NewRef(prefix string) string {
	n := time.Now().UnixNano()
	return fmt.Sprintf("%s-%06d", prefix, n%1_000_000)
}

func round(f float64) int64 { return int64(math.Round(f)) }

func charSum(s string) int {
	sum := 0
	for _, c := range s {
		sum += int(c)
	}
	return sum
}

// ── Eligibility gate ──────────────────────────────────────────────────────────

// EvaluateEligibility maps a user's compliance facts to a trading-gate decision.
// It is the single source of truth for the gate (Rule 2: server-authoritative)
// and is FAIL-CLOSED: every requirement must be affirmatively satisfied or the
// user is blocked with a stable machine-readable reason + a CTA route the client
// can deep-link to. The order of checks mirrors the onboarding funnel so the user
// is always sent to the earliest unmet step.
func EvaluateEligibility(f domain.EligibilityFacts) domain.Eligibility {
	base := domain.Eligibility{KycTier: f.KycTier, CryptoEnabled: f.CryptoEnabled}

	switch {
	case !f.UserActive:
		base.State = "restricted"
		base.Reason = "user_inactive"
		base.Message = "Your account is not active. Contact support to continue."
		base.CtaRoute = "/support"
	case f.KycTier < domain.MinCryptoKycTier:
		base.State = "kyc_required"
		base.Reason = "kyc_required"
		base.Message = "Complete identity verification (KYC) to trade crypto."
		base.CtaRoute = "/invest-onboarding/kyc"
	case f.SuitabilityExpired:
		base.State = "restricted"
		base.Reason = "suitability_expired"
		base.Message = "Your suitability assessment has expired. Please retake it."
		base.CtaRoute = "/invest-onboarding/suitability"
	case !f.SuitabilityComplete:
		base.State = "restricted"
		base.Reason = "suitability_required"
		base.Message = "Complete the suitability questionnaire to trade crypto."
		base.CtaRoute = "/invest-onboarding/suitability"
	case !f.AgreementsAccepted:
		base.State = "restricted"
		base.Reason = "agreements_required"
		base.Message = "Review and accept the required agreements to continue."
		base.CtaRoute = "/invest-onboarding/agreements"
	case !f.CryptoEnabled:
		base.State = "product_unavailable"
		base.Reason = "crypto_disabled"
		base.Message = "Crypto trading is not available on your account yet."
		base.CtaRoute = "/support"
	default:
		base.State = "eligible"
		base.Message = "You're verified and cleared to trade crypto."
	}
	return base
}

// ── Buy / sell quote ──────────────────────────────────────────────────────────

// BuildQuote builds a buy/sell quote. Buys cost a touch more, sells pay a touch
// less; every fee is itemised in settlement fiat.
func BuildQuote(a domain.Asset, side, basis string, amount int64, currency string, lock bool) domain.Quote {
	unit := math.Pow(10, float64(a.Decimals))
	unitPrice := float64(a.Price.Amount)
	spreadBps := SpreadBps(a.RiskRating)

	spreadFactor := 1.0
	if side == "buy" {
		spreadFactor = 1 + float64(spreadBps)/10_000
	} else {
		spreadFactor = 1 - float64(spreadBps)/10_000
	}
	allInUnit := round(unitPrice * spreadFactor)

	var cryptoMinor, tradeFiat int64
	if basis == "fiat" {
		cryptoMinor = round((float64(amount) / float64(allInUnit)) * unit)
		tradeFiat = round((float64(cryptoMinor) / unit) * float64(allInUnit))
	} else {
		cryptoMinor = amount
		tradeFiat = round((float64(amount) / unit) * float64(allInUnit))
	}

	paymaxFee := round(float64(tradeFiat) * PaymaxFeeBps / 10_000)
	providerFee := round(float64(tradeFiat) * ProviderFeeBps / 10_000)
	spreadFiat := round(float64(tradeFiat) * float64(spreadBps) / 10_000)

	fees := []domain.Fee{
		{Type: "spread", Amount: domain.Money{Amount: spreadFiat, Currency: currency}},
		{Type: "paymax_fee", Amount: domain.Money{Amount: paymaxFee, Currency: currency}},
		{Type: "provider_fee", Amount: domain.Money{Amount: providerFee, Currency: currency}},
	}
	feeSum := paymaxFee + providerFee

	var totalFiat int64
	if side == "buy" {
		totalFiat = tradeFiat + feeSum
	} else {
		totalFiat = max(int64(0), tradeFiat-feeSum)
	}

	status := "quoted"
	if lock {
		status = "locked"
	}

	return domain.Quote{
		ID:                NewID("cq"),
		AssetID:           a.ID,
		Symbol:            a.Symbol,
		Side:              side,
		Status:            status,
		Basis:             basis,
		Fiat:              domain.Money{Amount: tradeFiat, Currency: currency},
		Crypto:            domain.CryptoAmount{Amount: cryptoMinor, Symbol: a.Symbol},
		Rate:              domain.Money{Amount: a.Price.Amount, Currency: currency},
		AllInRate:         domain.Money{Amount: allInUnit, Currency: currency},
		SpreadPct:         float64(spreadBps) / 100,
		Fees:              fees,
		TotalFiat:         domain.Money{Amount: totalFiat, Currency: currency},
		LiquidityProvider: "mock-liquidity",
		CustodyProvider:   "mock-custody",
		RiskScore:         riskScore(a.RiskRating),
		ExpiresAt:         Expiry(QuoteExpirySeconds),
	}
}

// ── Swap quote ────────────────────────────────────────────────────────────────

// BuildSwapQuote prices a crypto-to-crypto swap via fiat triangulation.
func BuildSwapQuote(from, to domain.Asset, fromAmount int64) domain.SwapQuote {
	fromUnit := math.Pow(10, float64(from.Decimals))
	toUnit := math.Pow(10, float64(to.Decimals))

	fromFiat := round((float64(fromAmount) / fromUnit) * float64(from.Price.Amount))
	netFiat := round(float64(fromFiat) * (1 - float64(SwapSpreadBps)/10_000))

	var toAmount int64
	if to.Price.Amount > 0 {
		toAmount = round((float64(netFiat) / float64(to.Price.Amount)) * toUnit)
	}
	fee := round(float64(fromFiat) * float64(SwapFeeBps) / 10_000)

	rate := 0.0
	if fromAmount > 0 {
		rate = (float64(toAmount) / toUnit) / (float64(fromAmount) / fromUnit)
	}

	return domain.SwapQuote{
		ID:                NewID("sq"),
		FromAssetID:       from.ID,
		ToAssetID:         to.ID,
		From:              domain.CryptoAmount{Amount: fromAmount, Symbol: from.Symbol},
		To:                domain.CryptoAmount{Amount: toAmount, Symbol: to.Symbol},
		Rate:              rate,
		SpreadPct:         float64(SwapSpreadBps) / 100,
		Fee:               domain.Money{Amount: fee, Currency: from.Price.Currency},
		FiatValue:         domain.Money{Amount: fromFiat, Currency: from.Price.Currency},
		LiquidityProvider: "mock-liquidity",
		ExpiresAt:         Expiry(QuoteExpirySeconds),
	}
}

// ── Withdrawal quote ──────────────────────────────────────────────────────────

// WithdrawalQuoteFor estimates the network fee and builds a withdrawal preview.
func WithdrawalQuoteFor(a domain.Asset, n domain.Network, amount int64) domain.WithdrawalQuote {
	unit := math.Pow(10, float64(a.Decimals))
	networkFee := max(round(unit*0.00005), round(float64(amount)*0.0005))
	receive := max(int64(0), amount-networkFee)
	fiatValue := round((float64(amount) / unit) * float64(a.Price.Amount))

	return domain.WithdrawalQuote{
		Symbol:               a.Symbol,
		NetworkID:            n.ID,
		NetworkName:          n.Name,
		Amount:               domain.CryptoAmount{Amount: amount, Symbol: a.Symbol},
		NetworkFee:           domain.CryptoAmount{Amount: networkFee, Symbol: a.Symbol},
		PaymaxFee:            domain.Money{Amount: 150_00, Currency: "NGN"},
		ReceiveAmount:        domain.CryptoAmount{Amount: receive, Symbol: a.Symbol},
		FiatValue:            domain.Money{Amount: fiatValue, Currency: "NGN"},
		RequiresManualReview: true,
		ExpiresAt:            Expiry(QuoteExpirySeconds),
	}
}

// ── Deposit address ───────────────────────────────────────────────────────────

// DepositAddressFor returns a deterministic custody deposit address.
func DepositAddressFor(a domain.Asset, n domain.Network) domain.DepositAddress {
	unit := math.Pow(10, float64(a.Decimals))
	seed := charSum(a.Symbol + "-" + n.ID)
	num := int64(seed) * 2654435761
	if num < 0 {
		num = -num
	}
	body := strconv.FormatInt(num, 36)
	for len(body) < 30 {
		body += "0"
	}
	body = body[:30]

	prefix := "0x"
	switch n.ID {
	case "bitcoin":
		prefix = "bc1q"
	case "tron":
		prefix = "T"
	}
	memo := ""
	if n.ID == "tron" {
		memo = strconv.Itoa(100000 + (seed % 900000))
	}

	return domain.DepositAddress{
		Symbol:          a.Symbol,
		NetworkID:       n.ID,
		NetworkName:     n.Name,
		Address:         prefix + body,
		Memo:            memo,
		MinDeposit:      domain.CryptoAmount{Amount: round(unit * 0.0001), Symbol: a.Symbol},
		Confirmations:   n.Confirmations,
		CustodyProvider: "mock-custody",
	}
}

// ── Price chart ───────────────────────────────────────────────────────────────

// Chart returns a deterministic price series for a range (1H/1D/1W/1M/1Y).
func Chart(a domain.Asset, rng string) []domain.CandlePoint {
	points := map[string]int{"1H": 30, "1D": 24, "1W": 28, "1M": 30, "1Y": 52}[rng]
	if points == 0 {
		points = 24
	}
	stepMs := map[string]int64{
		"1H": 120_000, "1D": 3_600_000, "1W": 6 * 3_600_000,
		"1M": 86_400_000, "1Y": 7 * 86_400_000,
	}[rng]
	if stepMs == 0 {
		stepMs = 3_600_000
	}

	base := float64(a.Price.Amount)
	seed := charSum(a.Symbol + rng)
	amp := 0.004
	switch a.RiskRating {
	case "high":
		amp = 0.06
	case "medium":
		amp = 0.035
	}

	out := make([]domain.CandlePoint, 0, points)
	now := time.Now()
	for i := 0; i < points; i++ {
		wobble := math.Sin(float64(seed+i)/3)*amp + math.Cos(float64(seed+i)/6)*amp*0.6
		drift := (a.Change24hPct / 100) * (float64(i) / float64(points))
		price := max(int64(1), round(base*(1+wobble+drift-amp/2)))
		t := now.Add(-time.Duration(int64(points-i)*stepMs) * time.Millisecond).UTC().Format(time.RFC3339)
		out = append(out, domain.CandlePoint{T: t, Price: price})
	}
	return out
}

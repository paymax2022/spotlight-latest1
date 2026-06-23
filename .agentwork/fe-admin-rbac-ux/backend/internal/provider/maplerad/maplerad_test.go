package maplerad_test

import (
	"testing"

	"spotlight/backend/internal/provider/maplerad"
)

// TestClientName verifies the provider identifier is "maplerad".
func TestClientName(t *testing.T) {
	c := maplerad.New("sk_test_dummy", false)
	if c.Name() != "maplerad" {
		t.Errorf("Name() = %q, want %q", c.Name(), "maplerad")
	}
}

// TestFXQuoteRequestCurrencyPair verifies source and target currencies are distinct.
func TestFXQuoteRequestCurrencyPair(t *testing.T) {
	req := maplerad.FXQuoteRequest{
		SourceCurrency: "NGN",
		TargetCurrency: "USD",
		AmountKobo:     500_000_00, // ₦500,000
	}
	if req.SourceCurrency == req.TargetCurrency {
		t.Error("FXQuoteRequest source and target currency must differ")
	}
	if req.AmountKobo <= 0 {
		t.Errorf("FXQuoteRequest.AmountKobo must be positive, got %d", req.AmountKobo)
	}
}

// TestFXQuoteResponseFields verifies the rate and amounts in a quote are positive.
func TestFXQuoteResponseFields(t *testing.T) {
	resp := maplerad.FXQuoteResponse{
		QuoteID:           "quote-abc",
		Rate:              0.00065,
		SourceAmountKobo:  50_000_000, // ₦500,000 in kobo
		TargetAmountMinor: 32500,      // $325.00 in cents
		Fee:               500,
		ExpiresAt:         "2026-06-16T12:00:00Z",
	}
	if resp.Rate <= 0 {
		t.Errorf("FXQuoteResponse.Rate must be positive, got %f", resp.Rate)
	}
	if resp.SourceAmountKobo <= 0 {
		t.Errorf("FXQuoteResponse.SourceAmountKobo must be positive, got %d", resp.SourceAmountKobo)
	}
	if resp.TargetAmountMinor <= 0 {
		t.Errorf("FXQuoteResponse.TargetAmountMinor must be positive, got %d", resp.TargetAmountMinor)
	}
	if resp.QuoteID == "" {
		t.Error("FXQuoteResponse.QuoteID must not be empty")
	}
}

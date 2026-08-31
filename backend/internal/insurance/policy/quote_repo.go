package policy

import (
	"context"
	"encoding/json"
	"time"

	"spotlight/backend/internal/insurance/gateway"
)

// insertQuote persists an ephemeral, TTL-bounded quote and returns its id. The
// provider quote ref + disclosure are stored so a later bind reuses them.
// inputs are the product-specific answers collected at quote time. They MUST be
// persisted: aggregators like MyCover have no generic bind endpoint and validate
// the full per-product field set at purchase, so a bind that forwards no inputs
// is rejected outright. Storing them on the quote also lets the saga replay a
// bind without re-prompting the member.
func (r *Repository) insertQuote(ctx context.Context, userID, productCode, provider string, q gateway.Quote, inputs map[string]any, expiresAt time.Time) (string, error) {
	terms, _ := json.Marshal(q.Terms)
	if inputs == nil {
		inputs = map[string]any{}
	}
	inputsJSON, err := json.Marshal(inputs)
	if err != nil {
		return "", err
	}
	var id string
	err = r.db.QueryRow(ctx, `
		INSERT INTO public.insurance_quote
			(user_id, product_code, provider, underwriter, provider_quote_ref,
			 premium_kobo, sum_insured_kobo, currency, commission_kobo, terms, inputs, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING id`,
		userID, productCode, provider, q.Underwriter, q.ProviderQuoteRef,
		q.PremiumKobo, q.SumInsuredKobo, q.Currency, q.CommissionKobo, terms, inputsJSON, expiresAt,
	).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

// getQuote loads a quote and returns it plus its owner id. Expired quotes are
// still returned (the caller decides), but bind rejects them via the TTL check.
func (r *Repository) getQuote(ctx context.Context, quoteID string) (*QuoteResult, string, error) {
	var (
		qr      QuoteResult
		ownerID string
		terms   []byte
		inputs  []byte
	)
	err := r.db.QueryRow(ctx, `
		SELECT id, user_id, product_code, provider, underwriter, provider_quote_ref,
		       premium_kobo, sum_insured_kobo, currency, commission_kobo, terms, inputs, expires_at
		FROM public.insurance_quote WHERE id = $1`, quoteID).Scan(
		&qr.QuoteID, &ownerID, &qr.ProductCode, &qr.Provider, &qr.Underwriter, &qr.ProviderQuoteRef,
		&qr.PremiumKobo, &qr.SumInsuredKobo, &qr.Currency, &qr.CommissionKobo, &terms, &inputs, &qr.ExpiresAt,
	)
	if err != nil {
		return nil, "", err
	}
	_ = json.Unmarshal(terms, &qr.Terms)
	_ = json.Unmarshal(inputs, &qr.Inputs)
	return &qr, ownerID, nil
}

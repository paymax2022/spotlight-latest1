package app

import (
	"context"

	"spotlight/backend/internal/insurance/catalog"
	"spotlight/backend/internal/insurance/consent"
	"spotlight/backend/internal/insurance/policy"
)

// insuranceBinderAdapter implements transport.InsuranceBinder over the real
// insurance module (mirrors vetDispatchAdapter/commissionRecorderAdapter —
// transport never imports insurance/* packages directly; this thin wrapper is
// the only place that does).
type insuranceBinderAdapter struct {
	policy  *policy.Service
	catalog *catalog.Service
	consent *consent.Service
}

func (a *insuranceBinderAdapter) IndicativeRateBps(ctx context.Context, productCode string) (int64, error) {
	prod, err := a.catalog.Get(ctx, productCode)
	if err != nil {
		return 0, err
	}
	return prod.RateBps, nil
}

func (a *insuranceBinderAdapter) GrantConsent(ctx context.Context, userID, productCode string) error {
	_, err := a.consent.Grant(ctx, userID, productCode, "")
	return err
}

func (a *insuranceBinderAdapter) CreateQuote(ctx context.Context, userID, productCode string, sumInsuredKobo int64, inputs map[string]any) (string, int64, error) {
	q, err := a.policy.CreateQuote(ctx, userID, productCode, sumInsuredKobo, inputs)
	if err != nil {
		return "", 0, err
	}
	return q.QuoteID, q.PremiumKobo, nil
}

func (a *insuranceBinderAdapter) BindFromQuote(ctx context.Context, userID, quoteID, idempotencyKey string) (string, int64, error) {
	p, err := a.policy.BindFromQuote(ctx, userID, quoteID, idempotencyKey)
	if err != nil {
		return "", 0, err
	}
	return p.ID, p.PremiumKobo, nil
}

func (a *insuranceBinderAdapter) CancelPolicy(ctx context.Context, userID, policyID, reason string) error {
	_, err := a.policy.Cancel(ctx, userID, policyID, reason)
	return err
}

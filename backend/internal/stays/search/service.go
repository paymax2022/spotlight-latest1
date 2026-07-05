package search

import (
	"context"

	"spotlight/backend/internal/stays/dedup"
	"spotlight/backend/internal/stays/gateway"
	"spotlight/backend/internal/stays/pricing"
)

// Service ties the gateway Router (rail fan-out), the dedup layer (collapse
// identical hotels across rails + best-bookable-rate selection), and the pricing
// engine (display price with markup/commission, taxes, FX) into the member-facing
// search + content surface. It lives in its own package to avoid a gateway↔dedup
// import cycle (dedup depends on gateway models).
type Service struct {
	router  *gateway.Router
	dedup   *dedup.Service
	pricing *pricing.Engine
}

// NewService constructs the search service.
func NewService(router *gateway.Router, dd *dedup.Service, pr *pricing.Engine) *Service {
	return &Service{router: router, dedup: dd, pricing: pr}
}

// Result is one priced, de-duplicated search row.
type Result struct {
	Offer     gateway.PropertyOffer `json:"offer"`
	Breakdown pricing.Breakdown     `json:"breakdown"`
}

// Search fans out across active rails, drops failing rails (graceful degradation),
// queues cross-rail mapping conflicts, de-duplicates to the lowest bookable total,
// and returns priced results. The per-rail errors are returned for observability;
// the search still succeeds with the surviving rails.
func (s *Service) Search(ctx context.Context, req gateway.SearchRequest) ([]Result, []gateway.RailError) {
	merged, errs := s.router.Search(ctx, req)

	// Record cross-rail mapping conflicts for the admin queue (best-effort).
	_ = s.dedup.EnqueueConflicts(ctx, merged)

	// Dedup using the pricing engine's bookable total so the cheapest WINS.
	priced := func(o gateway.PropertyOffer) int64 { return s.pricing.PricedTotal(o) }
	deduped := s.dedup.Dedup(ctx, merged, priced)

	out := make([]Result, 0, len(deduped))
	for _, o := range deduped {
		bd, err := s.pricing.Price(o, req.LoyaltyTier, 0)
		if err != nil {
			// FX/pricing failure on this offer — drop it rather than display an
			// unpriceable row (FX-never-silent).
			continue
		}
		out = append(out, Result{Offer: o, Breakdown: bd})
	}
	return out, errs
}

// GetContent resolves the adapter for a (rail, supplier) and returns normalised
// property content.
func (s *Service) GetContent(ctx context.Context, rail gateway.SourceRail, supplierCode, supplierPropertyRef string) (gateway.PropertyContent, error) {
	gw, err := s.router.Resolve(ctx, rail, supplierCode)
	if err != nil {
		return gateway.PropertyContent{}, err
	}
	return gw.GetContent(ctx, supplierPropertyRef)
}

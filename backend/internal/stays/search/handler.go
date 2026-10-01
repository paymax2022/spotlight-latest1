package search

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/stays/dedup"
	"spotlight/backend/internal/stays/gateway"
	"spotlight/backend/internal/stays/pricing"
)

// Handler exposes the member search + property-content routes.
type Handler struct {
	svc *Service
}

// NewHandler constructs the search handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Search (member): GET /search?city=&check_in=&check_out=&rooms=&adults=&currency=
// Multi-rail fan-out + dedup + priced results. Per-rail failures are reported as
// `degraded` rails but never fail the whole search.
func (h *Handler) Search(c *gin.Context) {
	city := c.Query("city")
	ci, err1 := time.Parse("2006-01-02", c.Query("check_in"))
	co, err2 := time.Parse("2006-01-02", c.Query("check_out"))
	if err1 != nil || err2 != nil || !co.After(ci) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid check_in/check_out"})
		return
	}
	rooms := atoiDefault(c.Query("rooms"), 1)
	adults := atoiDefault(c.Query("adults"), 2)
	currency := c.DefaultQuery("currency", "NGN")

	results, railErrs := h.svc.Search(c.Request.Context(), gateway.SearchRequest{
		City:        city,
		CheckIn:     ci,
		CheckOut:    co,
		Rooms:       rooms,
		Occupancy:   gateway.Occupancy{Adults: adults},
		Currency:    currency,
		LoyaltyTier: c.Query("loyalty_tier"),
	})

	degraded := make([]string, 0, len(railErrs))
	for _, e := range railErrs {
		degraded = append(degraded, string(e.Rail))
	}
	c.JSON(http.StatusOK, gin.H{"data": results, "degraded_rails": degraded})
}

// Content (member): GET /properties/:rail/:supplier/:ref — normalised content.
func (h *Handler) Content(c *gin.Context) {
	content, err := h.svc.GetContent(c.Request.Context(),
		gateway.SourceRail(c.Param("rail")), c.Param("supplier"), c.Param("ref"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": content})
}

func atoiDefault(s string, def int) int {
	n := 0
	if s == "" {
		return def
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return def
		}
		n = n*10 + int(r-'0')
	}
	if n == 0 {
		return def
	}
	return n
}

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

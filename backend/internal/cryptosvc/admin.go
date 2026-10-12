package cryptosvc

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/cryptoprov"
)

// AdminReviewSwap is the admin-console view of a swap parked in needs_review: a swap the
// pipeline could not auto-resolve, with the user's NGN still held in the ledger. Unlike the
// member SwapView it DOES expose user_id and the provider swap id, because this surface is
// gated by the crypto.admin permission and ops need them to resolve held money. NGN is
// integer kobo; held_kobo is the ngn+fee the wallet is holding.
//
// Round 1 is read-only — it surfaces parked money so ops can SEE it. The settle/release/retry
// decision controls are a follow-up (the resolution set is state-dependent: a swap with no
// provider swap id has an unknown provider outcome and must never be blindly settled). See
// ADR-PR727.
type AdminReviewSwap struct {
	ID             string `json:"id"`
	UserID         string `json:"user_id"`
	Status         string `json:"status"`
	Asset          string `json:"asset"`
	NGNKobo        int64  `json:"ngn_kobo"`
	FeeKobo        int64  `json:"fee_kobo"`
	HeldKobo       int64  `json:"held_kobo"`
	Provider       string `json:"provider"`
	ProviderSwapID string `json:"provider_swap_id,omitempty"`
	HasProviderID  bool   `json:"has_provider_id"`
	UpdatedAt      string `json:"updated_at,omitempty"`
	AgeSeconds     int64  `json:"age_seconds"`
}

func adminViewOf(r SwapRecord, now time.Time) AdminReviewSwap {
	v := AdminReviewSwap{
		ID: r.ID, UserID: r.UserID, Status: string(r.State), Asset: r.ToCurrency,
		NGNKobo: r.NGNKobo, FeeKobo: r.FeeKobo, HeldKobo: r.NGNKobo + r.FeeKobo,
		Provider: r.Provider, ProviderSwapID: r.ProviderSwapID,
		HasProviderID: r.ProviderSwapID != "",
	}
	if !r.UpdatedAt.IsZero() {
		v.UpdatedAt = r.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z")
		if d := now.Sub(r.UpdatedAt); d > 0 {
			v.AgeSeconds = int64(d.Seconds())
		}
	}
	return v
}

type adminHandler struct {
	d   HandlerDeps
	now func() time.Time
}

const (
	reviewDefaultLimit = 50
	reviewMaxLimit     = 200
)

// RegisterAdminRoutes mounts the read-only crypto swap admin surface on admin, which the
// caller has already authenticated and guarded with the crypto.admin permission. Round 1
// exposes only the needs_review queue; decision controls follow.
func RegisterAdminRoutes(admin *gin.RouterGroup, d HandlerDeps) {
	h := &adminHandler{d: d, now: time.Now}
	admin.GET("/swaps/review", h.reviewQueue)
}

// reviewQueue GET /admin/crypto/swaps/review?limit=&offset= — swaps parked in needs_review,
// oldest parked first, so ops can see held money. Read-only.
func (h *adminHandler) reviewQueue(c *gin.Context) {
	limit := boundedQuery(c, "limit", reviewDefaultLimit, 1, reviewMaxLimit)
	offset := boundedQuery(c, "offset", 0, 0, 1_000_000)
	recs, err := h.d.Service.ListByState(c.Request.Context(), cryptoprov.SwapStateNeedsReview, limit, offset)
	if err != nil {
		fail(c, http.StatusInternalServerError, "review_list_failed")
		return
	}
	now := h.now()
	out := make([]AdminReviewSwap, 0, len(recs))
	for _, r := range recs {
		out = append(out, adminViewOf(r, now))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "swaps": out, "count": len(out)})
}

// boundedQuery reads an integer query param, falling back to def when absent or unparseable
// and clamping into [lo, hi]. A hostile ?limit=99999999 can never widen the page.
func boundedQuery(c *gin.Context, name string, def, lo, hi int) int {
	raw := c.Query(name)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}

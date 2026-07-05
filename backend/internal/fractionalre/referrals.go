package fractionalre

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/referrals"
)

// Referrals (work order 2): the platform referral engine already exists at
// internal/finance/referrals (per-user code + joined count + earned kobo,
// ledger-credited rewards). This is a THIN read proxy over that service —
// reused, never rebuilt. When the engine is not wired (nil dep / feature flag
// off) the endpoint returns a well-formed {enabled:false} payload that the
// mobile client renders as a "coming soon" state.
//
// Note: the platform engine records completed referrals only (a row exists
// once the referred user qualifies), so `invited` mirrors `joined` — there is
// no separate invite-tracking event upstream.

// ReferralSource is the subset of the platform referral engine the FRE surface
// reads. Satisfied by *referrals.Service.
type ReferralSource interface {
	GetSummary(ctx context.Context, userID string) (*referrals.Summary, error)
}

// WithReferrals wires the platform referral engine (optional; nil → disabled).
func (s *Service) WithReferrals(src ReferralSource) *Service { s.referrals = src; return s }

// ReferralSummary projects the platform engine's summary into the FRE payload.
func (s *Service) ReferralSummary(ctx context.Context, userID string) (*ReferralView, error) {
	if s.referrals == nil {
		return &ReferralView{Enabled: false}, nil
	}
	sum, err := s.referrals.GetSummary(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &ReferralView{
		Enabled:    true,
		Code:       sum.Code,
		Invited:    sum.TotalReferrals, // engine tracks completed referrals only
		Joined:     sum.TotalReferrals,
		EarnedKobo: sum.TotalEarnedKobo,
	}, nil
}

// Referrals handles GET /api/finance/fractionalre/referrals.
func (h *Handler) Referrals(c *gin.Context) {
	out, err := h.svc.ReferralSummary(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

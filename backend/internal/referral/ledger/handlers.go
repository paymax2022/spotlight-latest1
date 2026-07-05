package ledger

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes reward-ledger endpoints (member summary + admin views).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// MySummary handles GET /api/finance/referral/my-rewards — the caller's reward
// summary across states (M-HOME-03).
func (h *Handler) MySummary(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	sum, err := h.svc.GetSummary(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sum)
}

// MyEligible handles GET /api/finance/referral/withdraw-eligible — the caller's
// eligible (withdrawable) reward rows.
func (h *Handler) MyEligible(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	sum, err := h.svc.GetSummary(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"beneficiary_id": userID,
		"eligible_kobo":  sum.EligibleKobo,
		"currency":       "NGN",
	})
}

// MyWithdraw handles POST /api/finance/referral/withdraw — sweep the caller's
// eligible referral rewards into their Spotlight wallet. Money mutation: requires
// an Idempotency-Key header (fail-closed) and a verified KYC tier. The balanced
// double-entry + audit event are posted inside the service.
func (h *Handler) MyWithdraw(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	idem := c.GetHeader("Idempotency-Key")
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	res, err := h.svc.WithdrawEligible(c.Request.Context(), userID, idem)
	if err != nil {
		if errors.Is(err, ErrKYCRequired) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// AdminList handles GET /api/referral/admin/ledger — reward ledger view
// (RBAC referral.ledger.view). Optional ?beneficiary= filter.
func (h *Handler) AdminList(c *gin.Context) {
	beneficiary := c.Query("beneficiary")
	entries, err := h.svc.ListByBeneficiary(c.Request.Context(), beneficiary, 200)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
}

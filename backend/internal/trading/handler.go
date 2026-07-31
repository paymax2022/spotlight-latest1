package trading

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/trading/kyc"
	"spotlight/backend/internal/trading/promotion"
	"spotlight/backend/internal/trading/wallet"
)

// Handler is the HTTP surface for the AI-trading module: Module-KYC (member +
// admin), the paper fund wallet (member), the deterministic decision pipeline
// (member, read-only — records nothing, executes nothing), and the §12 promotion
// ladder (admin). It owns no money logic — it validates input, threads the
// authenticated user id, and maps service errors to status codes. Cash still moves
// only through the finance ledger inside the services.
type Handler struct {
	kyc   *kyc.Service
	wal   *wallet.Service
	promo *promotion.Service
}

func NewHandler(k *kyc.Service, w *wallet.Service, p *promotion.Service) *Handler {
	return &Handler{kyc: k, wal: w, promo: p}
}

func uid(c *gin.Context) string { return c.GetString("user_id") }

func reqIdem(c *gin.Context) (string, bool) {
	k := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if k == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Idempotency-Key required"})
		return "", false
	}
	return k, true
}

// httpErr maps typed service errors to status codes; unknown → 400.
func httpErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, wallet.ErrNoAccess):
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error(), "code": "MODULE_KYC_REQUIRED"})
	case errors.Is(err, wallet.ErrInsufficientCash):
		c.JSON(http.StatusPaymentRequired, gin.H{"success": false, "error": err.Error()})
	case errors.Is(err, wallet.ErrInsufficientUnit), errors.Is(err, wallet.ErrIdemConflict), errors.Is(err, kyc.ErrInvalidTransition), errors.Is(err, kyc.ErrVersionConflict):
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": err.Error()})
	case errors.Is(err, wallet.ErrDebitPending), errors.Is(err, wallet.ErrCreditPending):
		c.JSON(http.StatusAccepted, gin.H{"success": false, "error": err.Error(), "retryable": true})
	case errors.Is(err, promotion.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
	case errors.Is(err, promotion.ErrDenied):
		// A ladder gate rejection (illegal transition / unmet evidence) — the
		// request was well-formed but the promotion is not permitted.
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": err.Error(), "code": "LADDER_DENIED"})
	case errors.Is(err, promotion.ErrVersionConflict):
		c.JSON(http.StatusConflict, gin.H{"success": false, "error": err.Error(), "retryable": true})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
	}
}

// ── Member: Module-KYC ────────────────────────────────────────────────────────

func (h *Handler) KycStatus(c *gin.Context) {
	rec, err := h.kyc.GetStatus(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	access, _ := h.kyc.HasTradingAccess(c.Request.Context(), uid(c))
	c.JSON(http.StatusOK, gin.H{"success": true, "status": rec.Status, "has_access": access, "bypass_expires_at": rec.BypassExpiresAt})
}

func (h *Handler) KycSubmit(c *gin.Context) {
	if err := h.kyc.Submit(c.Request.Context(), uid(c)); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "status": kyc.StatusSubmitted})
}

// ── Member: fund wallet ───────────────────────────────────────────────────────

func (h *Handler) WalletPosition(c *gin.Context) {
	units, nav, value, err := h.wal.Position(c.Request.Context(), uid(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "units": units, "nav_per_unit_kobo": nav, "value_kobo": value})
}

func (h *Handler) Subscribe(c *gin.Context) {
	idem, ok := reqIdem(c)
	if !ok {
		return
	}
	var body struct{ AmountKobo int64 `json:"amount_kobo"` }
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	o, err := h.wal.Subscribe(c.Request.Context(), uid(c), idem, body.AmountKobo)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "units_minted": o.UnitsDelta, "nav_per_unit_kobo": o.NAVPerUnitKobo})
}

func (h *Handler) Redeem(c *gin.Context) {
	idem, ok := reqIdem(c)
	if !ok {
		return
	}
	var body struct{ Units int64 `json:"units"` }
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	o, err := h.wal.Redeem(c.Request.Context(), uid(c), idem, body.Units)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "cash_kobo": o.CashKobo, "nav_per_unit_kobo": o.NAVPerUnitKobo})
}

// ── Admin: Module-KYC ─────────────────────────────────────────────────────────

func (h *Handler) AdminQueue(c *gin.Context) {
	recs, err := h.kyc.ReviewQueue(c.Request.Context(), 200)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": recs})
}

func (h *Handler) AdminCase(c *gin.Context) {
	rec, events, err := h.kyc.GetCase(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "record": rec, "events": events})
}

func (h *Handler) AdminReview(c *gin.Context) {
	if err := h.kyc.StartReview(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "status": kyc.StatusUnderReview})
}

func (h *Handler) AdminApprove(c *gin.Context) {
	var body struct{ ReasonCode string `json:"reason_code"` }
	_ = c.ShouldBindJSON(&body)
	if err := h.kyc.Approve(c.Request.Context(), uid(c), c.Param("id"), body.ReasonCode); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "status": kyc.StatusApproved})
}

func (h *Handler) AdminReject(c *gin.Context) {
	var body struct{ ReasonCode string `json:"reason_code"` }
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.ReasonCode) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "reason_code required"})
		return
	}
	if err := h.kyc.Reject(c.Request.Context(), uid(c), c.Param("id"), body.ReasonCode); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "status": kyc.StatusRejected})
}

// AdminBypass — the authenticated admin is the MAKER; checker_id (body) must
// differ (two-person). ttl_days is bounded by the service (≤ MaxBypassTTL).
func (h *Handler) AdminBypass(c *gin.Context) {
	var body struct {
		CheckerID       string `json:"checker_id"`
		Reason          string `json:"reason"`
		TTLDays         int    `json:"ttl_days"`
		ExposureCapKobo *int64 `json:"exposure_cap_kobo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	ttl := time.Duration(body.TTLDays) * 24 * time.Hour
	if err := h.kyc.Bypass(c.Request.Context(), uid(c), body.CheckerID, c.Param("id"), body.Reason, ttl, body.ExposureCapKobo); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "status": kyc.StatusBypassed})
}

func (h *Handler) AdminBypassRegister(c *gin.Context) {
	rows, err := h.kyc.ListBypassRegister(c.Request.Context(), 200)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

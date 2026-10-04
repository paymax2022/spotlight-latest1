package trading

import (
	"errors"
	"log"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/trading/kyc"
	"spotlight/backend/internal/trading/promotion"
	"spotlight/backend/internal/trading/wallet"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyStatus = "status"

const keyNavPerUnitKobo = "nav_per_unit_kobo"

const keyData = "data"

const keySuccess = "success"

const keyInvalidBody = "invalid body"

const keyError = "error"

const keyCode = "code"

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

// errMap maps typed service errors to status codes; unknown → 400.
var errMap = httperr.New(http.StatusBadRequest,
	httperr.R(http.StatusForbidden, wallet.ErrNoAccess),
	// Tier-limit refusals: 403 — the same mapping the canonical transfer rail
	// uses (E2E-FIN-046). An unwired/degraded gate is a dependency failure: 503.
	httperr.R(http.StatusForbidden, tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded),
	httperr.R(http.StatusServiceUnavailable, wallet.ErrTierGateUnwired),
	httperr.R(http.StatusPaymentRequired, wallet.ErrInsufficientCash),
	httperr.R(http.StatusConflict, wallet.ErrInsufficientUnit, wallet.ErrIdemConflict, kyc.ErrInvalidTransition, kyc.ErrVersionConflict),
	httperr.R(http.StatusAccepted, wallet.ErrDebitPending, wallet.ErrCreditPending),
	httperr.R(http.StatusNotFound, promotion.ErrNotFound),
	httperr.R(http.StatusForbidden, promotion.ErrDenied),
	httperr.R(http.StatusConflict, promotion.ErrVersionConflict),
)

// httpErr writes the service error; rules live in errMap but a few errors carry
// extra envelope fields (code, retryable) the mapper cannot express.
func httpErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, wallet.ErrNoAccess):
		c.JSON(http.StatusForbidden, gin.H{keySuccess: false, keyError: httperr.Msg(c, http.StatusForbidden, err), keyCode: "MODULE_KYC_REQUIRED"})
	case errors.Is(err, wallet.ErrDebitPending), errors.Is(err, wallet.ErrCreditPending):
		c.JSON(http.StatusAccepted, gin.H{keySuccess: false, keyError: httperr.Msg(c, http.StatusAccepted, err), "retryable": true})
	case errors.Is(err, promotion.ErrDenied):
		// A ladder gate rejection (illegal transition / unmet evidence) — the
		// request was well-formed but the promotion is not permitted.
		c.JSON(http.StatusForbidden, gin.H{keySuccess: false, keyError: httperr.Msg(c, http.StatusForbidden, err), keyCode: "LADDER_DENIED"})
	case errors.Is(err, promotion.ErrVersionConflict):
		c.JSON(http.StatusConflict, gin.H{keySuccess: false, keyError: httperr.Msg(c, http.StatusConflict, err), "retryable": true})
	default:
		errMap.WriteOK(c, err)
	}
}

func (h *Handler) KycStatus(c *gin.Context) {
	rec, err := h.kyc.GetStatus(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	access, _ := h.kyc.HasTradingAccess(c.Request.Context(), ginutil.UserID(c))
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyStatus: rec.Status, "has_access": access, "bypass_expires_at": rec.BypassExpiresAt})
}

func (h *Handler) KycSubmit(c *gin.Context) {
	if err := h.kyc.Submit(c.Request.Context(), ginutil.UserID(c)); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyStatus: kyc.StatusSubmitted})
}

func (h *Handler) WalletPosition(c *gin.Context) {
	units, nav, value, err := h.wal.Position(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "units": units, keyNavPerUnitKobo: nav, "value_kobo": value})
}

func (h *Handler) Subscribe(c *gin.Context) {
	idem, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	var body struct {
		AmountKobo int64 `json:"amount_kobo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keySuccess: false, keyError: keyInvalidBody})
		return
	}
	o, err := h.wal.Subscribe(c.Request.Context(), ginutil.UserID(c), idem, body.AmountKobo)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "units_minted": o.UnitsDelta, keyNavPerUnitKobo: o.NAVPerUnitKobo})
}

func (h *Handler) Redeem(c *gin.Context) {
	idem, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	var body struct {
		Units int64 `json:"units"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keySuccess: false, keyError: keyInvalidBody})
		return
	}
	o, err := h.wal.Redeem(c.Request.Context(), ginutil.UserID(c), idem, body.Units)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "cash_kobo": o.CashKobo, keyNavPerUnitKobo: o.NAVPerUnitKobo})
}

func (h *Handler) AdminQueue(c *gin.Context) {
	recs, err := h.kyc.ReviewQueue(c.Request.Context(), 200)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: recs})
}

func (h *Handler) AdminCase(c *gin.Context) {
	rec, events, err := h.kyc.GetCase(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "record": rec, "events": events})
}

func (h *Handler) AdminReview(c *gin.Context) {
	if err := h.kyc.StartReview(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyStatus: kyc.StatusUnderReview})
}

func (h *Handler) AdminApprove(c *gin.Context) {
	var body struct {
		ReasonCode string `json:"reason_code"`
	}
	_ = c.ShouldBindJSON(&body)
	if err := h.kyc.Approve(c.Request.Context(), ginutil.UserID(c), c.Param("id"), body.ReasonCode); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyStatus: kyc.StatusApproved})
}

func (h *Handler) AdminReject(c *gin.Context) {
	var body struct {
		ReasonCode string `json:"reason_code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.ReasonCode) == "" {
		c.JSON(http.StatusBadRequest, gin.H{keySuccess: false, keyError: "reason_code required"})
		return
	}
	if err := h.kyc.Reject(c.Request.Context(), ginutil.UserID(c), c.Param("id"), body.ReasonCode); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyStatus: kyc.StatusRejected})
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
		c.JSON(http.StatusBadRequest, gin.H{keySuccess: false, keyError: keyInvalidBody})
		return
	}
	ttl := time.Duration(body.TTLDays) * 24 * time.Hour
	if err := h.kyc.Bypass(c.Request.Context(), ginutil.UserID(c), body.CheckerID, c.Param("id"), body.Reason, ttl, body.ExposureCapKobo); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyStatus: kyc.StatusBypassed})
}

func (h *Handler) AdminBypassRegister(c *gin.Context) {
	rows, err := h.kyc.ListBypassRegister(c.Request.Context(), 200)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: rows})
}

// Register wires the AI-trading module (paper/accounting only). The Module-KYC
// service IS the wallet's access gate — subscriptions are refused unless the user
// is APPROVED or unexpired-BYPASSED. This is the ONLY place the two services are
// joined, and it edits no existing file; finance_routes.go mounts it behind
// FEATURE_TRADING_ENABLED.
//   - member: /api/v1/trading/*        (member-auth; the KYC gate + object authz in the service)
//   - admin : /api/v1/admin/trading/*  (member-auth; per-route RBAC trading.kyc.*)
//
// No venue execution and no withdrawal keys exist in this module — cash moves only
// through the finance ledger (wallet), and units/NAV are integer-scaled.
// aiEnabled is a stricter SECOND gate (config.FeatureAITradingEnabled): the paper
// Module-KYC + wallet routes mount whenever this module is registered, but the
// deterministic decision pipeline (/evaluate) and the §12 promotion-ladder admin
// routes are exposed only when aiEnabled is also true. Neither executes a real
// order in this build.
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, led *ledger.Service, feeBps, hurdleBps int64, aiEnabled bool) (*wallet.Service, *kyc.Service) {
	if pool == nil || led == nil {
		log.Println("[trading] nil pool/ledger — skipping trading routes")
		return nil, nil
	}
	kycSvc := kyc.NewService(pool)
	walSvc := wallet.NewService(pool, led, kycSvc, feeBps, hurdleBps) // kycSvc satisfies wallet.AccessGate
	promoSvc := promotion.NewService(pool)
	h := NewHandler(kycSvc, walSvc, promoSvc)
	rp := func(perm string) gin.HandlerFunc { return middleware.RequirePermission(rbac, perm) }

	member.GET("/kyc/status", h.KycStatus)
	member.POST("/kyc/submit", h.KycSubmit)
	member.GET("/wallet", h.WalletPosition)
	member.POST("/wallet/subscribe", h.Subscribe) // Idempotency-Key; access-gated in the service
	member.POST("/wallet/redeem", h.Redeem)       // Idempotency-Key

	admin.GET("/kyc/queue", rp(kyc.PermReview), h.AdminQueue)
	admin.GET("/kyc/bypass-register", rp(kyc.PermAuditRead), h.AdminBypassRegister)
	admin.GET("/kyc/:id", rp(kyc.PermReview), h.AdminCase)
	admin.POST("/kyc/:id/review", rp(kyc.PermReview), h.AdminReview)
	admin.POST("/kyc/:id/approve", rp(kyc.PermReview), h.AdminApprove)
	admin.POST("/kyc/:id/reject", rp(kyc.PermReview), h.AdminReject)
	admin.POST("/kyc/:id/bypass", rp(kyc.PermBypassApprove), h.AdminBypass) // checker perm; maker≠checker enforced in service

	// The deterministic pipeline + §12 promotion ladder stay dark until the operator
	// explicitly opts in, independent of the paper wallet above. Still executes nothing.
	if aiEnabled {
		// Member: deterministic decision pipeline — KYC-gated + ladder-stage-gated
		// in the handler; SERVER-fixed risk/committee config; records nothing,
		// executes nothing.
		member.POST("/evaluate", h.Evaluate)
		// Member: read-only strategy-maturity transparency (§12) — sanitized ladder,
		// no governance internals. Lets a member see how the fund is managed.
		member.GET("/strategies", h.Strategies)

		// Admin: §12 promotion ladder (separation of duties).
		admin.GET("/promotions", rp(promotion.PermRead), h.AdminPromoteList)
		admin.GET("/promotions/:id", rp(promotion.PermRead), h.AdminPromoteGet)
		admin.POST("/promotions/:id/register", rp(promotion.PermPropose), h.AdminPromoteRegister)
		admin.POST("/promotions/:id/readiness", rp(promotion.PermRisk), h.AdminReadiness)
		admin.POST("/promotions/:id/promote", rp(promotion.PermApprove), h.AdminPromote) // checker perm; maker≠checker + Risk/legal enforced by the ladder gate
		admin.POST("/promotions/:id/demote", rp(promotion.PermHalt), h.AdminDemote)
		admin.POST("/promotions/:id/halt", rp(promotion.PermHalt), h.AdminHalt)
	}

	return walSvc, kycSvc
}

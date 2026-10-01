package analytics

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Service is the referral analytics read-model service.
type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) KFactor(ctx context.Context) (*KFactor, error) { return s.repo.KFactor(ctx) }

func (s *Service) Funnel(ctx context.Context) ([]FunnelStage, error) { return s.repo.Funnel(ctx) }

// CAC computes referral cost-of-acquisition (house-excluded spend / human-referred
// signups) and compares it against a supplied paid-CAC benchmark.
func (s *Service) CAC(ctx context.Context, paidCACKobo int64) (*CAC, error) {
	spend, err := s.repo.ReferralSpendKobo(ctx)
	if err != nil {
		return nil, err
	}
	signups, err := s.repo.ReferredSignupCount(ctx)
	if err != nil {
		return nil, err
	}
	out := &CAC{
		ReferralSpendKobo: spend,
		ReferredSignups:   signups,
		PaidCACKobo:       paidCACKobo,
	}
	if signups > 0 {
		out.ReferralCACKobo = spend / int64(signups)
	}
	return out, nil
}

func (s *Service) Cohorts(ctx context.Context) ([]CohortRow, error) { return s.repo.Cohorts(ctx) }

func (s *Service) Channels(ctx context.Context) ([]ChannelRow, error) { return s.repo.Channels(ctx) }

func (s *Service) Segmentation(ctx context.Context) (*Segmentation, error) {
	return s.repo.Segmentation(ctx)
}

func (s *Service) User360(ctx context.Context, userID string) (*User360, error) {
	if userID == "" {
		return nil, fmt.Errorf("analytics: user id required")
	}
	return s.repo.User360(ctx, userID)
}

// KFactor is the viral-coefficient summary. The numerator counts ONLY
// human-referred signups (house excluded); the denominator counts referrers.
type KFactor struct {
	Referrers       int     `json:"referrers"`        // distinct human referrers (house excluded)
	ReferredSignups int     `json:"referred_signups"` // human-referred signups (house excluded)
	HouseSignups    int     `json:"house_signups"`    // house_default signups (reported separately)
	KFactor         float64 `json:"k_factor"`         // referred_signups / referrers
}

// FunnelStage is one acquisition-funnel stage with a count.
type FunnelStage struct {
	Stage string `json:"stage"`
	Count int    `json:"count"`
}

// CAC is referral cost-of-acquisition vs paid acquisition (kobo).
type CAC struct {
	ReferralSpendKobo int64 `json:"referral_spend_kobo"` // paid, non-house reward spend
	ReferredSignups   int   `json:"referred_signups"`    // human-referred signups (house excluded)
	ReferralCACKobo   int64 `json:"referral_cac_kobo"`   // spend / referred signups
	PaidCACKobo       int64 `json:"paid_cac_kobo"`       // supplied benchmark (admin param)
}

// CohortRow is one signup-month cohort's LTV/retention.
type CohortRow struct {
	CohortMonth  string `json:"cohort_month"`  // YYYY-MM
	Signups      int    `json:"signups"`       // human-referred signups in cohort
	ActiveUsers  int    `json:"active_users"`  // with verified activity
	LTVKobo      int64  `json:"ltv_kobo"`      // verified activity value
	RetentionPct int    `json:"retention_pct"` // active / signups
}

// ChannelRow is channel/vertical attribution (by attribution_type).
type ChannelRow struct {
	Channel string `json:"channel"` // code | deeplink | context | regional_house | global_house
	Signups int    `json:"signups"`
	IsHouse bool   `json:"is_house"`
}

// Segmentation separates organic vs referred (house_default reported apart).
type Segmentation struct {
	ReferredSignups int `json:"referred_signups"` // human-referred (house excluded)
	HouseSignups    int `json:"house_signups"`    // house_default segment
	OrganicSignups  int `json:"organic_signups"`  // users with no attribution row
}

// User360 is the per-user referral profile (A-USR-01).
type User360 struct {
	UserID          string `json:"user_id"`
	AttributionType string `json:"attribution_type,omitempty"`
	IsHouse         bool   `json:"is_house"`
	ReferrerID      string `json:"referrer_id,omitempty"`
	ReferredCount   int    `json:"referred_count"`    // humans this user referred (house excluded)
	TotalEarnedKobo int64  `json:"total_earned_kobo"` // non-clawed reward total
	PaidKobo        int64  `json:"paid_kobo"`
	ClawedBackKobo  int64  `json:"clawed_back_kobo"`
	ActivityKobo    int64  `json:"activity_kobo"`  // own verified activity (LTV)
	FraudStanding   string `json:"fraud_standing"` // clear | under_review | restricted
}

// Handler exposes admin analytics + user-360 endpoints (read-only).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register wires analytics routes onto the referral admin group.
//   - admin: /api/referral/admin/analytics/*  (RBAC referral.analytics.view)
//   - admin: /api/referral/admin/users/:id     (RBAC referral.users.view, A-USR-01)
func Register(admin *gin.RouterGroup, svc *Service, rbac services.RBACService) {
	h := NewHandler(svc)
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }

	ag := admin.Group("/analytics")
	ag.GET("/k-factor", guard("referral.analytics.view"), h.KFactor)
	ag.GET("/funnel", guard("referral.analytics.view"), h.Funnel)
	ag.GET("/cac", guard("referral.analytics.view"), h.CAC)
	ag.GET("/cohorts", guard("referral.analytics.view"), h.Cohorts)
	ag.GET("/channels", guard("referral.analytics.view"), h.Channels)
	ag.GET("/segmentation", guard("referral.analytics.view"), h.Segmentation)

	// user-360 (A-USR-01) under a separate permission.
	ug := admin.Group("/users")
	ug.GET("/:id/referral-360", guard("referral.users.view"), h.User360)
}

func (h *Handler) KFactor(c *gin.Context) {
	k, err := h.svc.KFactor(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"k_factor": k})
}

func (h *Handler) Funnel(c *gin.Context) {
	f, err := h.svc.Funnel(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"funnel": f})
}

func (h *Handler) CAC(c *gin.Context) {
	var paid int64
	if v := c.Query("paid_cac_kobo"); v != "" {
		paid, _ = strconv.ParseInt(v, 10, 64)
	}
	cac, err := h.svc.CAC(c.Request.Context(), paid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cac": cac})
}

func (h *Handler) Cohorts(c *gin.Context) {
	rows, err := h.svc.Cohorts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cohorts": rows})
}

func (h *Handler) Channels(c *gin.Context) {
	rows, err := h.svc.Channels(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"channels": rows})
}

func (h *Handler) Segmentation(c *gin.Context) {
	s, err := h.svc.Segmentation(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"segmentation": s})
}

func (h *Handler) User360(c *gin.Context) {
	u, err := h.svc.User360(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": u})
}

package merchant

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes merchant admin endpoints (RBAC referral.merchant.*).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register wires merchant routes under the referral admin group only (merchant
// funding + partner-key issuance is an admin/back-office surface).
func Register(admin *gin.RouterGroup, svc *Service, rbac services.RBACService) {
	h := NewHandler(svc)
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }

	ag := admin.Group("/merchants")
	ag.GET("", guard("referral.merchant.view"), h.List)
	ag.POST("", guard("referral.merchant.manage"), h.Create)
	ag.GET("/:id", guard("referral.merchant.view"), h.Get)
	ag.GET("/:id/campaigns", guard("referral.merchant.view"), h.ListCampaigns)
	ag.POST("/campaigns", guard("referral.merchant.manage"), h.CreateCampaign)
	ag.POST("/campaigns/:mcid/fund", guard("referral.merchant.manage"), h.Fund)
	ag.POST("/campaigns/:mcid/settle", guard("referral.merchant.manage"), h.Settle)
	ag.GET("/:id/keys", guard("referral.merchant.view"), h.ListKeys)
	ag.POST("/keys", guard("referral.merchant.manage"), h.IssueKey)
	ag.POST("/keys/:keyid/revoke", guard("referral.merchant.manage"), h.RevokeKey)
}

// RegisterMember wires the READ-ONLY member merchant self-view onto the referral
// finance member group (/api/finance/referral/merchant/*). Funding, campaign
// creation and partner keys stay admin-only.
func RegisterMember(member *gin.RouterGroup, svc *Service) {
	h := NewHandler(svc)
	mg := member.Group("/merchant")
	mg.GET("/dashboard", h.MemberDashboard)
	mg.GET("/campaigns/:mcid/performance", h.MemberPerformance)
}

type memberCampaignRow struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Status      string    `json:"status"`
	BudgetKobo  int64     `json:"budget_kobo"`
	SpentKobo   int64     `json:"spent_kobo"`
	Conversions int       `json:"conversions"`
	StartedAt   time.Time `json:"started_at"`
}

// MemberDashboard: GET /merchant/dashboard — the caller's merchant zone. Returns
// an empty dashboard when the caller owns no merchant. Money is integer kobo.
func (h *Handler) MemberDashboard(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	m, err := h.svc.GetMerchantByOwner(c.Request.Context(), uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusOK, gin.H{"data": gin.H{
				"wallet_balance_kobo": 0, "total_spent_kobo": 0,
				"total_conversions": 0, "active_campaigns": 0,
				"campaigns": []memberCampaignRow{},
			}})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	camps, err := h.svc.ListCampaigns(c.Request.Context(), m.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	rows := make([]memberCampaignRow, 0, len(camps))
	var funded, settled int64
	active := 0
	for _, mc := range camps {
		funded += mc.FundedKobo
		settled += mc.SettledKobo
		if mc.Status == MCActive || mc.Status == MCFunded {
			active++
		}
		rows = append(rows, memberCampaignRow{
			ID: mc.ID, Name: mc.Name, Status: mc.Status,
			BudgetKobo: mc.FundedKobo, SpentKobo: mc.SettledKobo,
			// TODO(referral): no per-campaign conversion counter in the model yet.
			Conversions: 0, StartedAt: mc.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"wallet_balance_kobo": funded - settled, // unspent funded budget (escrow)
		"total_spent_kobo":    settled,
		"total_conversions":   0,
		"active_campaigns":    active,
		"campaigns":           rows,
	}})
}

// MemberPerformance: GET /merchant/campaigns/:mcid/performance — one campaign,
// owner-scoped (404 if the caller doesn't own it).
func (h *Handler) MemberPerformance(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	m, err := h.svc.GetMerchantByOwner(c.Request.Context(), uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "no merchant"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	camps, err := h.svc.ListCampaigns(c.Request.Context(), m.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	mcid := c.Param("mcid")
	for _, mc := range camps {
		if mc.ID == mcid {
			c.JSON(http.StatusOK, gin.H{"data": gin.H{
				"campaign_id": mc.ID, "campaign_name": mc.Name,
				"budget_kobo": mc.FundedKobo, "spent_kobo": mc.SettledKobo,
				"conversions": 0, "cost_per_conversion_kobo": 0, "roas": 0,
				"series": []any{},
			}})
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "campaign not found"})
}

func (h *Handler) List(c *gin.Context) {
	list, err := h.svc.ListMerchants(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"merchants": list})
}

func (h *Handler) Create(c *gin.Context) {
	var in CreateMerchantInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	m, err := h.svc.CreateMerchant(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, m)
}

func (h *Handler) Get(c *gin.Context) {
	m, err := h.svc.GetMerchant(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "merchant not found"})
		return
	}
	c.JSON(http.StatusOK, m)
}

func (h *Handler) ListCampaigns(c *gin.Context) {
	list, err := h.svc.ListCampaigns(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaigns": list})
}

func (h *Handler) CreateCampaign(c *gin.Context) {
	var in CreateMCInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	mc, err := h.svc.CreateCampaign(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, mc)
}

func (h *Handler) Fund(c *gin.Context) {
	idem := c.GetHeader("Idempotency-Key")
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var in FundInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	mc, err := h.svc.Fund(c.Request.Context(), c.Param("mcid"), in.AmountKobo, idem)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, mc)
}

func (h *Handler) Settle(c *gin.Context) {
	idem := c.GetHeader("Idempotency-Key")
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var in FundInput // reuse {amount_kobo}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.Settle(c.Request.Context(), c.Param("mcid"), in.AmountKobo, idem); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) ListKeys(c *gin.Context) {
	list, err := h.svc.ListKeys(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"keys": list})
}

func (h *Handler) IssueKey(c *gin.Context) {
	var in IssueKeyInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	k, err := h.svc.IssueKey(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// PlainKey is included exactly once in this response.
	c.JSON(http.StatusCreated, k)
}

func (h *Handler) RevokeKey(c *gin.Context) {
	if err := h.svc.RevokeKey(c.Request.Context(), c.Param("keyid")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

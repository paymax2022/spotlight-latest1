package merchant

import (
	"net/http"

	"github.com/gin-gonic/gin"

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

package rewards

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the rewards surface over Gin.
//   - member: own balance + history reads, catalog read, points redemption.
//   - admin : reward-pool CRUD + fund, catalog CRUD, ledger report
//     (all gated by RBAC academy.rewards).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated learner (mirrors the assessment package).
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

// RegisterAcademyRewards wires the rewards routes. Mirrors the project Register
// pattern (see RegisterAcademyAssessment): it builds its own service from the pool
// and gates admin routes with middleware.RequirePermission(rbac, "academy.rewards").
//
// walletCredit is the seam onto finance/ledger.Service (the ONLY value movement).
// fraud is the anti-fraud gate (nil → approve-all DefaultFraudCheck).
//
//	member:
//	  GET  /rewards/balance
//	  GET  /rewards/history
//	  GET  /rewards/catalog
//	  POST /rewards/redeem
//	admin (RBAC academy.rewards):
//	  GET  /rewards/pools
//	  POST /rewards/pools
//	  POST /rewards/pools/:id/fund
//	  GET  /rewards/pools/:id/ledger
//	  GET  /rewards/catalog
//	  POST /rewards/catalog
func RegisterAcademyRewards(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, walletCredit WalletCredit, fraud FraudCheck) {
	repo := NewRepository(pool)
	// rewardExpenseAccountID is resolved by the injected walletCredit adapter, which
	// owns the sponsor/pool expense counterpart account; "" here defers that choice
	// to the adapter (production wires a ledger.Service-backed adapter).
	svc := NewService(repo, walletCredit, fraud, "")
	h := NewHandler(svc)

	// ── Member ──
	mg := member.Group("/rewards")
	mg.GET("/balance", h.GetBalance)
	mg.GET("/history", h.GetHistory)
	mg.GET("/catalog", h.GetCatalog)
	mg.POST("/redeem", h.Redeem)

	// ── Admin (academy.rewards) ──
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	ag := admin.Group("/rewards")
	ag.GET("/pools", guard("academy.rewards"), h.AdminListPools)
	ag.POST("/pools", guard("academy.rewards"), h.AdminCreatePool)
	ag.POST("/pools/:id/fund", guard("academy.rewards"), h.AdminFundPool)
	ag.GET("/pools/:id/ledger", guard("academy.rewards"), h.AdminPoolLedger)
	ag.GET("/ledger", guard("academy.rewards"), h.AdminGlobalLedger)
	ag.GET("/catalog", guard("academy.rewards"), h.AdminListCatalog)
	ag.POST("/catalog", guard("academy.rewards"), h.AdminUpsertCatalog)
}

// ── Member handlers ──────────────────────────────────────────────────────────────

func (h *Handler) GetBalance(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	bal, err := h.svc.Balance(c.Request.Context(), u)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"balance_minor": bal}})
}

func (h *Handler) GetHistory(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.History(c.Request.Context(), u, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetCatalog(c *gin.Context) {
	out, err := h.svc.Catalog(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

type redeemRequest struct {
	SKU            string `json:"sku" binding:"required"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

func (h *Handler) Redeem(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req redeemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.RedeemPoints(c.Request.Context(), u, req.SKU, req.IdempotencyKey)
	if err != nil {
		if reason, ok := AsRejection(err); ok {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "rejected", "reason": reason})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers ───────────────────────────────────────────────────────────────

func (h *Handler) AdminListPools(c *gin.Context) {
	out, err := h.svc.ListPools(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCreatePool(c *gin.Context) {
	var req CreatePoolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreatePool(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminFundPool(c *gin.Context) {
	var req FundPoolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.FundPool(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		if reason, ok := AsRejection(err); ok {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "rejected", "reason": reason})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminPoolLedger(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.PoolLedger(c.Request.Context(), c.Param("id"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminGlobalLedger returns the reward ledger across ALL pools, newest first.
func (h *Handler) AdminGlobalLedger(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.GlobalLedger(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminListCatalog(c *gin.Context) {
	out, err := h.svc.ListCatalogAdmin(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminUpsertCatalog(c *gin.Context) {
	var req UpsertCatalogRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpsertCatalog(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

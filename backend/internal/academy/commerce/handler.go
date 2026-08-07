package commerce

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the academy commerce surface over Gin.
//   - member: catalog reads, order purchase (pay-now / BNPL), access-card redeem,
//     subscribe, bundle manifest, offline sync.
//   - admin (RBAC academy.commerce): refund, access-card generate/allocate, catalog CRUD.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated user. finance/connect groups mirror the auth user
// into c.Set("user_id", ...); fall back to the auth context if absent.
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

// idemKey reads the Idempotency-Key header (required for money-path mutations).
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

// fail maps sentinel errors to stable snake_case codes + HTTP statuses.
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrApprovalRequired):
		c.JSON(http.StatusForbidden, gin.H{"error": "approval_required", "message": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyKeyReused):
		c.JSON(http.StatusConflict, gin.H{"error": "idempotency_key_reused", "message": err.Error()})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount", "message": err.Error()})
	case errors.Is(err, ErrCatalogItemInactive):
		c.JSON(http.StatusConflict, gin.H{"error": "catalog_item_inactive", "message": err.Error()})
	case errors.Is(err, ErrRefundNotEligible):
		c.JSON(http.StatusConflict, gin.H{"error": "refund_not_eligible", "message": err.Error()})
	case errors.Is(err, ErrAccessCardInvalid):
		c.JSON(http.StatusBadRequest, gin.H{"error": "access_card_invalid", "message": err.Error()})
	case errors.Is(err, ErrAccessCardConsumed):
		c.JSON(http.StatusConflict, gin.H{"error": "access_card_consumed", "message": err.Error()})
	case errors.Is(err, ErrEntitlementAlreadyGrant):
		c.JSON(http.StatusConflict, gin.H{"error": "entitlement_already_granted", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

// RegisterAcademyCommerce wires the commerce routes. Mirrors the project Register
// pattern (assessment/identity): builds its own service from the pool + injected
// rails, and gates admin routes with middleware.RequirePermission(rbac, "academy.commerce").
// nil rails fall back to deterministic dev stubs; nil member/admin groups are skipped.
//
//	member: /academy/commerce/{plans,bundles,bundles/:id/manifest},
//	        /academy/commerce/orders[/:id/{pay,bnpl}],
//	        /academy/commerce/{subscribe,access-cards/activate,sync}
//	admin : /academy/commerce/admin/{orders/:id/refund, access-cards/*, plans*, bundles*}
func RegisterAcademyCommerce(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, pay PaymentRail, bnpl BNPLRail, gate ApprovalGate) {
	if pool == nil {
		return
	}
	if pay == nil {
		pay = StubPaymentRail{}
	}
	if bnpl == nil {
		bnpl = StubBNPLRail{}
	}
	svc := NewService(pool, pay, bnpl).WithApprovalGate(gate) // gate nil ⇒ no child-safety gate
	h := NewHandler(svc)

	if member != nil {
		mg := member.Group("/academy/commerce")
		mg.GET("/plans", h.ListPlans)
		mg.GET("/bundles", h.ListBundles)
		mg.GET("/bundles/:id", h.GetBundle)
		mg.GET("/bundles/:id/manifest", h.BundleManifest)
		mg.POST("/orders", h.CreateOrder)
		mg.POST("/orders/:id/pay", h.PayNow)
		mg.POST("/orders/:id/bnpl", h.StartBNPL)
		mg.POST("/access-cards/activate", h.ActivateCard)
		mg.POST("/subscribe", h.Subscribe)
		mg.POST("/sync", h.Sync)
	}

	if admin != nil {
		guard := middleware.RequirePermission(rbac, "academy.commerce")
		ag := admin.Group("/academy/commerce/admin")
		ag.Use(guard)
		ag.POST("/orders/:id/refund", h.AdminRefund)
		ag.POST("/access-cards/generate", h.AdminGenerateCards)
		ag.POST("/access-cards/allocate", h.AdminAllocateCards)
		ag.GET("/access-cards", h.AdminListAccessCards)
		ag.GET("/payments/overview", h.AdminPaymentsOverview)
		// Catalog CRUD (plans/bundles): list under the same RBAC for admin tooling.
		ag.GET("/plans", h.ListPlans)
		ag.GET("/bundles", h.ListBundles)
	}
}

// ── Member handlers ─────────────────────────────────────────────────────────────

func (h *Handler) ListPlans(c *gin.Context) {
	out, err := h.svc.ListPlans(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListBundles(c *gin.Context) {
	out, err := h.svc.ListBundles(c.Request.Context(), c.Query("arena"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetBundle returns a single exam bundle by id (public catalog read; same ExamBundle
// shape as the ListBundles list item).
func (h *Handler) GetBundle(c *gin.Context) {
	out, err := h.svc.GetBundle(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) BundleManifest(c *gin.Context) {
	out, err := h.svc.BundleManifest(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) CreateOrder(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req CreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateOrder(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) PayNow(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.PayNow(c.Request.Context(), u, c.Param("id"), idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) StartBNPL(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.StartBNPL(c.Request.Context(), u, c.Param("id"), idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ActivateCard(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req ActivateCardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	ent, err := h.svc.Activate(c.Request.Context(), u, req.Serial, req.PIN, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ent})
}

func (h *Handler) Subscribe(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req SubscribeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.Subscribe(c.Request.Context(), u, req.PlanID, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Sync(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req SyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.Sync(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers (RBAC academy.commerce) ──────────────────────────────────────

func (h *Handler) AdminRefund(c *gin.Context) {
	out, err := h.svc.Refund(c.Request.Context(), uid(c), c.Param("id"), idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminGenerateCards(c *gin.Context) {
	var req GenerateCardsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.GenerateBatch(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// AdminListAccessCards lists access-card batches/cards (admin console read).
// ?batch= filters to one batch; ?limit= caps the page (newest first).
func (h *Handler) AdminListAccessCards(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.ListAccessCards(c.Request.Context(), c.Query("batch"), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminPaymentsOverview aggregates orders by state/amount for the payments console.
func (h *Handler) AdminPaymentsOverview(c *gin.Context) {
	out, err := h.svc.PaymentsOverview(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminAllocateCards(c *gin.Context) {
	var req AllocateCardsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	n, err := h.svc.AllocateToAgent(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"allocated": n}})
}

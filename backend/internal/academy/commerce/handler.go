package commerce

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

const keyMessage = "message"

const keyInvalidInput = "invalid_input"

const keyError = "error"

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
// authUserID adapts middleware.GetAuthenticatedUser to ginutil.UserID’s
// fallback signature for contexts missing the "user_id" key.
func authUserID(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

// fail maps sentinel errors to stable snake_case codes + HTTP statuses.
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: "not_found", keyMessage: httperr.Msg(c, http.StatusNotFound, err)})
	case errors.Is(err, ErrApprovalRequired):
		c.JSON(http.StatusForbidden, gin.H{keyError: "approval_required", keyMessage: httperr.Msg(c, http.StatusForbidden, err)})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{keyError: "illegal_transition", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{keyError: "idempotency_key_required", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrIdempotencyKeyReused):
		c.JSON(http.StatusConflict, gin.H{keyError: "idempotency_key_reused", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid_amount", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrCatalogItemInactive):
		c.JSON(http.StatusConflict, gin.H{keyError: "catalog_item_inactive", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrRefundNotEligible):
		c.JSON(http.StatusConflict, gin.H{keyError: "refund_not_eligible", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrAccessCardInvalid):
		c.JSON(http.StatusBadRequest, gin.H{keyError: "access_card_invalid", keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrAccessCardConsumed):
		c.JSON(http.StatusConflict, gin.H{keyError: "access_card_consumed", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrEntitlementAlreadyGrant):
		c.JSON(http.StatusConflict, gin.H{keyError: "entitlement_already_granted", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: "internal", keyMessage: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: "unauthenticated"})
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
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
	out, err := h.svc.PayNow(c.Request.Context(), u, c.Param("id"), ginutil.IdempotencyKey(c))
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
	out, err := h.svc.StartBNPL(c.Request.Context(), u, c.Param("id"), ginutil.IdempotencyKey(c))
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ent, err := h.svc.Activate(c.Request.Context(), u, req.Serial, req.PIN, ginutil.IdempotencyKey(c))
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.Subscribe(c.Request.Context(), u, req.PlanID, ginutil.IdempotencyKey(c))
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.Sync(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminRefund(c *gin.Context) {
	out, err := h.svc.Refund(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"), ginutil.IdempotencyKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminGenerateCards(c *gin.Context) {
	var req GenerateCardsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.GenerateBatch(c.Request.Context(), ginutil.UserID(c, authUserID), req)
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	n, err := h.svc.AllocateToAgent(c.Request.Context(), ginutil.UserID(c, authUserID), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"allocated": n}})
}

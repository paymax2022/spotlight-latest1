package catalog

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/kyc"
)

// Handler exposes catalog routes. Member routes filter by the caller's KYC tier;
// admin routes manage catalog + routing.
type Handler struct {
	svc    *Service
	kyc    *kyc.Service
	syncer *Syncer
	floats *FloatService
	// health reports adapter configuration for the admin providers screen. It
	// returns PRESENCE booleans and base URLs only — never a credential value.
	health func() any
}

// NewHandler constructs the catalog handler. kycSvc may be nil (members then
// resolve to tier 0 and only see tier-0 products).
func NewHandler(svc *Service, kycSvc *kyc.Service) *Handler {
	return &Handler{svc: svc, kyc: kycSvc}
}

// WithAdmin attaches the admin-side dependencies: the catalog syncer, the
// provider float breaker, and an adapter-health reporter. All are optional; the
// corresponding routes report "unavailable" rather than failing when absent.
func (h *Handler) WithAdmin(syncer *Syncer, floats *FloatService, health func() any) *Handler {
	h.syncer = syncer
	h.floats = floats
	h.health = health
	return h
}

// ListProducts (member): GET /products?line=&context=
// Filtered by KYC tier + optional product_line context (PRD §12.1).
func (h *Handler) ListProducts(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	tier := 0
	if h.kyc != nil {
		if p, err := h.kyc.GetProfile(c.Request.Context(), userID); err == nil && p != nil {
			tier = int(p.Tier)
		}
	}
	line := c.Query("line")
	if line == "" {
		line = c.Query("context")
	}
	products, err := h.svc.ListForMember(c.Request.Context(), tier, line)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": products})
}

// AdminList (admin): GET /catalog — all products incl. inactive.
func (h *Handler) AdminList(c *gin.Context) {
	products, err := h.svc.ListAdmin(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": products})
}

// AdminSetActive (admin): PATCH /catalog/:code/active {active:bool}
func (h *Handler) AdminSetActive(c *gin.Context) {
	code := c.Param("code")
	var body struct {
		Active bool `json:"active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetActive(c.Request.Context(), code, body.Active); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"code": code, "active": body.Active}})
}

// AdminSetRouting (admin): PATCH /routing/:code {provider, provider_product_code}
// Re-routes a product to a different aggregator — a data edit, not a code change.
func (h *Handler) AdminSetRouting(c *gin.Context) {
	code := c.Param("code")
	var body struct {
		Provider            string `json:"provider" binding:"required"`
		ProviderProductCode string `json:"provider_product_code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetProvider(c.Request.Context(), code, body.Provider, body.ProviderProductCode); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"code": code, "provider": body.Provider}})
}

// ════════════════════════════════════════════════════════════════════════════
// Product detail + dynamic form schema (member)
// ════════════════════════════════════════════════════════════════════════════

// GetProduct (member): GET /products/:code — one product, including its
// form_schema, so the app can render the purchase form without a second call.
func (h *Handler) GetProduct(c *gin.Context) {
	if c.GetString("user_id") == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{"code": "unauthenticated", "message": "sign in required"}})
		return
	}
	p, err := h.svc.Get(c.Request.Context(), c.Param("code"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "not_found", "message": "product not found"}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// GetProductSchema (member): GET /products/:code/schema — the dynamic form the
// app renders for this product.
//
// MyCover validates a bespoke field set per purchase family, so there is no one
// hardcoded quote form. When a schema has NOT been discovered yet the response
// says so explicitly (available:false with a reason) instead of returning an
// empty field list, which the app would render as a blank form that can never
// validate — a dead end the member cannot get out of.
func (h *Handler) GetProductSchema(c *gin.Context) {
	if c.GetString("user_id") == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{"code": "unauthenticated", "message": "sign in required"}})
		return
	}
	code := c.Param("code")
	schema, available, err := h.svc.FormSchema(c.Request.Context(), code)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "not_found", "message": "product not found"}})
		return
	}
	if schema == nil {
		schema = map[string]any{"fields": []any{}}
	}
	schema["available"] = available
	if !available {
		schema["reason"] = "This product's purchase form has not been mapped yet. " +
			"It can be browsed and quoted, but not purchased."
	}
	c.JSON(http.StatusOK, gin.H{"data": schema})
}

// ════════════════════════════════════════════════════════════════════════════
// Catalog sync + provider health (admin)
// ════════════════════════════════════════════════════════════════════════════

// AdminSync (admin): POST /catalog/sync — pull the live provider catalog into
// the DB. Idempotent; safe to re-run. New products land INACTIVE so a sync never
// silently puts an unreviewed product in front of members.
func (h *Handler) AdminSync(c *gin.Context) {
	if h.syncer == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{
			"code":    "sync_unavailable",
			"message": "no provider catalog source is configured (check INSURANCE_MYCOVER_API_KEY)",
		}})
		return
	}
	res, err := h.syncer.Run(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		// Report the run either way — a failed sync must be visible, not silent.
		c.JSON(http.StatusBadGateway, gin.H{
			"error": gin.H{"code": "sync_failed", "message": err.Error()},
			"data":  res,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// AdminProviders (admin): GET /providers — adapter health, last sync, live/test
// mode, and the prefunded-float state.
//
// It reports credential PRESENCE and never a value. The float section is the
// launch gate: MyCover settles binds from a prefunded distributor wallet, so
// binding_paused there means no policy can be issued no matter how healthy
// everything else looks.
func (h *Handler) AdminProviders(c *gin.Context) {
	ctx := c.Request.Context()
	out := gin.H{}

	if h.health != nil {
		out["adapters"] = h.health()
	}
	if h.floats != nil {
		if states, err := h.floats.List(ctx); err == nil {
			out["float"] = states
			for _, s := range states {
				if s.BindingPaused {
					out["binding_paused"] = true
					out["binding_paused_reason"] = "The provider's prefunded wallet is empty. " +
						"Top it up in the provider dashboard, then reset the breaker."
				}
			}
		}
	}
	if h.svc != nil && h.svc.db != nil {
		var (
			provider   string
			status     string
			seen       int
			upserted   int
			failed     int
			startedAt  time.Time
			finishedAt *time.Time
		)
		err := h.svc.db.QueryRow(ctx, `
			SELECT provider, status, products_seen, products_upserted, products_failed,
			       started_at, finished_at
			FROM public.insurance_catalog_sync
			ORDER BY started_at DESC LIMIT 1`).Scan(
			&provider, &status, &seen, &upserted, &failed, &startedAt, &finishedAt)
		if err == nil {
			out["last_sync"] = gin.H{
				"provider": provider, "status": status,
				"products_seen": seen, "products_upserted": upserted, "products_failed": failed,
				"started_at": startedAt, "finished_at": finishedAt,
			}
		} else {
			out["last_sync"] = nil
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminResetFloat (admin): POST /providers/:provider/float/reset — re-arm
// binding after an operator has topped the provider wallet up.
//
// note is a HUMAN RECORD of what they funded, not an authority: the real balance
// lives at the provider and /wallet/balance is 403 for our key, so we cannot
// read it. Resetting without actually funding simply means the next bind trips
// the breaker again — which is the safe failure.
func (h *Handler) AdminResetFloat(c *gin.Context) {
	if h.floats == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"code": "unavailable", "message": "float breaker not configured"}})
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	provider := c.Param("provider")
	if err := h.floats.Reset(c.Request.Context(), provider, body.Note, c.GetString("user_id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "reset_failed", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"provider": provider, "state": "ok"}})
}

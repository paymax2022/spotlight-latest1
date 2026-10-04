package nutrition

import (
	"errors"
	"log"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyCode = "code"

// Handler exposes the member (buyer + vendor) and admin nutrition routes.
type Handler struct {
	svc *Service
}

// NewHandler constructs the nutrition handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// mapErr maps service sentinels to clean HTTP codes (no raw DB error leaks; a
// 23514 check_violation is already mapped to ErrAllergenRuleViolation in the repo).
func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	case errors.Is(err, ErrAllergenRuleViolation):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": httperr.Msg(c, http.StatusUnprocessableEntity, err), keyCode: "ALLERGEN_RULE_VIOLATION"})
	case errors.Is(err, ErrSanityBounds):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": httperr.Msg(c, http.StatusUnprocessableEntity, err), keyCode: "SANITY_BOUNDS", "needs_review": true})
	case errors.Is(err, ErrBadState):
		c.JSON(http.StatusConflict, gin.H{"error": httperr.Msg(c, http.StatusConflict, err), keyCode: "ILLEGAL_TRANSITION"})
	case errors.Is(err, ErrVersionConflict):
		c.JSON(http.StatusConflict, gin.H{"error": httperr.Msg(c, http.StatusConflict, err), keyCode: "VERSION_CONFLICT"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// GetDish (buyer-readable): GET /dishes/:dishId — current profile + display +
// allergens. Lazily resolves on first read so the block is never empty.
func (h *Handler) GetDish(c *gin.Context) {
	view, err := h.svc.GetDishView(c.Request.Context(), c.Param("dishId"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, view)
}

// DeclareRecipe (vendor, owner-checked, HIDDEN power path): POST /dishes/:dishId/recipe.
func (h *Handler) DeclareRecipe(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		Ingredients  []Ingredient `json:"ingredients" binding:"required,min=1"`
		PortionSizeG float64      `json:"portion_size_g" binding:"required"`
		CookMethod   string       `json:"cook_method"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	profile, err := h.svc.DeclareRecipe(c.Request.Context(), c.Param("dishId"), ginutil.UserID(c), DeclareRecipeInput{
		Ingredients:  body.Ingredients,
		PortionSizeG: body.PortionSizeG,
		CookMethod:   body.CookMethod,
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile, "disclaimer": Disclaimer})
}

// Approve (vendor, owner-checked): POST /dishes/:dishId/approve. Marks the
// estimate RESTAURANT_CONFIRMED (still an estimate) and grants the
// "Nutrition-Verified" badge.
func (h *Handler) Approve(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	profile, err := h.svc.Approve(c.Request.Context(), c.Param("dishId"), ginutil.UserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile, "badge": "Nutrition-Verified", "disclaimer": Disclaimer})
}

// Edit (vendor, owner-checked): POST /dishes/:dishId/edit. Lightweight portion
// selector + macro nudge ONLY (never ingredients); an edit is an implicit
// approval → RESTAURANT_CONFIRMED.
func (h *Handler) Edit(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		PortionLabel      string             `json:"portion_label"`
		PortionMacroNudge map[string]float64 `json:"portion_macro_nudges"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if body.PortionLabel == "" && len(body.PortionMacroNudge) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide portion_label and/or portion_macro_nudges"})
		return
	}
	profile, err := h.svc.Edit(c.Request.Context(), c.Param("dishId"), ginutil.UserID(c), EditInput{
		PortionLabel:      body.PortionLabel,
		PortionMacroNudge: body.PortionMacroNudge,
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile, "badge": "Nutrition-Verified", "disclaimer": Disclaimer})
}

// AutoSuggestMenu (vendor, owner-checked): POST /menus/:menuId/auto-suggest.
// menuId IS the restaurantId (menu_items has no menu_id column). Batch-estimates +
// auto-publishes AI_ESTIMATE for every item lacking a profile (or STALE).
func (h *Handler) AutoSuggestMenu(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	n, err := h.svc.AutoSuggestMenu(c.Request.Context(), c.Param("menuId"), ginutil.UserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"estimated": n, "disclaimer": Disclaimer})
}

// ApproveAll (vendor, owner-checked): POST /menus/:menuId/approve-all. menuId IS
// the restaurantId. Approves every AI_ESTIMATE dish for the restaurant.
func (h *Handler) ApproveAll(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	n, err := h.svc.ApproveAll(c.Request.Context(), c.Param("menuId"), ginutil.UserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"approved": n, "badge": "Nutrition-Verified", "disclaimer": Disclaimer})
}

// AttestAllergens (vendor, owner-checked): POST /dishes/:dishId/allergens.
func (h *Handler) AttestAllergens(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		Allergens []AllergenAttestInput `json:"allergens" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.AttestAllergens(c.Request.Context(), c.Param("dishId"), ginutil.UserID(c), body.Allergens)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"allergens": out, "disclaimer": Disclaimer})
}

// CartSummary: GET /cart/summary?ids=a,b,c  OR  POST {dish_ids:[...]}.
func (h *Handler) CartSummary(c *gin.Context) {
	var ids []string
	if c.Request.Method == http.MethodPost {
		var body struct {
			DishIDs []string `json:"dish_ids"`
		}
		_ = c.ShouldBindJSON(&body)
		ids = body.DishIDs
	} else {
		if raw := c.Query("ids"); raw != "" {
			ids = strings.Split(raw, ",")
		}
	}
	if len(ids) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no dish ids provided"})
		return
	}
	summary, err := h.svc.CartSummaryByIDs(c.Request.Context(), ids)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, summary)
}

// AdminUpsertComposition: POST /composition — append a new versioned reference.
func (h *Handler) AdminUpsertComposition(c *gin.Context) {
	var c0 Composition
	if err := c.ShouldBindJSON(&c0); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.UpsertComposition(c.Request.Context(), ginutil.UserID(c), c0)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// AdminUpsertLibrary: POST /library — curate a library entry.
func (h *Handler) AdminUpsertLibrary(c *gin.Context) {
	var e LibraryEntry
	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.UpsertLibrary(c.Request.Context(), ginutil.UserID(c), e); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "slug": e.Slug})
}

// AdminReresolve: POST /reresolve — batch re-resolve on a version bump.
func (h *Handler) AdminReresolve(c *gin.Context) {
	var body struct {
		Limit int `json:"limit"`
	}
	_ = c.ShouldBindJSON(&body)
	n, err := h.svc.Reresolve(c.Request.Context(), body.Limit)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"reresolved": n})
}

// AdminListConsults: GET /consults?status=&priority=&q= — the review queue of dish
// nutrition profiles awaiting a human resolve/accept (mapped onto the console's
// "nutritionist consult" shape; see admin_oversight.go for what is real vs a
// placeholder). RBAC nutrition.admin.manage at the route.
func (h *Handler) AdminListConsults(c *gin.Context) {
	f := AdminConsultFilters{
		Status:   c.Query("status"),
		Priority: c.Query("priority"),
		Q:        c.Query("q"),
	}
	rows, err := h.svc.AdminListConsults(c.Request.Context(), f, 0)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"consults": rows})
}

// AdminResolveConsult: POST /consults/:id/resolve {resolution, note} — a REAL
// human resolve/accept/close over the dish profile behind the consult. Audited.
// RBAC nutrition.admin.resolve at the route.
func (h *Handler) AdminResolveConsult(c *gin.Context) {
	var body struct {
		Resolution string `json:"resolution"`
		Note       string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	out, err := h.svc.AdminResolveConsult(c.Request.Context(), c.Param("id"), ginutil.UserID(c), body.Resolution, body.Note)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"consult": out})
}

// AdminPayoutRuns: GET /payouts — read-only. Returns an explicit, documented EMPTY
// shape: the nutrition module has NO settlement/payout entity and never fabricates
// money (see admin_oversight.go TODO). RBAC nutrition.admin.manage at the route.
func (h *Handler) AdminPayoutRuns(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.AdminPayoutRuns(c.Request.Context()))
}

// AdminResolve: POST /resolve — force-resolve a single dish (the internal resolve).
func (h *Handler) AdminResolve(c *gin.Context) {
	var body struct {
		DishID          string  `json:"dish_id" binding:"required"`
		Barcode         string  `json:"barcode"`
		DefaultPortionG float64 `json:"default_portion_g"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	profile, err := h.svc.Resolve(c.Request.Context(), ResolveInput{
		MenuItemID:      body.DishID,
		Barcode:         body.Barcode,
		DefaultPortionG: body.DefaultPortionG,
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile, "disclaimer": Disclaimer})
}

// RBAC permission slugs for the admin surface.
const (
	PermNutritionManage  = "nutrition.admin.manage"  // composition + library curation
	PermNutritionResolve = "nutrition.admin.resolve" // force/batch resolve
)

// RegisterNutrition wires the Nutrition Resolution Engine routes.
//
//	member — the authed finance group (auth via the finance group's requireUserID;
//	         vendor actions are object-level owner-checked inside the service).
//	admin  — the admin group (already has requireUserID); per-route RBAC is added
//	         here via middleware.RequirePermission.
//	pool   — the pgx pool (money is N/A; this is read/write of NRE rows only).
//	rbac   — the RBAC service for the admin permission gates.
//	llm    — the Tier-3 AI estimator (an *llm.Client satisfies LLMGenerator); may
//	         be nil/disabled, in which case the deterministic mock is used.
//
// The Tier-0 barcode/label source defaults to the deterministic MockLabelLookup
// so the engine resolves end-to-end without a network dependency.
func RegisterNutrition(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, llm LLMGenerator) {
	if pool == nil {
		log.Println("[nutrition] nil pool — skipping nutrition routes")
		return
	}

	repo := NewRepository(pool)
	svc := NewService(repo).
		WithLLM(llm).
		WithLabelLookup(NewMockLabelLookup())
	h := NewHandler(svc)

	nut := member.Group("/nutrition")
	nut.GET("/dishes/:dishId", h.GetDish)                      // buyer-readable
	nut.POST("/dishes/:dishId/approve", h.Approve)             // vendor approve → RESTAURANT_CONFIRMED
	nut.POST("/dishes/:dishId/edit", h.Edit)                   // vendor portion+macro edit (no ingredients)
	nut.POST("/dishes/:dishId/allergens", h.AttestAllergens)   // vendor allergen attest
	nut.POST("/dishes/:dishId/recipe", h.DeclareRecipe)        // HIDDEN power path → grounding RECIPE
	nut.POST("/menus/:menuId/auto-suggest", h.AutoSuggestMenu) // batch auto-estimate (menuId = restaurantId)
	nut.POST("/menus/:menuId/approve-all", h.ApproveAll)       // batch approve (menuId = restaurantId)
	nut.GET("/cart/summary", h.CartSummary)                    // ?ids=a,b,c
	nut.POST("/cart/summary", h.CartSummary)                   // body {dish_ids:[...]}

	admin.POST("/composition", middleware.RequirePermission(rbac, PermNutritionManage), h.AdminUpsertComposition)
	admin.POST("/library", middleware.RequirePermission(rbac, PermNutritionManage), h.AdminUpsertLibrary)
	admin.POST("/reresolve", middleware.RequirePermission(rbac, PermNutritionResolve), h.AdminReresolve)
	admin.POST("/resolve", middleware.RequirePermission(rbac, PermNutritionResolve), h.AdminResolve)

	//    consults = the dish-profile review queue mapped onto the console's consult
	//    shape (real review entity; person fields are documented placeholders).
	//    resolve  = a real human resolve/accept/close over that profile (audited).
	//    payouts  = READ-ONLY explicit empty shape — no settlement entity exists,
	//               money is never fabricated here (see admin_oversight.go).
	admin.GET("/consults", middleware.RequirePermission(rbac, PermNutritionManage), h.AdminListConsults)
	admin.POST("/consults/:id/resolve", middleware.RequirePermission(rbac, PermNutritionResolve), h.AdminResolveConsult)
	admin.GET("/payouts", middleware.RequirePermission(rbac, PermNutritionManage), h.AdminPayoutRuns)

	log.Println("[nutrition] NRE routes registered at /api/finance/nutrition + /api/nutrition/admin")
}

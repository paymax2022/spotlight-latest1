package nutrition

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Handler exposes the member (buyer + vendor) and admin nutrition routes.
type Handler struct {
	svc *Service
}

// NewHandler constructs the nutrition handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

// mapErr maps service sentinels to clean HTTP codes (no raw DB error leaks; a
// 23514 check_violation is already mapped to ErrAllergenRuleViolation in the repo).
func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	case errors.Is(err, ErrAllergenRuleViolation):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "ALLERGEN_RULE_VIOLATION"})
	case errors.Is(err, ErrSanityBounds):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "SANITY_BOUNDS", "needs_review": true})
	case errors.Is(err, ErrBadState):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "ILLEGAL_TRANSITION"})
	case errors.Is(err, ErrVersionConflict):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "VERSION_CONFLICT"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// ── Member (buyer-readable + vendor actions) ──────────────────────────────────

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
	if uid(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		Ingredients  []Ingredient `json:"ingredients" binding:"required,min=1"`
		PortionSizeG float64      `json:"portion_size_g" binding:"required"`
		CookMethod   string       `json:"cook_method"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	profile, err := h.svc.DeclareRecipe(c.Request.Context(), c.Param("dishId"), uid(c), DeclareRecipeInput{
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
	if uid(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	profile, err := h.svc.Approve(c.Request.Context(), c.Param("dishId"), uid(c))
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
	if uid(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		PortionLabel      string             `json:"portion_label"`
		PortionMacroNudge map[string]float64 `json:"portion_macro_nudges"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.PortionLabel == "" && len(body.PortionMacroNudge) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide portion_label and/or portion_macro_nudges"})
		return
	}
	profile, err := h.svc.Edit(c.Request.Context(), c.Param("dishId"), uid(c), EditInput{
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
	if uid(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	n, err := h.svc.AutoSuggestMenu(c.Request.Context(), c.Param("menuId"), uid(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"estimated": n, "disclaimer": Disclaimer})
}

// ApproveAll (vendor, owner-checked): POST /menus/:menuId/approve-all. menuId IS
// the restaurantId. Approves every AI_ESTIMATE dish for the restaurant.
func (h *Handler) ApproveAll(c *gin.Context) {
	if uid(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	n, err := h.svc.ApproveAll(c.Request.Context(), c.Param("menuId"), uid(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"approved": n, "badge": "Nutrition-Verified", "disclaimer": Disclaimer})
}

// AttestAllergens (vendor, owner-checked): POST /dishes/:dishId/allergens.
func (h *Handler) AttestAllergens(c *gin.Context) {
	if uid(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		Allergens []AllergenAttestInput `json:"allergens" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.AttestAllergens(c.Request.Context(), c.Param("dishId"), uid(c), body.Allergens)
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

// ── Admin (RBAC-gated at the route) ───────────────────────────────────────────

// AdminUpsertComposition: POST /composition — append a new versioned reference.
func (h *Handler) AdminUpsertComposition(c *gin.Context) {
	var c0 Composition
	if err := c.ShouldBindJSON(&c0); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.UpsertComposition(c.Request.Context(), uid(c), c0)
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
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpsertLibrary(c.Request.Context(), uid(c), e); err != nil {
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

// AdminResolve: POST /resolve — force-resolve a single dish (the internal resolve).
func (h *Handler) AdminResolve(c *gin.Context) {
	var body struct {
		DishID          string  `json:"dish_id" binding:"required"`
		Barcode         string  `json:"barcode"`
		DefaultPortionG float64 `json:"default_portion_g"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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

package restaurant

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"spotlight/backend/go-common/httperr"
)

// FOOD-011 / C-005: modifier-group read + admin CRUD. Admin routes sit behind
// restaurant.admin.onboarding (wired in finance_routes.go). Deletes are hard:
// menu_modifier_groups has no deleted_at, and order_item_modifiers snapshots name +
// price (its modifier_id FK blocks deleting an option that was ever ordered, which
// surfaces as 409 — mark it unavailable instead).

// ListModifierGroups → GET /api/finance/restaurant/menu/items/:itemId/modifier-groups.
func (h *Handler) ListModifierGroups(c *gin.Context) {
	groups, ok, err := h.svc.ListItemModifierGroupsWire(c.Request.Context(), c.Param("itemId"))
	switch {
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	case !ok:
		c.JSON(http.StatusNotFound, gin.H{keyError: "menu item not found"})
	default:
		c.JSON(http.StatusOK, gin.H{"item_id": c.Param("itemId"), "modifier_groups": groups})
	}
}

// AdminListModifierGroups → GET /api/restaurant/admin/menu-items/:itemId/modifier-groups.
func (h *Handler) AdminListModifierGroups(c *gin.Context) { h.ListModifierGroups(c) }

type adminModifierGroupBody struct {
	Name      *string `json:"name"`
	Kind      *string `json:"kind"`
	Required  *bool   `json:"required"`
	MinSelect *int    `json:"min_select"`
	MaxSelect *int    `json:"max_select"`
	SortOrder *int    `json:"sort_order"`
}

// resolveGroupRules merges the body onto the current rules (kind first, explicit
// fields override) and validates them against the DB CHECK constraints.
func resolveGroupRules(b adminModifierGroupBody, required bool, minS, maxS int) (bool, int, int, error) {
	if b.Kind != nil {
		switch *b.Kind {
		case "required_single":
			required, minS, maxS = true, 1, 1
		case "optional_single":
			required, minS, maxS = false, 0, 1
		case "required_multi":
			required, minS = true, 1
			if maxS < 2 {
				maxS = 2
			}
		case "optional_multi":
			required, minS = false, 0
			if maxS < 2 {
				maxS = 2
			}
		default:
			return false, 0, 0, &invalidInputError{"kind must be required_single|optional_single|required_multi|optional_multi"}
		}
	}
	if b.Required != nil {
		required = *b.Required
	}
	if b.MinSelect != nil {
		minS = *b.MinSelect
	}
	if b.MaxSelect != nil {
		maxS = *b.MaxSelect
	}
	if required && minS < 1 {
		minS = 1
	}
	if minS < 0 || maxS < 1 || maxS < minS {
		return false, 0, 0, &invalidInputError{"need 0 <= min_select <= max_select and max_select >= 1"}
	}
	return required, minS, maxS, nil
}

func modifierErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		c.JSON(http.StatusNotFound, gin.H{keyError: "not found"})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{keyError: err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

func validUUIDParam(c *gin.Context, name string) bool {
	if _, err := uuid.Parse(c.Param(name)); err != nil {
		c.JSON(http.StatusNotFound, gin.H{keyError: "not found"})
		return false
	}
	return true
}

// AdminCreateModifierGroup → POST /api/restaurant/admin/menu-items/:itemId/modifier-groups.
func (h *Handler) AdminCreateModifierGroup(c *gin.Context) {
	if !validUUIDParam(c, "itemId") {
		return
	}
	var b adminModifierGroupBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if b.Name == nil || len(*b.Name) < 1 || len(*b.Name) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "name is required (1-100 chars)"})
		return
	}
	required, minS, maxS, err := resolveGroupRules(b, false, 0, 1)
	if err != nil {
		modifierErr(c, err)
		return
	}
	sort := 0
	if b.SortOrder != nil {
		sort = *b.SortOrder
	}
	ctx := c.Request.Context()
	var exists bool
	if err := h.svc.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM menu_items WHERE id=$1)`, c.Param("itemId")).Scan(&exists); err != nil {
		modifierErr(c, err)
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{keyError: "menu item not found"})
		return
	}
	id := uuid.New().String()
	if _, err := h.svc.db.Exec(ctx,
		`INSERT INTO menu_modifier_groups (id, menu_item_id, name, required, min_select, max_select, sort_order)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, c.Param("itemId"), *b.Name, required, minS, maxS, sort); err != nil {
		modifierErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, toModifierGroupWire(ModifierGroup{ID: id, Name: *b.Name, Required: required, MinSelect: minS, MaxSelect: maxS}))
}

// AdminUpdateModifierGroup → PATCH /api/restaurant/admin/modifier-groups/:groupId.
func (h *Handler) AdminUpdateModifierGroup(c *gin.Context) {
	if !validUUIDParam(c, "groupId") {
		return
	}
	var b adminModifierGroupBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ctx := c.Request.Context()
	var g ModifierGroup
	var sort int
	if err := h.svc.db.QueryRow(ctx, `SELECT name, required, min_select, max_select, sort_order FROM menu_modifier_groups WHERE id=$1`,
		c.Param("groupId")).Scan(&g.Name, &g.Required, &g.MinSelect, &g.MaxSelect, &sort); err != nil {
		modifierErr(c, err)
		return
	}
	g.ID = c.Param("groupId")
	if b.Name != nil {
		if len(*b.Name) < 1 || len(*b.Name) > 100 {
			c.JSON(http.StatusBadRequest, gin.H{keyError: "name must be 1-100 chars"})
			return
		}
		g.Name = *b.Name
	}
	if b.SortOrder != nil {
		sort = *b.SortOrder
	}
	var err error
	if g.Required, g.MinSelect, g.MaxSelect, err = resolveGroupRules(b, g.Required, g.MinSelect, g.MaxSelect); err != nil {
		modifierErr(c, err)
		return
	}
	if _, err := h.svc.db.Exec(ctx, `UPDATE menu_modifier_groups SET name=$2, required=$3, min_select=$4, max_select=$5, sort_order=$6 WHERE id=$1`,
		g.ID, g.Name, g.Required, g.MinSelect, g.MaxSelect, sort); err != nil {
		modifierErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toModifierGroupWire(g))
}

// AdminDeleteModifierGroup → DELETE /api/restaurant/admin/modifier-groups/:groupId.
func (h *Handler) AdminDeleteModifierGroup(c *gin.Context) {
	if !validUUIDParam(c, "groupId") {
		return
	}
	h.deleteModifierRow(c, `DELETE FROM menu_modifier_groups WHERE id=$1`, c.Param("groupId"))
}

type adminModifierOptionBody struct {
	Name           *string `json:"name"`
	PriceDeltaKobo *int64  `json:"price_delta_kobo"`
	Available      *bool   `json:"available"`
	SortOrder      *int    `json:"sort_order"`
}

// AdminCreateModifierOption → POST /api/restaurant/admin/modifier-groups/:groupId/options.
func (h *Handler) AdminCreateModifierOption(c *gin.Context) {
	if !validUUIDParam(c, "groupId") {
		return
	}
	var b adminModifierOptionBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if b.Name == nil || len(*b.Name) < 1 || len(*b.Name) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "name is required (1-100 chars)"})
		return
	}
	var delta int64
	if b.PriceDeltaKobo != nil {
		delta = *b.PriceDeltaKobo
	}
	if delta < 0 || delta > maxItemPriceKobo {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "price_delta_kobo must be between 0 and 100000000"})
		return
	}
	avail, sort := true, 0
	if b.Available != nil {
		avail = *b.Available
	}
	if b.SortOrder != nil {
		sort = *b.SortOrder
	}
	ctx := c.Request.Context()
	var exists bool
	if err := h.svc.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM menu_modifier_groups WHERE id=$1)`, c.Param("groupId")).Scan(&exists); err != nil {
		modifierErr(c, err)
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{keyError: "modifier group not found"})
		return
	}
	id := uuid.New().String()
	if _, err := h.svc.db.Exec(ctx, `INSERT INTO menu_modifiers (id, group_id, name, price_delta_kobo, is_available, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
		id, c.Param("groupId"), *b.Name, delta, avail, sort); err != nil {
		modifierErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, ModifierOptionWire{ID: id, Name: *b.Name, PriceDeltaKobo: delta, Available: avail})
}

// AdminUpdateModifierOption → PATCH /api/restaurant/admin/modifier-groups/:groupId/options/:optionId.
func (h *Handler) AdminUpdateModifierOption(c *gin.Context) {
	if !validUUIDParam(c, "groupId") || !validUUIDParam(c, "optionId") {
		return
	}
	var b adminModifierOptionBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ctx := c.Request.Context()
	var o ModifierOptionWire
	var sort int
	if err := h.svc.db.QueryRow(ctx, `SELECT id, name, price_delta_kobo, is_available, sort_order FROM menu_modifiers WHERE id=$1 AND group_id=$2`,
		c.Param("optionId"), c.Param("groupId")).Scan(&o.ID, &o.Name, &o.PriceDeltaKobo, &o.Available, &sort); err != nil {
		modifierErr(c, err)
		return
	}
	if b.Name != nil {
		if len(*b.Name) < 1 || len(*b.Name) > 100 {
			c.JSON(http.StatusBadRequest, gin.H{keyError: "name must be 1-100 chars"})
			return
		}
		o.Name = *b.Name
	}
	if b.PriceDeltaKobo != nil {
		if *b.PriceDeltaKobo < 0 || *b.PriceDeltaKobo > maxItemPriceKobo {
			c.JSON(http.StatusBadRequest, gin.H{keyError: "price_delta_kobo must be between 0 and 100000000"})
			return
		}
		o.PriceDeltaKobo = *b.PriceDeltaKobo
	}
	if b.Available != nil {
		o.Available = *b.Available
	}
	if b.SortOrder != nil {
		sort = *b.SortOrder
	}
	if _, err := h.svc.db.Exec(ctx, `UPDATE menu_modifiers SET name=$2, price_delta_kobo=$3, is_available=$4, sort_order=$5 WHERE id=$1`,
		o.ID, o.Name, o.PriceDeltaKobo, o.Available, sort); err != nil {
		modifierErr(c, err)
		return
	}
	c.JSON(http.StatusOK, o)
}

// AdminDeleteModifierOption → DELETE /api/restaurant/admin/modifier-groups/:groupId/options/:optionId.
func (h *Handler) AdminDeleteModifierOption(c *gin.Context) {
	if !validUUIDParam(c, "groupId") || !validUUIDParam(c, "optionId") {
		return
	}
	h.deleteModifierRow(c, `DELETE FROM menu_modifiers WHERE id=$1 AND group_id=$2`, c.Param("optionId"), c.Param("groupId"))
}

func (h *Handler) deleteModifierRow(c *gin.Context, q string, args ...any) {
	tag, err := h.svc.db.Exec(c.Request.Context(), q, args...)
	if err != nil {
		// FK from order_item_modifiers: an option that was ever ordered can't be deleted.
		if pgErrCode(err) == "23503" {
			c.JSON(http.StatusConflict, gin.H{keyError: "already used on orders; mark the option unavailable instead"})
			return
		}
		modifierErr(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{keyError: "not found"})
		return
	}
	c.Status(http.StatusNoContent)
}

func pgErrCode(err error) string {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.Code
	}
	return ""
}

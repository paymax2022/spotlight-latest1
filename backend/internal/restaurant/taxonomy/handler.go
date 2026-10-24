package taxonomy

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const codeCategoryForbidden = "CATEGORY_MANAGEMENT_FORBIDDEN"

// ForbidOwnerCategoryWrite answers an owner's category create or delete. Categories
// are admin-managed; owners pick from them when they add an item.
func ForbidOwnerCategoryWrite(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{
		"error":   codeCategoryForbidden,
		"message": "Menu categories are managed by Spotlight. Pick one from the list when you add an item.",
	})
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register mounts the admin routes (restaurant.manage) and the owner's read-only views.
func Register(admin, owner *gin.RouterGroup, h *Handler, guard func(permission string) gin.HandlerFunc) {
	ad := admin.Group("/menu-taxonomy", guard("restaurant.manage"))
	ad.GET("/categories", h.AdminListCategories)
	ad.POST("/categories", h.AdminCreateCategory)
	ad.PATCH("/categories/reorder", h.AdminReorder)
	ad.PATCH("/categories/:id", h.AdminUpdateCategory)
	ad.DELETE("/categories/:id", h.AdminDeleteCategory)
	ad.POST("/categories/seed-defaults", h.AdminSeedDefaults)
	ad.GET("/cuisines", h.AdminListCuisines)
	ad.POST("/cuisines", h.AdminCreateCuisine)
	ad.PATCH("/cuisines/:id", h.AdminUpdateCuisine)
	ad.POST("/backfill", h.AdminBackfill)
	ad.GET("/needs-review", h.AdminNeedsReview)
	ad.PATCH("/needs-review/remap", h.AdminRemap)

	ow := owner.Group("/menu-taxonomy")
	ow.GET("/categories", h.ListCategories)
	ow.GET("/cuisines", h.ListCuisines)
}

// RegisterBrowse mounts the customer-facing taxonomy reads under
// /menu-taxonomy/browse. They are separate from the owner's /menu-taxonomy reads
// (which the merchant console depends on) so customer browsing has its own kill
// switch: not mounting these hides the chips without touching the merchant UI.
func RegisterBrowse(owner *gin.RouterGroup, h *Handler) {
	br := owner.Group("/menu-taxonomy/browse")
	br.GET("/categories", h.ListCategories)
	br.GET("/cuisines", h.ListCuisines)
}

func writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
	case errors.Is(err, ErrConflict):
		c.JSON(http.StatusConflict, gin.H{"error": "name_or_slug_taken"})
	case errors.Is(err, ErrSeeded):
		c.JSON(http.StatusConflict, gin.H{"error": "default_row_deactivate_instead", "message": err.Error()})
	case errors.As(err, new(ErrInUse)):
		var in ErrInUse
		errors.As(err, &in)
		c.JSON(http.StatusConflict, gin.H{"error": "in_use", "count": in.Count, "message": err.Error()})
	case errors.Is(err, ErrInvalid):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "invalid", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

func boolQuery(c *gin.Context, key string) bool {
	v, _ := strconv.ParseBool(c.Query(key))
	return v
}

func (h *Handler) AdminListCategories(c *gin.Context) {
	nodes, err := h.svc.ListTree(c.Request.Context(), true)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": nodes})
}

// ListCategories is the owner view: active rows only, read-only.
func (h *Handler) ListCategories(c *gin.Context) {
	nodes, err := h.svc.ListTree(c.Request.Context(), false)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": nodes})
}

type createCategoryBody struct {
	Name      string  `json:"name" binding:"required,min=1,max=80"`
	Kind      string  `json:"kind" binding:"required"`
	ParentID  *string `json:"parent_id"`
	Icon      *string `json:"icon"`
	SortOrder int     `json:"sort_order"`
}

func (h *Handler) AdminCreateCategory(c *gin.Context) {
	var b createCategoryBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	n, err := h.svc.Create(c.Request.Context(), ginutil.UserID(c), Input{
		Name: b.Name, Kind: b.Kind, ParentID: b.ParentID, Icon: b.Icon, SortOrder: b.SortOrder,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": n})
}

type updateCategoryBody struct {
	Name     *string `json:"name"`
	Kind     *string `json:"kind"`
	Icon     *string `json:"icon"`
	IsActive *bool   `json:"is_active"`
}

func (h *Handler) AdminUpdateCategory(c *gin.Context) {
	var b updateCategoryBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	n, err := h.svc.Update(c.Request.Context(), ginutil.UserID(c), c.Param("id"), Patch{
		Name: b.Name, Kind: b.Kind, Icon: b.Icon, IsActive: b.IsActive,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": n})
}

func (h *Handler) AdminReorder(c *gin.Context) {
	var body []struct {
		ID        string `json:"id" binding:"required"`
		SortOrder int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "body must be a non-empty [{id, sort_order}] list"})
		return
	}
	orders := make(map[string]int, len(body))
	for _, r := range body {
		orders[r.ID] = r.SortOrder
	}
	if err := h.svc.Reorder(c.Request.Context(), ginutil.UserID(c), orders); err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"reordered": len(orders)}})
}

func (h *Handler) AdminDeleteCategory(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

func (h *Handler) AdminSeedDefaults(c *gin.Context) {
	rep, err := SeedDefaults(c.Request.Context(), h.svc.db)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rep})
}

func (h *Handler) AdminListCuisines(c *gin.Context) {
	out, err := h.svc.ListCuisines(c.Request.Context(), true)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ListCuisines is the owner and customer view: active cuisines only.
func (h *Handler) ListCuisines(c *gin.Context) {
	out, err := h.svc.ListCuisines(c.Request.Context(), false)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

type createCuisineBody struct {
	Name      string `json:"name" binding:"required,min=1,max=80"`
	SortOrder int    `json:"sort_order"`
}

func (h *Handler) AdminCreateCuisine(c *gin.Context) {
	var b createCuisineBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	cu, err := h.svc.CreateCuisine(c.Request.Context(), ginutil.UserID(c), b.Name, b.SortOrder)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": cu})
}

type updateCuisineBody struct {
	Name      *string `json:"name"`
	SortOrder *int    `json:"sort_order"`
	IsActive  *bool   `json:"is_active"`
}

func (h *Handler) AdminUpdateCuisine(c *gin.Context) {
	var b updateCuisineBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	cu, err := h.svc.UpdateCuisine(c.Request.Context(), ginutil.UserID(c), c.Param("id"), b.Name, b.SortOrder, b.IsActive)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cu})
}

// AdminBackfill maps legacy item categories. dry_run defaults to true, so the first
// call only reports what a real run would do.
func (h *Handler) AdminBackfill(c *gin.Context) {
	dry := true
	if v := c.Query("dry_run"); v != "" {
		parsed, err := strconv.ParseBool(v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "dry_run must be true or false"})
			return
		}
		dry = parsed
	}
	rep, err := Backfill(c.Request.Context(), h.svc.db, dry)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rep})
}

func (h *Handler) AdminNeedsReview(c *gin.Context) {
	groups, err := NeedsReview(c.Request.Context(), h.svc.db)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": groups})
}

type remapBody struct {
	Label         string  `json:"label" binding:"required"`
	CategoryID    string  `json:"category_id" binding:"required"`
	SubcategoryID *string `json:"subcategory_id"`
}

func (h *Handler) AdminRemap(c *gin.Context) {
	var b remapBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	n, err := RemapLabel(c.Request.Context(), h.svc.db, ginutil.UserID(c), b.Label, b.CategoryID, b.SubcategoryID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"remapped": n}})
}

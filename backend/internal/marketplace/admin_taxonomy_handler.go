package marketplace

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

// admin_taxonomy_handler.go — GET/POST/PATCH /admin/taxonomy/categories(/:id)
// (MKT-007). CRUD over the pre-existing mkt_categories table (see
// repository_admin_taxonomy.go for the schema note).
//
// ⚠️ Response shape deliberately does NOT use respond() (the package's usual
// {"data": ...} envelope) for the single-object routes. frontend-admin's
// marketplaceAdminService.ts createCategory/getCategory/updateCategory/
// setCategoryActive all do `return res.json()` and immediately read fields off
// the result (`saved.name`, `saved.id`, `c.slug`, ...) with NO `.data` unwrap —
// that file is this endpoint's frozen contract (task brief: "these ARE the
// contract to build to"), so a single category is written bare. The LIST route
// still uses respond() ({"data":[...]}) because listCategories() explicitly
// handles both `Array.isArray(data) ? data : data.data ?? []`.

// categoryBody is the taxonomy console's create/update payload
// (frontend MktCategoryInput) plus the optional reason_code PATCH carries.
type categoryBody struct {
	Name            string          `json:"name"`
	Slug            string          `json:"slug"`
	ParentID        *string         `json:"parent_id"`
	RiskTier        int             `json:"risk_tier"`
	CommissionBps   int             `json:"commission_bps"`
	IsActive        bool            `json:"is_active"`
	AttributeSchema json.RawMessage `json:"attribute_schema"`
	ReasonCode      string          `json:"reason_code"`
}

func (b categoryBody) toCategory(marketID string) Category {
	return Category{
		MarketID:        marketID,
		ParentID:        b.ParentID,
		Slug:            b.Slug,
		Name:            b.Name,
		RiskTier:        b.RiskTier,
		CommissionBps:   b.CommissionBps,
		IsActive:        b.IsActive,
		AttributeSchema: b.AttributeSchema,
	}
}

func validateCategoryBody(b categoryBody) error {
	if b.Name == "" {
		return fieldErr(CodeValidation, "name is required", "name")
	}
	if b.Slug == "" {
		return fieldErr(CodeValidation, "slug is required", "slug")
	}
	if b.RiskTier < 0 || b.RiskTier > 3 {
		return fieldErr(CodeValidation, "risk_tier must be 0..3", "risk_tier")
	}
	if b.CommissionBps < 0 || b.CommissionBps > 10000 {
		return fieldErr(CodeValidation, "commission_bps must be 0..10000", "commission_bps")
	}
	return nil
}

// AdminListCategories GET /admin/taxonomy/categories — every category
// (active + inactive) for the default market, with a live listing_count.
func (h *Handler) AdminListCategories(c *gin.Context) {
	cats, err := h.svc.repo.AdminListCategories(c.Request.Context(), DefaultMarketID)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, cats)
}

// AdminGetCategory GET /admin/taxonomy/categories/:id
func (h *Handler) AdminGetCategory(c *gin.Context) {
	cat, err := h.svc.repo.AdminGetCategory(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, cat)
}

// AdminCreateCategory POST /admin/taxonomy/categories — reason_code optional
// on create (there is no prior state to explain a change from); still written
// to the audit log when present, same as PATCH below.
func (h *Handler) AdminCreateCategory(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body categoryBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	if err := validateCategoryBody(body); err != nil {
		fail(c, err)
		return
	}
	cat, err := h.svc.repo.AdminInsertCategory(c.Request.Context(), body.toCategory(DefaultMarketID))
	if err != nil {
		fail(c, err)
		return
	}
	_ = h.svc.writeAudit(c.Request.Context(), AuditEntry{
		AdminID: uid, Action: "mkt.category.create", TargetType: "category", TargetID: cat.ID,
		ReasonCode: orStr(body.ReasonCode, "category created"),
		AfterState: map[string]any{"name": cat.Name, "slug": cat.Slug, "risk_tier": cat.RiskTier, "commission_bps": cat.CommissionBps, "is_active": cat.IsActive},
	})
	c.JSON(http.StatusOK, cat)
}

// AdminUpdateCategory PATCH /admin/taxonomy/categories/:id — accepts an
// optional reason_code (task brief: "write an audit row if present"). Before/
// after state is captured around the write so the audit trail shows what
// actually changed (mirrors AdminApproveListing's before/after pattern).
func (h *Handler) AdminUpdateCategory(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	id := c.Param("id")
	var body categoryBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	if err := validateCategoryBody(body); err != nil {
		fail(c, err)
		return
	}
	before, err := h.svc.repo.AdminGetCategory(c.Request.Context(), id)
	if err != nil {
		fail(c, err)
		return
	}
	cat, err := h.svc.repo.AdminUpdateCategory(c.Request.Context(), id, body.toCategory(before.MarketID))
	if err != nil {
		fail(c, err)
		return
	}
	if body.ReasonCode != "" {
		_ = h.svc.writeAudit(c.Request.Context(), AuditEntry{
			AdminID: uid, Action: "mkt.category.update", TargetType: "category", TargetID: id,
			ReasonCode:  body.ReasonCode,
			BeforeState: map[string]any{"name": before.Name, "slug": before.Slug, "risk_tier": before.RiskTier, "commission_bps": before.CommissionBps, "is_active": before.IsActive},
			AfterState:  map[string]any{"name": cat.Name, "slug": cat.Slug, "risk_tier": cat.RiskTier, "commission_bps": cat.CommissionBps, "is_active": cat.IsActive},
		})
	}
	c.JSON(http.StatusOK, cat)
}

// setCategoryActiveBody is PATCH /admin/taxonomy/categories/:id/active's body.
type setCategoryActiveBody struct {
	Active     bool   `json:"active"`
	ReasonCode string `json:"reason_code"`
}

// AdminSetCategoryActive PATCH /admin/taxonomy/categories/:id/active — the
// taxonomy console's enable/disable toggle. reason_code MANDATORY (the
// frontend already refuses to call this without one — service.go
// setCategoryActive requires reasonCode — the backend enforces it too rather
// than trusting the client).
func (h *Handler) AdminSetCategoryActive(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	id := c.Param("id")
	var body setCategoryActiveBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	if err := requireReason(body.ReasonCode); err != nil {
		fail(c, err)
		return
	}
	before, err := h.svc.repo.AdminGetCategory(c.Request.Context(), id)
	if err != nil {
		fail(c, err)
		return
	}
	cat, err := h.svc.repo.AdminSetCategoryActive(c.Request.Context(), id, body.Active)
	if err != nil {
		fail(c, err)
		return
	}
	_ = h.svc.writeAudit(c.Request.Context(), AuditEntry{
		AdminID: uid, Action: "mkt.category.set_active", TargetType: "category", TargetID: id,
		ReasonCode:  body.ReasonCode,
		BeforeState: map[string]any{"is_active": before.IsActive},
		AfterState:  map[string]any{"is_active": cat.IsActive},
	})
	c.JSON(http.StatusOK, cat)
}

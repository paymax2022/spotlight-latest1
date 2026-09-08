package association

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Admin organisation-management handlers. Every route is org-scoped in the
// service layer (requireCapInOrg); nothing here authorizes on its own.

// GET /associations/admin/organisations/:id
func (h *Handler) GetAdminOrganisation(c *gin.Context) {
	d, err := h.svc.GetAdminOrganisation(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, d)
}

// PATCH /associations/admin/organisations/:id
func (h *Handler) UpdateAdminOrganisation(c *gin.Context) {
	var b UpdateOrganisationRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b.IdempotencyKey = c.GetHeader("Idempotency-Key")
	d, err := h.svc.UpdateOrganisation(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, d)
}

// orgFlagHandler builds a handler that toggles one organisation flag.
func (h *Handler) orgFlagHandler(flag string, on bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := h.svc.SetOrganisationFlag(c.Request.Context(), c.GetString("user_id"), c.Param("id"), flag, on); err != nil {
			c.JSON(statusFor(err), gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// GET /associations/admin/organisations/:id/settings
func (h *Handler) GetOrganisationSettings(c *gin.Context) {
	out, err := h.svc.GetOrganisationSettings(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// PUT /associations/admin/organisations/:id/settings
func (h *Handler) UpdateOrganisationSettings(c *gin.Context) {
	var patch map[string]any
	if err := c.ShouldBindJSON(&patch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.UpdateOrganisationSettings(c.Request.Context(), c.GetString("user_id"), c.Param("id"), patch)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// ── Chapters ─────────────────────────────────────────────────────────────────

func (h *Handler) CreateChapter(c *gin.Context) {
	var b ChapterRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.CreateChapter(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) UpdateChapter(c *gin.Context) {
	var b ChapterRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateChapter(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), b); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteChapter(c *gin.Context) {
	if err := h.svc.DeleteChapter(c.Request.Context(), c.GetString("user_id"), c.Param("childId")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Committees ───────────────────────────────────────────────────────────────

func (h *Handler) CreateCommittee(c *gin.Context) {
	var b CommitteeRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.CreateCommittee(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) UpdateCommittee(c *gin.Context) {
	var b CommitteeRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateCommittee(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), b); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteCommittee(c *gin.Context) {
	if err := h.svc.DeleteCommittee(c.Request.Context(), c.GetString("user_id"), c.Param("childId")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Membership categories (dues tiers) ───────────────────────────────────────

func (h *Handler) CreateCategory(c *gin.Context) {
	var b CategoryRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b.IdempotencyKey = c.GetHeader("Idempotency-Key")
	id, err := h.svc.CreateCategory(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) UpdateCategory(c *gin.Context) {
	var b CategoryRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b.IdempotencyKey = c.GetHeader("Idempotency-Key")
	if err := h.svc.UpdateCategory(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), b); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteCategory(c *gin.Context) {
	if err := h.svc.DeleteCategory(c.Request.Context(), c.GetString("user_id"), c.Param("childId")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Rules ────────────────────────────────────────────────────────────────────

func (h *Handler) CreateRule(c *gin.Context) {
	var b RuleRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.CreateRule(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) UpdateRule(c *gin.Context) {
	var b RuleRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateRule(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), b); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteRule(c *gin.Context) {
	if err := h.svc.DeleteRule(c.Request.Context(), c.GetString("user_id"), c.Param("childId")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

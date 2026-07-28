package realtor

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
)

// ─────────────────────────────────────────────────────────────────────────────
// Admin handler (HTTP). Mounted under /api/realtor/admin with RBAC.
// RBAC-gated by the `realtor.manage` permission (fail-closed). Every mutation is
// written to realtor_admin_audit_log. Mirrors internal/invest/admin.go.
// ─────────────────────────────────────────────────────────────────────────────

type AdminHandler struct{ repo *Repository }

func NewAdminHandler(repo *Repository) *AdminHandler { return &AdminHandler{repo: repo} }

// adminID reads the authenticated admin's user id set by the auth middleware.
func adminID(c *gin.Context) string {
	if au, ok := middleware.GetAuthenticatedUser(c); ok && au.ID != "" {
		return au.ID
	}
	return c.GetString("user_id")
}

// Overview returns the headline dashboard counts/aggregates. The admin client
// reads the object directly (RealtorOverview).
func (h *AdminHandler) Overview(c *gin.Context) {
	out, err := h.repo.Overview(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}

// PendingListings returns the moderation queue. The admin client unwraps `.data`.
func (h *AdminHandler) PendingListings(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	listings, err := h.repo.PendingListings(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": listings})
}

// DecideListing applies an approve/reject/changes_requested moderation decision.
// Audited to realtor_admin_audit_log. No money moves here — moderation only.
func (h *AdminHandler) DecideListing(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !isValidListingDecision(body.Decision) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "decision must be one of approved, rejected, changes_requested"})
		return
	}
	beforeStatus, beforeVerification, err := h.repo.GetListingStatus(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "listing not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	newStatus, err := h.repo.DecideListing(c.Request.Context(), id, body.Decision)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "listing not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = h.repo.InsertAudit(c.Request.Context(), adminID(c), "listing.decision", "listing", id, body.Reason,
		gin.H{"status": beforeStatus, "verification": beforeVerification},
		gin.H{"decision": body.Decision, "status": newStatus})
	c.JSON(http.StatusOK, gin.H{"id": id, "status": newStatus})
}

// PendingVerifications returns the verification queue. Client unwraps `.data`.
func (h *AdminHandler) PendingVerifications(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	reqs, err := h.repo.PendingVerifications(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": reqs})
}

// DecideVerification applies an approve/reject/more_info verification decision.
// Audited. No money moves here — trust-&-safety verification only.
func (h *AdminHandler) DecideVerification(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !isValidVerificationStatus(body.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be one of approved, rejected, more_info"})
		return
	}
	if err := h.repo.DecideVerification(c.Request.Context(), id, body.Status); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "verification subject not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = h.repo.InsertAudit(c.Request.Context(), adminID(c), "verification.decision", "listing", id, body.Reason,
		nil, gin.H{"status": body.Status})
	c.JSON(http.StatusOK, gin.H{"id": id, "status": body.Status})
}

// Payments lists realtor payments (read-only). Client unwraps `.data`.
func (h *AdminHandler) Payments(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	payments, err := h.repo.Payments(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": payments})
}

// Escrow lists escrow deposits (read-only). Client unwraps `.data`.
func (h *AdminHandler) Escrow(c *gin.Context) {
	limit, offset := adminPage(c, 50)
	escrow, err := h.repo.Escrow(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": escrow})
}

// ── helpers ───────────────────────────────────────────────────────────────────

func adminPage(c *gin.Context, def int) (int, int) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(def)))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 200 {
		limit = def
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func isValidListingDecision(d string) bool {
	switch d {
	case "approved", "rejected", "changes_requested":
		return true
	}
	return false
}

func isValidVerificationStatus(s string) bool {
	switch s {
	case "approved", "rejected", "more_info":
		return true
	}
	return false
}

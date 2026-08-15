package handlers

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

// RegistrationAdminHandler serves the admin console's participants queue:
// listing entries, opening one, and moving it through review. Approving an
// entry promotes it onto the voting roster in the same transaction.
//
// Every route is mounted behind an RBAC permission guard (see the registration
// admin group in router.go) — these handlers do not check permissions
// themselves and must never be mounted on an unguarded group.
type RegistrationAdminHandler struct {
	store    *RegistrationAdminStore
	rbac     services.RBACService
	auditSvc services.AuditService
}

func NewRegistrationAdminHandler(store *RegistrationAdminStore, rbac services.RBACService, auditSvc services.AuditService) *RegistrationAdminHandler {
	return &RegistrationAdminHandler{store: store, rbac: rbac, auditSvc: auditSvc}
}

// permissionForStatus maps a target status to the permission it requires.
// Approving and rejecting are separate capabilities in the RBAC model, so a
// single blanket guard on the route would hand every reviewer both. The route
// guard covers contestant.view; this second check covers the specific action.
func permissionForStatus(status string) string {
	if terminalRemovalStatuses[status] {
		return "contestant.reject"
	}
	return "contestant.approve"
}

// allowedStatuses mirrors the registrations.status CHECK constraint. Validating
// here turns a rejected transition into a 400 with the valid set, rather than a
// 500 from the database.
var allowedStatuses = map[string]bool{
	"draft": true, "submitted": true, "awaiting_payment": true,
	"under_review": true, "more_information_requested": true,
	"shortlisted": true, "callback_invited": true, "approved": true,
	"rejected": true, "waitlisted": true, "disqualified": true,
	"audition_scheduled": true, "selected_for_bootcamp": true,
	"selected_for_public_voting": true, "eliminated": true,
	"winner": true, "withdrawn": true,
}

func allowedStatusList() []string {
	out := make([]string, 0, len(allowedStatuses))
	for s := range allowedStatuses {
		out = append(out, s)
	}
	return out
}

// List — GET /api/v1/admin/registrations
func (h *RegistrationAdminHandler) List(c *gin.Context) {
	limit := 50
	offset := 0
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 200 {
		limit = v
	}
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v >= 0 {
		offset = v
	}

	status := c.Query("status")
	if status != "" && !allowedStatuses[status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown status filter"})
		return
	}

	items, total, err := h.store.List(c.Request.Context(), status, c.Query("contestSlug"), c.Query("search"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load registrations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": items, "total": total, "limit": limit, "offset": offset})
}

// Get — GET /api/v1/admin/registrations/:id
func (h *RegistrationAdminHandler) Get(c *gin.Context) {
	reg, err := h.store.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load registration"})
		return
	}
	if reg == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "registration not found"})
		return
	}

	events, err := h.store.StatusEvents(c.Request.Context(), reg.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load review history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{"registration": reg, "statusEvents": events}})
}

// UpdateStatus — PATCH /api/v1/admin/registrations/:id/status
// Moves an entry through review. Approving promotes it onto the voting roster.
func (h *RegistrationAdminHandler) UpdateStatus(c *gin.Context) {
	id := c.Param("id")

	var body struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if !allowedStatuses[body.Status] {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":         "invalid status",
			"allowedValues": allowedStatusList(),
		})
		return
	}

	actorID := c.GetString("user_id")
	actorRole := c.GetString("adminRole")
	if actorRole == "" {
		actorRole = "admin"
	}

	// Fail closed: an RBAC lookup error denies the transition rather than
	// letting it through on a degraded permission service.
	required := permissionForStatus(body.Status)
	allowed, err := h.rbac.CheckPermission(actorID, required, "global", "")
	if err != nil || !allowed {
		c.JSON(http.StatusForbidden, gin.H{"error": "missing permission: " + required})
		return
	}

	result, err := h.store.SetStatus(c.Request.Context(), id, body.Status, body.Note, actorRole)
	if errors.Is(err, ErrRegistrationNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "registration not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update status"})
		return
	}

	if h.auditSvc != nil {
		h.auditSvc.LogAction(actorID, "", "update_registration_status", "registration", "registration",
			id, map[string]interface{}{"status": result.OldStatus},
			map[string]interface{}{
				"status":       body.Status,
				"note":         body.Note,
				"promoted":     result.Promoted,
				"contestantId": result.ContestantID,
			}, getIPAddress(c), c.Request.UserAgent(), "warning")
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

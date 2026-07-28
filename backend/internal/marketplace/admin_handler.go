package marketplace

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// admin_handler.go implements the /v1/marketplace/admin routes. Every mutating admin
// route requires reason_code in the body (§ integration contract) and the service
// writes an immutable mkt_admin_audit_log row.

// reasonBody is the common admin mutation body carrying the mandatory reason_code.
type reasonBody struct {
	ReasonCode string `json:"reason_code"`
}

// AdminModerationQueue GET /admin/moderation/queue
func (h *Handler) AdminModerationQueue(c *gin.Context) {
	limit, offset := pageParams(c)
	ls, err := h.svc.ModerationQueue(c.Request.Context(), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, ls)
}

// AdminApproveListing POST /admin/listings/:id/approve
func (h *Handler) AdminApproveListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	_ = c.ShouldBindJSON(&body)
	l, err := h.svc.ApproveListing(c.Request.Context(), uid, c.Param("id"), body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// AdminRejectListing POST /admin/listings/:id/reject — reason_code MANDATORY.
func (h *Handler) AdminRejectListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	l, err := h.svc.RejectListing(c.Request.Context(), uid, c.Param("id"), body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// AdminFlags GET /admin/flags
func (h *Handler) AdminFlags(c *gin.Context) {
	limit, offset := pageParams(c)
	fs, err := h.svc.repo.ListFlags(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, fs)
}

// AdminActionFlag POST /admin/flags/:id/action — reason_code MANDATORY.
func (h *Handler) AdminActionFlag(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		Action     string `json:"action"` // actioned | dismissed
		ReasonCode string `json:"reason_code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	if body.ReasonCode == "" {
		fail(c, ErrReasonRequired)
		return
	}
	if body.Action != "actioned" && body.Action != "dismissed" {
		fail(c, fieldErr(CodeValidation, "action must be actioned or dismissed", "action"))
		return
	}
	if err := h.svc.ActionFlag(c.Request.Context(), uid, c.Param("id"), body.Action, body.ReasonCode); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"ok": true})
}

// AdminAuditLog GET /admin/audit-log?target_type=&target_id=
func (h *Handler) AdminAuditLog(c *gin.Context) {
	limit, offset := pageParams(c)
	rows, err := h.svc.repo.AuditLog(c.Request.Context(), c.Query("target_type"), c.Query("target_id"), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, rows)
}

// AdminRejectBoost POST /admin/boosts/:id/reject — reason_code MANDATORY (§2.4).
// (Not in the frozen route list explicitly, but exposed for the admin boost console;
// safe additive admin action following the exemplar.)
func (h *Handler) AdminRejectBoost(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	b, err := h.svc.RejectBoost(c.Request.Context(), uid, c.Param("id"), body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, b)
}

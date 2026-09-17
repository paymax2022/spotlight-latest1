package marketplace

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// admin_handler_appeals.go — MKT-007 Appeals. FileAppeal (member-facing, no
// RBAC) lives here too since it shares the Appeal model/service with the admin
// routes; it's registered on the member group in marketplace_routes.go, not
// under /admin.

// FileAppeal POST /appeals (member, auth-only — createAppeal has no admin-only
// gate in the frontend service and no admin-only call site: a real user files
// their own appeal).
func (h *Handler) FileAppeal(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body CreateAppealInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.FileAppeal(c.Request.Context(), uid, body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, out)
}

// AdminListAppeals GET /admin/appeals?status=
func (h *Handler) AdminListAppeals(c *gin.Context) {
	limit, offset := pageParams(c)
	out, err := h.svc.ListAppealsAdmin(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminGetAppeal GET /admin/appeals/:id
func (h *Handler) AdminGetAppeal(c *gin.Context) {
	out, err := h.svc.GetAppealAdmin(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminSetAppealStatus PATCH /admin/appeals/:id/status
func (h *Handler) AdminSetAppealStatus(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		Status     string `json:"status"`
		ReasonCode string `json:"reason_code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.SetAppealStatusAdmin(c.Request.Context(), uid, adminRole(c), c.Param("id"), body.Status, body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminDecideAppeal POST /admin/appeals/:id/decide — propose (maker for
// 'overturn'; immediate for 'uphold').
func (h *Handler) AdminDecideAppeal(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body DecideAppealInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.DecideAppealAdmin(c.Request.Context(), uid, adminRole(c), c.Param("id"), body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminApproveAppeal POST /admin/appeals/:id/approve — checker step.
func (h *Handler) AdminApproveAppeal(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.ApproveAppealAdmin(c.Request.Context(), uid, adminRole(c), c.Param("id"), body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

package marketplace

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
)

// admin_handler_users.go — MKT-007 Users/Trust&Safety admin handlers.
// adminRole reads the caller's first RBAC role off the domain.AuthenticatedUser
// RequireAuthContext middleware sets under "authUser" (middleware.AuthUserContextKey),
// for the audit trail's admin_role column (mkt_admin_audit_log.admin_role NOT NULL).
func adminRole(c *gin.Context) string {
	if v, ok := c.Get("authUser"); ok {
		if au, ok := v.(domain.AuthenticatedUser); ok && len(au.Roles) > 0 {
			return au.Roles[0]
		}
	}
	return "admin"
}

// AdminSearchUsers GET /admin/users?q=&status=&min_fraud=
func (h *Handler) AdminSearchUsers(c *gin.Context) {
	limit, offset := pageParams(c)
	q := c.Query("q")
	status := c.Query("status")
	minFraud := 0.0
	if v := c.Query("min_fraud"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			minFraud = f
		}
	}
	out, err := h.svc.SearchUsersAdmin(c.Request.Context(), q, status, minFraud, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminGetUser GET /admin/users/:id
func (h *Handler) AdminGetUser(c *gin.Context) {
	out, err := h.svc.GetUserAdmin(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminSetUserStatus POST /admin/users/:id/status — propose (maker).
func (h *Handler) AdminSetUserStatus(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body SetUserStatusInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.ProposeUserStatus(c.Request.Context(), uid, adminRole(c), c.Param("id"), body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminApproveUserAction POST /admin/users/:id/action/approve — checker step.
func (h *Handler) AdminApproveUserAction(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.ApproveUserAction(c.Request.Context(), uid, adminRole(c), c.Param("id"), body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminReviewKYC POST /admin/users/:id/kyc/review
func (h *Handler) AdminReviewKYC(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body KycReviewInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.ReviewKYC(c.Request.Context(), uid, adminRole(c), c.Param("id"), body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminBlacklistUser POST /admin/users/:id/blacklist
func (h *Handler) AdminBlacklistUser(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body BlacklistInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.BlacklistUser(c.Request.Context(), uid, adminRole(c), c.Param("id"), body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminLogViewAs POST /admin/users/:id/audit/view-as
func (h *Handler) AdminLogViewAs(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	if err := h.svc.LogViewAs(c.Request.Context(), uid, adminRole(c), c.Param("id"), body.ReasonCode); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"id": c.Param("id"), "view_as_logged": true})
}

// AdminFraudSignals GET /admin/fraud/signals?severity=
func (h *Handler) AdminFraudSignals(c *gin.Context) {
	out, err := h.svc.ListFraudSignals(c.Request.Context(), c.Query("severity"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

package connectconsole

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
)

const keyError = "error"

// PermissionChecker answers a single-permission question for the signed-in admin. A failure is
// treated as "not permitted" (fail closed).
type PermissionChecker interface {
	CheckPermission(userID, permission, scopeType, scopeID string) (bool, error)
}

// Handler serves the console views.
type Handler struct {
	svc  *Service
	perm PermissionChecker
}

// NewHandler wires the handler. perm gates the money tiles on the dashboard; nil means "never".
func NewHandler(svc *Service, perm PermissionChecker) *Handler { return &Handler{svc: svc, perm: perm} }

// canSeeMoney reports whether the caller may see balances and gift totals (connect.gifting.view).
// A missing checker or a permission error means no (fail closed).
func (h *Handler) canSeeMoney(c *gin.Context) bool {
	if h.perm == nil {
		return false
	}
	ok, err := h.perm.CheckPermission(ginutil.UserID(c), "connect.gifting.view", "", "")
	return err == nil && ok
}

func internalErr(c *gin.Context, what string, err error) {
	log.Printf("[connect-console] %s: %v", what, err) // server-side only: the response is opaque
	c.JSON(http.StatusInternalServerError, gin.H{"success": false, keyError: "internal"})
}

// ListUsers — GET /api/connect/admin/users?s=&status=&limit=   (RBAC connect.users.view; balances need connect.gifting.view)
func (h *Handler) ListUsers(c *gin.Context) {
	status, ok := parseUserStatus(c.Query("status"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, keyError: "invalid status"})
		return
	}
	list, more, err := h.svc.ListUsers(c.Request.Context(), searchPattern(c.Query("s")), status, userLimit(c.Query("limit")))
	if err != nil {
		internalErr(c, "list users", err)
		return
	}
	if !h.canSeeMoney(c) {
		for i := range list {
			list[i].WalletBalanceKob = nil
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": list, "has_more": more})
}

// GetUser — GET /api/connect/admin/users/:id   (RBAC connect.users.view)
func (h *Handler) GetUser(c *gin.Context) {
	if _, err := uuid.Parse(c.Param("id")); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, keyError: "not_found"})
		return
	}
	u, err := h.svc.GetUser(c.Request.Context(), c.Param("id"))
	if errors.Is(err, ErrUserNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, keyError: "not_found"})
		return
	}
	if err != nil {
		internalErr(c, "get user", err)
		return
	}
	if !h.canSeeMoney(c) {
		u.WalletBalanceKob, u.LifetimeGiftSentKobo, u.LifetimeGiftReceivedKob = nil, nil, nil
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": u})
}

// Dashboard — GET /api/connect/admin/dashboard   (route RBAC connect.cases.view; money tiles also need connect.gifting.view)
func (h *Handler) Dashboard(c *gin.Context) {
	d, err := h.svc.GetDashboard(c.Request.Context(), h.canSeeMoney(c))
	if err != nil {
		internalErr(c, "dashboard", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": d})
}

// Finance — GET /api/connect/admin/finance   (RBAC connect.gifting.view AND connect.payouts.view)
func (h *Handler) Finance(c *gin.Context) {
	f, err := h.svc.GetFinance(c.Request.Context())
	if err != nil {
		internalErr(c, "finance", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": f})
}

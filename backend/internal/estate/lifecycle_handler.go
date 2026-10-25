package estate

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// codeEstateNotActive is the machine-readable code returned with a 423 when a
// write is refused because the estate is pending/suspended/closed. The BFF
// returns the same status for the same condition.
const codeEstateNotActive = "ESTATE_NOT_ACTIVE"

// lifecycleExemptSuffixes are the mutating /estate/:id routes that stay open
// while an estate is not active: life-safety (SOS + its status updates, guard
// incident reports), access REDUCTION (revoke / blacklist / visitor checkout),
// records of what already happened at the gate (offline log sync), and the
// legacy-import path, whose service enforces its own pending|active rule.
// Everything else that mutates is refused with 423.
var lifecycleExemptSuffixes = []string{
	"/:id/emergencies",
	"/:id/emergencies/:alertId/status",
	"/:id/guard/incident",
	"/:id/guard/checkout",
	"/:id/guard/sync",
	"/:id/access-codes/:cid/revoke",
	"/:id/access-codes/:cid/blacklist",
}

func lifecycleExempt(fullPath string) bool {
	for _, s := range lifecycleExemptSuffixes {
		if strings.HasSuffix(fullPath, s) {
			return true
		}
	}
	return false
}

// LifecycleGate is mounted on the /estate group (finance_routes.go) BEFORE any
// route is registered so it wraps every /estate/:id/... handler. Reads pass;
// a mutating request against a non-active estate is refused with 423 without
// touching any record (ESTD-D025 / EST-UAT-0419). An unknown or malformed id
// falls through to the handler's own membership check. Infra errors fail
// closed (503).
func (h *Handler) LifecycleGate() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}
		estateID := c.Param("id")
		if estateID == "" || lifecycleExempt(c.FullPath()) {
			c.Next()
			return
		}
		if _, err := uuid.Parse(estateID); err != nil {
			c.Next()
			return
		}
		err := h.svc.AssertEstateWritable(c.Request.Context(), estateID)
		switch {
		case err == nil, errors.Is(err, ErrEstateNotFound):
			c.Next()
		case IsEstateNotActive(err):
			var ne *EstateNotActiveError
			_ = errors.As(err, &ne)
			c.AbortWithStatusJSON(http.StatusLocked, gin.H{
				keyError: err.Error(), "code": codeEstateNotActive, "estate_status": ne.Status,
			})
		default:
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				keyError: httperr.Msg(c, http.StatusServiceUnavailable, err),
			})
		}
	}
}

var lifecycleErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrEstateNotFound),
	httperr.R(http.StatusBadRequest, ErrLifecycleReasonRequired),
	httperr.R(http.StatusConflict, ErrInvalidLifecycleTransition),
	httperr.R(http.StatusLocked, ErrLegalHold),
	httperr.Rule{Status: http.StatusLocked, Match: IsEstateNotActive},
)

// PlatformListEstates — GET /estate-admin/estates?status=pending (review queue).
func (h *Handler) PlatformListEstates(c *gin.Context) {
	status := c.Query("status")
	switch status {
	case "", EstateStatusPending, EstateStatusActive, EstateStatusSuspended, EstateStatusClosed:
	default:
		c.JSON(http.StatusBadRequest, gin.H{keyError: "status must be one of pending, active, suspended, closed"})
		return
	}
	n, _ := ginutil.PageParams(c, 100, 500)
	out, err := h.svc.ListEstatesByStatus(c.Request.Context(), status, n)
	if err != nil {
		lifecycleErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// PlatformGetEstate — GET /estate-admin/estates/:estateId.
func (h *Handler) PlatformGetEstate(c *gin.Context) {
	if !validEstateParam(c) {
		return
	}
	l, err := h.svc.GetEstateLifecycle(c.Request.Context(), c.Param("estateId"))
	if err != nil {
		lifecycleErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, l)
}

// PlatformTransitionEstate — POST /estate-admin/estates/:estateId/lifecycle
// {action: verify|reject|suspend|reactivate|close, reason}.
func (h *Handler) PlatformTransitionEstate(c *gin.Context) {
	if !validEstateParam(c) {
		return
	}
	var body struct {
		Action string `json:"action"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	switch body.Action {
	case LifecycleVerify, LifecycleReject, LifecycleSuspend, LifecycleReactivate, LifecycleClose:
	default:
		c.JSON(http.StatusBadRequest, gin.H{keyError: "action must be one of verify, reject, suspend, reactivate, close"})
		return
	}
	l, err := h.svc.TransitionEstate(c.Request.Context(), c.Param("estateId"), ginutil.UserID(c), body.Action, body.Reason)
	if err != nil {
		lifecycleErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, l)
}

// PlatformSetLegalHold — POST /estate-admin/estates/:estateId/legal-hold {enabled, reason}.
func (h *Handler) PlatformSetLegalHold(c *gin.Context) {
	if !validEstateParam(c) {
		return
	}
	var body struct {
		Enabled *bool  `json:"enabled"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Enabled == nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "enabled (boolean) and reason are required"})
		return
	}
	l, err := h.svc.SetLegalHold(c.Request.Context(), c.Param("estateId"), ginutil.UserID(c), *body.Enabled, body.Reason)
	if err != nil {
		lifecycleErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, l)
}

func validEstateParam(c *gin.Context) bool {
	if _, err := uuid.Parse(c.Param("estateId")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid estate id"})
		return false
	}
	return true
}

// writeIfLifecycleBlocked writes a 423 when err is a lifecycle refusal (estate
// not active, or legal hold) and reports whether it did, so existing handlers
// keep their own status mapping for every other error.
func writeIfLifecycleBlocked(c *gin.Context, err error) bool {
	if err == nil || lifecycleErrMap.Code(err) != http.StatusLocked {
		return false
	}
	body := gin.H{keyError: err.Error()}
	if IsEstateNotActive(err) {
		body["code"] = codeEstateNotActive
	} else {
		body["code"] = "ESTATE_LEGAL_HOLD"
	}
	c.JSON(http.StatusLocked, body)
	return true
}

package estate

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// HTTP surface for ESTD-D027 dual control (dual_control.go). Mounted only when
// FEATURE_ESTATE_DUAL_CONTROL_ENABLED is on (finance_routes.go).

var approvalErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, ErrIdempotencyRequired, ErrApprovalInvalid),
	httperr.R(http.StatusForbidden, ErrApprovalSelf),
	httperr.R(http.StatusNotFound, ErrApprovalNotFound),
	httperr.R(http.StatusConflict, ErrApprovalNotPending, ErrApprovalExpired, ErrApprovalOpen, ErrApprovalKeyReused, ErrDualControlRequired),
	httperr.R(http.StatusServiceUnavailable, ErrDualControlDisabled, ErrLedgerUnavailable),
	httperr.Rule{Status: http.StatusForbidden, Match: isMembershipErr},
)

type approvalNoteBody struct {
	Note string `json:"note"`
}

// CreateApproval → POST /:id/admin/approvals (maker; Idempotency-Key required).
// 201 with status=pending when a checker is needed; 201 with status=executed
// when the action was below threshold and ran immediately.
func (h *Handler) CreateApproval(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKey(c)
	if !ok {
		return
	}
	var in CreateApprovalInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	in.IdempotencyKey = key
	a, err := h.svc.CreateApproval(c.Request.Context(), c.Param("id"), ginutil.UserID(c), in)
	if err != nil {
		approvalErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, a)
}

// ListApprovals → GET /:id/admin/approvals?status=pending.
func (h *Handler) ListApprovals(c *gin.Context) {
	list, err := h.svc.ListApprovals(c.Request.Context(), c.Param("id"), ginutil.UserID(c), c.Query(keyStatus))
	if err != nil {
		approvalErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: list})
}

// GetApproval → GET /:id/admin/approvals/:rid.
func (h *Handler) GetApproval(c *gin.Context) {
	a, err := h.svc.GetApproval(c.Request.Context(), c.Param("id"), ginutil.UserID(c), c.Param("rid"))
	if err != nil {
		approvalErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}

// ApproveApproval → POST /:id/admin/approvals/:rid/approve (checker;
// Idempotency-Key required). A replay returns 200 with replayed=true and
// executes nothing.
func (h *Handler) ApproveApproval(c *gin.Context) {
	if _, ok := ginutil.RequireIdempotencyKey(c); !ok {
		return
	}
	var body approvalNoteBody
	_ = c.ShouldBindJSON(&body) // note optional
	a, replayed, err := h.svc.ApproveApproval(c.Request.Context(), c.Param("id"), ginutil.UserID(c), c.Param("rid"), body.Note)
	if err != nil {
		approvalErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"approval": a, "replayed": replayed})
}

// RejectApproval → POST /:id/admin/approvals/:rid/reject (checker).
func (h *Handler) RejectApproval(c *gin.Context) {
	var body approvalNoteBody
	_ = c.ShouldBindJSON(&body)
	a, err := h.svc.RejectApproval(c.Request.Context(), c.Param("id"), ginutil.UserID(c), c.Param("rid"), body.Note)
	if err != nil {
		approvalErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}

// GetApprovalThresholds → GET /:id/admin/approval-thresholds (current + history).
func (h *Handler) GetApprovalThresholds(c *gin.Context) {
	cur, history, err := h.svc.GetApprovalThresholds(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		approvalErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"current": cur, "history": history})
}

// writePendingApproval answers a direct admin path that filed a request
// instead of acting (202). Returns false when err is not a pending-approval.
func writePendingApproval(c *gin.Context, err error) bool {
	var pa *PendingApprovalError
	if !errors.As(err, &pa) {
		return false
	}
	c.JSON(http.StatusAccepted, gin.H{"pending_approval": true, "approval": pa.Request})
	return true
}

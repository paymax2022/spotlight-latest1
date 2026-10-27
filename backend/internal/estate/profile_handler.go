package estate

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// profile_handler.go — the HTTP surface for estate profile, configuration history and ownership
// governance (estate-a M02: EST-UAT-0023, 0028, 0031, 0032, 0035, 0036).
//
// The estate id always comes from the path. A transfer decision is the one route whose subject is a
// transfer row rather than the estate, so the service re-checks that the row belongs to the estate
// in the path before it reports the outcome.

var profileErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrEstateProfileNotFound, ErrOwnerTransferNotFound, ErrEstateNotFound),
	httperr.R(http.StatusBadRequest, ErrInvalidTimezone, ErrInvalidBranding, ErrNoticeTooLong,
		ErrEstateNameRequired, ErrInvalidConfigColumn, ErrInvalidTransferFilter,
		ErrInvalidTransferTargetUser, ErrOwnerTransferToSelf),
	httperr.R(http.StatusConflict, ErrOwnerTransferPending, ErrOwnerTransferNotPending),
	httperr.R(http.StatusForbidden,
		ErrOwnerTransferTarget, ErrOwnerTransferParty,
		ErrOwnerTransferTargetNotMember, ErrOwnerTransferTargetBanned),
	httperr.Rule{Status: http.StatusForbidden, Match: isMembershipErr},
)

func writeProfileError(c *gin.Context, err error) { profileErrMap.Write(c, err) }

func validEstatePathParam(c *gin.Context) bool {
	if _, err := uuid.Parse(c.Param("id")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid estate id"})
		return false
	}
	return true
}

// GetEstateInfo — GET /estate/:id/info. Any member may read the estate's timezone, branding and
// resident notice; those are what residents are shown, not privileges.
func (h *Handler) GetEstateInfo(c *gin.Context) {
	if !validEstatePathParam(c) {
		return
	}
	p, err := h.svc.GetEstateProfile(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		writeProfileError(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// UpdateEstateInfo — PATCH /estate/:id/info (estate admin only).
func (h *Handler) UpdateEstateInfo(c *gin.Context) {
	if !validEstatePathParam(c) {
		return
	}
	var req UpdateEstateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.UpdateEstateProfile(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req)
	if err != nil {
		writeProfileError(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// GetEstateConfigHistory — GET /estate/:id/admin/config/history?column=&limit= (estate admin only).
// Revisions are written by a database trigger on estate_config, so this is the record of what every
// writer did to the governance rules and the subscription plan.
func (h *Handler) GetEstateConfigHistory(c *gin.Context) {
	if !validEstatePathParam(c) {
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.GetEstateConfigHistory(c.Request.Context(), c.Param("id"),
		ginutil.UserID(c), c.Query("column"), limit)
	if err != nil {
		writeProfileError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// RequestOwnerTransfer — POST /estate/:id/owner-transfer (estate admin only). Opens a handover; it
// does not move the estate.
func (h *Handler) RequestOwnerTransfer(c *gin.Context) {
	if !validEstatePathParam(c) {
		return
	}
	var body RequestOwnerTransferBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	t, err := h.svc.RequestOwnerTransfer(c.Request.Context(), c.Param("id"), ginutil.UserID(c), body)
	if err != nil {
		writeProfileError(c, err)
		return
	}
	c.JSON(http.StatusCreated, t)
}

// ListOwnerTransfers — GET /estate/:id/owner-transfers. Admins see the estate's history; every other
// member sees only offers addressed to them.
func (h *Handler) ListOwnerTransfers(c *gin.Context) {
	if !validEstatePathParam(c) {
		return
	}
	out, err := h.svc.ListOwnerTransfers(c.Request.Context(), c.Param("id"),
		ginutil.UserID(c), c.Query("status"))
	if err != nil {
		writeProfileError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// DecideOwnerTransfer — POST /estate/:id/owner-transfer/:transferId/decide {accept, note}. Only the
// incoming owner can accept; the outgoing owner can withdraw. The privilege move happens inside
// estate_owner_transfer_decide().
func (h *Handler) DecideOwnerTransfer(c *gin.Context) {
	if !validEstatePathParam(c) {
		return
	}
	if _, err := uuid.Parse(c.Param("transferId")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid transfer id"})
		return
	}
	var body DecideOwnerTransferBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	t, err := h.svc.DecideOwnerTransfer(c.Request.Context(), c.Param("id"), ginutil.UserID(c),
		c.Param("transferId"), body.Accept, body.Note)
	if err != nil {
		writeProfileError(c, err)
		return
	}
	c.JSON(http.StatusOK, t)
}

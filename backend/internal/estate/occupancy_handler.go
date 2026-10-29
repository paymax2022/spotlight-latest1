package estate

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// occupancy_handler.go — the HTTP surface for unit occupancy (estate-a M03: EST-UAT-0043, 0044, 0045,
// 0046, 0048, 0051, 0052).
//
// Every route here takes the estate from the path and passes the caller's own id as the actor; the
// service then either asserts the privilege or hands it to the database writer, which asserts it again.
// Nothing in this file decides an occupancy rule — the rules are in 20271099000060, and the handlers
// exist to turn what the writer raises into a status code and a sentence.

var occupancyErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrUnitNotFound, ErrNoLiveOccupancy, ErrClaimNotFound,
		ErrProofNotFound, ErrVehicleNotFound, ErrEstateNotFound, ErrTenancyNotReviewable,
		ErrPropertyTransferNotFound),
	httperr.R(http.StatusBadRequest, ErrUnknownOccupancyType, ErrInvalidOccupancyWindow,
		ErrInvalidOccupantUser, ErrInvalidCapacity, ErrCapacityBelowOccupants,
		ErrInvalidReviewDecision, ErrInvalidProofDecision, ErrBillingOverrideNeedsReason,
		ErrInvalidOccupancyStatus, ErrInvalidTransferType, ErrInvalidPropertyType,
		ErrInvalidInvoiceAmount, ErrInvalidClaimFilter),
	httperr.R(http.StatusConflict, ErrUnitCapacityExceeded, ErrUnitHasAnotherOwner, ErrUnitHasAnotherTenant,
		ErrUnitHasLiveOccupants, ErrUnitArchived, ErrClaimReviewed, ErrUnitNoLandlord,
		ErrTransferAlreadyReviewed, ErrDuplicateUnitKey,
		ErrVacantUnitExempt, ErrOutOfTermUnitExempt, ErrUnitHasDeedOwner, ErrUnitHasOpenInvoices,
		ErrProofNeedsDocument),
	httperr.R(http.StatusForbidden, ErrNotAuthorisedToAdmit, ErrNotAuthorisedToRelease, ErrResidencyNotActive),
	httperr.Rule{Status: http.StatusForbidden, Match: isMembershipErr},
)

func writeOccupancyError(c *gin.Context, err error) { occupancyErrMap.Write(c, err) }

// validUUIDParam is the shape check every occupancy route runs before it touches the database: a
// malformed id is a caller mistake, not a not-found.
func validUUIDParam(c *gin.Context, name string) bool {
	if _, err := uuid.Parse(c.Param(name)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return false
	}
	return true
}

// queryUser returns ?user_id= trimmed, or "" when the caller did not name anybody.
func queryUser(c *gin.Context) string {
	return strings.TrimSpace(c.Query("user_id"))
}

// AdmitOccupant — POST /estate/:id/properties/:pid/occupants (estate admin, or this unit's landlord for
// a tenant). Recording somebody against a unit is the only way occupancy begins; there is no route that
// writes the party columns any more.
func (h *Handler) AdmitOccupant(c *gin.Context) {
	if !validUUIDParam(c, "id") || !validUUIDParam(c, "pid") {
		return
	}
	var req AdmitOccupantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	a, err := h.svc.AdmitOccupant(c.Request.Context(), c.Param("id"), ginutil.UserID(c), c.Param("pid"), req)
	if err != nil {
		writeOccupancyError(c, err)
		return
	}
	c.JSON(http.StatusCreated, a)
}

// ReleaseOccupant — DELETE /estate/:id/properties/:pid/occupants/:userId (estate admin, or the occupant
// ending their own registration). The row is kept: what changes is ended_at.
func (h *Handler) ReleaseOccupant(c *gin.Context) {
	if !validUUIDParam(c, "id") || !validUUIDParam(c, "pid") || !validUUIDParam(c, "userId") {
		return
	}
	reason := strings.TrimSpace(c.Query("reason"))
	r, err := h.svc.ReleaseOccupant(c.Request.Context(), c.Param("id"), ginutil.UserID(c),
		c.Param("pid"), c.Param("userId"), reason)
	if err != nil {
		writeOccupancyError(c, err)
		return
	}
	c.JSON(http.StatusOK, r)
}

// ListOccupancies — GET /estate/:id/properties/:pid/occupants, or GET /estate/:id/occupants for the
// caller's own units. An estate admin sees the whole register; anybody else sees only their own rows
// regardless of which unit is named.
func (h *Handler) ListOccupancies(c *gin.Context) {
	if !validUUIDParam(c, "id") {
		return
	}
	propertyID := ""
	if p := c.Param("pid"); p != "" {
		if _, err := uuid.Parse(p); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
			return
		}
		propertyID = p
	}
	includeEnded, _ := strconv.ParseBool(c.Query("include_ended"))
	out, err := h.svc.ListOccupancies(c.Request.Context(), c.Param("id"), ginutil.UserID(c),
		propertyID, includeEnded)
	if err != nil {
		writeOccupancyError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// SetUnitCapacity — PATCH /estate/:id/properties/:pid/capacity {capacity} (estate admin only).
func (h *Handler) SetUnitCapacity(c *gin.Context) {
	if !validUUIDParam(c, "id") || !validUUIDParam(c, "pid") {
		return
	}
	var req SetUnitCapacityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.SetUnitCapacity(c.Request.Context(), c.Param("id"), ginutil.UserID(c),
		c.Param("pid"), req.Capacity)
	if err != nil {
		writeOccupancyError(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// ListOwnershipClaims — GET /estate/:id/ownership-claims?status= (estate admin only). The review route
// existed with no way to read the queue it reviewed.
func (h *Handler) ListOwnershipClaims(c *gin.Context) {
	if !validUUIDParam(c, "id") {
		return
	}
	out, err := h.svc.ListOwnershipClaims(c.Request.Context(), c.Param("id"), ginutil.UserID(c),
		c.Query("status"))
	if err != nil {
		writeOccupancyError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// GetOccupancyProof — GET /estate/:id/profile/occupancy-proof?user_id= (estate admin; a member reads
// their own). This is the member-level read EST-UAT-0051 was missing: the person who filed the documents
// can see what the estate has done about them.
func (h *Handler) GetOccupancyProof(c *gin.Context) {
	if !validUUIDParam(c, "id") {
		return
	}
	proof, err := h.svc.GetOccupancyProof(c.Request.Context(), c.Param("id"), ginutil.UserID(c), queryUser(c))
	if err != nil {
		writeOccupancyError(c, err)
		return
	}
	c.JSON(http.StatusOK, proof)
}

// VerifyOccupancyProof — POST /estate/:id/profile/occupancy-proof/verify {user_id, decision, note}
// (estate admin only). decision is verified|rejected.
func (h *Handler) VerifyOccupancyProof(c *gin.Context) {
	if !validUUIDParam(c, "id") {
		return
	}
	var req VerifyOccupancyProofRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	proof, err := h.svc.VerifyOccupancyProof(c.Request.Context(), c.Param("id"), ginutil.UserID(c),
		req.UserID, req.Decision, req.Note)
	if err != nil {
		writeOccupancyError(c, err)
		return
	}
	c.JSON(http.StatusOK, proof)
}

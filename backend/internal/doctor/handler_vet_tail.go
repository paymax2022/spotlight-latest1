package doctor

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// handler_vet_tail.go — Gin handlers for the VET licence / verification /
// profile-publish / profile-draft "tail" endpoints. Additive (separate file to avoid
// colliding with concurrent edits to handler_vet.go). Routes are wired by the parent in
// finance_routes.go under /api/v1/doctor:
//
//	POST /vet/licence/renew   -> RenewVetLicence
//	POST /vet/verification    -> SubmitVetVerification
//	POST /vet/profile/publish -> PublishVetProfile
//	PUT  /vet/profile/draft   -> SaveVetProfileDraft
//
// Each handler reuses the shared helpers from handler.go (h.userID, h.fail, h.idemKey)
// and handler_account.go (h.rawBody), scopes to the authenticated vet, and mirrors the
// human-side account handlers. Mutations forward the Idempotency-Key; the service rejects
// a missing key with ErrIdempotencyRequired (→ 400). Creates return 201, the draft
// upsert returns 200.

// RenewVetLicence records / renews the vet licence (re-enters verification). 201.
func (h *Handler) RenewVetLicence(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SubmitVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.RenewVetLicence(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// SubmitVetVerification submits the vet's verification. 201.
func (h *Handler) SubmitVetVerification(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SubmitVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SubmitVetVerification(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// PublishVetProfile marks the vet profile live (fail-closed on verification). 201
// would imply a new resource; publishing transitions the existing row, so 200.
func (h *Handler) PublishVetProfile(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.PublishVetProfile(c.Request.Context(), uid, h.idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// SaveVetProfileDraft upserts (patch-merges) the vet profile draft. 200.
func (h *Handler) SaveVetProfileDraft(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	patch, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SaveVetProfileDraft(c.Request.Context(), uid, h.idemKey(c), patch)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

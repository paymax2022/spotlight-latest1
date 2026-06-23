package doctor

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// handler_account_tail.go — Gin handlers for the Wave-2 "account tail" endpoints.
//
// One handler per service_account_tail.go method. Reuses the shared helpers from
// handler.go (h.userID, h.fail, h.idemKey) and the raw-body helper from
// handler_account.go (h.rawBody). Reads return 200 with the projection; creates
// return 201; updates/requests return 200. Everything is scoped to the
// authenticated doctor. Routes are wired by the parent in finance_routes.go.

// ── Profile ──────────────────────────────────────────────────────────────────

// CreateBankAccount → POST /profile/bank-account
func (h *Handler) CreateBankAccount(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req BankAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.CreateBankAccount(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// UploadProfileDocument → POST /profile/documents
func (h *Handler) UploadProfileDocument(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req ProfileDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.UploadProfileDocument(c.Request.Context(), uid, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// SetProfilePhoto → POST /profile/photo
func (h *Handler) SetProfilePhoto(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req ProfilePhotoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SetProfilePhoto(c.Request.Context(), uid, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// UpdateTaxInfo → PUT /profile/tax-info
func (h *Handler) UpdateTaxInfo(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	patch, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.UpdateTaxInfo(c.Request.Context(), uid, patch)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Payouts ──────────────────────────────────────────────────────────────────

// ListPayouts → GET /payouts
func (h *Handler) ListPayouts(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPayouts(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetPayout → GET /payouts/:id
func (h *Handler) GetPayout(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPayout(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetPayoutReport → GET /payout-report
func (h *Handler) GetPayoutReport(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPayoutReport(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// UpdatePayoutAccount → PUT /payout-account
func (h *Handler) UpdatePayoutAccount(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req PayoutAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.UpdatePayoutAccount(c.Request.Context(), uid, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// DisputePayout → POST /payouts/:id/dispute
// NOTE: the param is :id (not :payoutId) so it shares the same gin wildcard tree
// position as GET /payouts/:id — gin panics on conflicting param names at the same
// position.
func (h *Handler) DisputePayout(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SettlementDisputeRequest
	// Body is optional (reason/detail) — ignore bind errors on an empty body.
	_ = c.ShouldBindJSON(&req)
	res, err := h.svc.DisputePayout(c.Request.Context(), uid, c.Param("id"), h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// ── Privacy ──────────────────────────────────────────────────────────────────

// RequestPrivacyExport → POST /privacy/export
func (h *Handler) RequestPrivacyExport(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.RequestPrivacyExport(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// RequestPrivacyDelete → POST /privacy/delete
func (h *Handler) RequestPrivacyDelete(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.RequestPrivacyDelete(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Security ─────────────────────────────────────────────────────────────────

// ChangePassword → POST /security/password
// Records a password-change *request* in the compliance audit. No password is
// stored or verified here — Supabase Auth owns the credential.
func (h *Handler) ChangePassword(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	if err := h.svc.ChangePassword(c.Request.Context(), uid, h.idemKey(c)); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Compliance ───────────────────────────────────────────────────────────────

// GetCompliance → GET /compliance
func (h *Handler) GetCompliance(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetCompliance(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// AckPolicy → POST /compliance/policies/:policyKey/ack
func (h *Handler) AckPolicy(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.AckPolicy(c.Request.Context(), uid, c.Param("policyKey"), h.idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// ── Onboarding ───────────────────────────────────────────────────────────────

// GetLegalOnboarding → GET /onboarding/legal
func (h *Handler) GetLegalOnboarding(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetLegalOnboarding(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Reputation ───────────────────────────────────────────────────────────────

// GetReputation → GET /reputation
func (h *Handler) GetReputation(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetReputation(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Patients ─────────────────────────────────────────────────────────────────

// GetPatientFullProfile → GET /patients/:patientId/full-profile
func (h *Handler) GetPatientFullProfile(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPatientFullProfile(c.Request.Context(), uid, c.Param("patientId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetPatientRecordHub → GET /patients/:patientId/record-hub
func (h *Handler) GetPatientRecordHub(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPatientRecordHub(c.Request.Context(), uid, c.Param("patientId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Misc ─────────────────────────────────────────────────────────────────────

// SetPresence → PUT /presence
func (h *Handler) SetPresence(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req PresenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetPresence(c.Request.Context(), uid, req); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"presence": req.Presence, "ok": true})
}

// Logout → POST /auth/logout (stateless: Supabase JWT has no server session)
func (h *Handler) Logout(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	_ = h.svc.Logout(c.Request.Context(), uid)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DismissAnnouncement → POST /announcements/:announcementId/dismiss
func (h *Handler) DismissAnnouncement(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	_ = h.svc.DismissAnnouncement(c.Request.Context(), uid, c.Param("announcementId"))
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// CreateTechnicalSupport → POST /support/technical
func (h *Handler) CreateTechnicalSupport(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req TechnicalSupportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.CreateTechnicalSupport(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// SetEmergencySchedule → PUT /schedule/emergency
func (h *Handler) SetEmergencySchedule(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req EmergencyScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetEmergencySchedule(c.Request.Context(), uid, req); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

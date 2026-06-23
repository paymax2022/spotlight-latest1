package doctor

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

// handler_account.go — Wave 2 (account / provider / admin) Gin handlers.
//
// One handler per service_account.go method. Reuses the shared helpers from
// handler.go (h.userID, h.fail, h.idemKey) and mirrors the MVP style: reads
// return 200 with the projection; mutations parse the typed request (or a raw
// JSON patch via c.GetRawData), require an Idempotency-Key where the service
// does, and return 200/201. Everything is scoped to the authenticated doctor.

// rawBody reads the request body as a json.RawMessage for the patch-style
// endpoints the OpenAPI types as the free-form Generic schema. An empty body
// yields a nil patch (the repository upserts only the supplied keys).
func (h *Handler) rawBody(c *gin.Context) (json.RawMessage, bool) {
	b, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return nil, false
	}
	return json.RawMessage(b), true
}

// ── Onboarding ───────────────────────────────────────────────────────────────

func (h *Handler) ListConsents(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListConsents(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) AcceptConsent(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req AcceptConsentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.AcceptConsent(c.Request.Context(), uid, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) ListPermissions(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPermissions(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RecordPermission(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req RecordPermissionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.RecordPermission(c.Request.Context(), uid, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) GetMerchantUpgrade(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetMerchantUpgrade(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RequestMerchantUpgrade(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	detail, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.RequestMerchantUpgrade(c.Request.Context(), uid, h.idemKey(c), detail)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) SetProviderType(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SetProviderTypeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SetProviderType(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Profile builder ──────────────────────────────────────────────────────────

func (h *Handler) GetProfileDraft(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetProfileDraft(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SaveProfileDraft(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	patch, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SaveProfileDraft(c.Request.Context(), uid, h.idemKey(c), patch)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListProfileDocuments(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListProfileDocuments(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PublishProfile(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.PublishProfile(c.Request.Context(), uid, h.idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetLicenceExpiry(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetLicenceExpiry(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RenewLicence(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SubmitVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.RenewLicence(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// ── Notifications ────────────────────────────────────────────────────────────

func (h *Handler) ListNotificationGroups(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListNotificationGroups(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListNotificationPreferences(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListNotificationPreferences(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) UpdateNotificationPreference(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req UpdateNotificationPreferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.UpdateNotificationPreference(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) MarkAllNotificationsRead(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	n, err := h.svc.MarkAllNotificationsRead(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": n})
}

// ── Support ──────────────────────────────────────────────────────────────────

func (h *Handler) ListSupportTickets(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListSupportTickets(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CreateSupportTicket(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req CreateSupportTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.CreateSupportTicket(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) ListSupportDisputes(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListSupportDisputes(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetSupportDispute(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetSupportDispute(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CreateSupportDispute(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req CreateDisputeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.CreateSupportDispute(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) AddDisputeEvidence(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req AddEvidenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.AddDisputeEvidence(c.Request.Context(), uid, c.Param("id"), h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListSupportMessages(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListSupportMessages(c.Request.Context(), uid, c.Param("threadId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SendSupportMessage(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SendSupportMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SendSupportMessage(c.Request.Context(), uid, c.Param("threadId"), h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// ── Compliance ───────────────────────────────────────────────────────────────

func (h *Handler) ListAuditTrail(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListAuditTrail(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListTraining(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListTraining(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CompleteTraining(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	detail, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.CompleteTraining(c.Request.Context(), uid, c.Param("moduleId"), h.idemKey(c), detail)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListSafetyIssues(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListSafetyIssues(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ReportSafetyIssue(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req ReportSafetyIssueRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.ReportSafetyIssue(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) GetPrivacySettings(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPrivacySettings(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) UpdatePrivacySettings(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	patch, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.UpdatePrivacySettings(c.Request.Context(), uid, h.idemKey(c), patch)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Security / devices / preferences ─────────────────────────────────────────

func (h *Handler) ListDevices(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListDevices(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RevokeDevice(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	if err := h.svc.RevokeDevice(c.Request.Context(), uid, c.Param("deviceId"), h.idemKey(c)); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) GetSecurity(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetSecurity(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// SetSecurityFlags backs both PUT /security/biometric and PUT /security/2fa —
// each carries the relevant toggle in an UpdateSettingsRequest and the settings
// upsert applies only the supplied flags.
func (h *Handler) SetSecurityFlags(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req UpdateSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SetSecurityFlags(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetAppPreferences(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetAppPreferences(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) UpdateAppPreferences(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	prefs, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.UpdateAppPreferences(c.Request.Context(), uid, h.idemKey(c), prefs)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Reputation / reviews ─────────────────────────────────────────────────────

func (h *Handler) GetQualityScore(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetQualityScore(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetRanking projects the ranking insight off the latest quality score
// (GET /quality/ranking). No separate ranking table — it is a field of the score.
func (h *Handler) GetRanking(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetQualityScore(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res.Ranking)
}

// GetImprovements projects the improvement recommendations off the latest quality
// score (GET /quality/recommendations).
func (h *Handler) GetImprovements(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetQualityScore(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res.Recommendations)
}

func (h *Handler) ListConsultationFeedback(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListConsultationFeedback(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListReviewDisputes(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListReviewDisputes(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) DisputeReview(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req ReviewActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.DisputeReview(c.Request.Context(), uid, c.Param("reviewId"), h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// ReportReview backs both POST /reviews/:reviewId/report and
// POST /reviews/:reviewId/removal-request (a removal request is a report).
func (h *Handler) ReportReview(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req ReviewActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.ReportReview(c.Request.Context(), uid, c.Param("reviewId"), h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

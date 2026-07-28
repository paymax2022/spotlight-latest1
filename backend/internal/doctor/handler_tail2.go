package doctor

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// handler_tail2.go — Gin handlers for the Wave-3 "coverage close-out" endpoints
// (the 26 contract GETs specified but never wired). One handler per
// service_tail2.go method. All are READS → 200 on success. Reuses the shared
// helpers from handler.go (h.userID, h.fail). Routes are wired by the parent in
// finance_routes.go. Every read is scoped to the authenticated doctor.

// ── List reads ─────────────────────────────────────────────────────────────────

// ListCallDisputes → GET /calls/disputes
func (h *Handler) ListCallDisputes(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListCallDisputes(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListSettlementDisputes → GET /payouts/disputes
func (h *Handler) ListSettlementDisputes(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListSettlementDisputes(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListEmergencyCases → GET /emergency/cases
func (h *Handler) ListEmergencyCases(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListEmergencyCases(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListEmergencyEscalations → GET /emergency/escalations
func (h *Handler) ListEmergencyEscalations(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListEmergencyEscalations(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListEmergencyFacilities → GET /emergency/facilities
func (h *Handler) ListEmergencyFacilities(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListEmergencyFacilities(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListRedFlagAlerts → GET /red-flag-alerts
func (h *Handler) ListRedFlagAlerts(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListRedFlagAlerts(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListInvoices → GET /invoices
func (h *Handler) ListInvoices(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListInvoices(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListVetProfileDocuments → GET /vet/profile/documents
func (h *Handler) ListVetProfileDocuments(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListVetProfileDocuments(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Money projections ───────────────────────────────────────────────────────────

// GetWalletBalance → GET /wallet/balance (ledger-projected, never stored)
func (h *Handler) GetWalletBalance(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetWalletBalance(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetEarningsBreakdown → GET /earnings/breakdown
func (h *Handler) GetEarningsBreakdown(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetEarningsBreakdown(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetCommissionBreakdown → GET /earnings/commission
func (h *Handler) GetCommissionBreakdown(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetCommissionBreakdown(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetTaxVatReport → GET /earnings/tax-vat
func (h *Handler) GetTaxVatReport(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetTaxVatReport(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Composite / derived projections ─────────────────────────────────────────────

// GetDashboard → GET /dashboard
func (h *Handler) GetDashboard(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetDashboard(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetScheduleSettings → GET /schedule
func (h *Handler) GetScheduleSettings(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetScheduleSettings(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetQualityAnalytics → GET /analytics/quality
func (h *Handler) GetQualityAnalytics(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetQualityAnalytics(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetVerificationDecision → GET /verification/decision
func (h *Handler) GetVerificationDecision(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetVerificationDecision(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetAccountStatus → GET /account/status
func (h *Handler) GetAccountStatus(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetAccountStatus(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetReviewNotice → GET /account/review-notice
func (h *Handler) GetReviewNotice(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetReviewNotice(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetAppStatus → GET /app-status
func (h *Handler) GetAppStatus(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetAppStatus(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Vet reads ────────────────────────────────────────────────────────────────────

// GetVetLicence → GET /vet/licence
func (h *Handler) GetVetLicence(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetVetLicence(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetVetVerification → GET /vet/verification
func (h *Handler) GetVetVerification(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetVetVerification(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetVetProfileDraft → GET /vet/profile/draft
func (h *Handler) GetVetProfileDraft(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetVetProfileDraft(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Static content ───────────────────────────────────────────────────────────────

// GetSupportFAQs → GET /support/faqs
func (h *Handler) GetSupportFAQs(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetSupportFAQs(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetHelpArticles → GET /support/help-articles
func (h *Handler) GetHelpArticles(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetHelpArticles(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetOnboardingSlides → GET /onboarding/slides
func (h *Handler) GetOnboardingSlides(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetOnboardingSlides(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetLatestAnnouncement → GET /announcements/latest
// Returns the latest announcement, or { "announcement": null } when none exists
// (200, not 404 — the absence of an announcement is a normal state).
func (h *Handler) GetLatestAnnouncement(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetLatestAnnouncement(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"announcement": res})
}

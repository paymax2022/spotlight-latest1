package doctor

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// handler_tail2.go — Gin handlers for the Wave-3 "coverage close-out" endpoints
// (the 26 contract GETs specified but never wired). One handler per
// service_tail2.go method. All are READS → 200 on success. Reuses the shared
// helpers from handler.go (h.userID, h.fail). Routes are wired by the parent in
// finance_routes.go. Every read is scoped to the authenticated doctor.

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

// DTOs / projections for the Wave-3 "coverage close-out"
// endpoints (the 26 contract GETs specified but never wired). Style mirrors
// model_account.go / service_clinical_tail.go:
//   - row mirrors carry json tags matching the mobile types;
//   - all money is int64 minor units (kobo); never floats, never strings;
//   - aggregate projections are computed (composed from existing reads / the
//     ledger), never read from a stored balance column.
// Models already declared elsewhere are reused here, NOT redeclared:
//   CallDispute, EmergencyCase, EmergencyEscalation   -> service_clinical_tail.go
//   SettlementDispute, QualityScore, Settings,        -> service_account_tail.go / model_account.go
//   Verification, VetProfile, VerificationDocument,   -> model.go / model_vet.go / model_account.go
//   BlockedDate, Vacation, RecurringRule, Reminder    -> model_ops.go

// EmergencyFacility mirrors public.doctor_emergency_facilities.
type EmergencyFacility struct {
	ID           string          `json:"id"`
	UserID       string          `json:"userId"`
	Name         *string         `json:"name,omitempty"`
	FacilityType *string         `json:"facilityType,omitempty"`
	Location     json.RawMessage `json:"location,omitempty"`
	Contact      json.RawMessage `json:"contact,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
}

// Invoice mirrors public.doctor_invoices. All money columns are int64 kobo.
type Invoice struct {
	ID             string          `json:"id"`
	UserID         string          `json:"userId"`
	Ref            *string         `json:"ref,omitempty"`
	AppointmentID  *string         `json:"appointmentId,omitempty"`
	GrossKobo      int64           `json:"grossKobo"`
	CommissionKobo int64           `json:"commissionKobo"`
	VATKobo        int64           `json:"vatKobo"`
	NetKobo        int64           `json:"netKobo"`
	Currency       string          `json:"currency"`
	Status         string          `json:"status"`
	LedgerRef      *string         `json:"ledgerRef,omitempty"`
	IssuedAt       time.Time       `json:"issuedAt"`
	Detail         json.RawMessage `json:"detail,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

// CommissionConfig mirrors public.doctor_commission_config (one row per doctor).
type CommissionConfig struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	CommissionBps int             `json:"commissionBps"`
	VATBps        int             `json:"vatBps"`
	PayoutCycle   string          `json:"payoutCycle"`
	Detail        json.RawMessage `json:"detail,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// WalletBalance is the doctor's wallet balance PROJECTED from the double-entry
// ledger (Service.ledger.GetBalance) — it is never read from a stored balance
// column. AvailableKobo is int64 minor units (kobo).
type WalletBalance struct {
	AvailableKobo int64  `json:"availableKobo"`
	Currency      string `json:"currency"`
	Source        string `json:"source"` // always "ledger" — documents the projection
}

// EarningsBreakdown composes the ledger wallet balance with invoice money sums.
// All money is int64 kobo. LedgerBalanceKobo comes from the ledger; the gross /
// commission / vat / net totals are summed from doctor_invoices.
type EarningsBreakdown struct {
	Currency          string `json:"currency"`
	LedgerBalanceKobo int64  `json:"ledgerBalanceKobo"`
	GrossKobo         int64  `json:"grossKobo"`
	CommissionKobo    int64  `json:"commissionKobo"`
	VATKobo           int64  `json:"vatKobo"`
	NetKobo           int64  `json:"netKobo"`
	InvoiceCount      int64  `json:"invoiceCount"`
}

// CommissionBreakdown is the commission projection: the configured rate (bps)
// plus the lifetime commission withheld (summed from invoices). Money in kobo.
type CommissionBreakdown struct {
	Currency           string `json:"currency"`
	CommissionBps      int    `json:"commissionBps"`
	VATBps             int    `json:"vatBps"`
	PayoutCycle        string `json:"payoutCycle"`
	LifetimeGrossKobo  int64  `json:"lifetimeGrossKobo"`
	CommissionPaidKobo int64  `json:"commissionPaidKobo"`
}

// TaxVatReport is the tax / VAT projection summed from doctor_invoices. Money in kobo.
type TaxVatReport struct {
	Currency     string `json:"currency"`
	GrossKobo    int64  `json:"grossKobo"`
	VATKobo      int64  `json:"vatKobo"`
	NetKobo      int64  `json:"netKobo"`
	InvoiceCount int64  `json:"invoiceCount"`
}

// DashboardSummary is the composite landing projection for GET /dashboard. It is
// composed entirely from existing scoped reads + the ledger balance — no new
// table. Money is int64 kobo.
type DashboardSummary struct {
	AppointmentCounts   map[string]int64 `json:"appointmentCounts"`
	UnreadNotifications int64            `json:"unreadNotifications"`
	WalletBalanceKobo   int64            `json:"walletBalanceKobo"`
	Currency            string           `json:"currency"`
}

// ScheduleSettings is the composite projection for GET /schedule — it summarises
// the doctor's schedule sub-resources (blocked dates / recurring rules /
// reminders / current vacation) which each already have their own list endpoints.
type ScheduleSettings struct {
	BlockedDates   []BlockedDate   `json:"blockedDates"`
	RecurringRules []RecurringRule `json:"recurringRules"`
	Reminders      []Reminder      `json:"reminders"`
	Vacation       *Vacation       `json:"vacation,omitempty"`
}

// AccountStatus is the derived account-state projection for GET /account/status.
type AccountStatus struct {
	VerificationStatus string `json:"verificationStatus"`
	IsPublished        bool   `json:"isPublished"`
	ProviderType       string `json:"providerType"`
}

// ReviewNotice is the derived review-notice projection for
// GET /account/review-notice. HasNotice is true while verification is pending or
// rejected; Message surfaces any rejection reason.
type ReviewNotice struct {
	HasNotice bool    `json:"hasNotice"`
	Status    string  `json:"status"`
	Message   *string `json:"message,omitempty"`
}

// AppStatus is the static app/runtime status for GET /app-status. No table —
// these are server-side constants surfaced to the client for soft gating.
type AppStatus struct {
	MinSupportedVersion string `json:"minSupportedVersion"`
	Maintenance         bool   `json:"maintenance"`
	Message             string `json:"message,omitempty"`
}

// VetLicenceInfo is the vet-licence projection for GET /vet/licence, derived from
// the doctor_vet_profiles row (licence number + verification state).
type VetLicenceInfo struct {
	LicenceNumber *string `json:"licenceNumber,omitempty"`
	Verification  string  `json:"verification"`
}

// SupportFAQ is one FAQ entry for GET /support/faqs (static content catalogue).
type SupportFAQ struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

// HelpArticle is one help-article stub for GET /doctor/support/help-articles.
type HelpArticle struct {
	Slug    string `json:"slug"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

// OnboardingSlide is one onboarding slide for GET /doctor/onboarding/slides.
type OnboardingSlide struct {
	Key   string `json:"key"`
	Title string `json:"title"`
	Body  string `json:"body"`
}

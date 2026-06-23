package doctor

import (
	"context"
	"errors"
	"fmt"
)

// service_tail2.go — business logic for the Wave-3 "coverage close-out" endpoints
// (the 26 contract GETs specified but never wired). All are READS. Style mirrors
// service.go / service_account_tail.go:
//   - simple reads delegate straight to the repository, scoped to the doctor;
//   - aggregate / composed reads (dashboard, schedule, earnings breakdown) are
//     built from existing scoped reads — never a new stored field;
//   - the wallet balance is PROJECTED from the double-entry ledger via
//     s.ledger.GetBalance (the same call GetEarnings uses, service.go:115) — it is
//     never read from a stored balance column;
//   - NONE of these post to the ledger (money READS only).
//
// Optional sub-resources that legitimately may not exist yet (quality score,
// vacation, commission config) surface as zeroed/empty projections rather than a
// 404, so the composite dashboard/earnings/schedule reads never fail for a brand-
// new doctor.

// ── List reads (real tables) ──────────────────────────────────────────────────

func (s *Service) ListCallDisputes(ctx context.Context, userID string) ([]CallDispute, error) {
	return s.repo.ListCallDisputes(ctx, userID)
}

func (s *Service) ListSettlementDisputes(ctx context.Context, userID string) ([]SettlementDispute, error) {
	return s.repo.ListSettlementDisputes(ctx, userID)
}

func (s *Service) ListEmergencyCases(ctx context.Context, userID string) ([]EmergencyCase, error) {
	return s.repo.ListEmergencyCases(ctx, userID)
}

func (s *Service) ListEmergencyEscalations(ctx context.Context, userID string) ([]EmergencyEscalation, error) {
	return s.repo.ListEmergencyEscalations(ctx, userID, "")
}

func (s *Service) ListEmergencyFacilities(ctx context.Context, userID string) ([]EmergencyFacility, error) {
	return s.repo.ListEmergencyFacilities(ctx, userID)
}

// ListRedFlagAlerts surfaces the doctor's emergency escalations filtered to the
// 'hospital' / 'ambulance' urgency types — there is no dedicated red-flag table,
// so this is a derived projection over doctor_emergency_escalations.
func (s *Service) ListRedFlagAlerts(ctx context.Context, userID string) ([]EmergencyEscalation, error) {
	hosp, err := s.repo.ListEmergencyEscalations(ctx, userID, "hospital")
	if err != nil {
		return nil, err
	}
	amb, err := s.repo.ListEmergencyEscalations(ctx, userID, "ambulance")
	if err != nil {
		return nil, err
	}
	out := make([]EmergencyEscalation, 0, len(hosp)+len(amb))
	out = append(out, hosp...)
	out = append(out, amb...)
	return out, nil
}

func (s *Service) ListInvoices(ctx context.Context, userID string) ([]Invoice, error) {
	return s.repo.ListInvoices(ctx, userID)
}

func (s *Service) ListVetProfileDocuments(ctx context.Context, userID string) ([]VerificationDocument, error) {
	return s.repo.ListVetProfileDocuments(ctx, userID)
}

// ── Money projections ─────────────────────────────────────────────────────────

// GetWalletBalance PROJECTS the doctor's wallet balance from the double-entry
// ledger — it never reads a stored balance column. This reuses the exact same
// ledger call the MVP earnings path uses (GetEarnings, service.go:115:
// "balance, err := s.ledger.GetBalance(ctx, userID)"). Read-only: it posts no
// ledger entries.
func (s *Service) GetWalletBalance(ctx context.Context, userID string) (*WalletBalance, error) {
	balance, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("doctor: project wallet balance from ledger: %w", err)
	}
	return &WalletBalance{AvailableKobo: balance, Currency: "NGN", Source: "ledger"}, nil
}

// GetEarningsBreakdown composes the ledger wallet balance with the doctor's
// invoice money sums. Ledger balance is projected (never stored); invoice totals
// are summed from doctor_invoices. All money is int64 kobo.
func (s *Service) GetEarningsBreakdown(ctx context.Context, userID string) (*EarningsBreakdown, error) {
	balance, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("doctor: project earnings breakdown from ledger: %w", err)
	}
	gross, commission, vat, net, count, err := s.repo.invoiceTotals(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &EarningsBreakdown{
		Currency:          "NGN",
		LedgerBalanceKobo: balance,
		GrossKobo:         gross,
		CommissionKobo:    commission,
		VATKobo:           vat,
		NetKobo:           net,
		InvoiceCount:      count,
	}, nil
}

// GetCommissionBreakdown returns the configured commission/VAT rate plus the
// lifetime commission withheld (summed from invoices). A missing config row is
// not an error — it yields the zeroed default.
func (s *Service) GetCommissionBreakdown(ctx context.Context, userID string) (*CommissionBreakdown, error) {
	out := &CommissionBreakdown{Currency: "NGN", PayoutCycle: "biweekly"}
	cfg, err := s.repo.GetCommissionConfig(ctx, userID)
	switch {
	case err == nil:
		out.CommissionBps = cfg.CommissionBps
		out.VATBps = cfg.VATBps
		out.PayoutCycle = cfg.PayoutCycle
	case errors.Is(err, ErrNotFound):
		// keep zeroed defaults
	default:
		return nil, err
	}
	gross, commission, _, _, _, err := s.repo.invoiceTotals(ctx, userID)
	if err != nil {
		return nil, err
	}
	out.LifetimeGrossKobo = gross
	out.CommissionPaidKobo = commission
	return out, nil
}

// GetTaxVatReport summarises gross / VAT / net withheld across the doctor's
// invoices. All money is int64 kobo.
func (s *Service) GetTaxVatReport(ctx context.Context, userID string) (*TaxVatReport, error) {
	gross, _, vat, net, count, err := s.repo.invoiceTotals(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &TaxVatReport{Currency: "NGN", GrossKobo: gross, VATKobo: vat, NetKobo: net, InvoiceCount: count}, nil
}

// ── Composite / derived projections ───────────────────────────────────────────

// GetDashboard composes the landing dashboard from existing scoped reads: the
// appointment status counts, the unread-notification count, and the ledger wallet
// balance (projected, never stored). No new table.
func (s *Service) GetDashboard(ctx context.Context, userID string) (*DashboardSummary, error) {
	counts, err := s.repo.appointmentStatusCounts(ctx, userID)
	if err != nil {
		return nil, err
	}
	unread, err := s.repo.unreadNotificationCount(ctx, userID)
	if err != nil {
		return nil, err
	}
	balance, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("doctor: project dashboard wallet balance from ledger: %w", err)
	}
	return &DashboardSummary{
		AppointmentCounts:   counts,
		UnreadNotifications:  unread,
		WalletBalanceKobo:   balance,
		Currency:            "NGN",
	}, nil
}

// GetScheduleSettings composes the doctor's schedule sub-resources (blocked dates,
// recurring rules, reminders, current vacation) into one read. A missing vacation
// row is not an error — it surfaces as nil.
func (s *Service) GetScheduleSettings(ctx context.Context, userID string) (*ScheduleSettings, error) {
	blocked, err := s.repo.ListBlockedDates(ctx, userID)
	if err != nil {
		return nil, err
	}
	rules, err := s.repo.ListRecurringRules(ctx, userID)
	if err != nil {
		return nil, err
	}
	reminders, err := s.repo.ListReminders(ctx, userID)
	if err != nil {
		return nil, err
	}
	var vac *Vacation
	switch v, vErr := s.repo.GetVacation(ctx, userID); {
	case vErr == nil:
		vac = v
	case errors.Is(vErr, ErrNotFound):
		// no active vacation — leave nil
	default:
		return nil, vErr
	}
	return &ScheduleSettings{BlockedDates: blocked, RecurringRules: rules, Reminders: reminders, Vacation: vac}, nil
}

// GetQualityAnalytics returns the latest quality-score projection (reuses the
// repository read used by GET /quality/score). A missing row yields a zeroed
// score rather than a 404.
func (s *Service) GetQualityAnalytics(ctx context.Context, userID string) (*QualityScore, error) {
	q, err := s.repo.GetLatestQualityScore(ctx, userID)
	switch {
	case err == nil:
		return q, nil
	case errors.Is(err, ErrNotFound):
		return &QualityScore{UserID: userID, Score: 0}, nil
	default:
		return nil, err
	}
}

// GetVerificationDecision returns the latest verification record as the decision
// payload (status + any rejection reason). Reuses GetLatestVerification.
func (s *Service) GetVerificationDecision(ctx context.Context, userID string) (*Verification, error) {
	return s.repo.GetLatestVerification(ctx, userID)
}

// GetAccountStatus derives the account-state projection from the profile +
// latest verification. A missing profile is a genuine 404 (the doctor must have a
// profile); a missing verification degrades to "unsubmitted".
func (s *Service) GetAccountStatus(ctx context.Context, userID string) (*AccountStatus, error) {
	p, err := s.repo.GetProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := &AccountStatus{ProviderType: p.ProviderType, IsPublished: p.IsPublished, VerificationStatus: "unsubmitted"}
	switch v, vErr := s.repo.GetLatestVerification(ctx, userID); {
	case vErr == nil:
		out.VerificationStatus = v.Status
	case errors.Is(vErr, ErrNotFound):
		// keep "unsubmitted"
	default:
		return nil, vErr
	}
	return out, nil
}

// GetReviewNotice derives the review-notice banner from the latest verification:
// a notice is shown while verification is pending or rejected. No verification
// row means nothing to review (no notice).
func (s *Service) GetReviewNotice(ctx context.Context, userID string) (*ReviewNotice, error) {
	out := &ReviewNotice{Status: "unsubmitted"}
	switch v, err := s.repo.GetLatestVerification(ctx, userID); {
	case err == nil:
		out.Status = v.Status
		out.HasNotice = v.Status == "pending" || v.Status == "rejected"
		out.Message = v.RejectionReason
	case errors.Is(err, ErrNotFound):
		// no verification submitted — no notice
	default:
		return nil, err
	}
	return out, nil
}

// GetAppStatus returns static server-side runtime status (no backing table).
func (s *Service) GetAppStatus(ctx context.Context, userID string) (*AppStatus, error) {
	_ = userID
	return &AppStatus{MinSupportedVersion: "1.0.0", Maintenance: false}, nil
}

// ── Vet reads ─────────────────────────────────────────────────────────────────

// GetVetLicence projects the vet licence info from the doctor_vet_profiles row.
func (s *Service) GetVetLicence(ctx context.Context, userID string) (*VetLicenceInfo, error) {
	vp, err := s.repo.GetVetProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &VetLicenceInfo{LicenceNumber: vp.LicenceNumber, Verification: vp.Verification}, nil
}

// GetVetVerification returns the vet profile (whose verification field is the
// submission state). Reuses GetVetProfile.
func (s *Service) GetVetVerification(ctx context.Context, userID string) (*VetProfile, error) {
	return s.repo.GetVetProfile(ctx, userID)
}

// GetVetProfileDraft returns the vet profile (carrying the profile_draft field).
// Reuses GetVetProfile.
func (s *Service) GetVetProfileDraft(ctx context.Context, userID string) (*VetProfile, error) {
	return s.repo.GetVetProfile(ctx, userID)
}

// ── Static content catalogues (no backing table) ──────────────────────────────

// GetSupportFAQs returns the static support FAQ catalogue.
func (s *Service) GetSupportFAQs(ctx context.Context, userID string) ([]SupportFAQ, error) {
	_ = userID
	return []SupportFAQ{
		{Question: "How do I request a payout?", Answer: "Open Earnings → Request Payout. Funds settle to your verified bank account on the next cycle."},
		{Question: "How is my commission calculated?", Answer: "Commission is withheld per consultation at your configured rate; see Earnings → Commission."},
		{Question: "How do I go on vacation?", Answer: "Open Schedule → Vacation and set your away dates; new bookings are paused for that window."},
	}, nil
}

// GetHelpArticles returns the static help-article catalogue.
func (s *Service) GetHelpArticles(ctx context.Context, userID string) ([]HelpArticle, error) {
	_ = userID
	return []HelpArticle{
		{Slug: "getting-started", Title: "Getting started", Summary: "Set up your profile, availability and verification."},
		{Slug: "consultations", Title: "Running consultations", Summary: "Joining calls, writing clinical notes and prescriptions."},
		{Slug: "payouts", Title: "Payouts & earnings", Summary: "How earnings, commission and settlements work."},
	}, nil
}

// GetOnboardingSlides returns the static onboarding slide deck.
func (s *Service) GetOnboardingSlides(ctx context.Context, userID string) ([]OnboardingSlide, error) {
	_ = userID
	return []OnboardingSlide{
		{Key: "welcome", Title: "Welcome", Body: "Provide care to patients across the network."},
		{Key: "verify", Title: "Get verified", Body: "Submit your MDCN licence to start consulting."},
		{Key: "earn", Title: "Get paid", Body: "Track earnings and request payouts to your bank."},
	}, nil
}

// GetLatestAnnouncement returns the latest platform announcement. No announcement
// table is wired for doctors yet, so this is a derived empty projection (nil =
// "no announcement"), surfaced as a 200 with a null body by the handler.
func (s *Service) GetLatestAnnouncement(ctx context.Context, userID string) (any, error) {
	_ = userID
	return nil, nil
}

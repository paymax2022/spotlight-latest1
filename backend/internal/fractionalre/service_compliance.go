package fractionalre

import (
	"context"
	"fmt"
	"time"
)

// LimitCheck evaluates the SEC retail 10%-of-declared-annual-income cap for a
// user, platform-wide, before a proposed investment of requestedKobo.
//
// Cap formula (all integer kobo, no floats):
//
//	base_cap   = declared_annual_income_kobo * RetailIncomeCapBps / 10000   // 10%
//	cap        = base_cap + active_overrides_kobo
//	ytd        = SUM(primary subscriptions escrowed|allocated this year)
//	             + SUM(secondary buys escrowed|settled this year)            // includes auto-invest executions, which run through subscribe
//	remaining  = max(cap - ytd, 0)
//	allowed    = requestedKobo <= remaining
//	soft_warn  = (ytd + requestedKobo) >= cap * SoftWarnBps / 10000          // >= 80%
//
// HNI and qualified investors are EXEMPT (cap not applied). The check is
// fail-closed: any error, or a missing/unclassified profile treated as retail
// with zero declared income, yields a hard block (remaining 0) for retail.
func (s *Service) LimitCheck(ctx context.Context, userID string, requestedKobo int64) (*LimitCheck, error) {
	p, err := s.repo.GetInvestorProfile(ctx, userID)
	if err != nil {
		if err == ErrNotFound {
			// No profile → treat as retail with zero income → fail-closed block.
			return &LimitCheck{
				UserID:         userID,
				Classification: ClassRetail,
				RequestedKobo:  requestedKobo,
				CapKobo:        0,
				RemainingKobo:  0,
				Allowed:        requestedKobo <= 0,
				Reason:         "no investor profile — activate and declare income first",
			}, nil
		}
		return nil, err
	}

	res := &LimitCheck{
		UserID:           userID,
		Classification:   p.Classification,
		AnnualIncomeKobo: p.DeclaredAnnualIncomeKobo,
		RequestedKobo:    requestedKobo,
	}

	// HNI / qualified are exempt from the retail cap.
	if p.Classification == ClassHNI || p.Classification == ClassQualified {
		res.Exempt = true
		res.Allowed = true
		res.RemainingKobo = -1 // -1 sentinel = unlimited
		return res, nil
	}

	year := s.now().UTC().Year()
	ytd, err := s.repo.SumYTDInvested(ctx, userID, year)
	if err != nil {
		// Fail closed.
		return nil, fmt.Errorf("fractionalre: ytd sum (fail closed): %w", err)
	}
	overrides, err := s.repo.SumActiveOverrides(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("fractionalre: overrides sum (fail closed): %w", err)
	}

	capKobo, remaining, allowed, softWarn := computeRetailCap(p.DeclaredAnnualIncomeKobo, overrides, ytd, requestedKobo)
	res.CapKobo = capKobo
	res.YTDInvestedKobo = ytd
	res.RemainingKobo = remaining
	res.Allowed = allowed
	res.SoftWarn = softWarn
	if !res.Allowed {
		res.Reason = fmt.Sprintf("exceeds 10%% annual-income cap: requested %d kobo, remaining %d kobo", requestedKobo, remaining)
	}
	return res, nil
}

// computeRetailCap is the pure, integer-kobo core of the retail 10%-income cap.
// Extracted so the arithmetic is unit-testable without a DB. All values are
// kobo. remaining is clamped at >= 0; allowed = requested <= remaining;
// softWarn fires when (ytd + requested) >= 80% of cap.
func computeRetailCap(annualIncomeKobo, overridesKobo, ytdKobo, requestedKobo int64) (capKobo, remainingKobo int64, allowed, softWarn bool) {
	baseCap := annualIncomeKobo * RetailIncomeCapBps / 10000
	capKobo = baseCap + overridesKobo
	remainingKobo = capKobo - ytdKobo
	if remainingKobo < 0 {
		remainingKobo = 0
	}
	allowed = requestedKobo <= remainingKobo
	if capKobo > 0 && (ytdKobo+requestedKobo) >= capKobo*SoftWarnBps/10000 {
		softWarn = true
	}
	return capKobo, remainingKobo, allowed, softWarn
}

// enforceLimit is the server-side fail-closed gate reused by Subscribe and the
// secondary-market Buy path. It HARD-BLOCKS when not allowed (returns
// ErrLimitExceeded); the soft-warn is surfaced to the client via LimitCheck but
// never blocks. Exempt (HNI/qualified) investors always pass.
func (s *Service) enforceLimit(ctx context.Context, userID string, amountKobo int64) error {
	chk, err := s.LimitCheck(ctx, userID, amountKobo)
	if err != nil {
		return err // fail closed
	}
	if chk.Exempt {
		return nil
	}
	if !chk.Allowed {
		return ErrLimitExceeded
	}
	return nil
}

// ── Compliance admin: classification + overrides + KYC queue glue ─────────────

// ClassifyInvestor sets a user's classification (retail|hni|qualified) and
// declared income. Logged to the immutable audit trail (compliance action).
func (s *Service) ClassifyInvestor(ctx context.Context, adminID, userID string, class Classification, incomeKobo int64) error {
	switch class {
	case ClassRetail, ClassHNI, ClassQualified:
	default:
		return fmt.Errorf("fractionalre: invalid classification %q", class)
	}
	if err := s.repo.SetClassification(ctx, userID, class, incomeKobo, adminID); err != nil {
		return err
	}
	_ = s.audit.log(ctx, adminID, "investor.classify", "investor_profile", userID, "",
		nil, map[string]any{"classification": class, "declared_annual_income_kobo": incomeKobo})
	return nil
}

// SetDeclaredIncome lets the investor self-declare annual income (drives the cap).
func (s *Service) SetDeclaredIncome(ctx context.Context, userID string, incomeKobo int64) error {
	if incomeKobo < 0 {
		return fmt.Errorf("fractionalre: income must be non-negative kobo")
	}
	if err := s.repo.SetDeclaredIncome(ctx, userID, incomeKobo); err != nil {
		return err
	}
	_ = s.audit.log(ctx, userID, "investor.declare_income", "investor_profile", userID, "",
		nil, map[string]int64{"declared_annual_income_kobo": incomeKobo})
	return nil
}

// OverrideLimit grants additional headroom above the 10% cap for a user. This is
// a compliance-only action and is ALWAYS logged with a mandatory reason plus a
// typed reason_code from the closed LimitOverrideReasonCodes vocabulary
// (empty → 'other'; unknown codes are rejected).
func (s *Service) OverrideLimit(ctx context.Context, adminID, userID string, overrideKobo int64, reason, reasonCode string, expires *time.Time) error {
	if reason == "" {
		return fmt.Errorf("%w: override reason is required", ErrValidation)
	}
	if reasonCode == "" {
		reasonCode = "other"
	}
	if !LimitOverrideReasonCodes[reasonCode] {
		return fmt.Errorf("%w: reason_code must be one of hni_upgrade|vip_waiver|error_correction|compliance_review|other", ErrValidation)
	}
	if overrideKobo <= 0 {
		return fmt.Errorf("%w: override must be positive kobo", ErrValidation)
	}
	if err := s.repo.InsertOverride(ctx, userID, overrideKobo, reason, reasonCode, adminID, expires); err != nil {
		return err
	}
	_ = s.audit.log(ctx, adminID, "compliance.limit_override", "investor_profile", userID, reason,
		nil, map[string]any{"override_kobo": overrideKobo, "reason_code": reasonCode})
	return nil
}

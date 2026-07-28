package connectaml

import (
	"context"
	"errors"
	"time"
)

// Auditor writes an immutable audit entry (connect_audit_log). AML decisions are
// audited (action + reason code + ids — never raw PII).
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// Thresholds are backend-owned kobo limits + window sizes for the rules engine.
// Defaults align with PRD §7 (single-event reporting threshold, velocity burst,
// structuring aggregation). They are NOT client input.
type Thresholds struct {
	// SingleEventKobo: a single event at/above this is reported (THRESHOLD_EXCEEDED).
	SingleEventKobo int64
	// VelocityWindow + VelocityMaxCount: more than MaxCount events in Window → VELOCITY_BURST.
	VelocityWindow   time.Duration
	VelocityMaxCount int
	// StructuringWindow + StructuringAggKobo: many sub-threshold events whose sum
	// reaches AggKobo within Window → STRUCTURING.
	StructuringWindow  time.Duration
	StructuringAggKobo int64
}

// DefaultThresholds returns CBN/NFIU-aligned defaults (₦1,000,000 single-event
// reporting line; ₦5,000,000 aggregate structuring line). All kobo.
func DefaultThresholds() Thresholds {
	return Thresholds{
		SingleEventKobo:    100_000_000, // ₦1,000,000
		VelocityWindow:     time.Hour,
		VelocityMaxCount:   20,
		StructuringWindow:  24 * time.Hour,
		StructuringAggKobo: 500_000_000, // ₦5,000,000
	}
}

// Sentinel errors.
var (
	ErrCaseNotFound = errors.New("aml: case not found or not open")
	ErrInvalidType  = errors.New("aml: report type must be str or sar")
)

// Service runs the monitoring rules engine and owns the NFIU case scaffold.
// Hooks (FlagGift / FlagPaidVote / FlagPayout) are called from the money path;
// they record the event, score it, screen the subject, and raise append-only
// alerts. Scoring NEVER blocks settlement — AML is detect-and-report, not a
// pre-authorization gate (the tier/limit gate is the money-path guard).
type Service struct {
	repo     *Repository
	audit    Auditor
	screener SanctionsScreener
	limits   Thresholds
}

// NewService builds the AML service. If screener is nil, a NoopScreener is used.
func NewService(repo *Repository, audit Auditor, screener SanctionsScreener, limits Thresholds) *Service {
	if screener == nil {
		screener = NoopScreener{}
	}
	if limits.SingleEventKobo == 0 {
		limits = DefaultThresholds()
	}
	return &Service{repo: repo, audit: audit, screener: screener, limits: limits}
}

// FlagGift is the gifting hook (satisfies gifting.SolicitationFlagger).
func (s *Service) FlagGift(ctx context.Context, senderID, recipientID string, amountKobo int64, ref string) error {
	return s.score(ctx, senderID, EventGift, amountKobo, ref)
}

// FlagPaidVote is the voting hook (satisfies voting.SolicitationFlagger).
func (s *Service) FlagPaidVote(ctx context.Context, voterID string, amountKobo int64, ref string) error {
	return s.score(ctx, voterID, EventPaidVote, amountKobo, ref)
}

// FlagPayout is the payouts hook (satisfies payouts.SolicitationFlagger).
func (s *Service) FlagPayout(ctx context.Context, creatorID string, amountKobo int64, ref string) error {
	return s.score(ctx, creatorID, EventPayout, amountKobo, ref)
}

// score records the event projection, evaluates the rules, screens the subject,
// and raises append-only alerts for every triggered reason. Best-effort: a
// scoring/storage error is returned for logging but never unwinds the money move.
func (s *Service) score(ctx context.Context, subjectID string, kind EventKind, amountKobo int64, ref string) error {
	if err := s.repo.RecordEvent(ctx, subjectID, kind, amountKobo, ref); err != nil {
		return err
	}

	// Threshold rule — single event at/above the reporting line.
	if amountKobo >= s.limits.SingleEventKobo {
		s.raise(ctx, subjectID, kind, ReasonThresholdExceeded, amountKobo, 1, ref)
	}

	// Velocity rule — too many events in the short window.
	if s.limits.VelocityMaxCount > 0 {
		n, _, err := s.repo.SumRecent(ctx, subjectID, kind, time.Now().UTC().Add(-s.limits.VelocityWindow))
		if err == nil && n > s.limits.VelocityMaxCount {
			s.raise(ctx, subjectID, kind, ReasonVelocity, amountKobo, n, ref)
		}
	}

	// Structuring rule — many sub-threshold events aggregating past the line.
	if s.limits.StructuringAggKobo > 0 {
		n, total, err := s.repo.SumRecent(ctx, subjectID, kind, time.Now().UTC().Add(-s.limits.StructuringWindow))
		if err == nil && total >= s.limits.StructuringAggKobo && n > 1 {
			s.raise(ctx, subjectID, kind, ReasonStructuring, total, n, ref)
		}
	}

	// Sanctions / PEP screening — stub interface; a hit raises an alert.
	if res, err := s.screener.Screen(ctx, subjectID); err == nil && res.Hit {
		s.raise(ctx, subjectID, kind, ReasonSanctionsHit, amountKobo, 1, ref)
	}
	return nil
}

// raise appends an alert and audits it (best-effort; reason code only, no PII).
func (s *Service) raise(ctx context.Context, subjectID string, kind EventKind, reason ReasonCode, amountKobo int64, windowCount int, ref string) {
	r := ref
	a, err := s.repo.InsertAlert(ctx, &Alert{
		SubjectID:   subjectID,
		EventKind:   kind,
		ReasonCode:  reason,
		AmountKobo:  amountKobo,
		WindowCount: windowCount,
		LedgerRef:   &r,
	})
	if err != nil || s.audit == nil {
		return
	}
	_ = s.audit.WriteAudit(ctx, "connect.aml.alert", "system", "connect_aml_alert", a.ID, map[string]any{
		"reason_code": string(reason), "event_kind": string(kind),
		"amount_kobo": amountKobo, "window_count": windowCount,
	})
}

// --- Admin: case scaffold ---

// ListAlerts returns recent monitoring alerts (admin).
func (s *Service) ListAlerts(ctx context.Context, limit int) ([]Alert, error) {
	return s.repo.ListAlerts(ctx, limit)
}

// ListCases returns recent NFIU STR/SAR cases (admin).
func (s *Service) ListCases(ctx context.Context, limit int) ([]Case, error) {
	return s.repo.ListCases(ctx, limit)
}

// OpenCase opens an append-only STR/SAR case for a subject (admin/compliance).
func (s *Service) OpenCase(ctx context.Context, subjectID, reportType string, reasonCodes []string, adminID string) (*Case, error) {
	if reportType != "str" && reportType != "sar" {
		return nil, ErrInvalidType
	}
	c, err := s.repo.OpenCase(ctx, subjectID, reportType, reasonCodes, &adminID)
	if err != nil {
		return nil, err
	}
	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "connect.aml.case.open", adminID, "connect_aml_case", c.ID, map[string]any{
			"report_type": reportType, "reason_codes": reasonCodes,
		})
	}
	return c, nil
}

// FileSTR files an open case with the NFIU (forward-only transition to 'filed').
func (s *Service) FileSTR(ctx context.Context, caseID, adminID string, req FileSTRRequest) (*Case, error) {
	c, err := s.repo.FileSTR(ctx, caseID, adminID, req)
	if err != nil {
		return nil, ErrCaseNotFound
	}
	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "connect.aml.case.file_str", adminID, "connect_aml_case", c.ID, map[string]any{
			"filed_ref": req.FiledRef, "report_type": c.ReportType,
		})
	}
	return c, nil
}

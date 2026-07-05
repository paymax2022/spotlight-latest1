package parent

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service implements the academy parent layer. Every (guardian, minor) operation
// is gated by the active guardian link, FAIL-CLOSED: if the link is not active the
// op returns ErrForbidden and is audited. No money path (purchase approvals only
// gate the order; commerce reads the approval state).
type Service struct {
	repo *Repository
}

// NewService wires the parent service from a pgx pool.
func NewService(db *pgxpool.Pool) *Service { return &Service{repo: NewRepository(db)} }

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrIllegalTransition = errors.New("academy.parent: illegal state transition")
	ErrInvalidInput      = errors.New("academy.parent: invalid input")
	// ErrForbidden is the child-safety gate failure: no ACTIVE guardian link.
	ErrForbidden = errors.New("academy.parent: no active guardian link for this minor")
)

// requireActiveLink is the single fail-closed gate. It resolves the link state and
// runs the pure canActOnMinor decision; on denial it audits and returns ErrForbidden.
// EVERY guarded op calls this BEFORE touching any minor data.
func (s *Service) requireActiveLink(ctx context.Context, guardianID, minorID string) error {
	if guardianID == "" || minorID == "" {
		return ErrInvalidInput
	}
	active, err := s.repo.IsActiveGuardianLink(ctx, guardianID, minorID)
	if err != nil {
		return err
	}
	if !canActOnMinor(active) {
		// Fail closed + audit the denied attempt.
		_ = s.repo.insertAudit(ctx, guardianID, "parent.access_denied", "academy_guardian_link", minorID,
			map[string]any{"minor_user_id": minorID, "reason": "no_active_guardian_link"}, "warning")
		return ErrForbidden
	}
	return nil
}

// ── Children / dashboards ────────────────────────────────────────────────────────

// Children returns the minors the guardian is actively linked to.
func (s *Service) Children(ctx context.Context, guardianID string) ([]Child, error) {
	if guardianID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.ListActiveChildren(ctx, guardianID)
}

// ChildDashboard aggregates a minor's cross-subject progress. Gated by the link.
func (s *Service) ChildDashboard(ctx context.Context, guardianID, minorID string) (*ChildDashboard, error) {
	if err := s.requireActiveLink(ctx, guardianID, minorID); err != nil {
		return nil, err
	}
	return s.buildDashboard(ctx, minorID, "")
}

// ChildSubject aggregates a minor's progress for one subject. Gated by the link.
func (s *Service) ChildSubject(ctx context.Context, guardianID, minorID, subjectID string) (*ChildDashboard, error) {
	if subjectID == "" {
		return nil, ErrInvalidInput
	}
	if err := s.requireActiveLink(ctx, guardianID, minorID); err != nil {
		return nil, err
	}
	return s.buildDashboard(ctx, minorID, subjectID)
}

// buildDashboard assembles the aggregated view from mastery + progress + readiness.
func (s *Service) buildDashboard(ctx context.Context, minorID, subjectID string) (*ChildDashboard, error) {
	rows, err := s.repo.MasteryRowsForMinor(ctx, minorID, subjectID)
	if err != nil {
		return nil, err
	}
	recent, err := s.repo.RecentProgressForMinor(ctx, minorID, 20)
	if err != nil {
		return nil, err
	}
	readiness, err := s.repo.LatestReadinessForMinor(ctx, minorID)
	if err != nil {
		return nil, err
	}
	return &ChildDashboard{
		MinorUserID:    minorID,
		Subjects:       aggregateMasteryBySubject(rows),
		RecentProgress: recent,
		ExamReadiness:  readiness,
		GeneratedAt:    time.Now().UTC(),
	}, nil
}

// ── Parent controls ──────────────────────────────────────────────────────────────

// UpsertControls writes controls for a minor. Gated by the link.
func (s *Service) UpsertControls(ctx context.Context, guardianID, minorID string, req UpsertControlsRequest) (*ParentControls, error) {
	if req.ScreenTimeMinutes < 0 {
		return nil, ErrInvalidInput
	}
	if err := s.requireActiveLink(ctx, guardianID, minorID); err != nil {
		return nil, err
	}
	return s.repo.UpsertControls(ctx, guardianID, minorID, req)
}

// ── Progress reports ─────────────────────────────────────────────────────────────

// GenerateReport aggregates the minor's stats for the period into a stored report.
// Gated by the link.
func (s *Service) GenerateReport(ctx context.Context, guardianID, minorID, period string) (*ProgressReport, error) {
	if period == "" {
		return nil, ErrInvalidInput
	}
	if err := s.requireActiveLink(ctx, guardianID, minorID); err != nil {
		return nil, err
	}
	rows, err := s.repo.MasteryRowsForMinor(ctx, minorID, "")
	if err != nil {
		return nil, err
	}
	recent, err := s.repo.RecentProgressForMinor(ctx, minorID, 200)
	if err != nil {
		return nil, err
	}
	readiness, err := s.repo.LatestReadinessForMinor(ctx, minorID)
	if err != nil {
		return nil, err
	}
	subjects := aggregateMasteryBySubject(rows)
	payload := buildReportPayload(period, subjects, len(recent), readiness)
	return s.repo.InsertReport(ctx, guardianID, minorID, period, payload)
}

// ListReports returns a minor's generated reports. Gated by the link.
func (s *Service) ListReports(ctx context.Context, guardianID, minorID string) ([]ProgressReport, error) {
	if err := s.requireActiveLink(ctx, guardianID, minorID); err != nil {
		return nil, err
	}
	return s.repo.ListReports(ctx, minorID, 50)
}

// ── Purchase approvals ───────────────────────────────────────────────────────────

// ListPending returns the guardian's pending purchase approvals (already scoped to
// the guardian; each row belongs to a minor the guardian linked).
func (s *Service) ListPending(ctx context.Context, guardianID string) ([]PurchaseApproval, error) {
	if guardianID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.ListPendingApprovals(ctx, guardianID)
}

// Decide approves or rejects a minor's purchase. Fail-closed: the approval must be
// owned by this guardian AND the guardian must hold an ACTIVE link to the minor on
// the approval (re-verified here, not trusted from the row). This gates the order;
// commerce reads the resulting approval state.
func (s *Service) Decide(ctx context.Context, guardianID, approvalID, decision string) (*PurchaseApproval, error) {
	to, ok := validApprovalDecision(decision)
	if !ok {
		return nil, ErrInvalidInput
	}
	appr, err := s.repo.GetApproval(ctx, approvalID)
	if err != nil {
		return nil, err
	}
	// Ownership: the approval must belong to this guardian.
	if appr.GuardianUserID != guardianID {
		_ = s.repo.insertAudit(ctx, guardianID, "purchase_approval.decide_denied", "academy_purchase_approval", approvalID,
			map[string]any{"reason": "not_owner"}, "warning")
		return nil, ErrForbidden
	}
	// Child-safety gate: re-verify the active link to the minor on the approval.
	if err := s.requireActiveLink(ctx, guardianID, appr.MinorUserID); err != nil {
		return nil, err
	}
	return s.repo.DecideApproval(ctx, guardianID, approvalID, to)
}

// ── Notification templates (admin) ───────────────────────────────────────────────

func (s *Service) UpsertTemplate(ctx context.Context, actor string, req UpsertTemplateRequest) (*NotificationTemplate, error) {
	if req.Key == "" || req.Body == "" || !validChannel(req.Channel) {
		return nil, ErrInvalidInput
	}
	return s.repo.UpsertTemplate(ctx, actor, req)
}

func (s *Service) ListTemplates(ctx context.Context) ([]NotificationTemplate, error) {
	return s.repo.ListTemplates(ctx)
}

func (s *Service) GetTemplate(ctx context.Context, key string) (*NotificationTemplate, error) {
	if key == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.GetTemplate(ctx, key)
}

func (s *Service) DeleteTemplate(ctx context.Context, actor, key string) error {
	if key == "" {
		return ErrInvalidInput
	}
	return s.repo.DeleteTemplate(ctx, actor, key)
}

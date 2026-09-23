package marketplace

import (
	"context"
	"errors"

	"spotlight/backend/internal/health/makercheck"
)

// service_admin_appeals.go — MKT-007 Appeals service layer. Same maker-checker
// mechanism as service_admin_users.go (makercheck.Authorize), applied only to
// an 'overturn' decision — an 'uphold' executes immediately (see
// repository_admin_appeals.go ProposeAppealDecision doc comment).

// FileAppeal is the member-facing POST /appeals (auth, no RBAC) AND the
// admin-on-behalf-of-member path — same method, different caller context.
func (s *Service) FileAppeal(ctx context.Context, appellantID string, in CreateAppealInput) (*Appeal, error) {
	if in.TargetType != string(AppealTargetListing) && in.TargetType != string(AppealTargetBoost) && in.TargetType != string(AppealTargetUser) {
		return nil, fieldErr(CodeValidation, "target_type must be listing, boost, or user", "target_type")
	}
	if in.TargetID == "" {
		return nil, fieldErr(CodeValidation, "target_id is required", "target_id")
	}
	if in.OriginalReasonCode == "" {
		return nil, fieldErr(CodeValidation, "original_reason_code is required", "original_reason_code")
	}
	if in.AppellantNote == "" {
		return nil, fieldErr(CodeValidation, "appellant_note is required", "appellant_note")
	}
	a, err := s.repo.InsertAppeal(ctx, DefaultMarketID, appellantID, in.TargetType, in.TargetID, in.OriginalAction, in.OriginalReasonCode, in.AppellantNote)
	if err != nil {
		return nil, err
	}
	if s.audit != nil {
		s.audit.Audit(ctx, appellantID, "appeal.filed", map[string]any{"appeal_id": a.ID, "target_type": a.TargetType, "target_id": a.TargetID})
	}
	return a, nil
}

// GetAppealAdmin GET /admin/appeals/:id.
func (s *Service) GetAppealAdmin(ctx context.Context, id string) (*Appeal, error) {
	return s.repo.GetAppeal(ctx, id)
}

// ListAppealsAdmin GET /admin/appeals?status=.
func (s *Service) ListAppealsAdmin(ctx context.Context, status string, limit, offset int) ([]Appeal, error) {
	return s.repo.ListAppeals(ctx, DefaultMarketID, status, limit, offset)
}

// SetAppealStatusAdmin PATCH /admin/appeals/:id/status.
func (s *Service) SetAppealStatusAdmin(ctx context.Context, adminID, adminRole, id, status, reasonCode string) (*Appeal, error) {
	if status != "opened" && status != "under_review" && status != "closed" {
		return nil, fieldErr(CodeValidation, "status must be opened, under_review, or closed", "status")
	}
	a, err := s.repo.SetAppealStatus(ctx, id, status)
	if err != nil {
		return nil, err
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, AdminRole: adminRole, Action: "appeal.status",
		TargetType: "appeal", TargetID: id, ReasonCode: reasonCode,
		AfterState: map[string]any{"status": status},
	})
	return a, nil
}

// DecideAppealAdmin POST /admin/appeals/:id/decide — the maker step for
// decision='overturn' (dual-approval), or the immediate execution for
// decision='uphold' (single-admin).
func (s *Service) DecideAppealAdmin(ctx context.Context, adminID, adminRole, id string, in DecideAppealInput) (*Appeal, error) {
	if err := requireReason(in.ReasonCode); err != nil {
		return nil, err
	}
	stored, ok := decisionPastTense(in.Decision)
	if !ok {
		return nil, ErrInvalidAppealDecision
	}
	a, err := s.repo.ProposeAppealDecision(ctx, id, stored, in.ReasonCode, in.Notes, adminID)
	if err != nil {
		return nil, err
	}
	action := "appeal.decide." + in.Decision
	if a.RequiresDualApproval {
		action += ".proposed"
	} else {
		action += ".executed"
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, AdminRole: adminRole, Action: action,
		TargetType: "appeal", TargetID: id, ReasonCode: in.ReasonCode,
		AfterState: map[string]any{"decision": stored, "status": a.Status, "requires_dual_approval": a.RequiresDualApproval},
	})
	return a, nil
}

// ApproveAppealAdmin POST /admin/appeals/:id/approve — the checker step for an
// 'overturn' decision. checkerID MUST differ from decided_by.
func (s *Service) ApproveAppealAdmin(ctx context.Context, checkerID, checkerRole, id, reasonCode string) (*Appeal, error) {
	if err := requireReason(reasonCode); err != nil {
		return nil, err
	}
	current, err := s.repo.GetAppeal(ctx, id)
	if err != nil {
		return nil, err
	}
	if current.Status != "decided" || !current.RequiresDualApproval || current.DecidedBy == nil {
		return nil, ErrNoPendingAction
	}
	if err := makercheck.Authorize(*current.DecidedBy, checkerID); err != nil {
		if errors.Is(err, makercheck.ErrSelfApproval) {
			return nil, ErrSameApproverNotAllowed
		}
		return nil, wrapInternal("makercheck authorize", err)
	}
	a, err := s.repo.ApproveAppealDecision(ctx, id, checkerID)
	if err != nil {
		return nil, err
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: checkerID, AdminRole: checkerRole, Action: "appeal.decide.approved",
		TargetType: "appeal", TargetID: id, ReasonCode: reasonCode,
		BeforeState: map[string]any{"decided_by": *current.DecidedBy},
		AfterState:  map[string]any{"status": a.Status, "second_approver_id": checkerID},
	})
	return a, nil
}

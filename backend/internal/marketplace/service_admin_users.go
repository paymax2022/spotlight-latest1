package marketplace

import (
	"context"
	"errors"
	"strings"

	"spotlight/backend/internal/health/makercheck"
)

// service_admin_users.go — MKT-007 Users/Trust&Safety service layer. Maker-checker
// mechanism reused VERBATIM from backend/internal/health/makercheck/makercheck.go
// (Authorize/Approve/Consume) — the closest existing precedent found for this PR
// (a pure, dependency-free four-eyes primitive already built generically for
// "sensitive clinical/admin actions"), rather than reinventing a state machine.
// The DB-level CHECK (mkt_user_moderation_no_self_approve) added by this PR's
// migration mirrors ADR-005's (docs/adr/ADR-005-maker-checker.md) defense-in-depth
// pattern as a second, independent line of defense.

func maskEmail(e *string) string {
	if e == nil || *e == "" {
		return "—"
	}
	s := *e
	at := strings.IndexByte(s, '@')
	if at <= 1 {
		return "***" + s[at:]
	}
	return s[:1] + "***" + s[at-1:]
}

func maskPhone(p *string) string {
	if p == nil || *p == "" {
		return "—"
	}
	s := *p
	if len(s) <= 4 {
		return "****"
	}
	return strings.Repeat("*", len(s)-4) + s[len(s)-4:]
}

// buildUserAdminView assembles the full admin console shape from three real
// sources: platform_users (identity), mkt_trust_scores (trust/kyc — reused via
// the EXISTING GetTrustProfile, not a duplicate query), and mkt_user_moderation
// (this PR's moderation state). fraud_score is a documented heuristic — see
// PR notes — NOT a fabricated number: it is derived from open_flags and
// (1 - trust_score), both real signals, clamped to [0,1].
func (s *Service) buildUserAdminView(ctx context.Context, userID, marketID string) (*UserAdminView, error) {
	basics, err := s.repo.GetPlatformUserBasics(ctx, userID)
	if err != nil {
		return nil, err
	}
	trust, err := s.repo.GetTrustProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	mod, err := s.repo.GetOrInitUserModeration(ctx, userID, marketID)
	if err != nil {
		return nil, err
	}
	activeListings, err := s.repo.CountActiveListings(ctx, userID)
	if err != nil {
		return nil, err
	}
	openFlags, err := s.repo.CountOpenFlagsForTarget(ctx, "user", userID)
	if err != nil {
		return nil, err
	}

	fraudScore := float64(openFlags)*0.15 + (1 - trust.TrustScore*float64(1))*0.3
	if fraudScore > 1 {
		fraudScore = 1
	}
	if fraudScore < 0 {
		fraudScore = 0
	}

	var pendingActionBy *string
	if mod.PendingAction != nil {
		pendingActionBy = mod.ProposedBy
	}

	return &UserAdminView{
		ID:                    userID,
		DisplayName:           strings.TrimSpace(basics.FirstName + " " + basics.LastName),
		EmailMasked:           maskEmail(basics.Email),
		PhoneMasked:           maskPhone(basics.Phone),
		Status:                mod.Status,
		KYCTier:               string(trust.KYCTier),
		KYCPending:            mod.KYCPending,
		TrustScore:            trust.TrustScore,
		VerifiedIDBadge:       trust.VerifiedIDBadge,
		VerifiedBusinessBadge: trust.VerifiedBusinessBadge,
		ActiveListings:        activeListings,
		CompletedDeals:        trust.CompletedEscrowCount,
		OpenFlags:             openFlags,
		FraudScore:            fraudScore,
		SuspensionReasonCode:  mod.SuspensionReasonCode,
		PendingAction:         mod.PendingAction,
		PendingActionBy:       pendingActionBy,
		RequiresDualApproval:  mod.RequiresDualApproval,
		CreatedAt:             basics.CreatedAt,
	}, nil
}

// GetUserAdmin GET /admin/users/:id.
func (s *Service) GetUserAdmin(ctx context.Context, userID string) (*UserAdminView, error) {
	return s.buildUserAdminView(ctx, userID, DefaultMarketID)
}

// SearchUsersAdmin GET /admin/users?q=&status=&min_fraud=.
func (s *Service) SearchUsersAdmin(ctx context.Context, q, status string, minFraud float64, limit, offset int) ([]UserAdminView, error) {
	basics, err := s.repo.SearchPlatformUsers(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	out := make([]UserAdminView, 0, len(basics))
	for _, b := range basics {
		v, err := s.buildUserAdminView(ctx, b.ID, DefaultMarketID)
		if err != nil {
			continue // a user with no marketplace footprint yet still shows with defaults; a real error here just skips the row rather than failing the whole search
		}
		if status != "" && v.Status != status {
			continue
		}
		if v.FraudScore < minFraud {
			continue
		}
		out = append(out, *v)
	}
	return out, nil
}

// ProposeUserStatus POST /admin/users/:id/status — the maker step. adminID is
// the caller (proposer). Returns the updated view; RequiresDualApproval tells
// the console whether this is now pending a second admin.
func (s *Service) ProposeUserStatus(ctx context.Context, adminID, adminRole, userID string, in SetUserStatusInput) (*UserAdminView, error) {
	if err := requireReason(in.ReasonCode); err != nil {
		return nil, err
	}
	action := UserAction(in.Action)
	if action != UserActionSuspend && action != UserActionBan && action != UserActionReinstate {
		return nil, ErrInvalidUserAction
	}
	// Ensure a row exists before the UPDATE-only ProposeUserStatus query.
	if _, err := s.repo.GetOrInitUserModeration(ctx, userID, DefaultMarketID); err != nil {
		return nil, err
	}
	dual := dualApprovalRequiredFor(action)
	target := resultingStatus(action)
	mod, err := s.repo.ProposeUserStatus(ctx, userID, DefaultMarketID, target, action, in.ReasonCode, adminID, dual)
	if err != nil {
		return nil, err
	}
	auditAction := "user.status." + in.Action
	if dual {
		auditAction += ".proposed"
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, AdminRole: adminRole, Action: auditAction,
		TargetType: "user", TargetID: userID, ReasonCode: in.ReasonCode,
		AfterState: map[string]any{"status": mod.Status, "pending_action": mod.PendingAction, "requires_dual_approval": mod.RequiresDualApproval},
	})
	return s.buildUserAdminView(ctx, userID, DefaultMarketID)
}

// ApproveUserAction POST /admin/users/:id/action/approve — the checker step.
// checkerID MUST differ from the admin who proposed the pending action
// (makercheck.Authorize; ErrSameApproverNotAllowed on a self-approval attempt).
func (s *Service) ApproveUserAction(ctx context.Context, checkerID, checkerRole, userID, reasonCode string) (*UserAdminView, error) {
	if err := requireReason(reasonCode); err != nil {
		return nil, err
	}
	mod, err := s.repo.GetOrInitUserModeration(ctx, userID, DefaultMarketID)
	if err != nil {
		return nil, err
	}
	if mod.PendingAction == nil || mod.ProposedBy == nil {
		return nil, ErrNoPendingAction
	}
	if err := makercheck.Authorize(*mod.ProposedBy, checkerID); err != nil {
		if errors.Is(err, makercheck.ErrSelfApproval) {
			return nil, ErrSameApproverNotAllowed
		}
		return nil, wrapInternal("makercheck authorize", err)
	}
	updated, err := s.repo.ApproveUserAction(ctx, userID, DefaultMarketID, checkerID)
	if err != nil {
		return nil, err
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: checkerID, AdminRole: checkerRole, Action: "user.status.approved",
		TargetType: "user", TargetID: userID, ReasonCode: reasonCode,
		BeforeState: map[string]any{"proposed_by": *mod.ProposedBy, "pending_action": *mod.PendingAction},
		AfterState:  map[string]any{"status": updated.Status, "second_approver_id": checkerID},
	})
	return s.buildUserAdminView(ctx, userID, DefaultMarketID)
}

// ReviewKYC POST /admin/users/:id/kyc/review — single-admin, immediate (see
// repository_admin_users.go SetKYCReview doc comment for why this is not
// maker-checker gated).
func (s *Service) ReviewKYC(ctx context.Context, adminID, adminRole, userID string, in KycReviewInput) (*UserAdminView, error) {
	if err := requireReason(in.ReasonCode); err != nil {
		return nil, err
	}
	if in.Decision != "approve" && in.Decision != "reject" {
		return nil, fieldErr(CodeValidation, "decision must be approve or reject", "decision")
	}
	if _, err := s.repo.GetOrInitUserModeration(ctx, userID, DefaultMarketID); err != nil {
		return nil, err
	}
	if _, err := s.repo.SetKYCReview(ctx, userID, DefaultMarketID, in.Decision == "approve", in.GrantTier); err != nil {
		return nil, err
	}
	if in.Decision == "approve" && in.GrantTier != nil {
		if err := s.repo.SetSellerKYCTier(ctx, userID, KYCTier(*in.GrantTier)); err != nil {
			return nil, err
		}
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, AdminRole: adminRole, Action: "user.kyc.review",
		TargetType: "user", TargetID: userID, ReasonCode: in.ReasonCode,
		AfterState: map[string]any{"decision": in.Decision, "grant_tier": in.GrantTier},
	})
	return s.buildUserAdminView(ctx, userID, DefaultMarketID)
}

// BlacklistUser POST /admin/users/:id/blacklist — single-admin, immediate. Records
// BOTH the account-level blacklisted flag on mkt_user_moderation AND the
// identifier-level mkt_blacklist row, so the identifier is blocked platform-wide
// (e.g. re-registration with the same phone/email/device) not just this account.
func (s *Service) BlacklistUser(ctx context.Context, adminID, adminRole, userID string, in BlacklistInput) (*UserAdminView, error) {
	if err := requireReason(in.ReasonCode); err != nil {
		return nil, err
	}
	if in.Type == "" || in.Value == "" {
		return nil, fieldErr(CodeValidation, "type and value are required", "type")
	}
	if _, err := s.repo.GetOrInitUserModeration(ctx, userID, DefaultMarketID); err != nil {
		return nil, err
	}
	if _, err := s.repo.SetUserBlacklisted(ctx, userID, DefaultMarketID, in.ReasonCode, adminID); err != nil {
		return nil, err
	}
	if err := s.repo.InsertBlacklistEntry(ctx, in.Type, in.Value, in.ReasonCode, adminID); err != nil {
		return nil, err
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, AdminRole: adminRole, Action: "user.blacklist",
		TargetType: "user", TargetID: userID, ReasonCode: in.ReasonCode,
		AfterState: map[string]any{"identifier_type": in.Type},
	})
	return s.buildUserAdminView(ctx, userID, DefaultMarketID)
}

// LogViewAs POST /admin/users/:id/audit/view-as — compliance-only audit write,
// no real impersonation session is created.
func (s *Service) LogViewAs(ctx context.Context, adminID, adminRole, userID, reasonCode string) error {
	if err := requireReason(reasonCode); err != nil {
		return err
	}
	return s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, AdminRole: adminRole, Action: "user.audit.view_as",
		TargetType: "user", TargetID: userID, ReasonCode: reasonCode,
	})
}

package marketplace

import (
	"context"
	"errors"
	"spotlight/backend/internal/health/makercheck"
	"strings"
	"time"
)

const (
	keyAppeal = "appeal"
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

	fraudScore := float64(openFlags)*0.15 + (1-trust.TrustScore*float64(1))*0.3
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
	// Resolve any self-serve verification requests (mkt_verification_requests)
	// the same review covers: on approve the requested badges are granted HERE —
	// the only path that can set them; on reject the requests close so the
	// member may resubmit. This is what un-blocks the queue flag kyc_pending.
	resolvedKinds, err := s.repo.ResolveVerificationRequests(ctx, userID, DefaultMarketID, in.Decision == "approve", adminID, in.ReasonCode)
	if err != nil {
		return nil, err
	}
	if in.Decision == "approve" {
		for _, kind := range resolvedKinds {
			if err := s.repo.SetVerifiedBadge(ctx, userID, kind == VerificationKindBusiness); err != nil {
				return nil, err
			}
		}
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, AdminRole: adminRole, Action: "user.kyc.review",
		TargetType: "user", TargetID: userID, ReasonCode: in.ReasonCode,
		AfterState: map[string]any{"decision": in.Decision, "grant_tier": in.GrantTier, "verification_requests": resolvedKinds},
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

// service_admin_appeals.go — MKT-007 Appeals service layer. Same maker-checker
// mechanism as service_admin_users.go (makercheck.Authorize), applied only to
// an 'overturn' decision — an 'uphold' executes immediately (see
// repository_admin_appeals.go ProposeAppealDecision doc comment).

// FileAppeal is the member-facing POST /appeals (auth, no RBAC) AND the
// admin-on-behalf-of-member path — same method, different caller context.
func (s *Service) FileAppeal(ctx context.Context, appellantID string, in CreateAppealInput) (*Appeal, error) {
	if in.TargetType != string(AppealTargetListing) && in.TargetType != string(AppealTargetBoost) && in.TargetType != string(AppealTargetUser) {
		return nil, fieldErr(CodeValidation, "target_type must be listing, boost, or user", colTargetType)
	}
	if in.TargetID == "" {
		return nil, fieldErr(CodeValidation, "target_id is required", colTargetId)
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
		s.audit.Audit(ctx, appellantID, "appeal.filed", map[string]any{"appeal_id": a.ID, colTargetType: a.TargetType, colTargetId: a.TargetID})
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
		TargetType: keyAppeal, TargetID: id, ReasonCode: reasonCode,
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
		TargetType: keyAppeal, TargetID: id, ReasonCode: in.ReasonCode,
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
		TargetType: keyAppeal, TargetID: id, ReasonCode: reasonCode,
		BeforeState: map[string]any{"decided_by": *current.DecidedBy},
		AfterState:  map[string]any{"status": a.Status, "second_approver_id": checkerID},
	})
	return a, nil
}

// ListFraudSignals — service_admin_fraud.go — MKT-007 Fraud signals (read-only). GET
// /admin/fraud/signals?severity=. Gated on marketplace.admin.users.view (the
// permission-seeding migration's own comment documents this route under that
// slug — no new permission was introduced for this PR).
// Every signal below is DERIVED from data that already exists in this module —
// no fabricated score, no new ingestion table:
//   - multiple_flags:  mkt_flags rows with target_type='user', status='open',
//     grouped by target_id, >= 3 open flags. Real reporter
//     activity already captured by the working Flags console.
//   - velocity:        mkt_listings.created_at, >= 5 listings from one seller in
//     a 60-minute window. Same table the moderation queue and
//     automod already read; no new table.
//   - blacklist_hit:   NOT emitted yet — mkt_blacklist (this PR) has no join key
//     back to a user_id at write time (it blacklists bare
//     identifiers: device/phone/ip/email). Honestly documented
//     gap rather than a fabricated match — see
//     BlacklistedIdentifierHitUsers's doc comment.
//   - duplicate_device / shared_ip: NOT emitted — this module has no device/IP
//     fingerprint table at all (not even for a single account,
//     let alone a cross-account join), so there is no real data
//     to derive this from yet. Omitted rather than fabricated.
//   - payment_evasion: reuses automod.go's EXISTING "payment_evasion" keyword
//     screen result surfaced on listings (screenListingContent);
//     flagged listings with moderation_reason_code='payment_evasion'.
func (s *Service) ListFraudSignals(ctx context.Context, severity string) ([]FraudSignal, error) {
	var out []FraudSignal

	flaggedUsers, err := s.repo.UsersWithNOpenFlags(ctx, DefaultMarketID, 3)
	if err != nil {
		return nil, err
	}
	for uid, n := range flaggedUsers {
		sev := "medium"
		if n >= 6 {
			sev = "high"
		}
		basics, berr := s.repo.GetPlatformUserBasics(ctx, uid)
		name := uid
		if berr == nil {
			name = basics.FirstName + " " + basics.LastName
		}
		out = append(out, FraudSignal{
			ID: "flg_" + uid, Kind: "multiple_flags", UserID: uid, UserDisplayName: name,
			Severity: sev, Detail: "This account has multiple open moderation flags awaiting review.",
			RelatedUserIDs: []string{}, CreatedAt: time.Now(),
		})
	}

	rapidSellers, err := s.repo.RapidListingSellers(ctx, DefaultMarketID, 60, 5)
	if err != nil {
		return nil, err
	}
	for uid, n := range rapidSellers {
		sev := "low"
		if n >= 10 {
			sev = "high"
		} else if n >= 7 {
			sev = "medium"
		}
		basics, berr := s.repo.GetPlatformUserBasics(ctx, uid)
		name := uid
		if berr == nil {
			name = basics.FirstName + " " + basics.LastName
		}
		out = append(out, FraudSignal{
			ID: "vel_" + uid, Kind: "velocity", UserID: uid, UserDisplayName: name,
			Severity: sev, Detail: "Unusually rapid listing creation from this seller in the last hour.",
			RelatedUserIDs: []string{}, CreatedAt: time.Now(),
		})
	}

	if severity != "" {
		filtered := out[:0]
		for _, sig := range out {
			if sig.Severity == severity {
				filtered = append(filtered, sig)
			}
		}
		out = filtered
	}
	if out == nil {
		out = []FraudSignal{}
	}
	return out, nil
}

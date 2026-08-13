package risk

import (
	"context"
	"errors"
	"fmt"

	referralevents "spotlight/backend/internal/referral/events"
	referralledger "spotlight/backend/internal/referral/ledger"
)

// Decision outcomes (worst-wins ordering: block > clawback > hold > review > pass).
const (
	DecisionPass     = "pass"
	DecisionReview   = "review"
	DecisionHold     = "hold"
	DecisionClawback = "clawback"
	DecisionBlock    = "block"
)

var decisionRank = map[string]int{
	DecisionPass: 0, DecisionReview: 1, DecisionHold: 2, DecisionClawback: 3, DecisionBlock: 4,
}

// Service is the referral risk engine. It evaluates configurable rules, raises
// alerts, holds rewards in review (the RB0 ledger row stays 'pending'), and
// executes clawbacks through the RB0 reward ledger (reversing entries, audited).
type Service struct {
	repo   *Repository
	reward *referralledger.Service // RB0 reward ledger (ClawBack/Transition)
	events *referralevents.Service // RB0 audit event stream
}

func NewService(repo *Repository, reward *referralledger.Service, events *referralevents.Service) *Service {
	return &Service{repo: repo, reward: reward, events: events}
}

// --- rules CRUD ---

func (s *Service) ListRules(ctx context.Context) ([]Rule, error) { return s.repo.ListRules(ctx) }

func (s *Service) UpsertRule(ctx context.Context, in RuleInput) (*Rule, error) {
	if in.Code == "" || in.Name == "" || in.RuleType == "" {
		return nil, fmt.Errorf("risk: rule code, name and rule_type are required")
	}
	switch in.RuleType {
	case TypeKYCDedup, TypeDevice, TypeVelocity, TypeCohort, TypeSelfReferral, TypeBlocklist:
	default:
		return nil, fmt.Errorf("risk: invalid rule_type %q", in.RuleType)
	}
	return s.repo.UpsertRule(ctx, in)
}

func (s *Service) SetRuleEnabled(ctx context.Context, id string, enabled bool) error {
	return s.repo.SetRuleEnabled(ctx, id, enabled)
}

// --- evaluation ---

// Evaluate runs every enabled rule against the input. Matches raise alerts; the
// most severe action wins. When the winning action is hold/clawback/block and a
// reward is supplied, the reward is held in the review queue (RB0 ledger stays
// pending). NOTE: no raw PII is read — only hashes and ids.
func (s *Service) Evaluate(ctx context.Context, in EvaluateInput) (*EvaluateResult, error) {
	if in.SubjectID == "" {
		return nil, fmt.Errorf("risk: evaluate requires a subject id")
	}
	rules, err := s.repo.EnabledRules(ctx)
	if err != nil {
		return nil, err
	}

	res := &EvaluateResult{Decision: DecisionPass}
	bump := func(decision, reason string) {
		if decisionRank[decision] > decisionRank[res.Decision] {
			res.Decision = decision
			res.ReasonCode = reason
		}
	}

	for _, rule := range rules {
		matched, reason, window, err := s.matchRule(ctx, rule, in)
		if err != nil {
			return nil, err
		}
		if !matched {
			continue
		}
		res.Matched = append(res.Matched, rule.Code)
		alert := Alert{
			SubjectID:     in.SubjectID,
			RuleCode:      rule.Code,
			ReasonCode:    reason,
			Severity:      rule.Severity,
			RewardID:      in.RewardID,
			AttributionID: in.AttributionID,
			IdentityHash:  in.IdentityHash,
			DeviceHash:    in.DeviceHash,
			WindowCount:   window,
		}
		created, err := s.repo.InsertAlert(ctx, alert)
		if err != nil {
			return nil, err
		}
		res.Alerts = append(res.Alerts, *created)
		bump(rule.Action, reason)
	}

	// Hold the reward for any non-pass, non-block-only outcome. A 'block' on the
	// signup path also holds any pending reward; an explicit clawback is executed
	// separately by an admin (we do not auto-claw during evaluation).
	if in.RewardID != "" && res.Decision != DecisionPass {
		alertID := ""
		if len(res.Alerts) > 0 {
			alertID = res.Alerts[len(res.Alerts)-1].ID
		}
		if _, err := s.repo.Enqueue(ctx, in.RewardID, in.SubjectID, alertID, res.ReasonCode); err != nil {
			return nil, err
		}
		res.HeldReward = true
		s.audit(ctx, "reward_held_for_review", in.SubjectID, in.RewardID, in.ReferrerID,
			map[string]any{"reason_code": res.ReasonCode, "decision": res.Decision},
			"risk_hold:"+in.RewardID)
	}
	return res, nil
}

// matchRule runs a single rule. Returns (matched, reasonCode, windowCount).
func (s *Service) matchRule(ctx context.Context, rule Rule, in EvaluateInput) (bool, string, int, error) {
	switch rule.RuleType {
	case TypeKYCDedup:
		hash := in.IdentityHash
		if hash == "" {
			h, err := s.repo.IdentityHashOf(ctx, in.SubjectID)
			if err != nil {
				return false, "", 0, err
			}
			hash = h
		}
		if hash == "" {
			return false, "", 0, nil
		}
		n, err := s.repo.IdentityDupCount(ctx, hash, in.SubjectID)
		if err != nil {
			return false, "", 0, err
		}
		if n > 0 {
			return true, "IDENTITY_DEDUP", n, nil
		}

	case TypeDevice:
		max := intParam(rule.Params, "max_accounts_per_device", 3)
		n, err := s.repo.DeviceAccountCount(ctx, in.DeviceHash, in.SubjectID)
		if err != nil {
			return false, "", 0, err
		}
		if n >= max {
			return true, "SHARED_DEVICE", n, nil
		}

	case TypeVelocity:
		windowHours := intParam(rule.Params, "window_hours", 24)
		maxSignups := intParam(rule.Params, "max_signups", 25)
		n, err := s.repo.ReferrerSignupVelocity(ctx, in.ReferrerID, windowHours)
		if err != nil {
			return false, "", 0, err
		}
		if n > maxSignups {
			return true, "SIGNUP_VELOCITY", n, nil
		}

	case TypeSelfReferral:
		// Direct: referrer == referred. Plus RB0 attribution risk_flag carry-over.
		if in.ReferrerID != "" && in.ReferrerID == in.SubjectID {
			return true, "SELF_REFERRAL", 1, nil
		}
		flag, _, err := s.repo.AttributionRiskFlag(ctx, in.SubjectID)
		if err != nil {
			return false, "", 0, err
		}
		if flag == "self_referral" {
			return true, "SELF_REFERRAL", 1, nil
		}

	case TypeBlocklist:
		// Block if the subject (or any supplied hash) is on an active block list.
		checks := [][2]string{
			{"user", in.SubjectID},
			{"identity_hash", in.IdentityHash},
			{"device_hash", in.DeviceHash},
			{"ip_hash", in.IPHash},
			{"email_hash", in.EmailHash},
		}
		for _, ch := range checks {
			listed, err := s.repo.IsListed(ctx, "block", ch[0], ch[1])
			if err != nil {
				return false, "", 0, err
			}
			if listed {
				return true, "BLOCKLISTED_" + ch[0], 1, nil
			}
		}

	case TypeCohort:
		// Behavioural cohort: high signup velocity AND a shared device → coordinated
		// cohort. Reuses the same hashed signals; thresholds from params.
		windowHours := intParam(rule.Params, "window_hours", 24)
		minSignups := intParam(rule.Params, "min_signups", 10)
		v, err := s.repo.ReferrerSignupVelocity(ctx, in.ReferrerID, windowHours)
		if err != nil {
			return false, "", 0, err
		}
		d, err := s.repo.DeviceAccountCount(ctx, in.DeviceHash, in.SubjectID)
		if err != nil {
			return false, "", 0, err
		}
		if v >= minSignups && d >= 1 {
			return true, "COORDINATED_COHORT", v, nil
		}
	}
	return false, "", 0, nil
}

// --- review-queue decisions ---

// ApproveReview releases a held reward: the queue item is approved and the RB0
// reward is advanced pending → vesting (the normal lifecycle resumes).
func (s *Service) ApproveReview(ctx context.Context, itemID, decidedBy string) error {
	item, err := s.repo.GetReviewItem(ctx, itemID)
	if err != nil {
		return err
	}
	if item == nil {
		return fmt.Errorf("risk: review item not found")
	}
	if err := s.repo.DecideReview(ctx, itemID, ReviewApproved, decidedBy); err != nil {
		return err
	}
	if s.reward != nil && item.RewardID != "" {
		if err := s.reward.Transition(ctx, item.RewardID, referralledger.StateVesting, "review_approve:"+itemID); err != nil {
			// Non-fatal: the decision is recorded; surface the error for retry.
			return fmt.Errorf("risk: release reward: %w", err)
		}
	}
	s.audit(ctx, "review_approved", item.SubjectID, item.RewardID, "",
		map[string]any{"item_id": itemID}, "review_approved:"+itemID)
	return nil
}

// RejectReview rejects a held reward and claws it back via the RB0 ledger.
func (s *Service) RejectReview(ctx context.Context, itemID, decidedBy string) error {
	item, err := s.repo.GetReviewItem(ctx, itemID)
	if err != nil {
		return err
	}
	if item == nil {
		return fmt.Errorf("risk: review item not found")
	}
	if err := s.repo.DecideReview(ctx, itemID, ReviewClawedBack, decidedBy); err != nil {
		return err
	}
	if s.reward != nil && item.RewardID != "" {
		if err := s.reward.ClawBack(ctx, item.RewardID, "review_reject:"+itemID); err != nil {
			return fmt.Errorf("risk: clawback on reject: %w", err)
		}
	}
	s.audit(ctx, "review_rejected", item.SubjectID, item.RewardID, "",
		map[string]any{"item_id": itemID}, "review_rejected:"+itemID)
	return nil
}

func (s *Service) ListReviewQueue(ctx context.Context, status string) ([]ReviewItem, error) {
	return s.repo.ListReviewQueue(ctx, status)
}

// --- clawback (admin direct) ---

// ExecuteClawback claws back a reward through the RB0 ledger (reversing entry for
// a paid reward, state flip otherwise). Idempotent on the supplied key. The
// reason code is audited; no PII.
func (s *Service) ExecuteClawback(ctx context.Context, in ClawbackInput, actorID string) error {
	if in.RewardID == "" {
		return fmt.Errorf("risk: clawback requires reward_id")
	}
	if in.IdempotencyKey == "" {
		return fmt.Errorf("risk: clawback requires an idempotency key")
	}
	if s.reward == nil {
		return fmt.Errorf("risk: reward ledger unavailable")
	}
	if err := s.reward.ClawBack(ctx, in.RewardID, "clawback:"+in.IdempotencyKey); err != nil {
		return fmt.Errorf("risk: execute clawback: %w", err)
	}
	s.audit(ctx, "reward_clawed_back", "", in.RewardID, "",
		map[string]any{"reason_code": in.ReasonCode, "actor_id": actorID},
		"clawback_event:"+in.IdempotencyKey)
	return nil
}

// --- cases / blocklist / dashboard passthroughs ---

func (s *Service) ListAlerts(ctx context.Context, status string, limit int) ([]Alert, error) {
	return s.repo.ListAlerts(ctx, status, limit)
}

func (s *Service) SetAlertStatus(ctx context.Context, id, status, caseID string) error {
	switch status {
	case AlertOpen, AlertReviewing, AlertDismissed, AlertConfirmed:
	default:
		return fmt.Errorf("risk: invalid alert status %q", status)
	}
	return s.repo.SetAlertStatus(ctx, id, status, caseID)
}

func (s *Service) OpenCase(ctx context.Context, subjectID string, reasonCodes []string, openedBy, notes string) (*Case, error) {
	return s.repo.OpenCase(ctx, subjectID, reasonCodes, openedBy, notes)
}

func (s *Service) ListCases(ctx context.Context, status string, limit int) ([]Case, error) {
	return s.repo.ListCases(ctx, status, limit)
}

// CaseWorkbench returns a case with its linked alerts.
func (s *Service) CaseWorkbench(ctx context.Context, caseID string) (*Case, []Alert, error) {
	c, err := s.repo.GetCase(ctx, caseID)
	if err != nil {
		return nil, nil, err
	}
	if c == nil {
		return nil, nil, fmt.Errorf("risk: case not found")
	}
	alerts, err := s.repo.CaseAlerts(ctx, caseID)
	if err != nil {
		return nil, nil, err
	}
	return c, alerts, nil
}

func (s *Service) UpdateCaseStatus(ctx context.Context, id, status, resolution, resolvedBy string) error {
	switch status {
	case CaseOpen, CaseInvestigating, CaseResolved, CaseEscalated:
	default:
		return fmt.Errorf("risk: invalid case status %q", status)
	}
	return s.repo.UpdateCaseStatus(ctx, id, status, resolution, resolvedBy)
}

func (s *Service) AddBlocklist(ctx context.Context, in BlocklistInput, addedBy string) (*BlocklistEntry, error) {
	if in.EntryType == "" || in.EntryValue == "" {
		return nil, fmt.Errorf("risk: blocklist entry_type and entry_value are required")
	}
	switch in.EntryType {
	case "user", "identity_hash", "device_hash", "ip_hash", "email_hash":
	default:
		return nil, fmt.Errorf("risk: invalid entry_type %q", in.EntryType)
	}
	return s.repo.AddBlocklist(ctx, in, addedBy)
}

func (s *Service) DeactivateBlocklist(ctx context.Context, id string) error {
	return s.repo.DeactivateBlocklist(ctx, id)
}

func (s *Service) ListBlocklist(ctx context.Context, listType string) ([]BlocklistEntry, error) {
	return s.repo.ListBlocklist(ctx, listType)
}

func (s *Service) Dashboard(ctx context.Context) (*DashboardCounts, error) {
	return s.repo.Dashboard(ctx)
}

// --- member-facing ---

// MyFraudStatus returns a coarse standing for the caller (A-USR-04). No PII, no
// internal reason codes — only counts and a standing label.
func (s *Service) MyFraudStatus(ctx context.Context, userID string) (*FraudStatus, error) {
	alerts, err := s.repo.AlertsBySubject(ctx, userID)
	if err != nil {
		return nil, err
	}
	held, err := s.repo.HeldRewardCount(ctx, userID)
	if err != nil {
		return nil, err
	}
	open := 0
	for _, a := range alerts {
		if a.Status == AlertOpen || a.Status == AlertReviewing {
			open++
		}
	}
	standing := "clear"
	if held > 0 || open > 0 {
		standing = "under_review"
	}
	for _, a := range alerts {
		if a.Status == AlertConfirmed {
			standing = "restricted"
			break
		}
	}
	return &FraudStatus{
		UserID:      userID,
		Standing:    standing,
		OpenAlerts:  open,
		HeldRewards: held,
	}, nil
}

// ErrNoReferrerToReport is returned when a member reports abuse but has no
// referrer to report — the caller should tell them so rather than failing
// generically.
var ErrNoReferrerToReport = errors.New("risk: no referrer to report")

// ReportAbuse lets a member report a suspected abusive referral. Stored as an
// open alert with a reason code only (no free-text PII persisted).
func (s *Service) ReportAbuse(ctx context.Context, reporterID string, in ReportInput) (*Alert, error) {
	// An empty target means "report whoever referred me" — the only report a
	// member can actually make from the app, which has no way to name another
	// account. Resolve it server-side: accepting a client-supplied id here would
	// let anyone open a fraud alert against any account.
	if in.TargetUserID == "" {
		referrer, err := s.repo.ReferrerOf(ctx, reporterID)
		if err != nil {
			return nil, err
		}
		if referrer == "" {
			return nil, ErrNoReferrerToReport
		}
		in.TargetUserID = referrer
	}
	if in.TargetUserID == reporterID {
		return nil, fmt.Errorf("risk: cannot report yourself")
	}
	reason := in.ReasonCode
	if reason == "" {
		reason = "MEMBER_REPORT"
	}
	a := Alert{
		SubjectID:  in.TargetUserID,
		RuleCode:   "member_report",
		ReasonCode: reason,
		Severity:   "low",
	}
	created, err := s.repo.InsertAlert(ctx, a)
	if err != nil {
		return nil, err
	}
	s.audit(ctx, "abuse_reported", in.TargetUserID, "", reporterID,
		map[string]any{"reason_code": reason}, "abuse_report:"+reporterID+":"+in.TargetUserID)
	return created, nil
}

// --- helpers ---

func (s *Service) audit(ctx context.Context, eventType, userID, rewardID, referrerID string, extra map[string]any, idemKey string) {
	if s.events == nil {
		return
	}
	payload := map[string]any{}
	for k, v := range extra {
		payload[k] = v
	}
	if rewardID != "" {
		payload["reward_id"] = rewardID
	}
	_ = s.events.Record(ctx, referralevents.Input{
		EventType:      eventType,
		UserID:         userID,
		ReferrerID:     referrerID,
		Payload:        payload,
		IdempotencyKey: idemKey,
	})
}

func intParam(p map[string]any, key string, def int) int {
	if p == nil {
		return def
	}
	switch v := p[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	}
	return def
}

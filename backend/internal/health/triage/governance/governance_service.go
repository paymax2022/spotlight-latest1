package governance

import (
	"context"
	"errors"
	"fmt"

	"spotlight/backend/internal/health/triage"
)

// ErrIllegalTransition guards the content/rule lifecycle SM (SC-6).
var ErrIllegalTransition = errors.New("triage.gov: illegal content/rule transition")

// ErrSignOffRequired is returned when a publish is attempted without a reviewer
// (licensed-clinician) — SC-6 forbids publishing un-signed-off clinical content.
var ErrSignOffRequired = errors.New("triage.gov: licensed-clinician sign-off required to publish")

// ErrConflict is a lost-race / state-moved-underneath guard outcome.
var ErrConflict = errors.New("triage.gov: state changed concurrently")

// Store is the data layer the service depends on (satisfied by *Repository).
// Decoupled as an interface so the service is unit-testable with fakes (no DB).
type Store interface {
	// content
	CreateContent(ctx context.Context, ci *ContentItem) (*ContentItem, error)
	GetContent(ctx context.Context, id string) (*ContentItem, error)
	UpdateContentBody(ctx context.Context, id, body string, ragTags []string) (bool, error)
	TransitionContent(ctx context.Context, id string, from, to triage.ContentState, reviewerID string, setPublished bool) (bool, error)
	BumpContentVersion(ctx context.Context, base *ContentItem, body string, ragTags []string) (*ContentItem, error)
	ListContent(ctx context.Context, state, kind, language string) ([]ContentItem, error)
	// rules
	CreateRule(ctx context.Context, rr *RedFlagRule) (*RedFlagRule, error)
	GetRule(ctx context.Context, id string) (*RedFlagRule, error)
	UpdateRuleBody(ctx context.Context, id, name string, cond RuleCondition, urgency int, severity string) (bool, error)
	TransitionRule(ctx context.Context, id string, from, to triage.ContentState, reviewerID string, setPublished bool) (bool, error)
	BumpRuleVersion(ctx context.Context, base *RedFlagRule, name string, cond RuleCondition, urgency int, severity string) (*RedFlagRule, error)
	ListRules(ctx context.Context, state string) ([]RedFlagRule, error)
	ListPublishedRules(ctx context.Context) ([]RedFlagRule, error)
	// language packs
	UpsertLanguagePack(ctx context.Context, lp *LanguagePack) (*LanguagePack, error)
	ListLanguagePacks(ctx context.Context) ([]LanguagePack, error)
	// audit
	audit(ctx context.Context, actor, action, resourceType, resourceID string, newValues map[string]any, severity string) error
}

// GovernanceService owns the clinician-governed lifecycle of clinical content +
// red-flag rules. Every transition is guarded by triage.CanContent (the shared SM),
// the publish step requires a licensed-clinician reviewer (SC-6 sign-off), edits to
// published items bump the version (immutable versioning, SC-12), and every action
// writes an audit row to module 'health.triage.gov'.
type GovernanceService struct{ repo Store }

// NewGovernanceService builds the governance service.
func NewGovernanceService(repo Store) *GovernanceService { return &GovernanceService{repo: repo} }

// ─────────────────────────────── Content lifecycle ───────────────────────────

var validContentKinds = map[string]bool{
	"condition": true, "first_aid": true, "disclaimer": true, "self_care": true, "question": true,
}

// CreateContentDraft creates a new DRAFT clinical content item (SC-10: curated,
// never LLM-generated — this is an authoring action, not generation).
func (s *GovernanceService) CreateContentDraft(ctx context.Context, actorID string, in ContentItem) (*ContentItem, error) {
	if in.Code == "" || in.Body == "" {
		return nil, fmt.Errorf("triage.gov: code and body required")
	}
	if !validContentKinds[in.Kind] {
		return nil, fmt.Errorf("triage.gov: invalid content kind %q", in.Kind)
	}
	if in.Language == "" {
		in.Language = "en"
	}
	ci, err := s.repo.CreateContent(ctx, &in)
	if err != nil {
		return nil, err
	}
	_ = s.repo.audit(ctx, actorID, "health.triage.content.draft_created", "health_triage_content_item", ci.ID,
		map[string]any{"code": ci.Code, "kind": ci.Kind, "language": ci.Language, "version": ci.Version}, "info")
	return ci, nil
}

// EditContent edits a content item. A DRAFT is edited in place. An edit to a
// PUBLISHED item creates a NEW DRAFT at version+1 (never mutates live signed-off
// content) — versioned, auditable.
func (s *GovernanceService) EditContent(ctx context.Context, actorID, id, body string, ragTags []string) (*ContentItem, error) {
	cur, err := s.repo.GetContent(ctx, id)
	if err != nil {
		return nil, err
	}
	switch cur.State {
	case triage.ContentDraft:
		ok, err := s.repo.UpdateContentBody(ctx, id, body, ragTags)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrConflict
		}
		_ = s.repo.audit(ctx, actorID, "health.triage.content.edited", "health_triage_content_item", id,
			map[string]any{"version": cur.Version}, "info")
		return s.repo.GetContent(ctx, id)
	case triage.ContentPublished, triage.ContentApproved, triage.ContentReview:
		// Branch a new draft at version+1 — live content is immutable.
		next, err := s.repo.BumpContentVersion(ctx, cur, body, ragTags)
		if err != nil {
			return nil, err
		}
		_ = s.repo.audit(ctx, actorID, "health.triage.content.version_bumped", "health_triage_content_item", next.ID,
			map[string]any{"code": cur.Code, "from_version": cur.Version, "to_version": next.Version}, "info")
		return next, nil
	default:
		return nil, fmt.Errorf("%w: cannot edit %s content", ErrIllegalTransition, cur.State)
	}
}

// SubmitContentForReview moves draft→clinical_review.
func (s *GovernanceService) SubmitContentForReview(ctx context.Context, actorID, id string) (*ContentItem, error) {
	return s.transitionContent(ctx, actorID, id, triage.ContentReview, "")
}

// ApproveContent moves clinical_review→approved. The approver is the reviewing
// clinician; recorded for the sign-off trail.
func (s *GovernanceService) ApproveContent(ctx context.Context, reviewerID, id string) (*ContentItem, error) {
	return s.transitionContent(ctx, reviewerID, id, triage.ContentApproved, reviewerID)
}

// KickBackContent moves clinical_review→draft (reviewer requests changes).
func (s *GovernanceService) KickBackContent(ctx context.Context, reviewerID, id string) (*ContentItem, error) {
	return s.transitionContent(ctx, reviewerID, id, triage.ContentDraft, "")
}

// PublishContent moves approved→published, requiring a licensed-clinician sign-off
// (reviewerID). SC-6: clinical content cannot go live without sign-off. Sets
// published_at + reviewer_id.
func (s *GovernanceService) PublishContent(ctx context.Context, reviewerID, id string) (*ContentItem, error) {
	if reviewerID == "" {
		return nil, ErrSignOffRequired
	}
	return s.transitionContent(ctx, reviewerID, id, triage.ContentPublished, reviewerID)
}

// DeprecateContent moves published→deprecated.
func (s *GovernanceService) DeprecateContent(ctx context.Context, actorID, id string) (*ContentItem, error) {
	return s.transitionContent(ctx, actorID, id, triage.ContentDeprecated, "")
}

func (s *GovernanceService) transitionContent(ctx context.Context, actorID, id string, to triage.ContentState, reviewerID string) (*ContentItem, error) {
	cur, err := s.repo.GetContent(ctx, id)
	if err != nil {
		return nil, err
	}
	if cur.State == to {
		return cur, nil // idempotent
	}
	if !triage.CanContent(cur.State, to) {
		return nil, fmt.Errorf("%w: %s→%s", ErrIllegalTransition, cur.State, to)
	}
	setPublished := to == triage.ContentPublished
	if setPublished && reviewerID == "" {
		return nil, ErrSignOffRequired
	}
	ok, err := s.repo.TransitionContent(ctx, id, cur.State, to, reviewerID, setPublished)
	if err != nil {
		return nil, err
	}
	if !ok {
		// Lost the guarded race; reload + treat matching target as idempotent success.
		if reloaded, gerr := s.repo.GetContent(ctx, id); gerr == nil && reloaded.State == to {
			return reloaded, nil
		}
		return nil, ErrConflict
	}
	sev := "info"
	if setPublished {
		sev = "warning" // a live clinical-content change is a notable governance event
	}
	_ = s.repo.audit(ctx, actorID, "health.triage.content."+string(to), "health_triage_content_item", id,
		map[string]any{"from": string(cur.State), "to": string(to), "reviewer_id": reviewerID, "version": cur.Version}, sev)
	return s.repo.GetContent(ctx, id)
}

// ListContent lists content items.
func (s *GovernanceService) ListContent(ctx context.Context, state, kind, language string) ([]ContentItem, error) {
	return s.repo.ListContent(ctx, state, kind, language)
}

// ─────────────────────────────── Rule lifecycle ──────────────────────────────

// CreateRuleDraft creates a new DRAFT red-flag rule. SC-2: urgency_level must be a
// valid (1..5) disposition level — the rule can only force a MORE-urgent level at
// evaluation time (enforced in DBRedFlagEngine + triage.ApplyRedFlag).
func (s *GovernanceService) CreateRuleDraft(ctx context.Context, actorID string, in RedFlagRule) (*RedFlagRule, error) {
	if in.Code == "" || in.Name == "" {
		return nil, fmt.Errorf("triage.gov: code and name required")
	}
	if in.UrgencyLevel < triage.LevelEmergencyAmbulance || in.UrgencyLevel > triage.LevelSelfCare {
		return nil, fmt.Errorf("triage.gov: urgency_level must be 1..5")
	}
	if in.Severity == "" {
		in.Severity = "emergency"
	}
	rr, err := s.repo.CreateRule(ctx, &in)
	if err != nil {
		return nil, err
	}
	_ = s.repo.audit(ctx, actorID, "health.triage.rule.draft_created", "health_triage_red_flag_rule", rr.ID,
		map[string]any{"code": rr.Code, "urgency_level": rr.UrgencyLevel, "version": rr.Version}, "info")
	return rr, nil
}

// EditRule edits a rule. A DRAFT is edited in place; an edit to a non-draft branches
// a new DRAFT at version+1 (live signed-off rules are immutable).
func (s *GovernanceService) EditRule(ctx context.Context, actorID, id, name string, cond RuleCondition, urgency int, severity string) (*RedFlagRule, error) {
	if urgency < triage.LevelEmergencyAmbulance || urgency > triage.LevelSelfCare {
		return nil, fmt.Errorf("triage.gov: urgency_level must be 1..5")
	}
	if severity == "" {
		severity = "emergency"
	}
	cur, err := s.repo.GetRule(ctx, id)
	if err != nil {
		return nil, err
	}
	if cur.State == triage.ContentDraft {
		ok, err := s.repo.UpdateRuleBody(ctx, id, name, cond, urgency, severity)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrConflict
		}
		_ = s.repo.audit(ctx, actorID, "health.triage.rule.edited", "health_triage_red_flag_rule", id,
			map[string]any{"version": cur.Version}, "info")
		return s.repo.GetRule(ctx, id)
	}
	next, err := s.repo.BumpRuleVersion(ctx, cur, name, cond, urgency, severity)
	if err != nil {
		return nil, err
	}
	_ = s.repo.audit(ctx, actorID, "health.triage.rule.version_bumped", "health_triage_red_flag_rule", next.ID,
		map[string]any{"code": cur.Code, "from_version": cur.Version, "to_version": next.Version}, "info")
	return next, nil
}

// SubmitRuleForReview moves draft→clinical_review.
func (s *GovernanceService) SubmitRuleForReview(ctx context.Context, actorID, id string) (*RedFlagRule, error) {
	return s.transitionRule(ctx, actorID, id, triage.ContentReview, "")
}

// ApproveRule moves clinical_review→approved.
func (s *GovernanceService) ApproveRule(ctx context.Context, reviewerID, id string) (*RedFlagRule, error) {
	return s.transitionRule(ctx, reviewerID, id, triage.ContentApproved, reviewerID)
}

// KickBackRule moves clinical_review→draft.
func (s *GovernanceService) KickBackRule(ctx context.Context, reviewerID, id string) (*RedFlagRule, error) {
	return s.transitionRule(ctx, reviewerID, id, triage.ContentDraft, "")
}

// PublishRule moves approved→published, requiring licensed-clinician sign-off
// (SC-6). Only after this does the rule become live in DBRedFlagEngine.
func (s *GovernanceService) PublishRule(ctx context.Context, reviewerID, id string) (*RedFlagRule, error) {
	if reviewerID == "" {
		return nil, ErrSignOffRequired
	}
	return s.transitionRule(ctx, reviewerID, id, triage.ContentPublished, reviewerID)
}

// DeprecateRule moves published→deprecated (removes the rule from the live set).
func (s *GovernanceService) DeprecateRule(ctx context.Context, actorID, id string) (*RedFlagRule, error) {
	return s.transitionRule(ctx, actorID, id, triage.ContentDeprecated, "")
}

func (s *GovernanceService) transitionRule(ctx context.Context, actorID, id string, to triage.ContentState, reviewerID string) (*RedFlagRule, error) {
	cur, err := s.repo.GetRule(ctx, id)
	if err != nil {
		return nil, err
	}
	if cur.State == to {
		return cur, nil
	}
	if !triage.CanContent(cur.State, to) {
		return nil, fmt.Errorf("%w: %s→%s", ErrIllegalTransition, cur.State, to)
	}
	setPublished := to == triage.ContentPublished
	if setPublished && reviewerID == "" {
		return nil, ErrSignOffRequired
	}
	ok, err := s.repo.TransitionRule(ctx, id, cur.State, to, reviewerID, setPublished)
	if err != nil {
		return nil, err
	}
	if !ok {
		if reloaded, gerr := s.repo.GetRule(ctx, id); gerr == nil && reloaded.State == to {
			return reloaded, nil
		}
		return nil, ErrConflict
	}
	sev := "info"
	if setPublished {
		sev = "warning"
	}
	_ = s.repo.audit(ctx, actorID, "health.triage.rule."+string(to), "health_triage_red_flag_rule", id,
		map[string]any{"from": string(cur.State), "to": string(to), "reviewer_id": reviewerID, "version": cur.Version}, sev)
	return s.repo.GetRule(ctx, id)
}

// ListRules lists rules filtered by state.
func (s *GovernanceService) ListRules(ctx context.Context, state string) ([]RedFlagRule, error) {
	return s.repo.ListRules(ctx, state)
}

// ─────────────────────────────── Language packs ──────────────────────────────

// SeedLanguagePacks seeds the Phase-1 packs: English + Nigerian Pidgin ('pcm').
// Idempotent (upsert by code).
func (s *GovernanceService) SeedLanguagePacks(ctx context.Context) error {
	for _, lp := range []LanguagePack{
		{Code: "en", Name: "English", Status: "active"},
		{Code: "pcm", Name: "Nigerian Pidgin", Status: "active"},
	} {
		if _, err := s.repo.UpsertLanguagePack(ctx, &lp); err != nil {
			return err
		}
	}
	return nil
}

// UpsertLanguagePack creates/updates a language pack.
func (s *GovernanceService) UpsertLanguagePack(ctx context.Context, actorID string, lp LanguagePack) (*LanguagePack, error) {
	if lp.Code == "" || lp.Name == "" {
		return nil, fmt.Errorf("triage.gov: language code and name required")
	}
	out, err := s.repo.UpsertLanguagePack(ctx, &lp)
	if err != nil {
		return nil, err
	}
	_ = s.repo.audit(ctx, actorID, "health.triage.language_pack.upserted", "health_triage_language_pack", out.ID,
		map[string]any{"code": out.Code, "status": out.Status}, "info")
	return out, nil
}

// ListLanguagePacks lists configured packs.
func (s *GovernanceService) ListLanguagePacks(ctx context.Context) ([]LanguagePack, error) {
	return s.repo.ListLanguagePacks(ctx)
}

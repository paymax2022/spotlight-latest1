package connectmentor

import (
	"context"
	"errors"
)

var (
	ErrNotFound       = errors.New("connect: mentorship record not found")
	ErrInvalidInput   = errors.New("connect: invalid mentorship input")
	ErrSelfMatch      = errors.New("connect: cannot mentor yourself")
	ErrNotMentor      = errors.New("connect: only the mentor may accept/decline this request")
	ErrNotParticipant = errors.New("connect: only a participant may transition this match")
	ErrBadTransition  = errors.New("connect: invalid mentorship state transition")
)

// Auditor mirrors the per-package Connect audit hook; nil-safe at call sites.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// LoyaltyAwarder is the ONE Paymax Black emit seam (PN-8). The composition root
// injects an adapter that wraps loyalty.AwardFor with a points.EarnContext of
// {Module:"connect", Reference: ref}. This package therefore depends only on this
// tiny interface — never on the points/loyalty packages directly — keeping it
// self-contained. There is NO second currency: the currency stays the points/
// loyalty ledger; connect_networking_loyalty_log is only an emit AUDIT (ADM-GM-01).
type LoyaltyAwarder interface {
	AwardFor(ctx context.Context, userID, module, trigger, ref string) error
}

// Service owns the mentorship opt-in, safe discovery, guarded FSM, and the dual
// loyalty emit on completion.
type Service struct {
	repo    *Repository
	loyalty LoyaltyAwarder
	audit   Auditor
}

func NewService(repo *Repository, loyalty LoyaltyAwarder, audit Auditor) *Service {
	return &Service{repo: repo, loyalty: loyalty, audit: audit}
}

// OptIn upserts the caller's mentorship profile (MN-01). Self-opt-in, no approval
// gate (PN-9).
func (s *Service) OptIn(ctx context.Context, userID string, in OptInInput) (*MentorshipProfile, error) {
	if !isRole(in.Role) {
		return nil, ErrInvalidInput
	}
	p, err := s.repo.UpsertProfile(ctx, userID, in.Role, in.Domains, in.Capacity)
	if err != nil {
		return nil, err
	}
	s.writeAudit(ctx, "connect.mentorship.optin", userID, "connect_mentorship_profile", p.ID,
		map[string]any{"role": p.Role, "domains": p.Domains})
	return p, nil
}

// Discover returns the PN-7 SAFE projection of opt-in mentors (MN-02).
func (s *Service) Discover(ctx context.Context, viewerID, domain string, limit int) ([]SafeMentorProfile, error) {
	return s.repo.DiscoverMentors(ctx, viewerID, domain, limit)
}

// RequestMatch creates a pending match from mentee → mentor (MN-03). Idempotent on
// the (mentor,mentee) pair.
func (s *Service) RequestMatch(ctx context.Context, menteeID string, in MatchRequestInput) (*MentorshipMatch, error) {
	if in.MentorID == "" {
		return nil, ErrInvalidInput
	}
	if in.MentorID == menteeID {
		return nil, ErrSelfMatch
	}
	m, err := s.repo.InsertMatch(ctx, in.MentorID, menteeID)
	if err != nil {
		return nil, err
	}
	s.writeAudit(ctx, "connect.mentorship.request", menteeID, "connect_mentorship_match", m.ID,
		map[string]any{"mentorId": in.MentorID, "state": m.State})
	return m, nil
}

// RespondMatch lets the mentor accept/decline a REQUESTED match (MN-03). Object-level
// authz: only the mentor may respond.
func (s *Service) RespondMatch(ctx context.Context, actorID, matchID string, accept bool) (*MentorshipMatch, error) {
	m, err := s.repo.GetMatch(ctx, matchID)
	if err != nil {
		return nil, err
	}
	if m.MentorID != actorID {
		return nil, ErrNotMentor
	}
	to := StateDeclined
	if accept {
		to = StateAccepted
	}
	applied, updated, err := s.repo.TransitionMatch(ctx, matchID, StateRequested, to)
	if err != nil {
		return nil, err
	}
	if !applied {
		return nil, ErrBadTransition
	}
	s.writeAudit(ctx, "connect.mentorship.respond", actorID, "connect_mentorship_match", matchID,
		map[string]any{"state": string(to)})
	return updated, nil
}

// Transition applies an active/paused/completed/ended_early transition (MN-06 for
// COMPLETED). Either participant may drive it. On COMPLETED it emits the dual
// Paymax Black loyalty event (both parties, distinct references — exactly once) and
// returns the mutual-testimonial hint the FE routes into RC-01.
func (s *Service) Transition(ctx context.Context, actorID, matchID string, to MatchState) (*TransitionResult, error) {
	m, err := s.repo.GetMatch(ctx, matchID)
	if err != nil {
		return nil, err
	}
	if m.MentorID != actorID && m.MenteeID != actorID {
		return nil, ErrNotParticipant
	}
	from := MatchState(m.State)
	if !validTransition(from, to) {
		return nil, ErrBadTransition
	}
	applied, updated, err := s.repo.TransitionMatch(ctx, matchID, from, to)
	if err != nil {
		return nil, err
	}
	if !applied {
		// A concurrent transition won the race; not our state change → do NOT emit.
		return nil, ErrBadTransition
	}
	s.writeAudit(ctx, "connect.mentorship.transition", actorID, "connect_mentorship_match", matchID,
		map[string]any{"from": string(from), "to": string(to)})

	res := &TransitionResult{Match: updated}
	if to == StateCompleted {
		// The guarded write above is the idempotency gate: this branch runs exactly
		// once per completed match, so each party is awarded exactly once. Distinct
		// references + points-ledger idempotency + the loyalty-log UNIQUE(reference)
		// are the defence-in-depth backstops against a retried call.
		s.emitCompletion(ctx, updated)
		res.TestimonialHint = &TestimonialHint{
			Flow: RecommendationFlow, // RC-01
			Prompts: []TestimonialPrompt{
				{AuthorID: updated.MentorID, SubjectID: updated.MenteeID},
				{AuthorID: updated.MenteeID, SubjectID: updated.MentorID},
			},
		}
	}
	return res, nil
}

// emitCompletion issues the dual Paymax Black emit for a completed match and records
// each emit in the append-only loyalty AUDIT log (ADM-GM-01). A loyalty failure must
// never unwind the (already-committed) completion — errors are audited, not raised.
func (s *Service) emitCompletion(ctx context.Context, m *MentorshipMatch) {
	mentorRef, menteeRef := completionRefs(m.ID)
	s.awardAndLog(ctx, m.MentorID, mentorRef, m.ID)
	s.awardAndLog(ctx, m.MenteeID, menteeRef, m.ID)
}

func (s *Service) awardAndLog(ctx context.Context, userID, ref, matchID string) {
	if s.loyalty != nil {
		if err := s.loyalty.AwardFor(ctx, userID, LoyaltyModule, TriggerMentorshipDone, ref); err != nil {
			s.writeAudit(ctx, "connect.mentorship.loyalty.error", userID, "connect_mentorship_match", matchID,
				map[string]any{"ref": ref, "err": err.Error()})
			return
		}
	}
	// Record the emit for ADM-GM-01 trace (idempotent on reference). repo is nil only
	// in unit tests that exercise the emit seam without a DB.
	if s.repo == nil {
		return
	}
	if err := s.repo.AppendLoyaltyLog(ctx, userID, TriggerMentorshipDone, ref, matchID); err != nil {
		s.writeAudit(ctx, "connect.mentorship.loyalty.log_error", userID, "connect_mentorship_match", matchID,
			map[string]any{"ref": ref, "err": err.Error()})
	}
}

// ListMyMatches returns the caller's mentorship matches.
func (s *Service) ListMyMatches(ctx context.Context, userID string) ([]MentorshipMatch, error) {
	return s.repo.ListMatchesForUser(ctx, userID)
}

// --- Admin ---

// MentorshipReports lists matches for moderation oversight (ADM-MN-01). Optional
// state filter; empty = all.
func (s *Service) MentorshipReports(ctx context.Context, state string, limit int) ([]MentorshipMatch, error) {
	return s.repo.ListMatchesByState(ctx, state, limit)
}

// LoyaltyAudit traces the Phase-6 Paymax Black emissions for a user (ADM-GM-01).
func (s *Service) LoyaltyAudit(ctx context.Context, userID string, limit int) ([]LoyaltyLogEntry, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.LoyaltyLogForUser(ctx, userID, limit)
}

func (s *Service) writeAudit(ctx context.Context, action, actorID, entityType, entityID string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	_ = s.audit.WriteAudit(ctx, action, actorID, entityType, entityID, meta)
}

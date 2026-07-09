package feescompetition

import (
	"context"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// leaderboard.go — the cross-school leaderboard EXTENSION (build-spec §2
// LeaderboardEntry: "Extends Academy's existing leaderboard table with
// school/scope columns, does not replace it").
//
// HOW WE EXTEND WITHOUT EDITING gamification (REUSE-MAP.md §1, §5.3):
//   - The physical rows live in the SAME academy_leaderboards /
//     academy_leaderboard_entries tables owned by academy/gamification. We do not
//     add a table and we do not modify the gamification package.
//   - gamification stores (leaderboard_id, user_id, period_key, score). The
//     school + scope + subject dimension the EdTech competition needs is carried
//     alongside via the FeesLeaderboardStore below, which resolves a
//     (scope, scopeRef, subject) tuple to a gamification leaderboard id (the
//     leaderboard row's scope already widened to include 'city','state' by
//     migration 20260918000000) and enriches ranked rows with student/school
//     identity so the SF-7 serializer can act on them.
//   - The scope value written to academy_leaderboards.scope is exactly one of the
//     five ValidScope() values — all permitted by the widened CHECK constraint.
//
// MONEY-FREE: nothing here credits a wallet or references a ledger account. A
// score is engagement, not value. Competition rewards go through academy/rewards.

// GamificationLadder is the NARROW slice of the shared academy/gamification
// service this package consumes. It is satisfied in production by
// *gamification.Service (verified methods RecordLeaderboardScore / GetLeaderboard
// / AdminUpsertLeaderboard) and by an in-memory fake in tests. Depending on this
// interface — not the concrete type — is how we reuse gamification through its
// public surface without importing internals or editing it.
type GamificationLadder interface {
	// EnsureLeaderboard resolves (or creates, via the gamification admin path) the
	// leaderboard id for a (scope, scopeRef, subject) tuple and returns its id.
	EnsureLeaderboard(ctx context.Context, scope, scopeRef, subject string) (leaderboardID string, err error)
	// RecordScore writes/accumulates a score for a user on a ladder+period. Mirrors
	// gamification.Service.RecordLeaderboardScore.
	RecordScore(ctx context.Context, leaderboardID, userID, periodKey string, score int64) error
	// RankedUserScores returns (userID, periodKey, score, rank) rows for a ladder,
	// score-descending. Mirrors gamification.Service.GetLeaderboard's entries.
	RankedUserScores(ctx context.Context, leaderboardID, periodKey string, limit int) ([]LadderRow, error)
}

// LadderRow is the raw gamification ranked row (identity-free: gamification knows
// only user_id + score). The EdTech layer enriches it with student/school PII via
// the IdentityResolver before serialization.
type LadderRow struct {
	UserID    string
	PeriodKey string
	Score     int64
	Rank      int
}

// IdentityResolver maps a gamification user_id back to the EdTech student/school
// identity fields required to build a LeaderboardEntry (and, downstream, to apply
// SF-7). Satisfied by the competition repository in production (reads
// academy_students / academy_schools) and by a fake in tests. It carries the
// minor_flag that drives SF-7.
type IdentityResolver interface {
	ResolveStudent(ctx context.Context, studentUserID string) (StudentIdentity, error)
}

// StudentIdentity is the identity enrichment for one leaderboard row.
type StudentIdentity struct {
	StudentID  string
	FirstName  string
	LastName   string
	PhotoURL   string
	MinorFlag  bool
	SchoolID   string
	SchoolName string
}

// LeaderboardManager is the cross-school leaderboard read/write facade. It owns
// the scope dimension and the scoring-lock guard; it delegates the actual row
// storage to the shared gamification ladder and identity enrichment to the
// resolver. It NEVER edits gamification — it only calls its public interface.
type LeaderboardManager struct {
	ladder   GamificationLadder
	identity IdentityResolver
}

// NewLeaderboardManager wires the manager over the shared gamification ladder and
// an identity resolver.
func NewLeaderboardManager(ladder GamificationLadder, identity IdentityResolver) *LeaderboardManager {
	return &LeaderboardManager{ladder: ladder, identity: identity}
}

// ErrScopeInvalid is returned when a caller supplies a scope outside the widened
// set (class/school/city/state/national).
var ErrScopeInvalid = feesErr("scope_invalid")

// WriteEntry records a single cross-school leaderboard entry for a competition.
//
// SCORING LOCK (build-spec §3.4 / SF): no LeaderboardEntry may be created or
// edited once the competition is results_pending or later. The instant the
// competition enters results_pending, feesstatemachine.ScoringLocked(status)
// returns true and this write path fails-closed with ErrScoringLocked. The check
// uses the SAME shared boundary the state machine encodes, so the lock can never
// drift from the transition definition.
func (m *LeaderboardManager) WriteEntry(
	ctx context.Context,
	competitionStatus feesstatemachine.CompetitionState,
	scope Scope,
	scopeRef, periodKey string,
	req RecordScoreRequest,
) error {
	// SF scoring-lock guard — fail-closed at results_pending and beyond.
	if feesstatemachine.ScoringLocked(competitionStatus) {
		return ErrScoringLocked
	}
	if !ValidScope(scope) {
		return ErrScopeInvalid
	}
	subject := ""
	if req.Subject != nil {
		subject = *req.Subject
	}
	lbID, err := m.ladder.EnsureLeaderboard(ctx, string(scope), scopeRef, subject)
	if err != nil {
		return err
	}
	// Delegate the physical write to the shared gamification ladder (same
	// academy_leaderboard_entries table) — the score is keyed by the student's
	// gamification user_id.
	return m.ladder.RecordScore(ctx, lbID, req.StudentUserID, periodKey, req.Score)
}

// ReadEntries reads a ranked cross-school leaderboard for a (scope, scopeRef,
// subject, period) selection and enriches each gamification row with student /
// school identity so the caller can serialize it (SF-7). The returned entries are
// RAW (full identity) — callers MUST pass them through Serializer before exposing
// them publicly.
func (m *LeaderboardManager) ReadEntries(
	ctx context.Context,
	scope Scope,
	scopeRef, subject, periodKey string,
	limit int,
) ([]LeaderboardEntry, error) {
	if !ValidScope(scope) {
		return nil, ErrScopeInvalid
	}
	lbID, err := m.ladder.EnsureLeaderboard(ctx, string(scope), scopeRef, subject)
	if err != nil {
		return nil, err
	}
	rows, err := m.ladder.RankedUserScores(ctx, lbID, periodKey, limit)
	if err != nil {
		return nil, err
	}
	out := make([]LeaderboardEntry, 0, len(rows))
	var subj *string
	if subject != "" {
		subj = &subject
	}
	for _, row := range rows {
		id, err := m.identity.ResolveStudent(ctx, row.UserID)
		if err != nil {
			return nil, err
		}
		out = append(out, LeaderboardEntry{
			StudentID:     id.StudentID,
			StudentUserID: row.UserID,
			FirstName:     id.FirstName,
			LastName:      id.LastName,
			PhotoURL:      id.PhotoURL,
			MinorFlag:     id.MinorFlag,
			SchoolID:      id.SchoolID,
			SchoolName:    id.SchoolName,
			Scope:         scope,
			Subject:       subj,
			LeaderboardID: lbID,
			PeriodKey:     row.PeriodKey,
			Score:         row.Score,
			Rank:          row.Rank,
		})
	}
	return out, nil
}

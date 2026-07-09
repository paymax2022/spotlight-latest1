// Package feescompetition is the EdTech School-Fees cross-school Competition +
// leaderboard-scope-extension + minor-safe serializer sub-package (build-spec
// §2 Competition/LeaderboardEntry, §3.4 Competition state machine, §4 SF-7).
//
// BROWNFIELD EXTENSION — this package REUSES, it does not replace:
//   - Competition lifecycle is driven ENTIRELY by the shared, pure state machine
//     in academy/fees/statemachine (feesstatemachine.CompetitionTransition +
//     ScoringLocked). No transition logic is re-implemented here.
//   - The cross-school leaderboard is layered on top of the EXISTING
//     academy_leaderboards / academy_leaderboard_entries tables owned by the
//     academy/gamification package (see leaderboard.go). We do NOT create a new
//     leaderboard table and we do NOT edit the gamification package — it is a
//     shared primitive consumed through a narrow interface.
//   - The quiz/scoring engine is academy/assessment + academy/exam (drives the
//     scores that land as leaderboard entries). Not re-implemented here.
//
// GOLDEN RULE (money-free): gamification/leaderboards move NO money. Competition
// rewards, if any, route exclusively through the sibling academy/rewards service
// (rewards.IssueReward) — a reward is NEVER represented as a leaderboard entry or
// a score. Nothing in this package touches the wallet ledger.
//
// SF-7 (RELEASE BLOCKER): the public leaderboard serializer DEFAULT-STRIPS PII
// for any student with minor_flag=true — first name + school only — and only
// widens to full identity/photo when an explicit, recorded guardian consent
// exists (academy_consent_records via academy/identity). See serializer.go.
package feescompetition

import (
	"time"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// ── Competition (mirrors public.academy_competitions, §2/§3.4) ──────────────────

// Competition is a cross-school contest. status is the string form of a
// feesstatemachine.CompetitionState; all mutations go through the state machine.
type Competition struct {
	ID                     string                            `json:"id"`
	Name                   string                            `json:"name"`
	Scope                  string                            `json:"scope"` // class|school|city|state|national
	Subject                *string                           `json:"subject,omitempty"`
	ParticipatingSchoolIDs []string                          `json:"participating_school_ids"`
	Sponsor                *string                           `json:"sponsor,omitempty"`
	StartDate              *time.Time                        `json:"start_date,omitempty"`
	EndDate                *time.Time                        `json:"end_date,omitempty"`
	Status                 feesstatemachine.CompetitionState `json:"status"`
	CreatedAt              time.Time                         `json:"created_at"`
}

// CompetitionRegistration mirrors public.academy_competition_registrations.
// UNIQUE(competition_id, school_id) — one registration per school per contest.
type CompetitionRegistration struct {
	ID            string    `json:"id"`
	CompetitionID string    `json:"competition_id"`
	SchoolID      string    `json:"school_id"`
	RegisteredAt  time.Time `json:"registered_at"`
}

// ── Leaderboard scope (§2 LeaderboardEntry: class/school/city/state/national) ────

// Scope is the geographic/organisational rollup dimension for a cross-school
// leaderboard. These MUST match the widened academy_leaderboards.scope CHECK
// (migration 20260918000000: class,school,national,friends + city,state). The
// EdTech competition surface uses the five below; 'friends' remains a pure
// gamification concept and is intentionally not exposed here.
type Scope string

const (
	ScopeClass    Scope = "class"
	ScopeSchool   Scope = "school"
	ScopeCity     Scope = "city"
	ScopeState    Scope = "state"
	ScopeNational Scope = "national"
)

// validScopes is the set accepted by the EdTech competition leaderboard.
var validScopes = map[Scope]bool{
	ScopeClass:    true,
	ScopeSchool:   true,
	ScopeCity:     true,
	ScopeState:    true,
	ScopeNational: true,
}

// ValidScope reports whether s is an accepted cross-school leaderboard scope.
func ValidScope(s Scope) bool { return validScopes[s] }

// LeaderboardEntry is the EdTech competition view of a ranked row. It is a
// RICHER projection over the shared academy_leaderboard_entries table: the
// gamification row carries (leaderboard_id, user_id, period_key, score) and the
// competition dimension (student, school, scope, subject) is carried alongside so
// the serializer can apply SF-7. student_user_id is the gamification user_id.
//
// This struct is the RAW, un-serialized entry — it holds full identity fields.
// It must NEVER be returned directly on a public endpoint; run it through
// Serializer.SerializeEntry (serializer.go) first so SF-7 stripping applies.
type LeaderboardEntry struct {
	// Identity of the student behind the row.
	StudentID     string `json:"student_id"`
	StudentUserID string `json:"student_user_id"` // == gamification user_id
	FirstName     string `json:"first_name"`
	LastName      string `json:"last_name"`
	PhotoURL      string `json:"photo_url"`
	MinorFlag     bool   `json:"minor_flag"`

	// School + competition dimension.
	SchoolID   string  `json:"school_id"`
	SchoolName string  `json:"school_name"`
	Scope      Scope   `json:"scope"`
	Subject    *string `json:"subject,omitempty"`

	// Underlying gamification ladder coordinates + score.
	LeaderboardID string `json:"leaderboard_id"`
	PeriodKey     string `json:"period_key"`
	Score         int64  `json:"score"`
	Rank          int    `json:"rank,omitempty"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// CreateCompetitionRequest is the body for POST /competitions.
type CreateCompetitionRequest struct {
	Name                   string     `json:"name" binding:"required"`
	Scope                  string     `json:"scope" binding:"required"`
	Subject                *string    `json:"subject,omitempty"`
	ParticipatingSchoolIDs []string   `json:"participating_school_ids,omitempty"`
	Sponsor                *string    `json:"sponsor,omitempty"`
	StartDate              *time.Time `json:"start_date,omitempty"`
	EndDate                *time.Time `json:"end_date,omitempty"`
}

// TransitionCompetitionRequest is the body for POST /competitions/:id/transition.
// event is a feesstatemachine competition event (open_registration,
// close_registration, start, pend_results, complete, archive).
type TransitionCompetitionRequest struct {
	Event string `json:"event" binding:"required"`
}

// RegisterSchoolRequest is the body for POST /competitions/:id/register.
type RegisterSchoolRequest struct {
	SchoolID string `json:"school_id" binding:"required"`
}

// RecordScoreRequest is the body for POST /competitions/:id/scores — a single
// leaderboard entry write. Rejected once the competition is results_pending or
// later (ScoringLocked). Carries no money field by design.
type RecordScoreRequest struct {
	StudentID     string  `json:"student_id" binding:"required"`
	StudentUserID string  `json:"student_user_id" binding:"required"`
	SchoolID      string  `json:"school_id" binding:"required"`
	Scope         string  `json:"scope" binding:"required"`
	Subject       *string `json:"subject,omitempty"`
	PeriodKey     string  `json:"period_key" binding:"required"`
	Score         int64   `json:"score"`
}

// Package connectmentor implements Paymax Connect Phase 6G/6H: professional
// mentorship matching + Paymax Black loyalty wiring.
//
// Design invariants mirrored from the Phase-6 PRD (§4/§6.6/§8):
//   - PN-7 (mode-privacy): mentorship discovery is an explicit opt-in capability
//     and its projection exposes ONLY mentorship + professional fields. It never
//     joins or returns any Dating-mode profile column. The "safe projection" is
//     the SafeMentorProfile struct + safeMentorProjectionColumns list below, both
//     asserted in mentorship_test.go.
//   - PN-8 (one loyalty currency): completion emits into the existing Paymax Black
//     ledger via the injected LoyaltyAwarder (loyalty.AwardFor). There is NO second
//     points table here — connect_networking_loyalty_log is an append-only AUDIT
//     record of emits (ADM-GM-01), not a balance.
//   - PN-9 (self-opt-in): becoming a mentor/mentee is a self-service capability with
//     no approval gate.
//
// The MentorshipMatch state machine is a guarded, deny-by-default FSM (§4).
package connectmentor

import "time"

// MatchState enumerates the mentorship-match lifecycle (§4).
type MatchState string

const (
	StateRequested   MatchState = "requested"
	StateAccepted    MatchState = "accepted"
	StateDeclined    MatchState = "declined"
	StateActive      MatchState = "active"
	StatePaused      MatchState = "paused"
	StateCompleted   MatchState = "completed"
	StateEndedEarly  MatchState = "ended_early"
)

// MentorRole is the opt-in capability role (MN-01).
type MentorRole string

const (
	RoleMentor MentorRole = "mentor"
	RoleMentee MentorRole = "mentee"
	RoleBoth   MentorRole = "both"
)

// LoyaltyTrigger + Module are the (module, trigger) pair bound to the Paymax Black
// earn rule (§8). Kept as consts so the emit sites and the migration seed agree.
const (
	LoyaltyModule          = "connect"
	TriggerMentorshipDone  = "mentorship_complete"
	// RecommendationFlow is the FE flow the completion hint routes into (RC-01). This
	// package emits only a hint; it makes NO cross-package call into recommendations.
	RecommendationFlow = "RC-01"
)

// MentorshipProfile is the durable opt-in record (MN-01).
type MentorshipProfile struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Role      string    `json:"role"`
	Domains   []string  `json:"domains"`
	Capacity  int       `json:"capacity"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// MentorshipMatch is one guarded FSM row (§4).
type MentorshipMatch struct {
	ID        string    `json:"id"`
	MentorID  string    `json:"mentorId"`
	MenteeID  string    `json:"menteeId"`
	State     string    `json:"state"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SafeMentorProfile is the PN-7 SAFE DISCOVERY PROJECTION.
//
// It carries ONLY mentorship fields (userId, role, domains, capacity) plus the
// professional display name sourced from connect_professional_profiles. It has NO
// Dating-mode field of any kind (no photos, orientation, interested_in, location,
// bio-for-dating, etc.). The discovery query (Repository.DiscoverMentors) selects
// exactly safeMentorProjectionColumns and never references the dating tables. The
// mentorship_test.go PN-7 test reflects over this struct and asserts the denylist
// of Dating-mode fields is absent.
type SafeMentorProfile struct {
	UserID      string   `json:"userId"`
	Role        string   `json:"role"`
	Domains     []string `json:"domains"`
	Capacity    int      `json:"capacity"`
	DisplayName string   `json:"displayName"` // professional display name only
}

// safeMentorProjectionColumns is the EXACT, testable set of columns the discovery
// query is allowed to select. Every entry is a mentorship_profiles or
// professional_profiles column — never a Dating-mode/connect_profiles column.
var safeMentorProjectionColumns = []string{
	"mp.user_id",   // mentorship
	"mp.role",      // mentorship
	"mp.domains",   // mentorship
	"mp.capacity",  // mentorship
	"pp.headline",  // professional (display name), NOT dating
}

// datingModeFieldDenylist is the set of Dating-mode signal names that must NEVER
// appear in the safe projection (PN-7). Used by the projection test.
var datingModeFieldDenylist = []string{
	"orientation", "interestedIn", "interested_in", "photos", "gallery",
	"birthdate", "age", "location", "geohash", "lat", "lng", "distance",
	"datingBio", "dating_bio", "relationshipGoal", "relationship_goal", "gender",
}

// --- Request DTOs (camelCase JSON) ---

// OptInInput is the MN-01 mentor/mentee opt-in payload.
type OptInInput struct {
	Role     string   `json:"role" binding:"required"` // mentor | mentee | both
	Domains  []string `json:"domains"`
	Capacity int      `json:"capacity"`
}

// MatchRequestInput is the MN-03 match request (mentee → mentor).
type MatchRequestInput struct {
	MentorID string `json:"mentorId" binding:"required"`
}

// MatchRespondInput is the MN-03 accept/decline by the mentor.
type MatchRespondInput struct {
	Accept bool `json:"accept"`
}

// StateTransitionInput drives the active/paused/completed/ended_early transitions.
type StateTransitionInput struct {
	State string `json:"state" binding:"required"`
}

// --- Result DTOs ---

// TestimonialPrompt is one side of the mutual-testimonial hint (MN-06 → RC-01).
type TestimonialPrompt struct {
	AuthorID  string `json:"authorId"`
	SubjectID string `json:"subjectId"`
}

// TestimonialHint tells the FE to route both parties into the recommendation flow
// (RC-01) after a completed mentorship. No cross-package call is made server-side.
type TestimonialHint struct {
	Flow    string              `json:"flow"` // RecommendationFlow (RC-01)
	Prompts []TestimonialPrompt `json:"prompts"`
}

// TransitionResult wraps the updated match plus (only on COMPLETED) the testimonial
// hint the FE routes into RC-01.
type TransitionResult struct {
	Match           *MentorshipMatch `json:"match"`
	TestimonialHint *TestimonialHint `json:"testimonialHint,omitempty"`
}

// LoyaltyLogEntry is an ADM-GM-01 audit row: proof that a Phase-6 Paymax Black emit
// happened, traceable back to its mentorship source.
type LoyaltyLogEntry struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Module    string    `json:"module"`
	Trigger   string    `json:"trigger"`
	Reference string    `json:"reference"`
	MatchID   string    `json:"matchId,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// validTransition is the guarded mentorship FSM (§4), deny-by-default.
//
//	REQUESTED → ACCEPTED | DECLINED
//	ACCEPTED  → ACTIVE
//	ACTIVE   ⇄ PAUSED
//	ACTIVE/PAUSED → COMPLETED | ENDED_EARLY
//
// declined/completed/ended_early are terminal.
func validTransition(from, to MatchState) bool {
	switch from {
	case StateRequested:
		return to == StateAccepted || to == StateDeclined
	case StateAccepted:
		return to == StateActive
	case StateActive:
		return to == StatePaused || to == StateCompleted || to == StateEndedEarly
	case StatePaused:
		return to == StateActive || to == StateCompleted || to == StateEndedEarly
	default:
		return false // declined/completed/ended_early are terminal
	}
}

// isRole reports whether r is a legal opt-in role.
func isRole(r string) bool {
	switch MentorRole(r) {
	case RoleMentor, RoleMentee, RoleBoth:
		return true
	}
	return false
}

// completionRefs returns the two DISTINCT idempotency references for a completed
// match's dual loyalty emit (mentor + mentee), so each party is awarded exactly
// once (idempotent at both the points ledger and the connect_networking_loyalty_log).
func completionRefs(matchID string) (mentorRef, menteeRef string) {
	return "mentorship:" + matchID + ":complete:mentor",
		"mentorship:" + matchID + ":complete:mentee"
}

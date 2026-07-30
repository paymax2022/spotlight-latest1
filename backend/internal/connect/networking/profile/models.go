// Package connectnetprofile implements Paymax Connect Phase 6C + 6E: the full
// professional profile (experience / education / about — PR-07..PR-09), a
// PN-1-safe profile-strength meter (PR-11), and the consent-gated recommendation
// state machine (RC-01..RC-04, PN-4).
//
// PN-4 (CRITICAL): a recommendation is DRAFTED → SENT → ACCEPTED_VISIBLE |
// DECLINED_HIDDEN. It is NEVER auto-published — acceptance is an explicit subject
// action. The public read path returns ONLY state='accepted_visible'; this is
// enforced in BOTH the service query and the RLS reader policy.
//
// PN-1: profile strength is an internal completion/verification calc. The API
// surfaces only a coarse band/label — never a raw granular trust number.
package connectnetprofile

import "time"

// RecoState enumerates the recommendation lifecycle (see PN-4).
type RecoState string

const (
	RecoDrafted         RecoState = "drafted"
	RecoSent            RecoState = "sent"
	RecoAcceptedVisible RecoState = "accepted_visible"
	RecoDeclinedHidden  RecoState = "declined_hidden"
)

// validTransition guards the recommendation FSM (deny-by-default). Only these
// edges are legal; everything else — including any transition that would reveal a
// recommendation without the subject's explicit accept — is rejected.
//
//	DRAFTED → SENT
//	SENT    → ACCEPTED_VISIBLE
//	SENT    → DECLINED_HIDDEN
func validTransition(from, to RecoState) bool {
	switch from {
	case RecoDrafted:
		return to == RecoSent
	case RecoSent:
		return to == RecoAcceptedVisible || to == RecoDeclinedHidden
	default:
		// accepted_visible and declined_hidden are terminal.
		return false
	}
}

// PubliclyVisible is the PN-4 visibility predicate: a recommendation is visible to
// anyone other than its author/subject/admin ONLY when accepted_visible. Every
// public read path (query + RLS reader policy) must agree with this predicate.
func PubliclyVisible(state RecoState) bool { return state == RecoAcceptedVisible }

// ═══════════════════════════════ Domain records ══════════════════════════════

// Experience is one role in a user's timeline (PR-07).
type Experience struct {
	ID          string    `json:"id"`
	UserID      string    `json:"userId"`
	Title       string    `json:"title"`
	Company     string    `json:"company"`
	Location    string    `json:"location,omitempty"`
	StartDate   string    `json:"startDate"`
	EndDate     *string   `json:"endDate,omitempty"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Education is one schooling entry (PR-08).
type Education struct {
	ID          string    `json:"id"`
	UserID      string    `json:"userId"`
	Institution string    `json:"institution"`
	Degree      string    `json:"degree,omitempty"`
	Field       string    `json:"field,omitempty"`
	StartDate   string    `json:"startDate"`
	EndDate     *string   `json:"endDate,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

// About is the free-text professional summary (PR-09).
type About struct {
	UserID    string    `json:"userId"`
	Summary   string    `json:"summary"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Recommendation is a consent-gated endorsement (RC-01..RC-03, PN-4).
type Recommendation struct {
	ID            string    `json:"id"`
	AuthorUserID  string    `json:"authorUserId"`
	SubjectUserID string    `json:"subjectUserId"`
	Body          string    `json:"body"`
	State         string    `json:"state"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// RecommendationRequest is a subject asking a connection to write one (RC-04).
type RecommendationRequest struct {
	ID              string    `json:"id"`
	RequesterUserID string    `json:"requesterUserId"`
	TargetUserID    string    `json:"targetUserId"`
	Note            string    `json:"note,omitempty"`
	State           string    `json:"state"`
	CreatedAt       time.Time `json:"createdAt"`
}

// ═══════════════════════════════ Request DTOs ════════════════════════════════

type ExperienceInput struct {
	Title       string `json:"title" binding:"required"`
	Company     string `json:"company" binding:"required"`
	Location    string `json:"location"`
	StartDate   string `json:"startDate" binding:"required"` // YYYY-MM-DD
	EndDate     string `json:"endDate"`                      // "" = current role
	Description string `json:"description"`
}

type EducationInput struct {
	Institution string `json:"institution" binding:"required"`
	Degree      string `json:"degree"`
	Field       string `json:"field"`
	StartDate   string `json:"startDate" binding:"required"`
	EndDate     string `json:"endDate"`
}

type AboutInput struct {
	Summary string `json:"summary"`
}

type WriteRecommendationInput struct {
	SubjectUserID string `json:"subjectUserId" binding:"required"`
	Body          string `json:"body" binding:"required"`
	// Draft=true stores it as 'drafted' (author can send later); default sends it.
	Draft bool `json:"draft"`
}

type RequestRecommendationInput struct {
	TargetUserID string `json:"targetUserId" binding:"required"`
	Note         string `json:"note"`
}

// ═══════════════════════════ Profile strength (PR-11) ═════════════════════════

// StrengthSignals is the input to the pure strength calc. It is populated from
// the user's own profile data plus verification/assessment signals. Keeping it a
// plain struct makes ComputeStrength trivially unit-testable.
type StrengthSignals struct {
	HasExperience           bool
	HasEducation            bool
	HasAbout                bool
	VerifiedBadge           bool // business/professional verification (binary, PN-1)
	PassedAssessment        bool // at least one passed skill assessment (PN-5)
	AcceptedRecommendations int  // count of accepted_visible recommendations
}

// Strength weights. Verification-weighted: verified badge + passed assessment are
// worth as much as raw completion, so a fully-filled but unverified profile can
// never reach the top band on completion alone (PN-3 spirit).
const (
	wExperience   = 20
	wEducation    = 15
	wAbout        = 15
	wVerified     = 20
	wAssessment   = 15
	wPerReco      = 5
	maxRecoCredit = 15 // caps recommendation credit at 3 accepted (3 * wPerReco)
	strengthMax   = wExperience + wEducation + wAbout + wVerified + wAssessment + maxRecoCredit
)

// ComputeStrength returns the internal 0..100 completion+verification score. This
// number is NEVER returned by any public API (PN-1); callers expose only the band
// from StrengthBand.
func ComputeStrength(s StrengthSignals) int {
	score := 0
	if s.HasExperience {
		score += wExperience
	}
	if s.HasEducation {
		score += wEducation
	}
	if s.HasAbout {
		score += wAbout
	}
	if s.VerifiedBadge {
		score += wVerified
	}
	if s.PassedAssessment {
		score += wAssessment
	}
	recoCredit := s.AcceptedRecommendations * wPerReco
	if recoCredit > maxRecoCredit {
		recoCredit = maxRecoCredit
	}
	if recoCredit < 0 {
		recoCredit = 0
	}
	score += recoCredit
	if score > strengthMax {
		score = strengthMax
	}
	if score < 0 {
		score = 0
	}
	return score
}

// StrengthBand maps the internal score to a coarse, PN-1-safe label. Only this
// band (never the raw score) is exposed to clients.
func StrengthBand(score int) string {
	switch {
	case score >= 85:
		return "all_star"
	case score >= 60:
		return "strong"
	case score >= 30:
		return "intermediate"
	default:
		return "beginner"
	}
}

// StrengthView is the PN-1-safe API projection: a coarse band plus which sections
// are still missing (completion guidance is not a trust number). The raw score is
// deliberately omitted.
type StrengthView struct {
	Band    string   `json:"band"`
	Missing []string `json:"missing"`
}

// BuildStrengthView derives the client-facing view from signals without ever
// leaking the numeric score.
func BuildStrengthView(s StrengthSignals) StrengthView {
	v := StrengthView{Band: StrengthBand(ComputeStrength(s)), Missing: []string{}}
	if !s.HasExperience {
		v.Missing = append(v.Missing, "experience")
	}
	if !s.HasEducation {
		v.Missing = append(v.Missing, "education")
	}
	if !s.HasAbout {
		v.Missing = append(v.Missing, "about")
	}
	if !s.VerifiedBadge {
		v.Missing = append(v.Missing, "verification")
	}
	if !s.PassedAssessment {
		v.Missing = append(v.Missing, "skill_assessment")
	}
	if s.AcceptedRecommendations == 0 {
		v.Missing = append(v.Missing, "recommendations")
	}
	return v
}

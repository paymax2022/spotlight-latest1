package feescompetition

import "context"

// SF-7 (RELEASE BLOCKER) — minor-safe leaderboard serializer.
//
// build-spec §4 SF-7: "Public leaderboard display defaults to first-name + school
// only for any minor_flag=true student; full identity/photo requires explicit
// recorded guardian consent … API response serializer — strips PII by default,
// consent flag required to include more."
//
// The invariant is DEFAULT-STRIP, i.e. fail-CLOSED: a minor's row is reduced to
// {rank, score, first name, school} UNLESS a recorded guardian consent is found.
// Absence of a consent lookup, a lookup error, or an ambiguous result all resolve
// to STRIPPED — never to "show full identity". Consent is checked against the
// existing immutable academy_consent_records store via academy/identity (we do
// NOT build a second consent store — REUSE-MAP.md §1).

// LeaderboardConsentScope is the consent scope key that authorises publishing a
// minor's full identity/photo on a public leaderboard. It reuses the existing
// academy/identity data-sharing capability scope (identity.CapabilityDataSharing
// == "data_sharing"); a guardian who has granted data_sharing for the minor has
// authorised public display. Kept as a const so the serializer and any wiring
// agree on exactly one key.
const LeaderboardConsentScope = "data_sharing"

// ConsentChecker reports whether a recorded, active guardian consent exists for a
// minor authorising the given scope. This is satisfied in production by
// academy/identity's *Repository.HasActiveConsent(ctx, minorID, scopeKey)
// (verified signature) and by an in-memory fake in tests. Keeping it an interface
// is what lets SF-7 be tested with no live DB.
type ConsentChecker interface {
	HasActiveConsent(ctx context.Context, minorUserID, scopeKey string) (bool, error)
}

// PublicLeaderboardEntry is the SANITISED, wire-safe shape returned by the public
// leaderboard API. For a stripped (default) minor entry, only Rank/Score plus
// FirstName + SchoolName are populated; LastName and PhotoURL are empty and
// FullIdentity is false. Non-minors, and consented minors, get the full fields.
type PublicLeaderboardEntry struct {
	Rank         int    `json:"rank,omitempty"`
	Score        int64  `json:"score"`
	FirstName    string `json:"first_name"`
	SchoolName   string `json:"school_name"`
	Subject      string `json:"subject,omitempty"`
	Scope        string `json:"scope"`
	FullIdentity bool   `json:"full_identity"` // true only when unstripped
	// The following are populated ONLY when the row is not stripped (adult, or
	// minor with recorded guardian consent). Omitted from JSON when empty so a
	// stripped minor's payload carries no surname/photo field at all.
	LastName string `json:"last_name,omitempty"`
	PhotoURL string `json:"photo_url,omitempty"`
	// StudentUserID is deliberately NOT exposed here — public identifiers for a
	// minor are PII. (StudentID/UserID stay server-side.)
}

// Serializer applies the SF-7 minor-safe policy to raw leaderboard entries.
type Serializer struct {
	consent ConsentChecker
}

// NewSerializer builds a serializer bound to a consent checker. Passing a nil
// checker is safe and STRICTER: every minor entry is stripped (fail-closed),
// because with no way to verify consent we must assume none exists.
func NewSerializer(consent ConsentChecker) *Serializer {
	return &Serializer{consent: consent}
}

// SerializeEntry converts one raw entry into its public form, applying SF-7.
//
// Decision (fail-closed):
//   - non-minor (MinorFlag=false)            → full identity.
//   - minor + recorded data_sharing consent  → full identity.
//   - minor, no consent / error / nil checker → STRIPPED (first name + school).
func (s *Serializer) SerializeEntry(ctx context.Context, e LeaderboardEntry) PublicLeaderboardEntry {
	subject := ""
	if e.Subject != nil {
		subject = *e.Subject
	}
	base := PublicLeaderboardEntry{
		Rank:       e.Rank,
		Score:      e.Score,
		FirstName:  e.FirstName,
		SchoolName: e.SchoolName,
		Subject:    subject,
		Scope:      string(e.Scope),
	}

	// Adults are always shown in full.
	if !e.MinorFlag {
		return s.withFullIdentity(base, e)
	}

	// Minor: DEFAULT is stripped. Only a positive, error-free consent check for
	// the LeaderboardConsentScope unlocks full identity. Any other outcome
	// (nil checker, error, false) leaves the entry stripped — fail-closed.
	if s.consent == nil {
		return base
	}
	ok, err := s.consent.HasActiveConsent(ctx, e.StudentUserID, LeaderboardConsentScope)
	if err != nil || !ok {
		return base
	}
	return s.withFullIdentity(base, e)
}

// withFullIdentity widens a base (already-stripped) entry to include surname and
// photo and marks FullIdentity. Used for adults and consented minors only.
func (s *Serializer) withFullIdentity(base PublicLeaderboardEntry, e LeaderboardEntry) PublicLeaderboardEntry {
	base.LastName = e.LastName
	base.PhotoURL = e.PhotoURL
	base.FullIdentity = true
	return base
}

// SerializeList serializes a whole leaderboard, applying SF-7 per row. Order and
// ranks are preserved. A per-row consent failure never leaks another row's PII —
// each entry is decided independently and fail-closed.
func (s *Serializer) SerializeList(ctx context.Context, entries []LeaderboardEntry) []PublicLeaderboardEntry {
	out := make([]PublicLeaderboardEntry, 0, len(entries))
	for _, e := range entries {
		out = append(out, s.SerializeEntry(ctx, e))
	}
	return out
}

// ErrConsentRequired is returned by SerializeFullIdentity when a caller explicitly
// asks for a minor's full identity that no recorded consent authorises. This is
// the "explicit attempt to fetch full identity without consent is rejected" path
// (SF-7 DoD) — distinct from the default GET path, which silently strips.
var ErrConsentRequired = feesErr("consent_required")

// feesErr is a tiny local error type so we don't pull a dependency just for one
// sentinel; its string is a stable snake_case code.
type feesErr string

func (e feesErr) Error() string { return string(e) }

// SerializeFullIdentity is the strict variant used when a caller (e.g. a
// broadcast/export surface) EXPLICITLY requests the unredacted identity of a
// single entry. Unlike SerializeEntry it does not silently downgrade a minor to
// the stripped shape — it REJECTS with ErrConsentRequired when consent is absent,
// so an attempt to fetch full identity without consent fails loudly rather than
// appearing to succeed with empty PII fields. Adults and consented minors return
// the full entry with a nil error.
func (s *Serializer) SerializeFullIdentity(ctx context.Context, e LeaderboardEntry) (PublicLeaderboardEntry, error) {
	if !e.MinorFlag {
		return s.withFullIdentity(s.strippedBase(e), e), nil
	}
	if s.consent == nil {
		return PublicLeaderboardEntry{}, ErrConsentRequired
	}
	ok, err := s.consent.HasActiveConsent(ctx, e.StudentUserID, LeaderboardConsentScope)
	if err != nil {
		return PublicLeaderboardEntry{}, err
	}
	if !ok {
		return PublicLeaderboardEntry{}, ErrConsentRequired
	}
	return s.withFullIdentity(s.strippedBase(e), e), nil
}

// strippedBase builds the minimal (first-name + school) projection shared by both
// serialize paths.
func (s *Serializer) strippedBase(e LeaderboardEntry) PublicLeaderboardEntry {
	subject := ""
	if e.Subject != nil {
		subject = *e.Subject
	}
	return PublicLeaderboardEntry{
		Rank:       e.Rank,
		Score:      e.Score,
		FirstName:  e.FirstName,
		SchoolName: e.SchoolName,
		Subject:    subject,
		Scope:      string(e.Scope),
	}
}

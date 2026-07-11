package connectfeed

import (
	"math"
	"sort"
)

// RankSignals is the full set of ranking inputs for a single post. It is the ONLY
// input to RankScore — a pure, deterministic function — so PN-3 is unit-testable.
type RankSignals struct {
	// Raw engagement (must NEVER be the sole ranking input, PN-3).
	ReactionCount int
	CommentCount  int
	ReshareCount  int

	// Verified-outcome signals (the PN-3 primary weight).
	AuthorVerified       bool // Connect professional verification (verified badge)
	AuthorPassedAssessment bool // author has a passed, timestamped skill assessment (PN-5)
	LinksCompletedOutcome  bool // post links to a completed booking/mentorship

	// Recency (minor tiebreaker only; bounded well below one engagement unit-band).
	AgeHours float64
}

// Ranking weights. PN-3 REQUIRES verified-outcome weight >= engagement weight.
//
// The score is banded so the invariant is *structural*, not coincidental:
//
//	engagementRaw = wReaction*reactions + wComment*comments + wReshare*reshares
//	engagement    = min(engagementRaw, engagementCap)          // saturates
//	recency       = wRecency * 0.5^(ageHours / recencyHalfLife)  // in [0, wRecency]
//	verifiedTier  = #{authorVerified, passedAssessment, linksOutcome}   // 0..3
//	score         = verifiedTier*BandVerifiedOutcome + engagement + recency
//
// Because engagement is capped at EngagementCap and recency <= WeightRecency, and
// BandVerifiedOutcome > EngagementCap + WeightRecency, a post with even ONE verified
// signal (verifiedTier >= 1) always outranks a post with ZERO verified signals no
// matter how large its engagement. That is exactly PN-3: "raw engagement volume
// alone must never be a ranking input", and each verified weight (BandVerifiedOutcome)
// dominates the entire engagement weight range.
const (
	WeightReaction = 1.0
	WeightComment  = 2.0 // a comment is heavier signal than a like
	WeightReshare  = 3.0 // a reshare is the heaviest engagement signal

	// EngagementCap saturates raw engagement so it can never cross a verified band.
	EngagementCap = 10000.0

	// BandVerifiedOutcome is the per-signal verified weight. It is strictly greater
	// than the entire engagement range (EngagementCap + WeightRecency), which is what
	// makes verified outcomes weigh >= engagement (PN-3).
	BandVerifiedOutcome = 100000.0

	WeightRecency        = 500.0 // < EngagementCap: recency is only a tiebreaker
	RecencyHalfLifeHours = 48.0
)

// RankScore computes a post's feed score from its signals. PURE: no I/O, no clock,
// no globals — deterministic in its input. This is the single source of truth the
// PN-3 tests assert against.
func RankScore(s RankSignals) float64 {
	engagementRaw := WeightReaction*float64(s.ReactionCount) +
		WeightComment*float64(s.CommentCount) +
		WeightReshare*float64(s.ReshareCount)
	engagement := math.Min(engagementRaw, EngagementCap)

	age := s.AgeHours
	if age < 0 {
		age = 0
	}
	recency := WeightRecency * math.Pow(0.5, age/RecencyHalfLifeHours)

	verifiedTier := 0.0
	if s.AuthorVerified {
		verifiedTier++
	}
	if s.AuthorPassedAssessment {
		verifiedTier++
	}
	if s.LinksCompletedOutcome {
		verifiedTier++
	}

	return verifiedTier*BandVerifiedOutcome + engagement + recency
}

// VerifiedWeight and EngagementWeight expose the two weight regimes so PN-3 can be
// asserted directly: a single verified signal must weigh at least as much as the
// entire engagement contribution.
func VerifiedWeight() float64  { return BandVerifiedOutcome }
func EngagementWeight() float64 { return EngagementCap }

// rankable pairs a post with its precomputed signals for sorting.
type rankable struct {
	item    FeedItem
	signals RankSignals
}

// RankFeed sorts posts by descending RankScore (verified outcomes first, PN-3),
// stamping each returned item's Score. Ties break by recency then id for stability.
func RankFeed(items []rankable) []FeedItem {
	sort.SliceStable(items, func(i, j int) bool {
		si, sj := RankScore(items[i].signals), RankScore(items[j].signals)
		if si != sj {
			return si > sj
		}
		return items[i].item.CreatedAt.After(items[j].item.CreatedAt)
	})
	out := make([]FeedItem, len(items))
	for i := range items {
		it := items[i].item
		it.Score = RankScore(items[i].signals)
		out[i] = it
	}
	return out
}

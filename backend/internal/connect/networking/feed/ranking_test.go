package connectfeed

import (
	"testing"
	"time"
)

// PN-3 (CRITICAL): a post backed by a VERIFIED OUTCOME must rank above a post that
// has only higher raw engagement. This proves verified-outcome weight >= engagement
// weight — raw engagement volume alone is never the deciding ranking input.
func TestPN3_VerifiedOutcomeOutranksHigherEngagement(t *testing.T) {
	// Post A: one verified signal (a completed booking), modest engagement.
	verified := RankScore(RankSignals{
		ReactionCount:         2,
		CommentCount:          1,
		LinksCompletedOutcome: true,
	})
	// Post B: NO verified signal, extreme engagement (adversarial max).
	engagementOnly := RankScore(RankSignals{
		ReactionCount: 1_000_000,
		CommentCount:  1_000_000,
		ReshareCount:  1_000_000,
	})

	if verified <= engagementOnly {
		t.Fatalf("PN-3 violated: verified-outcome post (%.0f) must outrank engagement-only post (%.0f)",
			verified, engagementOnly)
	}
}

// PN-3 structural guarantee: a single verified weight is at least the entire
// engagement weight range, so verified outcomes are weighted >= engagement.
func TestPN3_VerifiedWeightAtLeastEngagementWeight(t *testing.T) {
	if VerifiedWeight() < EngagementWeight() {
		t.Fatalf("PN-3 violated: verified weight %.0f < engagement weight %.0f",
			VerifiedWeight(), EngagementWeight())
	}
	// And strictly dominates once recency is included (so ordering is unambiguous).
	if BandVerifiedOutcome <= EngagementCap+WeightRecency {
		t.Fatalf("verified band %.0f does not dominate engagement+recency %.0f",
			BandVerifiedOutcome, EngagementCap+WeightRecency)
	}
}

// Each additional verified signal strictly increases the score (monotonic in
// verified outcomes), and each is worth a full engagement band.
func TestPN3_MoreVerifiedSignalsRankHigher(t *testing.T) {
	one := RankScore(RankSignals{AuthorVerified: true})
	two := RankScore(RankSignals{AuthorVerified: true, AuthorPassedAssessment: true})
	three := RankScore(RankSignals{AuthorVerified: true, AuthorPassedAssessment: true, LinksCompletedOutcome: true})
	if !(three > two && two > one) {
		t.Fatalf("verified signals must be monotonic: one=%.0f two=%.0f three=%.0f", one, two, three)
	}
}

// RankFeed orders a mixed set: verified posts first (regardless of engagement),
// then by engagement among equally-verified posts.
func TestRankFeed_OrdersVerifiedFirstThenEngagement(t *testing.T) {
	now := time.Now()
	items := []rankable{
		{ // low engagement, no verified
			item:    FeedItem{Post: Post{ID: "plain", CreatedAt: now}},
			signals: RankSignals{ReactionCount: 5},
		},
		{ // huge engagement, no verified
			item:    FeedItem{Post: Post{ID: "viral", CreatedAt: now}},
			signals: RankSignals{ReactionCount: 9000, CommentCount: 400},
		},
		{ // verified outcome, tiny engagement
			item:    FeedItem{Post: Post{ID: "verified", CreatedAt: now}},
			signals: RankSignals{LinksCompletedOutcome: true, ReactionCount: 1},
		},
	}
	got := RankFeed(items)
	if got[0].ID != "verified" {
		t.Fatalf("PN-3: verified post must rank first, got %q", got[0].ID)
	}
	if got[1].ID != "viral" || got[2].ID != "plain" {
		t.Fatalf("among non-verified, higher engagement first: got %q then %q", got[1].ID, got[2].ID)
	}
	// Score must be stamped and descending.
	if !(got[0].Score >= got[1].Score && got[1].Score >= got[2].Score) {
		t.Fatalf("scores must be descending: %.0f %.0f %.0f", got[0].Score, got[1].Score, got[2].Score)
	}
}

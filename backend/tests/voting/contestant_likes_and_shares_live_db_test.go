package voting_test

// Contestant likes + profile-share links — guards migration 20270311000000
// (contestant_likes, contestant_shares).
//
// Both tables ON DELETE CASCADE from contestants, so newContestant's own
// cleanup removes any like/share rows these tests create — nothing extra to
// tear down here.

import (
	"context"
	"testing"

	connectvoting "spotlight/backend/internal/connect/voting"
)

func TestContestantLikes_LikeIsIdempotentAndUnlikeRemovesIt(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	repo := connectvoting.NewRepository(pool)

	contestID := newContest(t, ctx, pool, contestOpts{status: "open"})
	contestantID := newContestant(t, ctx, pool, contestID)
	voter := anyVoter(t, ctx, pool)

	// Liking twice must not double-count — the client cannot tell "already
	// liked" from "just liked" and the count must not care either.
	if err := repo.LikeContestant(ctx, contestantID, voter); err != nil {
		t.Fatalf("like: %v", err)
	}
	if err := repo.LikeContestant(ctx, contestantID, voter); err != nil {
		t.Fatalf("like again (must be a no-op, not an error): %v", err)
	}

	e, err := repo.GetRosterEntry(ctx, contestantID, voter)
	if err != nil {
		t.Fatalf("get roster entry: %v", err)
	}
	if e == nil {
		t.Fatal("expected a roster entry, got nil")
	}
	if e.LikeCount != 1 {
		t.Fatalf("like_count = %d, want 1 (a double-like must not double-count)", e.LikeCount)
	}
	if !e.LikedByMe {
		t.Fatal("liked_by_me = false, want true for the user who just liked")
	}

	// A different viewer must not see someone else's like reflected back at them.
	otherViewer := "00000000-0000-0000-0000-000000000000"
	e2, err := repo.GetRosterEntry(ctx, contestantID, otherViewer)
	if err != nil {
		t.Fatalf("get roster entry (other viewer): %v", err)
	}
	if e2.LikedByMe {
		t.Fatal("liked_by_me = true for a viewer who never liked this contestant")
	}
	if e2.LikeCount != 1 {
		t.Fatalf("like_count = %d as seen by another viewer, want 1 (count is not per-viewer)", e2.LikeCount)
	}

	if err := repo.UnlikeContestant(ctx, contestantID, voter); err != nil {
		t.Fatalf("unlike: %v", err)
	}
	if err := repo.UnlikeContestant(ctx, contestantID, voter); err != nil {
		t.Fatalf("unlike again (must be a no-op, not an error): %v", err)
	}
	e3, err := repo.GetRosterEntry(ctx, contestantID, voter)
	if err != nil {
		t.Fatalf("get roster entry after unlike: %v", err)
	}
	if e3.LikeCount != 0 {
		t.Fatalf("like_count = %d after unlike, want 0", e3.LikeCount)
	}
	if e3.LikedByMe {
		t.Fatal("liked_by_me = true after unlike, want false")
	}
}

func TestContestantShares_TokenResolvesToTheRightContestantAndCounts(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	repo := connectvoting.NewRepository(pool)

	contestID := newContest(t, ctx, pool, contestOpts{status: "open"})
	contestantID := newContestant(t, ctx, pool, contestID)
	sharer := anyVoter(t, ctx, pool)

	token, err := repo.CreateShare(ctx, contestantID, sharer)
	if err != nil {
		t.Fatalf("create share: %v", err)
	}
	if token == "" {
		t.Fatal("expected a non-empty share token")
	}

	resolved, err := repo.ResolveShareToken(ctx, token)
	if err != nil {
		t.Fatalf("resolve share token: %v", err)
	}
	if resolved != contestantID {
		t.Fatalf("resolved contestant = %q, want %q", resolved, contestantID)
	}

	// A second share from the same user is a SEPARATE row (unlike a like, a
	// share has no per-user uniqueness constraint — sharing twice is a real,
	// countable action, not a duplicate to collapse).
	if _, err := repo.CreateShare(ctx, contestantID, sharer); err != nil {
		t.Fatalf("create second share: %v", err)
	}
	e, err := repo.GetRosterEntry(ctx, contestantID, "")
	if err != nil {
		t.Fatalf("get roster entry: %v", err)
	}
	if e.ShareCount != 2 {
		t.Fatalf("share_count = %d, want 2", e.ShareCount)
	}
}

func TestContestantShares_UnknownTokenDoesNotResolve(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	repo := connectvoting.NewRepository(pool)

	resolved, err := repo.ResolveShareToken(ctx, "this-token-was-never-issued")
	if err != nil {
		t.Fatalf("resolve unknown token: %v", err)
	}
	if resolved != "" {
		t.Fatalf("resolved = %q for an unknown token, want empty", resolved)
	}
}

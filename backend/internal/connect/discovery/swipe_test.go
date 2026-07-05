package connectdiscovery

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// fakeLiker is the LikeRecorder seam onto the (real, DB-backed) mutual-match
// transaction. It records how it was called and simulates the matcher's idempotent
// mutual-only contract: a repeated (from,target) like is a no-op that still reports
// the same match outcome — so a double-swipe never double-matches.
type fakeLiker struct {
	calls    int
	seen     map[string]int // key: from|to|kind → count
	gotFrom  string
	gotTo    string
	gotKind  string
	matchFor map[string]string // target → matchID that a like produces
	err      error
}

func newFakeLiker() *fakeLiker {
	return &fakeLiker{seen: map[string]int{}, matchFor: map[string]string{}}
}

func (f *fakeLiker) Like(_ context.Context, fromUserID, toProfileID, kind string) (SwipeResult, error) {
	f.calls++
	f.gotFrom, f.gotTo, f.gotKind = fromUserID, toProfileID, kind
	f.seen[fromUserID+"|"+toProfileID+"|"+kind]++
	if f.err != nil {
		return SwipeResult{}, f.err
	}
	if mid, ok := f.matchFor[toProfileID]; ok {
		return SwipeResult{Matched: true, MatchID: mid}, nil
	}
	return SwipeResult{}, nil
}

// serviceWithViewer builds a Service whose viewer is stubbed to (profileID) so
// Swipe's routing/guards run with no DB. db stays nil; the like/superlike path never
// touches the DB (deletePass is guarded on s.db != nil).
func serviceWithViewer(profileID string) *Service {
	s := &Service{}
	s.viewerFn = func(context.Context, string) (string, *float64, *float64, error) {
		return profileID, nil, nil, nil
	}
	return s
}

func TestSwipe_LikeDelegatesWithLikeKind(t *testing.T) {
	s := serviceWithViewer("me")
	liker := newFakeLiker()
	matched, matchID, err := s.Swipe(context.Background(), "user-me", "target-1", DirectionLike, liker)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if matched || matchID != "" {
		t.Fatalf("no reciprocal like → no match; got matched=%v id=%q", matched, matchID)
	}
	if liker.gotKind != "like" {
		t.Fatalf("direction 'like' must map to kind 'like', got %q", liker.gotKind)
	}
	if liker.gotTo != "target-1" || liker.gotFrom != "user-me" {
		t.Fatalf("like must carry the caller + target, got from=%q to=%q", liker.gotFrom, liker.gotTo)
	}
}

func TestSwipe_SuperlikeMapsToSuperKind(t *testing.T) {
	s := serviceWithViewer("me")
	liker := newFakeLiker()
	if _, _, err := s.Swipe(context.Background(), "user-me", "target-1", DirectionSuper, liker); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if liker.gotKind != "super" {
		t.Fatalf("direction 'superlike' must map to kind 'super', got %q", liker.gotKind)
	}
}

func TestSwipe_MutualLikeReturnsMatch(t *testing.T) {
	s := serviceWithViewer("me")
	liker := newFakeLiker()
	liker.matchFor["target-1"] = "match-99" // target already liked back
	matched, matchID, err := s.Swipe(context.Background(), "user-me", "target-1", DirectionLike, liker)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched || matchID != "match-99" {
		t.Fatalf("mutual like must surface the match, got matched=%v id=%q", matched, matchID)
	}
}

// The idempotent mutual-match guarantee: a double-swipe (same caller, same target,
// same kind) delegates to the matcher, which is itself idempotent — so the caller
// never ends up with two likes or two matches. We assert the delegation is stable
// and the reported match outcome is identical on replay.
func TestSwipe_DoubleSwipeIsIdempotent(t *testing.T) {
	s := serviceWithViewer("me")
	liker := newFakeLiker()
	liker.matchFor["target-1"] = "match-1"

	m1, id1, err := s.Swipe(context.Background(), "user-me", "target-1", DirectionLike, liker)
	if err != nil {
		t.Fatalf("first swipe failed: %v", err)
	}
	m2, id2, err := s.Swipe(context.Background(), "user-me", "target-1", DirectionLike, liker)
	if err != nil {
		t.Fatalf("second swipe failed: %v", err)
	}
	if m1 != m2 || id1 != id2 {
		t.Fatalf("replayed swipe must report the SAME match outcome: (%v,%q) vs (%v,%q)", m1, id1, m2, id2)
	}
	if got := liker.seen["user-me|target-1|like"]; got != 2 {
		t.Fatalf("both swipes must route to the idempotent matcher, saw %d", got)
	}
	// The matcher's UNIQUE(from,to) + ON CONFLICT DO NOTHING is what makes those two
	// calls collapse to one like/one match — verified in connectmatching's own tests.
}

func TestSwipe_RejectsSelf(t *testing.T) {
	s := serviceWithViewer("me")
	liker := newFakeLiker()
	if _, _, err := s.Swipe(context.Background(), "user-me", "me", DirectionLike, liker); !errors.Is(err, ErrSelfSwipe) {
		t.Fatalf("want ErrSelfSwipe, got %v", err)
	}
	if liker.calls != 0 {
		t.Fatal("self-swipe must be rejected before the matcher is called")
	}
}

func TestSwipe_RejectsUnknownDirection(t *testing.T) {
	s := serviceWithViewer("me")
	liker := newFakeLiker()
	if _, _, err := s.Swipe(context.Background(), "user-me", "target-1", "sideways", liker); !errors.Is(err, ErrInvalidSwipe) {
		t.Fatalf("want ErrInvalidSwipe, got %v", err)
	}
	if liker.calls != 0 {
		t.Fatal("an invalid direction must not reach the matcher")
	}
}

func TestSwipe_NoProfileFailsClosed(t *testing.T) {
	s := &Service{}
	s.viewerFn = func(context.Context, string) (string, *float64, *float64, error) {
		return "", nil, nil, errors.New("connect: no profile for user")
	}
	liker := newFakeLiker()
	if _, _, err := s.Swipe(context.Background(), "ghost", "target-1", DirectionLike, liker); !errors.Is(err, ErrNoProfile) {
		t.Fatalf("want ErrNoProfile, got %v", err)
	}
	if liker.calls != 0 {
		t.Fatal("no matcher call when the caller has no profile")
	}
}

// cardFrom must NEVER leak coordinates — the ProfileCard has no lat/lng fields, and
// the mapping copies only privacy-safe attributes. This locks the privacy invariant
// for the mobile stack contract.
func TestCardFromDropsRawCoordinates(t *testing.T) {
	name := "Ada"
	c := Candidate{
		ProfileID:     "p1",
		DisplayName:   &name,
		Verified:      true,
		IntentTags:    []string{"hiking"},
		DistanceLabel: "within 25 km",
	}
	card := cardFrom(c)
	if card.ProfileID != "p1" || card.DistanceLabel != "within 25 km" {
		t.Fatalf("card mapping lost fields: %+v", card)
	}
	if card.IntentTags == nil {
		t.Fatal("intentTags must never be nil (stable JSON array)")
	}
	// There is no field on ProfileCard that could carry a raw coordinate — assert the
	// distance is a coarse bucket label, never a decimal.
	if strings.ContainsAny(card.DistanceLabel, ".") {
		t.Fatalf("distance label leaked a precise value: %q", card.DistanceLabel)
	}
}

// orderPairLocal must match matching.orderPair's canonical (a<b) ordering so the
// rewind match-void query targets the same UNIQUE(profile_a,profile_b) row the
// matcher created — regardless of who swiped first.
func TestOrderPairLocalCanonical(t *testing.T) {
	a, b := orderPairLocal("beta", "alpha")
	c, d := orderPairLocal("alpha", "beta")
	if a != c || b != d {
		t.Fatalf("order not canonical: (%s,%s) vs (%s,%s)", a, b, c, d)
	}
	if !(a < b) {
		t.Fatalf("expected a<b, got a=%s b=%s", a, b)
	}
}

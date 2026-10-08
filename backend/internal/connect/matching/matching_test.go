package connectmatching

import (
	"context"
	"errors"
	"testing"
)

// orderPair must produce the same canonical (a<b) pair regardless of argument
// order — this is what makes the mutual match UNIQUE(a,b) constraint direction-
// independent (the safety-critical mutual-only guarantee).
func TestOrderPairIsCanonical(t *testing.T) {
	a, b := orderPair("alpha", "beta")
	c, d := orderPair("beta", "alpha")
	if a != c || b != d {
		t.Fatalf("order not canonical: (%s,%s) vs (%s,%s)", a, b, c, d)
	}
	if a >= b {
		t.Fatalf("expected a<b, got a=%s b=%s", a, b)
	}
}

func TestOrderPairStable(t *testing.T) {
	a, b := orderPair("z", "a")
	if a != "a" || b != "z" {
		t.Fatalf("expected (a,z), got (%s,%s)", a, b)
	}
}

func TestValidKind(t *testing.T) {
	if !ValidKind(KindLike) || !ValidKind(KindSuper) {
		t.Fatal("like and super must be valid kinds")
	}
	if ValidKind("") || ValidKind("dislike") {
		t.Fatal("unknown kinds must be rejected")
	}
}

// A malformed (non-UUID) target must fail as ErrTargetNotFound BEFORE the tx —
// connect_profiles.id is uuid, so without the guard Postgres answered
// "invalid input syntax" → the discovery swipe path turned that into a 500.
// The guard precedes db.Begin, so a nil-pool service exercises it directly.
func TestLikeMalformedTargetIsNotFound(t *testing.T) {
	s := NewService(nil)
	if _, err := s.Like(context.Background(), "user-1", "not-a-uuid", KindLike); !errors.Is(err, ErrTargetNotFound) {
		t.Fatalf("want ErrTargetNotFound, got %v", err)
	}
}

package connectdiscovery

// LIVE-DB test for the enriched swipe-deck card: GET /discovery/stack (and the
// shared likes-you / nearby card shape) must carry real photos + age + headline +
// bio, not the blank placeholders the lean card used to produce.
//
// GATED ON TEST_DATABASE_URL only — never DATABASE_URL (production pooler):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/discovery/ -run TestLiveDB_Stack -v

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

// discoveryTestPool is provided by profile_detail_live_db_test.go in this package
// (same TEST_DATABASE_URL gate) and reused here.

// seedProfile creates a throwaway auth user + connect_profiles row and returns the
// auth user id and the connect profile id. geo is set so distance ranking works.
func seedProfile(t *testing.T, pool *pgxpool.Pool, lat, lng float64) (userID, profileID string) {
	t.Helper()
	ctx := context.Background()
	userID = uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		userID, "connect-discovery-test-"+userID+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)
	if err := pool.QueryRow(ctx,
		`INSERT INTO connect_profiles (user_id, geo_lat, geo_lng) VALUES ($1, $2, $3) RETURNING id`,
		userID, lat, lng).Scan(&profileID); err != nil {
		t.Fatalf("seed connect_profiles: %v", err)
	}
	return userID, profileID
}

// fakeSigner records the keys it was asked to sign and returns a deterministic
// signed URL, so the test can assert object keys are turned into viewable URLs
// while plain URLs pass through resolveMedia untouched.
type fakeSigner struct{ signed []string }

func (f *fakeSigner) Configured() bool { return true }
func (f *fakeSigner) PresignGet(key string, _ time.Duration) (string, error) {
	f.signed = append(f.signed, key)
	return "https://signed.invalid/" + key, nil
}

func TestLiveDB_StackCardCarriesPhotosAgeBio(t *testing.T) {
	pool := discoveryTestPool(t)
	ctx := context.Background()

	// Viewer and a nearby candidate (same point → distance "within <bucket> km").
	viewerUser, _ := seedProfile(t, pool, 6.5, 3.4)
	_, candProfile := seedProfile(t, pool, 6.5, 3.4)

	// Candidate identity: a clear adult DOB, headline and bio.
	dob := time.Now().UTC().AddDate(-29, 0, -1)
	if _, err := pool.Exec(ctx,
		`UPDATE connect_profiles SET display_name=$2, headline=$3, bio=$4, dob=$5 WHERE id=$1`,
		candProfile, "Zainab", "Product designer · Lagos", "Design by day, jollof by night.", dob); err != nil {
		t.Fatalf("set candidate identity: %v", err)
	}
	// Visible dating mode so the candidate surfaces in the deck.
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_profile_modes (profile_id, mode, visible, intent_tags)
		 VALUES ($1,'dating',true,ARRAY['long_term'])`, candProfile); err != nil {
		t.Fatalf("set candidate mode: %v", err)
	}
	// Three photos: approved (object key → signed), pending (shown), rejected (withheld).
	// sort_order fixes display order so the primary is deterministic.
	seedPhoto := func(url, status string, sort int) {
		if _, err := pool.Exec(ctx,
			`INSERT INTO connect_profile_media (profile_id, url, kind, moderation_status, sort_order)
			 VALUES ($1,$2,'photo',$3,$4)`, candProfile, url, status, sort); err != nil {
			t.Fatalf("seed photo: %v", err)
		}
	}
	seedPhoto("connect/profile/"+candProfile+"/primary.jpg", "approved", 0)
	seedPhoto("https://plain.invalid/second.jpg", "pending", 1)
	seedPhoto("connect/profile/"+candProfile+"/nope.jpg", "rejected", 2)

	signer := &fakeSigner{}
	svc := NewService(pool).WithPresigner(signer)

	cards, err := svc.Stack(ctx, viewerUser, StackFilters{})
	if err != nil {
		t.Fatalf("Stack: %v", err)
	}

	var card *ProfileCard
	for i := range cards {
		if cards[i].ProfileID == candProfile {
			card = &cards[i]
			break
		}
	}
	if card == nil {
		t.Fatalf("candidate %s not in deck of %d", candProfile, len(cards))
	}

	// Age derived from dob (never the raw dob).
	if card.Age == nil || *card.Age != 29 {
		t.Fatalf("age = %v, want 29", card.Age)
	}
	if card.Headline == nil || *card.Headline != "Product designer · Lagos" {
		t.Fatalf("headline = %v", card.Headline)
	}
	if card.Bio == nil || *card.Bio != "Design by day, jollof by night." {
		t.Fatalf("bio = %v", card.Bio)
	}
	// Two photos survive moderation (approved + pending); rejected is withheld.
	if len(card.Photos) != 2 {
		t.Fatalf("photos = %v, want 2 (rejected withheld)", card.Photos)
	}
	// Primary is the approved object key, signed by the presigner.
	if card.Photos[0] != "https://signed.invalid/connect/profile/"+candProfile+"/primary.jpg" {
		t.Fatalf("primary photo not signed: %q", card.Photos[0])
	}
	// The pending plain URL passes through untouched.
	if card.Photos[1] != "https://plain.invalid/second.jpg" {
		t.Fatalf("plain url should pass through: %q", card.Photos[1])
	}
	// Distance is a coarse bucket label, never a raw coordinate.
	if card.DistanceLabel == "" {
		t.Fatal("expected a bucketed distanceLabel for a co-located pair")
	}

	// A candidate with NO photos must still produce a non-nil (empty) photo list so
	// the mobile client never crashes on `.map`/`[0]`.
	_, bareProfile := seedProfile(t, pool, 6.5, 3.4)
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_profile_modes (profile_id, mode, visible) VALUES ($1,'dating',true)`, bareProfile); err != nil {
		t.Fatalf("set bare mode: %v", err)
	}
	cards, err = svc.Stack(ctx, viewerUser, StackFilters{})
	if err != nil {
		t.Fatalf("Stack (bare): %v", err)
	}
	for i := range cards {
		if cards[i].ProfileID == bareProfile && cards[i].Photos == nil {
			t.Fatal("photos must be an empty list, not nil")
		}
	}
}

// Package connect_test holds live-DB integration tests for the Paymax Connect
// module. This file is the executed, deterministic evidence for safety invariant 3
// ("block is absolute & mutual-invisible") across every discovery/contact surface —
// test-plan rows TS-001, DM-008, EC-004 and PN-011.
//
// Root cause it guards against: before this suite, connect_blocks was consulted ONLY
// by the chat layer, so a blocked user still appeared in the dating deck, could still
// form a match, and their posts + professional profile stayed visible to the blocker.
//
// Bring-up (skipped unless a DB is wired):
//   1. A Postgres with the Connect schema applied (e.g. the local Supabase DB).
//   2. export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres
//   3. cd backend && go test ./tests/connect/ -run TestConnectBlockIsAbsolute -v
//
// The suite seeds throwaway rows under freshly-generated UUIDs and deletes them on
// cleanup; it never touches real user data.
package connect_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	connectdiscovery "spotlight/backend/internal/connect/discovery"
	connectfeed "spotlight/backend/internal/connect/networking/feed"
	connectmatching "spotlight/backend/internal/connect/matching"
	connectprofessional "spotlight/backend/internal/connect/professional"
	connectsafety "spotlight/backend/internal/connect/safety"
	connecttrust "spotlight/backend/internal/connect/trust"
	connectchat "spotlight/backend/internal/connect/chat"
	connectaccount "spotlight/backend/internal/connect/account"
	connectmonetization "spotlight/backend/internal/connect/monetization"
	ledger "spotlight/backend/internal/finance/ledger"
	connectcredits "spotlight/backend/internal/connect/credits"
)

func blockLiveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB Connect block-absolute integration test; see file header for bring-up")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// noopAuditor satisfies the feed/professional Auditor interfaces without a DB write.
type noopAuditor struct{}

func (noopAuditor) WriteAudit(context.Context, string, string, string, string, map[string]any) error {
	return nil
}

// seedProfile inserts a connect_profiles row for a fresh auth user id and returns
// (userID, profileID).
func seedProfile(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (string, string) {
	t.Helper()
	userID := uuid.NewString()
	// connect_profiles.user_id FKs to auth.users(id); seed the auth row first.
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
		userID, "seed-"+userID[:8]+"@example.test"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	var profileID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO connect_profiles (user_id, display_name) VALUES ($1::uuid, $2) RETURNING id`,
		userID, "seed-"+userID[:8]).Scan(&profileID); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	return userID, profileID
}

func seedDatingMode(t *testing.T, ctx context.Context, pool *pgxpool.Pool, profileID string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_profile_modes (profile_id, mode, visible) VALUES ($1::uuid,'dating',true)`,
		profileID); err != nil {
		t.Fatalf("seed dating mode: %v", err)
	}
}

func seedProfessional(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_professional_profiles
		   (user_id, headline, company, role_title, industry, bio, visible)
		 VALUES ($1::uuid,'Engineer','Acme','Staff','tech','bio',true)`,
		userID); err != nil {
		t.Fatalf("seed professional: %v", err)
	}
}

func seedPost(t *testing.T, ctx context.Context, pool *pgxpool.Pool, authorUserID, body string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO connect_posts (author_type, author_id, body, visible)
		 VALUES ('user',$1::uuid,$2,true) RETURNING id`,
		authorUserID, body).Scan(&id); err != nil {
		t.Fatalf("seed post: %v", err)
	}
	return id
}

func seedBlock(t *testing.T, ctx context.Context, pool *pgxpool.Pool, blocker, blocked string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_blocks (blocker_id, blocked_id) VALUES ($1::uuid,$2::uuid)`,
		blocker, blocked); err != nil {
		t.Fatalf("seed block: %v", err)
	}
}

// TestConnectBlockIsAbsolute proves that once a viewer blocks another user, that
// user vanishes from every Connect surface: the dating deck, the like/match path,
// the professional feed, and professional discovery — in BOTH block directions.
func TestConnectBlockIsAbsolute(t *testing.T) {
	pool := blockLiveDBPool(t)
	defer pool.Close()
	ctx := context.Background()

	// Three actors: viewer blocks `blocked`; `control` is an unrelated third user
	// used as a positive control (must still surface everywhere).
	viewerUser, viewerProfile := seedProfile(t, ctx, pool)
	blockedUser, blockedProfile := seedProfile(t, ctx, pool)
	controlUser, controlProfile := seedProfile(t, ctx, pool)

	t.Cleanup(func() {
		users := []any{viewerUser, blockedUser, controlUser}
		_, _ = pool.Exec(ctx, `DELETE FROM connect_matches WHERE profile_a = ANY(SELECT id FROM connect_profiles WHERE user_id = ANY($1::uuid[])) OR profile_b = ANY(SELECT id FROM connect_profiles WHERE user_id = ANY($1::uuid[]))`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_likes WHERE from_profile = ANY(SELECT id FROM connect_profiles WHERE user_id = ANY($1::uuid[])) OR to_profile = ANY(SELECT id FROM connect_profiles WHERE user_id = ANY($1::uuid[]))`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_blocks WHERE blocker_id = ANY($1::uuid[]) OR blocked_id = ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_posts WHERE author_id = ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profile_modes WHERE profile_id = ANY(SELECT id FROM connect_profiles WHERE user_id = ANY($1::uuid[]))`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_professional_profiles WHERE user_id = ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE user_id = ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, users)
	})

	// The block: viewer blocks blocked. (One direction; the predicate is bidirectional.)
	seedBlock(t, ctx, pool, viewerUser, blockedUser)

	// ── DM-008: dating deck excludes the blocked user, keeps the control ──────────
	t.Run("DM-008_discovery_deck_excludes_blocked", func(t *testing.T) {
		seedDatingMode(t, ctx, pool, blockedProfile)
		seedDatingMode(t, ctx, pool, controlProfile)
		disc := connectdiscovery.NewService(pool)
		resp, err := disc.Discovery(ctx, viewerUser, "dating")
		if err != nil {
			t.Fatalf("discovery: %v", err)
		}
		var sawBlocked, sawControl bool
		for _, c := range resp.Candidates {
			if c.ProfileID == blockedProfile {
				sawBlocked = true
			}
			if c.ProfileID == controlProfile {
				sawControl = true
			}
		}
		if sawBlocked {
			t.Errorf("blocked user appeared in dating deck — block not absolute (invariant 3)")
		}
		if !sawControl {
			t.Errorf("control user missing from deck — filter over-broad; seeding/query issue")
		}
	})

	// ── EC-004: like/match refused in both directions when a block exists ─────────
	t.Run("EC-004_like_refused_both_directions", func(t *testing.T) {
		m := connectmatching.NewService(pool)
		if _, err := m.Like(ctx, viewerUser, blockedProfile, "like"); !errors.Is(err, connectmatching.ErrBlocked) {
			t.Errorf("viewer→blocked like: want ErrBlocked, got %v", err)
		}
		// Reverse direction: the blocked user must also be unable to like the blocker.
		if _, err := m.Like(ctx, blockedUser, viewerProfile, "like"); !errors.Is(err, connectmatching.ErrBlocked) {
			t.Errorf("blocked→viewer like: want ErrBlocked, got %v", err)
		}
		// Control: an unrelated like still works (no false-positive block).
		if _, err := m.Like(ctx, viewerUser, controlProfile, "like"); err != nil {
			t.Errorf("viewer→control like should succeed, got %v", err)
		}
		// And no match row was created between the blocked pair.
		var matches int
		_ = pool.QueryRow(ctx,
			`SELECT count(*) FROM connect_matches
			 WHERE (profile_a=$1 AND profile_b=$2) OR (profile_a=$2 AND profile_b=$1)`,
			viewerProfile, blockedProfile).Scan(&matches)
		if matches != 0 {
			t.Errorf("a match exists between the blocked pair — got %d, want 0", matches)
		}
	})

	// ── DM-007: a minor never surfaces in the adult deck and can't be liked ───────
	t.Run("DM-007_minor_excluded_from_deck_and_like", func(t *testing.T) {
		minorUser, minorProfile := seedProfile(t, ctx, pool)
		t.Cleanup(func() {
			_, _ = pool.Exec(ctx, `DELETE FROM connect_likes WHERE to_profile=$1 OR from_profile=$1`, minorProfile)
			_, _ = pool.Exec(ctx, `DELETE FROM connect_underage_flags WHERE user_id=$1::uuid`, minorUser)
			_, _ = pool.Exec(ctx, `DELETE FROM connect_profile_modes WHERE profile_id=$1`, minorProfile)
			_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE id=$1`, minorProfile)
			_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1::uuid`, minorUser)
		})
		// Make the minor maximally "visible": dating mode on, and flagged underage.
		seedDatingMode(t, ctx, pool, minorProfile)
		if _, err := pool.Exec(ctx,
			`INSERT INTO connect_underage_flags (user_id, reason, status) VALUES ($1::uuid,'test','queued')`,
			minorUser); err != nil {
			t.Fatalf("seed underage flag: %v", err)
		}

		disc := connectdiscovery.NewService(pool)
		resp, err := disc.Discovery(ctx, viewerUser, "dating")
		if err != nil {
			t.Fatalf("discovery: %v", err)
		}
		for _, c := range resp.Candidates {
			if c.ProfileID == minorProfile {
				t.Errorf("underage-flagged profile appeared in adult deck — invariant 1 violated")
			}
		}
		// And a direct like to the minor is refused (fail-closed defense-in-depth).
		m := connectmatching.NewService(pool)
		if _, err := m.Like(ctx, viewerUser, minorProfile, "like"); !errors.Is(err, connectmatching.ErrIneligibleTarget) {
			t.Errorf("like to minor: want ErrIneligibleTarget, got %v", err)
		}
	})

	// ── PN-011: professional feed hides the blocked user's posts ──────────────────
	t.Run("PN-011_feed_excludes_blocked_author", func(t *testing.T) {
		blockedPost := seedPost(t, ctx, pool, blockedUser, "post from blocked user")
		controlPost := seedPost(t, ctx, pool, controlUser, "post from control user")
		svc := connectfeed.NewService(connectfeed.NewRepository(pool), noopAuditor{})
		items, err := svc.Feed(ctx, viewerUser, 200)
		if err != nil {
			t.Fatalf("feed: %v", err)
		}
		var sawBlocked, sawControl bool
		for _, it := range items {
			if it.ID == blockedPost {
				sawBlocked = true
			}
			if it.ID == controlPost {
				sawControl = true
			}
		}
		if sawBlocked {
			t.Errorf("blocked user's post appeared in feed — block not absolute (PN-011)")
		}
		if !sawControl {
			t.Errorf("control post missing from feed — filter over-broad")
		}
	})

	// ── PN-011: professional discovery hides the blocked user's profile ───────────
	t.Run("PN-011_professional_discover_excludes_blocked", func(t *testing.T) {
		seedProfessional(t, ctx, pool, blockedUser)
		seedProfessional(t, ctx, pool, controlUser)
		p := connectprofessional.NewService(pool, noopAuditor{})
		profs, err := p.Discover(ctx, viewerUser, "", 100)
		if err != nil {
			t.Fatalf("professional discover: %v", err)
		}
		var sawBlocked, sawControl bool
		for _, pr := range profs {
			if pr.UserID == blockedUser {
				sawBlocked = true
			}
			if pr.UserID == controlUser {
				sawControl = true
			}
		}
		if sawBlocked {
			t.Errorf("blocked user's professional profile appeared in Discover — block not absolute (PN-011)")
		}
		if !sawControl {
			t.Errorf("control professional profile missing from Discover — filter over-broad")
		}
	})
}

// TestConnectBanIsEnforced proves TS-009 / invariant 6: resolving a safety case to
// 'banned' via the admin UpdateCase path does not merely LOG the decision — it
// writes an active account restriction that removes the user from discovery and
// blocks them from liking/matching. Before this slice, ban was a no-op log.
func TestConnectBanIsEnforced(t *testing.T) {
	pool := blockLiveDBPool(t)
	defer pool.Close()
	ctx := context.Background()

	adminUser, _ := seedProfile(t, ctx, pool)
	viewerUser, _ := seedProfile(t, ctx, pool)
	subjectUser, subjectProfile := seedProfile(t, ctx, pool)
	controlUser, controlProfile := seedProfile(t, ctx, pool)

	t.Cleanup(func() {
		users := []any{adminUser, viewerUser, subjectUser, controlUser}
		_, _ = pool.Exec(ctx, `DELETE FROM connect_account_restrictions WHERE user_id = ANY($1::uuid[]) OR created_by = ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_audit_log WHERE actor_id = ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_cases WHERE subject_id = ANY($1::uuid[]) OR reporter_id = ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_likes WHERE from_profile = ANY(SELECT id FROM connect_profiles WHERE user_id = ANY($1::uuid[])) OR to_profile = ANY(SELECT id FROM connect_profiles WHERE user_id = ANY($1::uuid[]))`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profile_modes WHERE profile_id = ANY(SELECT id FROM connect_profiles WHERE user_id = ANY($1::uuid[]))`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE user_id = ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, users)
	})

	// The subject is a visible, adult dating profile — so absent a ban they WOULD
	// surface in the deck (positive baseline).
	seedDatingMode(t, ctx, pool, subjectProfile)
	seedDatingMode(t, ctx, pool, controlProfile)

	safety := connectsafety.NewService(pool)
	disc := connectdiscovery.NewService(pool)
	match := connectmatching.NewService(pool)

	// Baseline: before any ban, the subject appears in the viewer's deck.
	if resp, err := disc.Discovery(ctx, viewerUser, "dating"); err != nil {
		t.Fatalf("baseline discovery: %v", err)
	} else {
		var seen bool
		for _, c := range resp.Candidates {
			if c.ProfileID == subjectProfile {
				seen = true
			}
		}
		if !seen {
			t.Fatalf("baseline: subject should be visible in deck before ban (seeding issue)")
		}
	}

	// Open a case against the subject and resolve it 'banned' via the admin path.
	cs, err := safety.OpenCase(ctx, connectsafety.OpenCaseInput{
		ReporterID: viewerUser, SubjectID: subjectUser, Type: "harassment", Severity: "high",
	})
	if err != nil {
		t.Fatalf("open case: %v", err)
	}
	if _, err := safety.UpdateCase(ctx, cs.ID, adminUser, connectsafety.UpdateCaseInput{
		Status: "resolved", Resolution: "banned",
	}); err != nil {
		t.Fatalf("update case to banned: %v", err)
	}

	// 1) An active restriction row was written for the subject (enforcement, not log-only).
	var active int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM connect_account_restrictions
		 WHERE user_id = $1::uuid AND active AND type = 'banned'`, subjectUser).Scan(&active); err != nil {
		t.Fatalf("restriction lookup: %v", err)
	}
	if active != 1 {
		t.Errorf("want exactly 1 active 'banned' restriction for subject, got %d", active)
	}

	// 2) The banned subject no longer appears in the deck.
	resp, err := disc.Discovery(ctx, viewerUser, "dating")
	if err != nil {
		t.Fatalf("post-ban discovery: %v", err)
	}
	for _, c := range resp.Candidates {
		if c.ProfileID == subjectProfile {
			t.Errorf("banned subject still appears in deck — ban not enforced (TS-009)")
		}
	}

	// 3) The banned subject cannot like anyone.
	if _, err := match.Like(ctx, subjectUser, controlProfile, "like"); !errors.Is(err, connectmatching.ErrRestricted) {
		t.Errorf("banned user like: want ErrRestricted, got %v", err)
	}
	// 4) Nobody can like the banned subject either (target restricted).
	if _, err := match.Like(ctx, controlUser, subjectProfile, "like"); !errors.Is(err, connectmatching.ErrRestricted) {
		t.Errorf("like toward banned user: want ErrRestricted, got %v", err)
	}
}

// TestConnectMatchRaceExactlyOnce probes DM-014 / EC-008: when two users like each
// other at the "same instant", the outcome must be EXACTLY ONE match — never zero
// (missed) and never two (duplicate). Runs many independent pairs with the two
// reciprocal likes fired concurrently to maximise interleaving.
func TestConnectMatchRaceExactlyOnce(t *testing.T) {
	pool := blockLiveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	m := connectmatching.NewService(pool)

	const iterations = 25
	var missed, dup int
	for i := 0; i < iterations; i++ {
		uA, pA := seedProfile(t, ctx, pool)
		uB, pB := seedProfile(t, ctx, pool)
		seedDatingMode(t, ctx, pool, pA)
		seedDatingMode(t, ctx, pool, pB)

		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); <-start; _, _ = m.Like(ctx, uA, pB, "like") }()
		go func() { defer wg.Done(); <-start; _, _ = m.Like(ctx, uB, pA, "like") }()
		close(start) // fire both as simultaneously as possible
		wg.Wait()

		var matches int
		_ = pool.QueryRow(ctx,
			`SELECT count(*) FROM connect_matches
			 WHERE (profile_a=$1 AND profile_b=$2) OR (profile_a=$2 AND profile_b=$1)`,
			pA, pB).Scan(&matches)
		if matches == 0 {
			missed++
		} else if matches > 1 {
			dup++
		}

		// cleanup this pair
		users := []any{uA, uB}
		_, _ = pool.Exec(ctx, `DELETE FROM connect_matches WHERE profile_a=ANY($1) OR profile_b=ANY($1)`, []any{pA, pB})
		_, _ = pool.Exec(ctx, `DELETE FROM connect_likes WHERE from_profile=ANY($1) OR to_profile=ANY($1)`, []any{pA, pB})
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profile_modes WHERE profile_id=ANY($1)`, []any{pA, pB})
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE user_id=ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=ANY($1::uuid[])`, users)
	}
	if missed > 0 || dup > 0 {
		t.Errorf("match race not exactly-once over %d pairs: missed=%d duplicate=%d", iterations, missed, dup)
	}
}

// TestConnectBanSeversActiveChat pins EC-005 / TS-009: once a matched user is
// banned, the conversation is dead BOTH ways — the banned user can't send, and
// their partner can't message the banned recipient either. Enforced mid-chat.
func TestConnectBanSeversActiveChat(t *testing.T) {
	pool := blockLiveDBPool(t)
	defer pool.Close()
	ctx := context.Background()

	uA, pA := seedProfile(t, ctx, pool)
	uB, pB := seedProfile(t, ctx, pool)
	t.Cleanup(func() {
		users := []any{uA, uB}
		_, _ = pool.Exec(ctx, `DELETE FROM connect_messages WHERE conversation_id IN (SELECT c.id FROM connect_conversations c JOIN connect_matches m ON m.id=c.match_id WHERE m.profile_a=ANY($1) OR m.profile_b=ANY($1))`, []any{pA, pB})
		_, _ = pool.Exec(ctx, `DELETE FROM connect_conversations WHERE match_id IN (SELECT id FROM connect_matches WHERE profile_a=ANY($1) OR profile_b=ANY($1))`, []any{pA, pB})
		_, _ = pool.Exec(ctx, `DELETE FROM connect_matches WHERE profile_a=ANY($1) OR profile_b=ANY($1)`, []any{pA, pB})
		_, _ = pool.Exec(ctx, `DELETE FROM connect_account_restrictions WHERE user_id=ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE user_id=ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=ANY($1::uuid[])`, users)
	})

	// Canonical-ordered mutual match between A and B.
	a, b := pA, pB
	if b < a {
		a, b = b, a
	}
	var matchID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO connect_matches (profile_a, profile_b, status) VALUES ($1,$2,'matched') RETURNING id`,
		a, b).Scan(&matchID); err != nil {
		t.Fatalf("seed match: %v", err)
	}

	cfg := connecttrust.NewConfigReader(pool)
	safety := connectsafety.NewService(pool)
	shield := connecttrust.NewShieldStore(pool, cfg, safety)
	chat := connectchat.NewService(pool, cfg, shield, safety)

	convID, _, err := chat.OpenConversation(ctx, matchID, uA)
	if err != nil {
		t.Fatalf("open conversation: %v", err)
	}
	// Baseline: A can message B before any ban.
	if _, err := chat.SendMessage(ctx, convID, uA, connectchat.SendMessageRequest{Body: "hi there"}); err != nil {
		t.Fatalf("baseline send should succeed, got %v", err)
	}

	// Ban B.
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_account_restrictions (user_id, type, active) VALUES ($1::uuid,'banned',true)`,
		uB); err != nil {
		t.Fatalf("seed restriction: %v", err)
	}

	// A can no longer message the banned recipient B.
	if _, err := chat.SendMessage(ctx, convID, uA, connectchat.SendMessageRequest{Body: "still there?"}); !errors.Is(err, connectchat.ErrRestricted) {
		t.Errorf("partner messaging banned recipient: want ErrRestricted, got %v", err)
	}
	// The banned user B can't send either.
	if _, err := chat.SendMessage(ctx, convID, uB, connectchat.SendMessageRequest{Body: "hello?"}); !errors.Is(err, connectchat.ErrRestricted) {
		t.Errorf("banned sender: want ErrRestricted, got %v", err)
	}
}

// TestConnectAccountDeletionCascade pins ON-010 + EC-011: deleting an account
// anonymises the user's PII, removes them from discovery, ends matches gracefully
// (partner sees 'unmatched' + can no longer message), redacts their messages,
// erases sensitive data, writes an immutable audit entry, and is idempotent.
func TestConnectAccountDeletionCascade(t *testing.T) {
	pool := blockLiveDBPool(t)
	defer pool.Close()
	ctx := context.Background()

	subjU, subjP := seedProfile(t, ctx, pool)
	partU, partP := seedProfile(t, ctx, pool)
	t.Cleanup(func() {
		users := []any{subjU, partU}
		profs := []any{subjP, partP}
		_, _ = pool.Exec(ctx, `DELETE FROM connect_messages WHERE conversation_id IN (SELECT c.id FROM connect_conversations c JOIN connect_matches m ON m.id=c.match_id WHERE m.profile_a=ANY($1) OR m.profile_b=ANY($1))`, profs)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_conversations WHERE match_id IN (SELECT id FROM connect_matches WHERE profile_a=ANY($1) OR profile_b=ANY($1))`, profs)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_matches WHERE profile_a=ANY($1) OR profile_b=ANY($1)`, profs)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profile_media WHERE profile_id=ANY($1)`, profs)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profile_modes WHERE profile_id=ANY($1)`, profs)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_verification WHERE user_id=ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_professional_profiles WHERE user_id=ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_audit_log WHERE entity_id=ANY($1) OR actor_id=ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE user_id=ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=ANY($1::uuid[])`, users)
	})

	// Seed a rich footprint for the subject.
	seedDatingMode(t, ctx, pool, subjP)
	seedDatingMode(t, ctx, pool, partP)
	seedProfessional(t, ctx, pool, subjU)
	mustExec(t, ctx, pool, `INSERT INTO connect_profile_media (profile_id, url, kind) VALUES ($1,'https://x/y.jpg','photo')`, subjP)
	mustExec(t, ctx, pool, `INSERT INTO connect_verification (user_id, level, status) VALUES ($1::uuid,'l1','approved')`, subjU)
	// A mutual match + a conversation + a subject-authored message.
	a, b := subjP, partP
	if b < a {
		a, b = b, a
	}
	var matchID string
	mustScan(t, ctx, pool, `INSERT INTO connect_matches (profile_a,profile_b,status) VALUES ($1,$2,'matched') RETURNING id`, &matchID, a, b)
	var convID string
	mustScan(t, ctx, pool, `INSERT INTO connect_conversations (match_id) VALUES ($1) RETURNING id`, &convID, matchID)
	mustExec(t, ctx, pool, `INSERT INTO connect_messages (conversation_id, sender_id, body) VALUES ($1,$2::uuid,'my secret message')`, convID, subjU)

	// Delete the subject's account (self-serve).
	svc := connectaccount.NewService(pool)
	res, err := svc.DeleteAccount(ctx, subjU, subjU)
	if err != nil {
		t.Fatalf("delete account: %v", err)
	}
	if res.AlreadyDeleted {
		t.Fatalf("first delete should not report AlreadyDeleted")
	}

	// PII anonymised + marked deleted.
	var name string
	var bio, city *string
	var deletedAt *string
	row := pool.QueryRow(ctx, `SELECT display_name, bio, city, deleted_at::text FROM connect_profiles WHERE user_id=$1::uuid`, subjU)
	if err := row.Scan(&name, &bio, &city, &deletedAt); err != nil {
		t.Fatalf("read profile: %v", err)
	}
	if name != "Deleted user" || bio != nil || city != nil || deletedAt == nil {
		t.Errorf("profile not anonymised: name=%q bio=%v city=%v deleted_at=%v", name, bio, city, deletedAt)
	}

	// Removed from discovery (partner's deck no longer shows the subject).
	if resp, err := connectdiscovery.NewService(pool).Discovery(ctx, partU, "dating"); err != nil {
		t.Fatalf("discovery: %v", err)
	} else {
		for _, c := range resp.Candidates {
			if c.ProfileID == subjP {
				t.Errorf("deleted subject still surfaces in partner's deck")
			}
		}
	}

	// Match ended gracefully; partner can no longer message.
	assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_matches WHERE id=$1 AND status='unmatched'`, matchID)
	chat := connectchat.NewService(pool, connecttrust.NewConfigReader(pool), connecttrust.NewShieldStore(pool, connecttrust.NewConfigReader(pool), connectsafety.NewService(pool)), connectsafety.NewService(pool))
	if _, err := chat.SendMessage(ctx, convID, partU, connectchat.SendMessageRequest{Body: "you there?"}); !errors.Is(err, connectchat.ErrNoMatch) {
		t.Errorf("partner messaging deleted user: want ErrNoMatch (match ended), got %v", err)
	}

	// Message content redacted; media + verification erased.
	assertCount(t, ctx, pool, 0, `SELECT count(*) FROM connect_messages WHERE sender_id=$1::uuid AND body <> ''`, subjU)
	assertCount(t, ctx, pool, 0, `SELECT count(*) FROM connect_profile_media WHERE profile_id=$1`, subjP)
	assertCount(t, ctx, pool, 0, `SELECT count(*) FROM connect_verification WHERE user_id=$1::uuid`, subjU)
	// Professional profile redacted + hidden.
	assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_professional_profiles WHERE user_id=$1::uuid AND visible=false AND headline IS NULL`, subjU)
	// Immutable audit entry written.
	assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_audit_log WHERE action='connect.account.delete' AND entity_id=$1`, subjU)

	// Idempotent: a second delete is a safe no-op.
	res2, err := svc.DeleteAccount(ctx, subjU, subjU)
	if err != nil {
		t.Fatalf("second delete: %v", err)
	}
	if !res2.AlreadyDeleted {
		t.Errorf("second delete should report AlreadyDeleted")
	}
}

func mustExec(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func mustScan(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sql string, dest *string, args ...any) {
	t.Helper()
	if dest == nil {
		return
	}
	if err := pool.QueryRow(ctx, sql, args...).Scan(dest); err != nil {
		t.Fatalf("scan %q: %v", sql, err)
	}
}

func assertCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, want int, sql string, args ...any) {
	t.Helper()
	var got int
	if err := pool.QueryRow(ctx, sql, args...).Scan(&got); err != nil {
		t.Fatalf("count %q: %v", sql, err)
	}
	if got != want {
		t.Errorf("count %q = %d, want %d", sql, got, want)
	}
}

// --- PAY-007 refund test scaffolding ---

type testRefunder struct{ led *ledger.Service }

func (r testRefunder) Refund(ctx context.Context, userID, reference, idem string, amountKobo int64) error {
	rev, err := r.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return err
	}
	w, err := r.led.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return err
	}
	err = r.led.PostJournal(ctx, ledger.JournalEntry{
		Reference: reference, IdempotencyKey: idem, AmountKobo: amountKobo,
		DebitAccountID: rev.ID, CreditAccountID: w.ID,
	})
	if errors.Is(err, ledger.ErrDuplicate) {
		return nil
	}
	return err
}

type noopMoneyAudit struct{}

func (noopMoneyAudit) WriteAudit(context.Context, string, string, string, string, map[string]any) error {
	return nil
}

func seedPaidOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, amount int64) string {
	t.Helper()
	var planID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO connect_plans (code, kind, name, price_kobo) VALUES ($1,'boost','Test Boost',$2) RETURNING id`,
		"boost-"+userID[:8], amount).Scan(&planID); err != nil {
		t.Fatalf("seed plan: %v", err)
	}
	var orderID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO connect_orders (user_id, plan_id, plan_code, kind, amount_kobo, status, idempotency_key, ledger_ref)
		 VALUES ($1::uuid,$2,$3,'boost',$4,'paid',$5,$6) RETURNING id`,
		userID, planID, "boost-"+userID[:8], amount, "buy-"+userID[:8], "connect:boost:test").Scan(&orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_entitlements (user_id, plan_code, kind, source_order, active) VALUES ($1::uuid,$2,'boost',$3,true)`,
		userID, "boost-"+userID[:8], orderID); err != nil {
		t.Fatalf("seed entitlement: %v", err)
	}
	return orderID
}

// TestConnectRefundSafeAndSingle pins PAY-007: refunding a paid order returns the
// EXACT amount to the wallet once, marks the order refunded, revokes the
// entitlement, and is idempotent + single under retries AND concurrency.
func TestConnectRefundSafeAndSingle(t *testing.T) {
	pool := blockLiveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := connectmonetization.NewService(pool, nil, nil, noopMoneyAudit{}, testRefunder{led: led})

	const amount int64 = 50000

	cleanupOrder := func(userID, orderID string) {
		_, _ = pool.Exec(ctx, `DELETE FROM connect_entitlements WHERE user_id=$1::uuid`, userID)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_orders WHERE user_id=$1::uuid`, userID)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_plans WHERE code=$1`, "boost-"+userID[:8])
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1::uuid`, userID)
	}

	t.Run("idempotent_retry_refunds_once", func(t *testing.T) {
		uid, _ := seedProfile(t, ctx, pool)
		orderID := seedPaidOrder(t, ctx, pool, uid, amount)
		t.Cleanup(func() {
			_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE user_id=$1::uuid`, uid)
			cleanupOrder(uid, orderID)
		})

		before, _ := led.GetBalance(ctx, uid)
		if _, err := svc.Refund(ctx, orderID, "admin-1", "test refund"); err != nil {
			t.Fatalf("refund: %v", err)
		}
		after, _ := led.GetBalance(ctx, uid)
		if after-before != amount {
			t.Errorf("wallet delta = %d, want %d (exact refund)", after-before, amount)
		}
		// Order refunded, entitlement revoked.
		assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_orders WHERE id=$1 AND status='refunded'`, orderID)
		assertCount(t, ctx, pool, 0, `SELECT count(*) FROM connect_entitlements WHERE source_order=$1 AND active=true`, orderID)

		// Retry — must NOT credit again.
		if _, err := svc.Refund(ctx, orderID, "admin-1", "retry"); err != nil {
			t.Fatalf("second refund: %v", err)
		}
		after2, _ := led.GetBalance(ctx, uid)
		if after2 != after {
			t.Errorf("second refund changed balance %d→%d — not single", after, after2)
		}
	})

	t.Run("concurrent_double_refund_credits_once", func(t *testing.T) {
		uid, _ := seedProfile(t, ctx, pool)
		orderID := seedPaidOrder(t, ctx, pool, uid, amount)
		t.Cleanup(func() {
			_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE user_id=$1::uuid`, uid)
			cleanupOrder(uid, orderID)
		})

		before, _ := led.GetBalance(ctx, uid)
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		for i := 0; i < 2; i++ {
			go func() { defer wg.Done(); <-start; _, _ = svc.Refund(ctx, orderID, "admin-1", "race") }()
		}
		close(start)
		wg.Wait()
		after, _ := led.GetBalance(ctx, uid)
		if after-before != amount {
			t.Errorf("concurrent refund credited %d, want exactly %d (single)", after-before, amount)
		}
	})
}

// --- PAY-006 billing-cycle scaffolding ---

type scriptedWallet struct {
	err   error
	calls int
}

func (w *scriptedWallet) Debit(ctx context.Context, userID, reference, idem, creditAccountID string, amountKobo int64) error {
	w.calls++
	return w.err
}

type fixedRevenue struct{ led *ledger.Service }

func (r fixedRevenue) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// seedSubscription seeds a plan + paid order + active subscription entitlement with
// an explicit billing window, returning the entitlement id.
func seedSubscription(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, priceKobo int64, granted, expires time.Time) (planCode, entID, orderID string) {
	t.Helper()
	planCode = "sub-" + userID[:8]
	var planID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO connect_plans (code, kind, name, price_kobo, interval_days) VALUES ($1,'subscription','Premium',$2,30) RETURNING id`,
		planCode, priceKobo).Scan(&planID); err != nil {
		t.Fatalf("seed plan: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO connect_orders (user_id, plan_id, plan_code, kind, amount_kobo, status, idempotency_key, ledger_ref)
		 VALUES ($1::uuid,$2,$3,'subscription',$4,'paid',$5,'connect:sub:test') RETURNING id`,
		userID, planID, planCode, priceKobo, "buysub-"+userID[:8]).Scan(&orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO connect_entitlements (user_id, plan_code, kind, granted_at, expires_at, source_order, active, auto_renew)
		 VALUES ($1::uuid,$2,'subscription',$3,$4,$5,true,true) RETURNING id`,
		userID, planCode, granted, expires, orderID).Scan(&entID); err != nil {
		t.Fatalf("seed entitlement: %v", err)
	}
	return planCode, entID, orderID
}

// TestConnectSubscriptionBillingCycle pins PAY-006: end-of-period cancel keeps
// access + stops renewal; immediate cancel deactivates now + refunds unused time
// pro-rata; the renewal batch charges once & extends; and lapses on no funds.
func TestConnectSubscriptionBillingCycle(t *testing.T) {
	pool := blockLiveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)

	cleanup := func(uid string) func() {
		return func() {
			_, _ = pool.Exec(ctx, `DELETE FROM connect_entitlements WHERE user_id=$1::uuid`, uid)
			_, _ = pool.Exec(ctx, `DELETE FROM connect_orders WHERE user_id=$1::uuid`, uid)
			_, _ = pool.Exec(ctx, `DELETE FROM connect_plans WHERE code=$1`, "sub-"+uid[:8])
			_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE user_id=$1::uuid`, uid)
			_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1::uuid`, uid)
		}
	}

	t.Run("cancel_end_of_period_keeps_access", func(t *testing.T) {
		uid, _ := seedProfile(t, ctx, pool)
		t.Cleanup(cleanup(uid))
		exp := time.Now().UTC().AddDate(0, 0, 20)
		_, entID, _ := seedSubscription(t, ctx, pool, uid, 310000, time.Now().UTC().AddDate(0, 0, -10), exp)
		svc := connectmonetization.NewService(pool, &scriptedWallet{}, fixedRevenue{led}, noopMoneyAudit{}, testRefunder{led})

		res, err := svc.CancelSubscription(ctx, uid, false)
		if err != nil {
			t.Fatalf("cancel: %v", err)
		}
		if res.Immediate || res.ProratedRefundKobo != 0 {
			t.Errorf("end-of-period cancel should not refund, got %+v", res)
		}
		// auto_renew off, canceled_at set, but still active until expiry.
		assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_entitlements WHERE id=$1 AND active=true AND auto_renew=false AND canceled_at IS NOT NULL`, entID)
	})

	t.Run("cancel_immediate_prorates_refund", func(t *testing.T) {
		uid, _ := seedProfile(t, ctx, pool)
		t.Cleanup(cleanup(uid))
		// Half the 30-ish day period elapsed.
		granted := time.Now().UTC().AddDate(0, 0, -15)
		exp := time.Now().UTC().AddDate(0, 0, 15)
		_, entID, _ := seedSubscription(t, ctx, pool, uid, 300000, granted, exp)
		svc := connectmonetization.NewService(pool, &scriptedWallet{}, fixedRevenue{led}, noopMoneyAudit{}, testRefunder{led})

		before, _ := led.GetBalance(ctx, uid)
		res, err := svc.CancelSubscription(ctx, uid, true)
		if err != nil {
			t.Fatalf("immediate cancel: %v", err)
		}
		if res.ProratedRefundKobo <= 0 || res.ProratedRefundKobo >= 300000 {
			t.Errorf("prorated refund %d should be strictly between 0 and full price", res.ProratedRefundKobo)
		}
		after, _ := led.GetBalance(ctx, uid)
		if after-before != res.ProratedRefundKobo {
			t.Errorf("wallet credited %d, want %d (prorated)", after-before, res.ProratedRefundKobo)
		}
		assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_entitlements WHERE id=$1 AND active=false`, entID)
	})

	t.Run("auto_renew_charges_once_and_extends", func(t *testing.T) {
		uid, _ := seedProfile(t, ctx, pool)
		t.Cleanup(cleanup(uid))
		oldExp := time.Now().UTC().AddDate(0, 0, -1) // due (past expiry)
		_, entID, _ := seedSubscription(t, ctx, pool, uid, 310000, oldExp.AddDate(0, 0, -30), oldExp)
		w := &scriptedWallet{} // charge succeeds
		svc := connectmonetization.NewService(pool, w, fixedRevenue{led}, noopMoneyAudit{}, testRefunder{led})

		rep, err := svc.ProcessRenewals(ctx, time.Now().UTC())
		if err != nil {
			t.Fatalf("renewals: %v", err)
		}
		if rep.Renewed < 1 || w.calls < 1 {
			t.Errorf("expected a renewal charge, got report=%+v calls=%d", rep, w.calls)
		}
		// Expiry extended ~30d into the future (no longer due).
		assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_entitlements WHERE id=$1 AND active=true AND expires_at > now()`, entID)
		// A renewal order was recorded.
		assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_orders WHERE user_id=$1::uuid AND kind='subscription' AND ledger_ref LIKE 'connect:renew:%'`, uid)
		// Idempotent: a second run finds nothing due, no extra charge.
		callsBefore := w.calls
		rep2, _ := svc.ProcessRenewals(ctx, time.Now().UTC())
		if rep2.Due != 0 || w.calls != callsBefore {
			t.Errorf("second run should be a no-op, got due=%d extra charges=%d", rep2.Due, w.calls-callsBefore)
		}
	})

	t.Run("auto_renew_lapses_on_insufficient_funds", func(t *testing.T) {
		uid, _ := seedProfile(t, ctx, pool)
		t.Cleanup(cleanup(uid))
		oldExp := time.Now().UTC().AddDate(0, 0, -1)
		_, entID, _ := seedSubscription(t, ctx, pool, uid, 310000, oldExp.AddDate(0, 0, -30), oldExp)
		w := &scriptedWallet{err: errors.New("ledger: insufficient funds")}
		svc := connectmonetization.NewService(pool, w, fixedRevenue{led}, noopMoneyAudit{}, testRefunder{led})

		rep, err := svc.ProcessRenewals(ctx, time.Now().UTC())
		if err != nil {
			t.Fatalf("renewals: %v", err)
		}
		if rep.Lapsed < 1 {
			t.Errorf("expected a lapse on insufficient funds, got %+v", rep)
		}
		assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_entitlements WHERE id=$1 AND active=false`, entID)
	})
}

// TestConnectCreditsNoDoubleSpend pins PAY-008: consumable credits can't be
// double-spent or driven negative, grants + consumes are idempotent, and under
// concurrent spends exactly the available number succeed.
func TestConnectCreditsNoDoubleSpend(t *testing.T) {
	pool := blockLiveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	uid, _ := seedProfile(t, ctx, pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM connect_credit_txns WHERE user_id=$1::uuid`, uid)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_credits WHERE user_id=$1::uuid`, uid)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE user_id=$1::uuid`, uid)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1::uuid`, uid)
	})
	cr := connectcredits.NewService(pool)
	const ct = "super_like"

	// Grant 5 — and prove the grant is idempotent under the same key.
	if err := cr.Grant(ctx, uid, ct, uid+":grant-1", 5, "test"); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if err := cr.Grant(ctx, uid, ct, uid+":grant-1", 5, "dup"); err != nil {
		t.Fatalf("dup grant: %v", err)
	}
	if b, _ := cr.Balance(ctx, uid, ct); b != 5 {
		t.Fatalf("balance after idempotent grant = %d, want 5", b)
	}

	// Fire 10 concurrent single-credit spends with distinct keys → exactly 5 win.
	const attempts = 10
	start := make(chan struct{})
	results := make(chan error, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			<-start
			results <- cr.Consume(ctx, uid, ct, fmt.Sprintf("%s:spend-%d", uid, n), 1, "swipe")
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	var ok, insufficient, other int
	for err := range results {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, connectcredits.ErrInsufficientCredits):
			insufficient++
		default:
			other++
		}
	}
	if ok != 5 || insufficient != attempts-5 || other != 0 {
		t.Errorf("concurrent spend: ok=%d insufficient=%d other=%d, want ok=5 insufficient=%d", ok, insufficient, other, attempts-5)
	}
	// Balance is exactly zero — never negative, never oversold.
	if b, _ := cr.Balance(ctx, uid, ct); b != 0 {
		t.Errorf("balance after spends = %d, want 0", b)
	}
	// A fresh spend at zero balance is refused (no negative).
	if err := cr.Consume(ctx, uid, ct, uid+":spend-new", 1, "overdraw"); !errors.Is(err, connectcredits.ErrInsufficientCredits) {
		t.Errorf("spend at zero balance: want ErrInsufficientCredits, got %v", err)
	}

	// Idempotency, isolated on a fresh credit type: the SAME key never spends twice.
	const ct2 = "inmail"
	if err := cr.Grant(ctx, uid, ct2, uid+":grant-inmail", 1, "test"); err != nil {
		t.Fatalf("grant inmail: %v", err)
	}
	if err := cr.Consume(ctx, uid, ct2, uid+":c1", 1, "use"); err != nil {
		t.Fatalf("first consume: %v", err)
	}
	if err := cr.Consume(ctx, uid, ct2, uid+":c1", 1, "replay"); err != nil { // same key → idempotent no-op
		t.Errorf("idempotent replay consume should succeed, got %v", err)
	}
	if b, _ := cr.Balance(ctx, uid, ct2); b != 0 {
		t.Errorf("inmail balance after idempotent replay = %d, want 0", b)
	}
}

// TestConnectSuperLikeRequiresCredit pins PAY-003: a super-like is gated on a
// super-like credit — a free user (no credits) is blocked with ErrNeedsCredits and
// records no like, while a plain like needs no credit.
func TestConnectSuperLikeRequiresCredit(t *testing.T) {
	pool := blockLiveDBPool(t)
	defer pool.Close()
	ctx := context.Background()

	liker, likerP := seedProfile(t, ctx, pool)
	_, t1 := seedProfile(t, ctx, pool)
	_, t2 := seedProfile(t, ctx, pool)
	t.Cleanup(func() {
		users := []any{liker}
		profs := []any{likerP, t1, t2}
		_, _ = pool.Exec(ctx, `DELETE FROM connect_matches WHERE profile_a=ANY($1) OR profile_b=ANY($1)`, profs)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_likes WHERE from_profile=ANY($1) OR to_profile=ANY($1)`, profs)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_credit_txns WHERE user_id=ANY($1::uuid[])`, users)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_credits WHERE user_id=ANY($1::uuid[])`, users)
		for _, p := range profs {
			_, _ = pool.Exec(ctx, `DELETE FROM connect_profiles WHERE id=$1`, p)
		}
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=ANY((SELECT ARRAY(SELECT user_id FROM connect_profiles WHERE id=ANY($1)))::uuid[])`, profs)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1::uuid`, liker)
	})

	cr := connectcredits.NewService(pool)
	m := connectmatching.NewService(pool)
	m.SetCreditConsumer(cr)

	// Free user: super-like is refused and records NO like.
	if _, err := m.Like(ctx, liker, t1, "super"); !errors.Is(err, connectmatching.ErrNeedsCredits) {
		t.Fatalf("free super-like: want ErrNeedsCredits, got %v", err)
	}
	assertCount(t, ctx, pool, 0, `SELECT count(*) FROM connect_likes WHERE from_profile=$1`, likerP)

	// Grant one super-like credit → super-like now succeeds and spends the credit.
	if err := cr.Grant(ctx, liker, "super_like", liker+":grant", 1, "test"); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if _, err := m.Like(ctx, liker, t1, "super"); err != nil {
		t.Fatalf("credited super-like should succeed: %v", err)
	}
	assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_likes WHERE from_profile=$1 AND to_profile=$2`, likerP, t1)
	if b, _ := cr.Balance(ctx, liker, "super_like"); b != 0 {
		t.Errorf("super_like balance after spend = %d, want 0", b)
	}

	// Out of credits: a super-like to a new target is refused again.
	if _, err := m.Like(ctx, liker, t2, "super"); !errors.Is(err, connectmatching.ErrNeedsCredits) {
		t.Errorf("out-of-credits super-like: want ErrNeedsCredits, got %v", err)
	}
	// But a plain like needs no credit.
	if _, err := m.Like(ctx, liker, t2, "like"); err != nil {
		t.Errorf("plain like should not need credits: %v", err)
	}
	assertCount(t, ctx, pool, 1, `SELECT count(*) FROM connect_likes WHERE from_profile=$1 AND to_profile=$2`, likerP, t2)
}

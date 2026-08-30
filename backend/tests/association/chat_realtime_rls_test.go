package association_test

// ---------------------------------------------------------------------------
// The chat-realtime RLS gate must agree with the API gate.
//
// WHY THIS EXISTS
// ---------------
// /association/chat could send and read messages but never received one live:
// assoc_chat_messages was absent from the `supabase_realtime` publication, and
// RLS was enabled on it with zero policies, so Realtime — which evaluates RLS as
// the subscribing user — delivered nothing.
//
// Publishing the table means message rows now leave the database through a
// second path, one the Go service does not mediate. Who may read a thread is NOT
// simply "a member of the organisation": GetChatThreads / GetChatThread /
// SendChatMessage additionally require a role for EXECUTIVE threads and
// committee membership for COMMITTEE threads (the CM-002 / CH-005 defects).
// A policy checking only organisation membership would be a SUPERSET of that,
// and realtime payloads carry the message BODY — so an ordinary member would
// receive the text of executive and committee messages the API hides.
//
// assoc_can_read_chat_thread() is that gate expressed once. These tests pin it
// against the API for the same users and threads, so the two cannot drift apart
// silently: a change to one that is not made in the other fails here.
//
// Live-DB, same harness as founder_and_scoping_test.go: skipped without
// TEST_DATABASE_URL.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/association"
)

// canReadViaRLS asks the SQL gate the policy uses.
func canReadViaRLS(t *testing.T, ctx context.Context, pool *pgxpool.Pool, threadID, userID string) bool {
	t.Helper()
	var ok bool
	if err := pool.QueryRow(ctx,
		`SELECT public.assoc_can_read_chat_thread($1::uuid, $2::uuid)`, threadID, userID).Scan(&ok); err != nil {
		t.Fatalf("assoc_can_read_chat_thread: %v", err)
	}
	return ok
}

// canReadViaAPI asks the Go service the same question, by checking whether the
// thread appears in the caller's own thread list.
func canReadViaAPI(t *testing.T, ctx context.Context, svc *association.Service, userID, threadID string) bool {
	t.Helper()
	threads, err := svc.GetChatThreads(ctx, userID)
	if err != nil {
		// A user with no membership at all has no primary membership; that is a
		// "cannot read" answer, not a test failure.
		return false
	}
	for _, th := range threads {
		if th.ID == threadID {
			return true
		}
	}
	return false
}

// seedMember inserts an ACTIVE membership and returns its id.
func seedMember(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID, email string) (userID, membershipID string) {
	t.Helper()
	userID = uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+email); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO assoc_memberships (organisation_id, user_id, member_code, status, payment_standing, joined_at)
		VALUES ($1,$2,$3,'ACTIVE','PAID',now()) RETURNING id::text`,
		orgID, userID, "T-"+userID[:8]).Scan(&membershipID); err != nil {
		t.Fatalf("seed membership: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_committee_members WHERE membership_id=$1`, membershipID)
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_member_roles WHERE membership_id=$1`, membershipID)
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_memberships WHERE id=$1`, membershipID)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, userID)
	})
	return userID, membershipID
}

// seedThread inserts a chat thread of the given scope.
func seedThread(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID, scope string, committeeID *string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO assoc_chat_threads (organisation_id, title, scope, committee_id)
		VALUES ($1,$2,$3,$4) RETURNING id::text`,
		orgID, scope+" thread", scope, committeeID).Scan(&id); err != nil {
		t.Fatalf("seed thread: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_chat_thread_state WHERE thread_id=$1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_chat_messages WHERE thread_id=$1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_chat_threads WHERE id=$1`, id)
	})
	return id
}

// TestChatRealtimeGate_MatchesTheAPI is the anti-drift test: for every
// (user, thread) pair, the SQL gate and the API must give the same answer.
func TestChatRealtimeGate_MatchesTheAPI(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	// Founder publishes the org; publishing makes them SUPER_ADMIN, so they hold
	// a role and can see EXECUTIVE threads.
	founderID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		founderID, founderID+"@chatgate.test"); err != nil {
		t.Fatalf("seed founder: %v", err)
	}
	res, err := svc.PublishOrganisation(ctx, founderID, newTestDraft("Chat Gate "+uuid.NewString()[:8]))
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	orgID := res.OrganisationID

	// A plain member: ACTIVE, no role, not on any committee.
	plainID, plainMembership := seedMember(t, ctx, pool, orgID, "@plain.test")

	// A committee, with the plain member NOT on it and a second member on it.
	var committeeID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO assoc_committees (organisation_id, name) VALUES ($1,'Gate Committee') RETURNING id::text`,
		orgID).Scan(&committeeID); err != nil {
		t.Fatalf("seed committee: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM assoc_committees WHERE id=$1`, committeeID) })

	committeeUserID, committeeMembership := seedMember(t, ctx, pool, orgID, "@cmte.test")
	if _, err := pool.Exec(ctx,
		`INSERT INTO assoc_committee_members (committee_id, membership_id, status, joined_at) VALUES ($1,$2,'ACTIVE',now())`,
		committeeID, committeeMembership); err != nil {
		t.Fatalf("seed committee member: %v", err)
	}

	// An outsider: a real user with no membership in this organisation.
	outsiderID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		outsiderID, outsiderID+"@outsider.test"); err != nil {
		t.Fatalf("seed outsider: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, outsiderID) })

	general := seedThread(t, ctx, pool, orgID, "GENERAL", nil)
	executive := seedThread(t, ctx, pool, orgID, "EXECUTIVE", nil)
	committee := seedThread(t, ctx, pool, orgID, "COMMITTEE", &committeeID)

	_ = plainMembership

	cases := []struct {
		name     string
		userID   string
		threadID string
		want     bool
	}{
		{"founder reads general", founderID, general, true},
		{"founder reads executive (holds a role)", founderID, executive, true},
		{"plain member reads general", plainID, general, true},
		{"plain member CANNOT read executive", plainID, executive, false},
		{"plain member CANNOT read committee they are not on", plainID, committee, false},
		{"committee member reads their committee thread", committeeUserID, committee, true},
		{"committee member CANNOT read executive", committeeUserID, executive, false},
		{"outsider reads nothing", outsiderID, general, false},
		{"outsider reads no executive", outsiderID, executive, false},
		{"outsider reads no committee", outsiderID, committee, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			viaRLS := canReadViaRLS(t, ctx, pool, tc.threadID, tc.userID)
			if viaRLS != tc.want {
				t.Errorf("assoc_can_read_chat_thread = %v, want %v — realtime would %s",
					viaRLS, tc.want,
					map[bool]string{true: "deliver a message it must not", false: "withhold a message it should deliver"}[viaRLS])
			}

			// Parity: whatever the policy answers, the API must answer the same.
			// This is the assertion that stops the two definitions drifting.
			viaAPI := canReadViaAPI(t, ctx, svc, tc.userID, tc.threadID)
			if viaAPI != viaRLS {
				t.Errorf("API says %v but the realtime policy says %v — the two gates have drifted, "+
					"and realtime is not mediated by the API", viaAPI, viaRLS)
			}
		})
	}
}

// TestChatRealtimeGate_RejectsUnknownThread pins the fail-closed default: an id
// that resolves to nothing must answer false, not error and not true.
func TestChatRealtimeGate_RejectsUnknownThread(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	if canReadViaRLS(t, ctx, pool, uuid.NewString(), uuid.NewString()) {
		t.Error("a nonexistent thread must not be readable")
	}
}

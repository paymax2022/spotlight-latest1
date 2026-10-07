package propertyroles_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/property/roles"
)

// svcFixture registers cleanup BEFORE and AFTER so a crashed earlier run cannot
// leave rows behind that make Register return a stale profile.
func svcFixture(t *testing.T) (*roles.Service, *pgxpool.Pool, context.Context, string) {
	t.Helper()
	pool := propertyPool(t)
	ctx := context.Background()
	uid := anyUser(t, ctx, pool)
	clean := func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.property_role_profiles WHERE display_name = $1`, fixtureName)
	}
	clean()
	t.Cleanup(clean)
	return roles.NewService(roles.NewRepository(pool)), pool, ctx, uid
}

func agentDetails() map[string]any {
	return map[string]any{"licenceNumber": "FRCN-001", "operatingStates": []any{"Lagos"}}
}

func doc(uid string) string { return roles.DocumentKeyPrefix(uid, roles.RoleAgent) + "k1" }

// verifiedAgent drives a fresh agent profile all the way to verified.
func verifiedAgent(t *testing.T, s *roles.Service, ctx context.Context, uid string) *roles.Profile {
	t.Helper()
	p, err := s.Register(ctx, uid, roles.RoleAgent, fixtureName)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, err = s.Update(ctx, uid, roles.RoleAgent, nil, agentDetails()); err != nil {
		t.Fatalf("update: %v", err)
	}
	if _, err = s.AddDocument(ctx, uid, roles.RoleAgent, "agent_licence", doc(uid)); err != nil {
		t.Fatalf("doc: %v", err)
	}
	if _, err = s.Submit(ctx, uid, roles.RoleAgent); err != nil {
		t.Fatalf("submit: %v", err)
	}
	p, err = s.Approve(ctx, uid, p.ID)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	return p
}

func eventCount(t *testing.T, pool *pgxpool.Pool, profileID, action string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.property_role_events WHERE profile_id=$1 AND action=$2`, profileID, action).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRegister_ConcurrentCallsYieldOneRow(t *testing.T) {
	s, pool, ctx, uid := svcFixture(t)
	const n = 12
	var wg sync.WaitGroup
	errs := make(chan error, n)
	ids := make(chan string, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := s.Register(ctx, uid, roles.RoleAgent, fixtureName)
			if err != nil {
				errs <- err
				return
			}
			ids <- p.ID
		}()
	}
	wg.Wait()
	close(errs)
	close(ids)
	for err := range errs {
		t.Errorf("Register error: %v", err)
	}
	seen := map[string]bool{}
	for id := range ids {
		seen[id] = true
	}
	if len(seen) != 1 {
		t.Fatalf("want 1 distinct id, got %d", len(seen))
	}
	var rows int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM public.property_role_profiles WHERE user_id=$1 AND role=$2`, uid, roles.RoleAgent).Scan(&rows)
	if rows != 1 {
		t.Fatalf("want exactly one row, got %d", rows)
	}
	for id := range seen {
		if c := eventCount(t, pool, id, "registered"); c != 1 {
			t.Fatalf("want exactly one registered event, got %d", c)
		}
	}
}

func TestSubmit_RejectedWhenRequiredDetailsMissingEvenWithDocument(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	if _, err := s.Register(ctx, uid, roles.RoleAgent, fixtureName); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddDocument(ctx, uid, roles.RoleAgent, "agent_licence", doc(uid)); err != nil {
		t.Fatal(err)
	}
	_, err := s.Submit(ctx, uid, roles.RoleAgent)
	if !errors.Is(err, roles.ErrIncomplete) {
		t.Fatalf("want ErrIncomplete, got %v", err)
	}
	var inc *roles.IncompleteError
	if !errors.As(err, &inc) || len(inc.Missing) != 2 {
		t.Fatalf("want 2 missing fields, got %v", err)
	}
}

func TestSubmit_RejectedWithoutDocument(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	if _, err := s.Register(ctx, uid, roles.RoleAgent, fixtureName); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, uid, roles.RoleAgent, nil, agentDetails()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Submit(ctx, uid, roles.RoleAgent); !errors.Is(err, roles.ErrNoDocument) {
		t.Fatalf("want ErrNoDocument, got %v", err)
	}
}

func TestAddDocument_RefusesKeyOutsideCallersPrefix(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	if _, err := s.Register(ctx, uid, roles.RoleAgent, fixtureName); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{
		"property-roles/someone-else/agent/k",
		roles.DocumentKeyPrefix(uid, roles.RoleDeveloper) + "k",
		"other/" + uid + "/agent/k",
		roles.DocumentKeyPrefix(uid, roles.RoleAgent), // prefix alone, no object
	} {
		if _, err := s.AddDocument(ctx, uid, roles.RoleAgent, "agent_licence", k); !errors.Is(err, roles.ErrForeignKey) {
			t.Errorf("key %q: want ErrForeignKey, got %v", k, err)
		}
	}
	if _, err := s.AddDocument(ctx, uid, roles.RoleAgent, "bogus_kind", doc(uid)); err == nil {
		t.Error("unknown document kind must be refused")
	}
	p, err := s.AddDocument(ctx, uid, roles.RoleAgent, "id_document", doc(uid))
	if err != nil || len(p.Documents) != 1 {
		t.Fatalf("own key should be accepted: %v %+v", err, p)
	}
}

func TestApprove_OnlyFromPendingAndNotRestamped(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	p, err := s.Register(ctx, uid, roles.RoleAgent, fixtureName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Approve(ctx, uid, p.ID); !errors.Is(err, roles.ErrBadTransition) {
		t.Fatalf("approve from unverified: want ErrBadTransition, got %v", err)
	}
	p = verifiedAgent(t, s, ctx, uid)
	if p.VerificationStatus != "verified" || p.Status != "active" || p.VerifiedAt == nil || p.VerifiedBy == nil {
		t.Fatalf("bad approved profile: %+v", p)
	}
	first := *p.VerifiedAt
	time.Sleep(20 * time.Millisecond)
	if _, err = s.Approve(ctx, uid, p.ID); !errors.Is(err, roles.ErrBadTransition) {
		t.Fatalf("second approve: want ErrBadTransition, got %v", err)
	}
	mine, _ := s.MyRoles(ctx, uid)
	if len(mine) != 1 || mine[0].VerifiedAt == nil || !mine[0].VerifiedAt.Equal(first) {
		t.Fatalf("verified_at was re-stamped: %+v", mine)
	}
	if _, err = s.Approve(ctx, uid, "00000000-0000-0000-0000-000000000000"); !errors.Is(err, roles.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestReject_RequiresReason(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	p, _ := s.Register(ctx, uid, roles.RoleAgent, fixtureName)
	_, _ = s.Update(ctx, uid, roles.RoleAgent, nil, agentDetails())
	_, _ = s.AddDocument(ctx, uid, roles.RoleAgent, "agent_licence", doc(uid))
	if _, err := s.Submit(ctx, uid, roles.RoleAgent); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reject(ctx, uid, p.ID, "   "); !errors.Is(err, roles.ErrReasonRequired) {
		t.Fatalf("want ErrReasonRequired, got %v", err)
	}
	r, err := s.Reject(ctx, uid, p.ID, "licence unreadable")
	if err != nil || r.VerificationStatus != "rejected" || r.RejectionReason == nil || *r.RejectionReason != "licence unreadable" {
		t.Fatalf("reject: %v %+v", err, r)
	}
	// Rejected users can resubmit.
	r, err = s.Submit(ctx, uid, roles.RoleAgent)
	if err != nil || r.VerificationStatus != "pending" || r.RejectionReason != nil {
		t.Fatalf("resubmit: %v %+v", err, r)
	}
}

func TestUpdate_IdentityFieldOnVerifiedResetsToUnverified(t *testing.T) {
	s, pool, ctx, uid := svcFixture(t)
	p := verifiedAgent(t, s, ctx, uid)
	got, err := s.Update(ctx, uid, roles.RoleAgent, nil, map[string]any{"licenceNumber": "FRCN-999"})
	if err != nil {
		t.Fatal(err)
	}
	if got.VerificationStatus != "unverified" || got.VerifiedAt != nil || got.VerifiedBy != nil {
		t.Fatalf("not reset: %+v", got)
	}
	if ok, _ := s.IsVerified(ctx, uid, roles.RoleAgent); ok {
		t.Fatal("must not be verified after identity change")
	}
	if c := eventCount(t, pool, p.ID, "reset_to_unverified"); c != 1 {
		t.Fatalf("want 1 reset event, got %d", c)
	}
	// Re-sending the SAME licence number is not a change.
	_, _ = s.AddDocument(ctx, uid, roles.RoleAgent, "agent_licence", doc(uid))
	if _, err = s.Submit(ctx, uid, roles.RoleAgent); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Update(ctx, uid, roles.RoleAgent, nil, map[string]any{"licenceNumber": "FRCN-999"})
	if got.VerificationStatus != "pending" {
		t.Fatalf("unchanged identity value must not reset: %+v", got)
	}
	got, _ = s.Update(ctx, uid, roles.RoleAgent, nil, map[string]any{"licenceNumber": "FRCN-1000"})
	if got.VerificationStatus != "unverified" {
		t.Fatalf("pending profile must reset on identity change: %+v", got)
	}
}

func TestUpdate_DisplayNameOnVerifiedKeepsVerification(t *testing.T) {
	s, pool, ctx, uid := svcFixture(t)
	p := verifiedAgent(t, s, ctx, uid)
	n := fixtureName
	got, err := s.Update(ctx, uid, roles.RoleAgent, &n, map[string]any{"bio": "new bio", "agencyName": "Acme"})
	if err != nil {
		t.Fatal(err)
	}
	if got.VerificationStatus != "verified" || got.Status != "active" || got.VerifiedAt == nil {
		t.Fatalf("verification lost: %+v", got)
	}
	if got.Details["bio"] != "new bio" || got.Details["licenceNumber"] != "FRCN-001" {
		t.Fatalf("details not merged: %+v", got.Details)
	}
	if c := eventCount(t, pool, p.ID, "reset_to_unverified"); c != 0 {
		t.Fatalf("unexpected reset event")
	}
	if _, err = s.Update(ctx, uid, roles.RoleAgent, nil, map[string]any{"nope": 1}); !errors.Is(err, roles.ErrDetailsInvalid) {
		t.Fatalf("want ErrDetailsInvalid, got %v", err)
	}
}

func TestSuspended_CannotEditAndIsNotVerified(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	p := verifiedAgent(t, s, ctx, uid)
	if _, err := s.Suspend(ctx, uid, p.ID, "fraud report"); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.IsVerified(ctx, uid, roles.RoleAgent); ok || err != nil {
		t.Fatalf("suspended must not be verified: %v %v", ok, err)
	}
	n := "x"
	if _, err := s.Update(ctx, uid, roles.RoleAgent, &n, nil); !errors.Is(err, roles.ErrSuspended) {
		t.Fatalf("update: want ErrSuspended, got %v", err)
	}
	if _, err := s.AddDocument(ctx, uid, roles.RoleAgent, "agent_licence", doc(uid)); !errors.Is(err, roles.ErrSuspended) {
		t.Fatalf("add doc: want ErrSuspended, got %v", err)
	}
	if _, err := s.Submit(ctx, uid, roles.RoleAgent); !errors.Is(err, roles.ErrSuspended) {
		t.Fatalf("submit: want ErrSuspended, got %v", err)
	}
	if _, err := s.Suspend(ctx, uid, p.ID, "again"); !errors.Is(err, roles.ErrBadTransition) {
		t.Fatalf("double suspend: want ErrBadTransition, got %v", err)
	}
}

func TestIsVerified_FalseForDraftPendingRejectedSuspended_TrueOnlyForVerifiedActive(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	check := func(stage string, want bool) {
		t.Helper()
		got, err := s.IsVerified(ctx, uid, roles.RoleAgent)
		if err != nil || got != want {
			t.Fatalf("%s: got (%v,%v) want %v", stage, got, err, want)
		}
	}
	check("no profile", false)
	p, _ := s.Register(ctx, uid, roles.RoleAgent, fixtureName)
	check("draft", false)
	_, _ = s.Update(ctx, uid, roles.RoleAgent, nil, agentDetails())
	_, _ = s.AddDocument(ctx, uid, roles.RoleAgent, "agent_licence", doc(uid))
	_, _ = s.Submit(ctx, uid, roles.RoleAgent)
	check("pending", false)
	_, _ = s.Reject(ctx, uid, p.ID, "no")
	check("rejected", false)
	_, _ = s.Submit(ctx, uid, roles.RoleAgent)
	_, _ = s.Approve(ctx, uid, p.ID)
	check("verified", true)
	_, _ = s.Suspend(ctx, uid, p.ID, "x")
	check("suspended", false)
	if ok, err := s.IsVerified(ctx, uid, "not-a-role"); ok || err == nil {
		t.Fatalf("invalid role must be (false, err), got (%v, %v)", ok, err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if ok, err := s.IsVerified(cancelled, uid, roles.RoleAgent); ok || err == nil {
		t.Fatalf("db error must be (false, err), got (%v, %v)", ok, err)
	}
}

func TestEvents_WrittenForEveryTransition(t *testing.T) {
	s, pool, ctx, uid := svcFixture(t)
	p := verifiedAgent(t, s, ctx, uid)
	_, _ = s.Suspend(ctx, uid, p.ID, "r")
	for _, a := range []string{"registered", "updated", "submitted", "approved", "suspended"} {
		if c := eventCount(t, pool, p.ID, a); c < 1 {
			t.Errorf("no %q event", a)
		}
	}
	p2 := newDevPending(t, s, ctx, uid)
	_, _ = s.Reject(ctx, uid, p2.ID, "bad cac")
	if c := eventCount(t, pool, p2.ID, "rejected"); c != 1 {
		t.Errorf("rejected event count %d", c)
	}
	var reason *string
	_ = pool.QueryRow(ctx, `SELECT reason FROM public.property_role_events WHERE profile_id=$1 AND action='rejected'`, p2.ID).Scan(&reason)
	if reason == nil || *reason != "bad cac" {
		t.Errorf("reason not recorded: %v", reason)
	}
	list, err := s.ListByVerification(ctx, "rejected", 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, l := range list {
		if l.ID == p2.ID {
			found = true
		}
	}
	if !found {
		t.Error("rejected profile missing from ListByVerification")
	}
	if _, err = s.ListByVerification(ctx, "bogus", 10, 0); err == nil {
		t.Error("invalid status filter must error")
	}
}

func newDevPending(t *testing.T, s *roles.Service, ctx context.Context, uid string) *roles.Profile {
	t.Helper()
	p, err := s.Register(ctx, uid, roles.RoleDeveloper, fixtureName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Update(ctx, uid, roles.RoleDeveloper, nil, map[string]any{"companyName": "C", "cacNumber": "RC1"}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AddDocument(ctx, uid, roles.RoleDeveloper, "cac_certificate", roles.DocumentKeyPrefix(uid, roles.RoleDeveloper)+"c"); err != nil {
		t.Fatal(err)
	}
	if p, err = s.Submit(ctx, uid, roles.RoleDeveloper); err != nil {
		t.Fatal(err)
	}
	return p
}

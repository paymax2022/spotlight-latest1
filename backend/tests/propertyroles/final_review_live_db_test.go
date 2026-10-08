package propertyroles_test

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/property/roles"
)

// ── Final whole-branch review fixes ───────────────────────────────────────

func pendingAgent(t *testing.T, s *roles.Service, ctx context.Context, uid string) *roles.Profile {
	t.Helper()
	if _, err := s.Register(ctx, uid, roles.RoleAgent, fixtureName); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, uid, roles.RoleAgent, nil, agentDetails()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddDocument(ctx, uid, roles.RoleAgent, "agent_licence", doc(uid)); err != nil {
		t.Fatal(err)
	}
	p, err := s.Submit(ctx, uid, roles.RoleAgent)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func updatedAt(t *testing.T, pool *pgxpool.Pool, id string) time.Time {
	t.Helper()
	var at time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT updated_at FROM public.property_role_profiles WHERE id=$1`, id).Scan(&at); err != nil {
		t.Fatal(err)
	}
	return at
}

func TestReview_StaleVersionIsRefused(t *testing.T) {
	s, pool, ctx, uid := svcFixture(t)
	seen := pendingAgent(t, s, ctx, uid)
	// The member edits a non-identity field after the admin loaded the queue.
	time.Sleep(5 * time.Millisecond)
	if _, err := s.Update(ctx, uid, roles.RoleAgent, nil, map[string]any{"bio": "edited after review load"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Approve(ctx, adminID, seen.ID, seen.UpdatedAt); !errors.Is(err, roles.ErrStale) {
		t.Fatalf("approve with stale updatedAt: want ErrStale, got %v", err)
	}
	if _, err := s.Reject(ctx, adminID, seen.ID, "r", seen.UpdatedAt); !errors.Is(err, roles.ErrStale) {
		t.Fatalf("reject with stale updatedAt: want ErrStale, got %v", err)
	}
	mine, _ := s.MyRoles(ctx, uid)
	if mine[0].VerificationStatus != "pending" {
		t.Fatalf("stale review changed state: %+v", mine[0])
	}
	// The current version (as a JSON round-trip would carry it) is accepted.
	cur := updatedAt(t, pool, seen.ID)
	got, err := s.Approve(ctx, adminID, seen.ID, cur.UTC())
	if err != nil || got.VerificationStatus != "verified" {
		t.Fatalf("approve with current updatedAt: %v %+v", err, got)
	}
}

func TestListByVerification_ExcludesSuspended(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	p := pendingAgent(t, s, ctx, uid)
	if _, err := s.Suspend(ctx, adminID, p.ID, ""); err != nil {
		t.Fatal(err)
	}
	list, err := s.ListByVerification(ctx, "pending", 200, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range list {
		if l.ID == p.ID {
			t.Fatal("suspended profile listed in the pending queue")
		}
	}
}

func TestUpdate_CannotBlankRequiredKeyWhenPendingOrVerified(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	pendingAgent(t, s, ctx, uid)
	assertRefused := func(stage string, patch map[string]any, want []string) {
		t.Helper()
		_, err := s.Update(ctx, uid, roles.RoleAgent, nil, patch)
		var inc *roles.IncompleteError
		if !errors.As(err, &inc) || !reflect.DeepEqual(inc.Missing, want) {
			t.Fatalf("%s: want IncompleteError%v, got %v", stage, want, err)
		}
	}
	assertRefused("pending/nil", map[string]any{"operatingStates": nil}, []string{"operatingStates"})
	assertRefused("pending/empty list", map[string]any{"operatingStates": []any{}}, []string{"operatingStates"})
	assertRefused("pending/blank string", map[string]any{"licenceNumber": "  "}, []string{"licenceNumber"})
	mine, _ := s.MyRoles(ctx, uid)
	if mine[0].VerificationStatus != "pending" || mine[0].Details["licenceNumber"] != "FRCN-001" {
		t.Fatalf("refused update changed the row: %+v", mine[0])
	}
	// Approve, then the same patch is refused while verified.
	if _, err := s.Approve(ctx, adminID, mine[0].ID, mine[0].UpdatedAt); err != nil {
		t.Fatal(err)
	}
	assertRefused("verified", map[string]any{"operatingStates": nil}, []string{"operatingStates"})
	// Draft/unverified profiles may still clear required keys.
	if _, err := s.Register(ctx, uid, roles.RoleDeveloper, fixtureName); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, uid, roles.RoleDeveloper, nil, map[string]any{"companyName": "C", "cacNumber": "RC1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, uid, roles.RoleDeveloper, nil, map[string]any{"companyName": nil}); err != nil {
		t.Fatalf("unverified profile must be able to clear a required key: %v", err)
	}
}

func TestUpdate_DeveloperCompanyNameResetsVerification(t *testing.T) {
	s, pool, ctx, uid := svcFixture(t)
	p := newDevPending(t, s, ctx, uid)
	if _, err := s.Approve(ctx, adminID, p.ID, p.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	got, err := s.Update(ctx, uid, roles.RoleDeveloper, nil, map[string]any{"companyName": "Renamed Ltd"})
	if err != nil {
		t.Fatal(err)
	}
	if got.VerificationStatus != "unverified" || got.Status != "draft" || got.VerifiedAt != nil {
		t.Fatalf("companyName change must reset verification: %+v", got)
	}
	if c := eventCount(t, pool, p.ID, "reset_to_unverified"); c != 1 {
		t.Fatalf("want 1 reset event, got %d", c)
	}
	// displayName stays non-identity.
	pendingAgent(t, s, ctx, uid)
	n := fixtureName
	if got, _ = s.Update(ctx, uid, roles.RoleAgent, &n, map[string]any{"agencyName": "New Agency"}); got == nil || got.VerificationStatus != "pending" {
		t.Fatalf("non-identity change must not reset: %+v", got)
	}
}

func TestAddDocument_CappedPerProfile(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	if _, err := s.Register(ctx, uid, roles.RoleAgent, fixtureName); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < roles.MaxDocumentsPerProfile; i++ {
		if _, err := s.AddDocument(ctx, uid, roles.RoleAgent, "id_document", fmt.Sprintf("%sd%d", roles.DocumentKeyPrefix(uid, roles.RoleAgent), i)); err != nil {
			t.Fatalf("doc %d: %v", i, err)
		}
	}
	_, err := s.AddDocument(ctx, uid, roles.RoleAgent, "id_document", roles.DocumentKeyPrefix(uid, roles.RoleAgent)+"over")
	if !errors.Is(err, roles.ErrTooManyDocuments) {
		t.Fatalf("doc %d: want ErrTooManyDocuments, got %v", roles.MaxDocumentsPerProfile+1, err)
	}
	mine, _ := s.MyRoles(ctx, uid)
	if len(mine[0].Documents) != roles.MaxDocumentsPerProfile {
		t.Fatalf("want %d documents, got %d", roles.MaxDocumentsPerProfile, len(mine[0].Documents))
	}
}

func TestEnsureEditable_RequiresExistingNonSuspendedProfile(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	if err := s.EnsureEditable(ctx, uid, roles.RoleAgent); !errors.Is(err, roles.ErrNotFound) {
		t.Fatalf("no profile: want ErrNotFound, got %v", err)
	}
	if err := s.EnsureEditable(ctx, uid, "landlord"); !errors.Is(err, roles.ErrInvalidRole) {
		t.Fatalf("bad role: want ErrInvalidRole, got %v", err)
	}
	p, _ := s.Register(ctx, uid, roles.RoleAgent, fixtureName)
	if err := s.EnsureEditable(ctx, uid, roles.RoleAgent); err != nil {
		t.Fatalf("draft profile: want nil, got %v", err)
	}
	if _, err := s.Suspend(ctx, adminID, p.ID, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureEditable(ctx, uid, roles.RoleAgent); !errors.Is(err, roles.ErrSuspended) {
		t.Fatalf("suspended: want ErrSuspended, got %v", err)
	}
}

func TestDocumentForReview_ScopedToProfile(t *testing.T) {
	s, _, ctx, uid := svcFixture(t)
	agent := pendingAgent(t, s, ctx, uid)
	dev := newDevPending(t, s, ctx, uid)
	mine, _ := s.MyRoles(ctx, uid)
	var agentDoc, devDoc string
	for _, m := range mine {
		switch m.ID {
		case agent.ID:
			agentDoc = m.Documents[0].ID
		case dev.ID:
			devDoc = m.Documents[0].ID
		}
	}
	d, err := s.DocumentForReview(ctx, agent.ID, agentDoc)
	if err != nil || d.ID != agentDoc || d.StorageKey != doc(uid) {
		t.Fatalf("own document: %v %+v", err, d)
	}
	if _, err := s.DocumentForReview(ctx, agent.ID, devDoc); !errors.Is(err, roles.ErrNotFound) {
		t.Fatalf("another profile's document: want ErrNotFound, got %v", err)
	}
	if _, err := s.DocumentForReview(ctx, "not-a-uuid", agentDoc); !errors.Is(err, roles.ErrNotFound) {
		t.Fatalf("bad profile id: want ErrNotFound, got %v", err)
	}
	if _, err := s.DocumentForReview(ctx, agent.ID, "nope"); !errors.Is(err, roles.ErrNotFound) {
		t.Fatalf("bad doc id: want ErrNotFound, got %v", err)
	}
}

func TestUpdate_NoEffectiveChangeWritesNothing(t *testing.T) {
	s, pool, ctx, uid := svcFixture(t)
	p, _ := s.Register(ctx, uid, roles.RoleAgent, fixtureName)
	if _, err := s.Update(ctx, uid, roles.RoleAgent, nil, agentDetails()); err != nil {
		t.Fatal(err)
	}
	before := updatedAt(t, pool, p.ID)
	events := eventCount(t, pool, p.ID, "updated")
	n := fixtureName
	for name, call := range map[string]func() (*roles.Profile, error){
		"empty":       func() (*roles.Profile, error) { return s.Update(ctx, uid, roles.RoleAgent, nil, nil) },
		"same values": func() (*roles.Profile, error) { return s.Update(ctx, uid, roles.RoleAgent, &n, agentDetails()) },
		"delete unset": func() (*roles.Profile, error) {
			return s.Update(ctx, uid, roles.RoleAgent, nil, map[string]any{"bio": nil})
		},
	} {
		got, err := call()
		if err != nil || got == nil || got.ID != p.ID {
			t.Fatalf("%s: %v %+v", name, err, got)
		}
	}
	if c := eventCount(t, pool, p.ID, "updated"); c != events {
		t.Fatalf("no-op patch wrote %d event(s)", c-events)
	}
	if after := updatedAt(t, pool, p.ID); !after.Equal(before) {
		t.Fatalf("no-op patch bumped updated_at %v -> %v", before, after)
	}
}

func TestAddDocument_WritesEventAndBumpsUpdatedAt(t *testing.T) {
	s, pool, ctx, uid := svcFixture(t)
	p, _ := s.Register(ctx, uid, roles.RoleAgent, fixtureName)
	before := updatedAt(t, pool, p.ID)
	time.Sleep(5 * time.Millisecond)
	got, err := s.AddDocument(ctx, uid, roles.RoleAgent, "agent_licence", doc(uid))
	if err != nil {
		t.Fatal(err)
	}
	if !got.UpdatedAt.After(before) {
		t.Fatalf("updated_at not bumped: %v -> %v", before, got.UpdatedAt)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.property_role_events
		WHERE profile_id=$1 AND action='updated' AND reason='document_added'`, p.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("want 1 document_added event, got %d", n)
	}
}

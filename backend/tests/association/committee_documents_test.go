package association_test

// ---------------------------------------------------------------------------
// Committee membership management, and document-vault access.
//
// WHY THIS EXISTS
// ---------------
// A member could ASK to join a committee and nobody could answer: the request
// wrote a PENDING row and there was no endpoint to accept or decline it, add
// anyone directly, remove anyone, or give them a position. The committee member
// list was therefore a list nobody could change.
//
// The document vault had the mirror problem: documents could be listed and
// acknowledged, but the file behind one could not be fetched — the bucket is
// not public, so a stored object key is not a URL.
//
// The properties pinned here are the access ones, because both features hand
// out things that are meant to be scoped: committee membership, and a signed URL
// to an organisation's private documents.
//
// Live-DB, same harness as founder_and_scoping_test.go.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// TestCommitteeRequests_ApproveDeclineAndAuthority covers the whole loop.
func TestCommitteeRequests_ApproveDeclineAndAuthority(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID, adminID, memberID := orgWithAdminAndMember(t, ctx, pool, svc)

	var committeeID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO assoc_committees (organisation_id, name) VALUES ($1,'Welfare') RETURNING id::text`,
		orgID).Scan(&committeeID); err != nil {
		t.Fatalf("seed committee: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_committee_members WHERE committee_id=$1`, committeeID)
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_committees WHERE id=$1`, committeeID)
	})

	var membership string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM assoc_memberships WHERE user_id=$1 AND organisation_id=$2`,
		memberID, orgID).Scan(&membership); err != nil {
		t.Fatalf("membership: %v", err)
	}

	// The member asks to join.
	if err := svc.RequestJoinCommittee(ctx, memberID, committeeID); err != nil {
		t.Fatalf("request join: %v", err)
	}

	// A plain member cannot decide their own request — otherwise asking to join
	// is the same as joining.
	if err := svc.DecideCommitteeRequest(ctx, memberID, committeeID, membership, true); err == nil {
		t.Error("a non-admin must not be able to decide a committee request")
	}

	// The admin approves.
	if err := svc.DecideCommitteeRequest(ctx, adminID, committeeID, membership, true); err != nil {
		t.Fatalf("approve: %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM assoc_committee_members WHERE committee_id=$1 AND membership_id=$2`,
		committeeID, membership).Scan(&status); err != nil {
		t.Fatalf("read membership: %v", err)
	}
	if status != "ACTIVE" {
		t.Errorf("status = %q, want ACTIVE", status)
	}

	// Deciding again is refused: the request is no longer pending.
	if err := svc.DecideCommitteeRequest(ctx, adminID, committeeID, membership, true); err == nil {
		t.Error("deciding an already-decided request must be refused")
	}

	// A position can be set, but only for an ACTIVE member.
	if err := svc.SetCommitteeMemberRole(ctx, adminID, committeeID, membership, "CHAIR"); err != nil {
		t.Fatalf("set role: %v", err)
	}
	if err := svc.SetCommitteeMemberRole(ctx, adminID, committeeID, membership, "EMPEROR"); err == nil {
		t.Error("an unknown committee role must be refused")
	}

	// And removal takes them off entirely.
	if err := svc.RemoveCommitteeMember(ctx, adminID, committeeID, membership); err != nil {
		t.Fatalf("remove: %v", err)
	}
	var left int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM assoc_committee_members WHERE committee_id=$1 AND membership_id=$2`,
		committeeID, membership).Scan(&left); err != nil {
		t.Fatalf("count: %v", err)
	}
	if left != 0 {
		t.Errorf("rows after removal = %d, want 0", left)
	}
}

// TestCommitteeRequests_DeclineLetsThemAskAgain pins why a decline deletes the
// row rather than parking it in a REJECTED state.
func TestCommitteeRequests_DeclineLetsThemAskAgain(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID, adminID, memberID := orgWithAdminAndMember(t, ctx, pool, svc)

	var committeeID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO assoc_committees (organisation_id, name) VALUES ($1,'Finance') RETURNING id::text`,
		orgID).Scan(&committeeID); err != nil {
		t.Fatalf("seed committee: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_committee_members WHERE committee_id=$1`, committeeID)
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_committees WHERE id=$1`, committeeID)
	})
	var membership string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM assoc_memberships WHERE user_id=$1 AND organisation_id=$2`,
		memberID, orgID).Scan(&membership); err != nil {
		t.Fatalf("membership: %v", err)
	}

	if err := svc.RequestJoinCommittee(ctx, memberID, committeeID); err != nil {
		t.Fatalf("request: %v", err)
	}
	if err := svc.DecideCommitteeRequest(ctx, adminID, committeeID, membership, false); err != nil {
		t.Fatalf("decline: %v", err)
	}

	// A persisted REJECTED row would silently block every future request. The
	// member must be able to ask again.
	if err := svc.RequestJoinCommittee(ctx, memberID, committeeID); err != nil {
		t.Fatalf("re-request after a decline: %v — a decline must not lock the member out", err)
	}
}

// TestAddCommitteeMembers_DropsForeignMemberships closes the cross-org write.
func TestAddCommitteeMembers_DropsForeignMemberships(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgA, adminA, _ := orgWithAdminAndMember(t, ctx, pool, svc)

	otherFounder := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		otherFounder, otherFounder+"@cmteother.test"); err != nil {
		t.Fatalf("seed founder: %v", err)
	}
	resB, err := svc.PublishOrganisation(ctx, otherFounder, newTestDraft("CmteOther "+uuid.NewString()[:8]))
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	_, foreign := seedMember(t, ctx, pool, resB.OrganisationID, "@cmteforeign.test")

	var committeeID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO assoc_committees (organisation_id, name) VALUES ($1,'Members only') RETURNING id::text`,
		orgA).Scan(&committeeID); err != nil {
		t.Fatalf("seed committee: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_committee_members WHERE committee_id=$1`, committeeID)
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_committees WHERE id=$1`, committeeID)
	})

	n, err := svc.AddCommitteeMembers(ctx, adminA, committeeID, []string{foreign})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if n != 0 {
		t.Errorf("added = %d, want 0 — a membership from another organisation must not join this committee", n)
	}
}

// TestResolveDocumentDownload_ScopesToTheOrganisation pins the vault's access
// rules: members of the owning organisation only, and admins only for anything
// marked restricted.
func TestResolveDocumentDownload_ScopesToTheOrganisation(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID, adminID, memberID := orgWithAdminAndMember(t, ctx, pool, svc)

	var openDoc, restrictedDoc, filelessDoc string
	seed := func(title, key string, restricted bool) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO assoc_documents (organisation_id, title, category, storage_key, restricted)
			VALUES ($1,$2,'governance',NULLIF($3,''),$4) RETURNING id::text`,
			orgID, title, key, restricted).Scan(&id); err != nil {
			t.Fatalf("seed document: %v", err)
		}
		return id
	}
	openDoc = seed("Constitution", "association/document/"+orgID+"/abc.pdf", false)
	restrictedDoc = seed("Board minutes", "association/document/"+orgID+"/def.pdf", true)
	filelessDoc = seed("Legacy entry", "", false)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM assoc_documents WHERE organisation_id=$1`, orgID) })

	// A member of the organisation can fetch an open document.
	key, err := svc.ResolveDocumentDownload(ctx, memberID, openDoc)
	if err != nil {
		t.Fatalf("member open doc: %v", err)
	}
	if key == "" {
		t.Error("expected a storage key for an open document")
	}

	// A restricted document is admin-only — that is what the flag is for.
	if _, err := svc.ResolveDocumentDownload(ctx, memberID, restrictedDoc); err == nil {
		t.Error("a plain member must not get a download URL for a restricted document")
	}
	if _, err := svc.ResolveDocumentDownload(ctx, adminID, restrictedDoc); err != nil {
		t.Errorf("an admin must be able to fetch a restricted document: %v", err)
	}

	// An outsider gets nothing, and the same answer as for a document that does
	// not exist, so the endpoint does not confirm what it will not serve.
	outsider := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		outsider, outsider+"@docoutsider.test"); err != nil {
		t.Fatalf("seed outsider: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, outsider) })
	if _, err := svc.ResolveDocumentDownload(ctx, outsider, openDoc); err == nil {
		t.Error("an outsider must not get a download URL for another organisation's document")
	}

	// A document with no file is not an error — it exists, it just has nothing
	// to serve, and an empty key is how the handler knows to say so.
	key, err = svc.ResolveDocumentDownload(ctx, memberID, filelessDoc)
	if err != nil {
		t.Errorf("a document with no file must not error: %v", err)
	}
	if key != "" {
		t.Errorf("key = %q, want empty for a document with no file", key)
	}
}

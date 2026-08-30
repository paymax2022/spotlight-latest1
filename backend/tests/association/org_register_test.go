package association_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

// TestListAdminOrganisations_ReturnsRegisterColumnsAndFilters pins the widened
// register row: the console was issuing one extra detail query per visible row
// because acronym/category/status/createdAt were absent, and its published and
// verified filters were client-side (so a filtered page could come back empty
// purely because matches sat on another page).
func TestListAdminOrganisations_ReturnsRegisterColumnsAndFilters(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	founder := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		founder, founder+"@register.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	name := "Register Test " + uuid.New().String()[:8]
	res, err := svc.PublishOrganisation(ctx, founder, newTestDraft(name))
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	rows, err := svc.ListAdminOrganisations(ctx, founder, association.AdminOrgFilter{Search: name})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d; want 1", len(rows))
	}
	r := rows[0]
	if r.ID != res.OrganisationID {
		t.Fatalf("id = %s; want %s", r.ID, res.OrganisationID)
	}
	if r.Acronym == nil || *r.Acronym != "TST" {
		t.Fatalf("acronym = %v; want TST", r.Acronym)
	}
	if r.Category != "Professional" || r.Status != "ACTIVE" || r.CreatedAt == "" {
		t.Fatalf("category=%q status=%q createdAt=%q — register columns not populated", r.Category, r.Status, r.CreatedAt)
	}
	if !r.Published || r.MemberCount != 1 {
		t.Fatalf("published=%v memberCount=%d; want true/1 (the founder)", r.Published, r.MemberCount)
	}

	// Server-side filters must actually narrow.
	no := false
	empty, err := svc.ListAdminOrganisations(ctx, founder, association.AdminOrgFilter{Search: name, Published: &no})
	if err != nil {
		t.Fatalf("filtered list: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("published=false returned %d rows; want 0", len(empty))
	}
	unverified, err := svc.ListAdminOrganisations(ctx, founder, association.AdminOrgFilter{Search: name, Verified: &no})
	if err != nil {
		t.Fatalf("verified filter: %v", err)
	}
	if len(unverified) != 1 {
		t.Fatalf("verified=false returned %d rows; want 1", len(unverified))
	}
}

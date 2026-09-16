package adminext

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// These are PURE tests: every function under test is the decision logic that runs
// before any database access, so they need no pool and no TEST_DATABASE_URL. They
// therefore actually RUN in CI rather than skipping (a package whose tests all
// skip still prints "ok", which is how a dead suite hides).

func boolPtr(b bool) *bool { return &b }

// ─── ACTIVE-only rule ────────────────────────────────────────────────────────

// TestGuardFlagPromotion_ActiveOnly is the core rule: a campaign may only be
// PROMOTED onto a public discovery rail while it is ACTIVE.
func TestGuardFlagPromotion_ActiveOnly(t *testing.T) {
	promotions := map[string]CampaignFlagsRequest{
		"featured": {Featured: boolPtr(true)},
		"trending": {Trending: boolPtr(true)},
		"urgent":   {Urgent: boolPtr(true)},
		"all three": {
			Featured: boolPtr(true), Trending: boolPtr(true), Urgent: boolPtr(true),
		},
	}
	nonActive := []string{"PENDING_REVIEW", "CHANGES_REQUESTED", "REJECTED", "FROZEN", "DRAFT", ""}

	for name, req := range promotions {
		if err := guardFlagPromotion("ACTIVE", req); err != nil {
			t.Fatalf("%s: promoting an ACTIVE campaign must be allowed, got %v", name, err)
		}
		for _, status := range nonActive {
			err := guardFlagPromotion(status, req)
			if !errors.Is(err, ErrCampaignNotActive) {
				t.Fatalf("%s on %q: want ErrCampaignNotActive, got %v", name, status, err)
			}
			// The refusal must name the offending status so the console can say why.
			if status != "" && !strings.Contains(err.Error(), status) {
				t.Fatalf("%s on %q: error should mention the status, got %q", name, status, err.Error())
			}
		}
	}
}

// TestGuardFlagPromotion_DemotionAlwaysAllowed: clearing a flag must work whatever
// the review status, or a campaign frozen while featured would be stuck on the
// public rail with no way off it.
func TestGuardFlagPromotion_DemotionAlwaysAllowed(t *testing.T) {
	demotions := []CampaignFlagsRequest{
		{Featured: boolPtr(false)},
		{Trending: boolPtr(false)},
		{Urgent: boolPtr(false)},
		{Featured: boolPtr(false), Trending: boolPtr(false), Urgent: boolPtr(false)},
	}
	for _, status := range []string{"ACTIVE", "PENDING_REVIEW", "REJECTED", "FROZEN", "CHANGES_REQUESTED"} {
		for i, req := range demotions {
			if err := guardFlagPromotion(status, req); err != nil {
				t.Fatalf("demotion %d on %q must be allowed, got %v", i, status, err)
			}
		}
	}
}

// TestGuardFlagPromotion_MixedBodyRefusedWholesale: a body that both promotes and
// demotes is all-or-nothing. Applying only the demote half would be a silent
// partial success the caller never asked for.
func TestGuardFlagPromotion_MixedBodyRefusedWholesale(t *testing.T) {
	mixed := CampaignFlagsRequest{Featured: boolPtr(true), Urgent: boolPtr(false)}
	if err := guardFlagPromotion("PENDING_REVIEW", mixed); !errors.Is(err, ErrCampaignNotActive) {
		t.Fatalf("mixed promote+demote on a non-ACTIVE campaign must be refused, got %v", err)
	}
	if err := guardFlagPromotion("ACTIVE", mixed); err != nil {
		t.Fatalf("mixed body on an ACTIVE campaign must be allowed, got %v", err)
	}
}

// TestGuardFlagPromotion_EmptyBodyIsNotAPromotion — nothing supplied means nothing
// is promoted, so the status gate must not fire (the emptiness is caught later,
// by the ErrNoFlagsSupplied path).
func TestGuardFlagPromotion_EmptyBodyIsNotAPromotion(t *testing.T) {
	if promotesAnyFlag(CampaignFlagsRequest{}) {
		t.Fatal("an empty body promotes nothing")
	}
	if err := guardFlagPromotion("REJECTED", CampaignFlagsRequest{}); err != nil {
		t.Fatalf("empty body must not trip the ACTIVE gate, got %v", err)
	}
}

// ─── Partial-update semantics ────────────────────────────────────────────────

// TestFlagAssignments_OnlySuppliedKeys is the partial-update contract: an ABSENT
// key (nil pointer) produces no write at all. If this ever regressed to plain
// bools, `{"featured":true}` would also silently set trending=false, urgent=false.
func TestFlagAssignments_OnlySuppliedKeys(t *testing.T) {
	cases := []struct {
		name string
		req  CampaignFlagsRequest
		want []flagAssignment
	}{
		{"empty", CampaignFlagsRequest{}, nil},
		{"featured only true", CampaignFlagsRequest{Featured: boolPtr(true)},
			[]flagAssignment{{"featured", true}}},
		{"trending only false", CampaignFlagsRequest{Trending: boolPtr(false)},
			[]flagAssignment{{"trending", false}}},
		{"urgent only true", CampaignFlagsRequest{Urgent: boolPtr(true)},
			[]flagAssignment{{"urgent", true}}},
		{"featured+urgent, trending untouched",
			CampaignFlagsRequest{Featured: boolPtr(true), Urgent: boolPtr(false)},
			[]flagAssignment{{"featured", true}, {"urgent", false}}},
		{"all three", CampaignFlagsRequest{Featured: boolPtr(false), Trending: boolPtr(true), Urgent: boolPtr(true)},
			[]flagAssignment{{"featured", false}, {"trending", true}, {"urgent", true}}},
	}
	for _, tc := range cases {
		got := flagAssignments(tc.req)
		if len(got) != len(tc.want) {
			t.Fatalf("%s: got %d assignments %v, want %d %v", tc.name, len(got), got, len(tc.want), tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("%s: assignment %d = %+v, want %+v", tc.name, i, got[i], tc.want[i])
			}
		}
	}
}

// TestBuildFlagsUpdate_PartialSQL asserts the rendered UPDATE touches only the
// supplied columns, binds every value, and puts the id last.
func TestBuildFlagsUpdate_PartialSQL(t *testing.T) {
	const id = "11111111-1111-1111-1111-111111111111"

	sql, args, ok := buildFlagsUpdate(id, CampaignFlagsRequest{Featured: boolPtr(true)})
	if !ok {
		t.Fatal("a one-key body must produce an update")
	}
	if want := "UPDATE campaigns SET featured=$1, updated_at=NOW() WHERE id=$2"; sql != want {
		t.Fatalf("sql = %q, want %q", sql, want)
	}
	for _, absent := range []string{"trending", "urgent"} {
		if strings.Contains(sql, absent) {
			t.Fatalf("a featured-only patch must not write %s: %q", absent, sql)
		}
	}
	if len(args) != 2 || args[0] != true || args[1] != id {
		t.Fatalf("args = %v, want [true %s]", args, id)
	}

	sql, args, ok = buildFlagsUpdate(id, CampaignFlagsRequest{Trending: boolPtr(false), Urgent: boolPtr(true)})
	if !ok {
		t.Fatal("a two-key body must produce an update")
	}
	if want := "UPDATE campaigns SET trending=$1, urgent=$2, updated_at=NOW() WHERE id=$3"; sql != want {
		t.Fatalf("sql = %q, want %q", sql, want)
	}
	if strings.Contains(sql, "featured") {
		t.Fatalf("an omitted key must not appear in the SET list: %q", sql)
	}
	if len(args) != 3 || args[0] != false || args[1] != true || args[2] != id {
		t.Fatalf("args = %v, want [false true %s]", args, id)
	}

	if _, _, ok = buildFlagsUpdate(id, CampaignFlagsRequest{}); ok {
		t.Fatal("an empty body must not produce an update statement")
	}
}

// TestSetCampaignFlags_EmptyBodyRejected: the empty-body guard runs before any DB
// access, so a nil pool is safe here — proving it never reaches the database.
func TestSetCampaignFlags_EmptyBodyRejected(t *testing.T) {
	s := NewService(nil)
	_, err := s.SetCampaignFlags(context.Background(),
		"11111111-1111-1111-1111-111111111111", "admin", CampaignFlagsRequest{})
	if !errors.Is(err, ErrNoFlagsSupplied) {
		t.Fatalf("want ErrNoFlagsSupplied, got %v", err)
	}
}

// TestSetCampaignFlags_BlankIDRejected — also pre-DB, so nil pool is safe.
func TestSetCampaignFlags_BlankIDRejected(t *testing.T) {
	s := NewService(nil)
	if _, err := s.SetCampaignFlags(context.Background(), "  ", "admin",
		CampaignFlagsRequest{Featured: boolPtr(true)}); !errors.Is(err, ErrCampaignNotFound) {
		t.Fatalf("want ErrCampaignNotFound, got %v", err)
	}
}

// ─── Audit trail ─────────────────────────────────────────────────────────────

// TestAuditFlagsTarget records exactly which flags moved and to what, so the
// cf_audit_logs row is self-explanatory without re-reading the campaign.
func TestAuditFlagsTarget(t *testing.T) {
	const id = "22222222-2222-2222-2222-222222222222"
	got := auditFlagsTarget(id, CampaignFlagsRequest{Featured: boolPtr(true), Urgent: boolPtr(false)})
	if want := id + " featured=true,urgent=false"; got != want {
		t.Fatalf("audit target = %q, want %q", got, want)
	}
	if got := auditFlagsTarget(id, CampaignFlagsRequest{Trending: boolPtr(true)}); got != id+" trending=true" {
		t.Fatalf("audit target = %q", got)
	}
}

// ─── Discovery coupling ──────────────────────────────────────────────────────

// TestFlagColumnsMatchDiscoveryFilters pins the column names this module writes to
// the ones public discovery reads (internal/crowdfunding/query.go filters on
// c.featured / c.trending / c.urgent). A rename on either side silently empties
// the rails again, which is the exact bug this file exists to fix.
func TestFlagColumnsMatchDiscoveryFilters(t *testing.T) {
	want := []string{"featured", "trending", "urgent"}
	got := flagAssignments(CampaignFlagsRequest{
		Featured: boolPtr(true), Trending: boolPtr(true), Urgent: boolPtr(true),
	})
	if len(got) != len(want) {
		t.Fatalf("got %d columns, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i].Column != want[i] {
			t.Fatalf("column %d = %q, want %q", i, got[i].Column, want[i])
		}
	}
	if reviewStatusActive != "ACTIVE" {
		t.Fatalf("reviewStatusActive = %q, want the campaigns.review_status literal 'ACTIVE'", reviewStatusActive)
	}
}

// TestRegisterAdmin_FeaturedRoutes proves the three new paths are actually mounted
// and that adding them does not panic gin's router. A wildcard conflict
// (/campaigns/:id/flags against the existing /campaigns/:id/* routes) is a
// REGISTRATION-time panic that `go build` cannot see, so it would otherwise only
// surface as a dead API server at boot.
func TestRegisterAdmin_FeaturedRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterAdmin(r.Group("/api/crowdfunding/admin"), nil, nil, nil, &denyAllRBAC{})

	want := map[string]string{
		"GET /api/crowdfunding/admin/featured":              "",
		"GET /api/crowdfunding/admin/featured/report":       "",
		"PATCH /api/crowdfunding/admin/campaigns/:id/flags": "",
	}
	for _, ri := range r.Routes() {
		delete(want, ri.Method+" "+ri.Path)
	}
	for missing := range want {
		t.Fatalf("route not registered: %s", missing)
	}
}

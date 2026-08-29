package crowdfunding

import (
	"strings"
	"testing"
)

func TestReviewTransition(t *testing.T) {
	cases := []struct {
		current, decision, want string
		ok                      bool
	}{
		{"PENDING_REVIEW", "APPROVE", "ACTIVE", true},
		{"CHANGES_REQUESTED", "APPROVE", "ACTIVE", true},
		{"PENDING_REVIEW", "REJECT", "REJECTED", true},
		{"PENDING_REVIEW", "REQUEST_CHANGES", "CHANGES_REQUESTED", true},
		{"ACTIVE", "FREEZE", "FROZEN", true},
		{"FROZEN", "UNFREEZE", "ACTIVE", true},
		// Illegal transitions are rejected:
		{"ACTIVE", "APPROVE", "", false},
		{"REJECTED", "APPROVE", "", false},
		{"COMPLETED", "FREEZE", "", false},
		{"ACTIVE", "REQUEST_CHANGES", "", false},
		{"DRAFT", "APPROVE", "", false},
	}
	for _, c := range cases {
		got, ok := reviewTransition(c.current, c.decision)
		if ok != c.ok || got != c.want {
			t.Errorf("reviewTransition(%q,%q) = (%q,%v), want (%q,%v)", c.current, c.decision, got, ok, c.want, c.ok)
		}
	}
}

func TestBuildDiscoveryWhere_Collection(t *testing.T) {
	where, args := buildDiscoveryWhere(CampaignQuery{Collection: "featured"}, 1)
	if !strings.Contains(where, "c.featured = TRUE") {
		t.Errorf("featured collection missing predicate: %q", where)
	}
	// Public discovery must restrict to ACTIVE.
	if !strings.Contains(where, "review_status = 'ACTIVE'") {
		t.Errorf("public discovery should restrict to ACTIVE: %q", where)
	}
	if len(args) != 0 {
		t.Errorf("collection-only query should have no args, got %d", len(args))
	}
}

// Regression: an UNFILTERED discovery query (no collection/category/search —
// "fetch all active campaigns") must still restrict to ACTIVE. It previously
// fell through with no review_status guard at all, leaking PENDING_REVIEW/
// DRAFT campaigns to any authenticated caller.
func TestBuildDiscoveryWhere_Unfiltered(t *testing.T) {
	where, args := buildDiscoveryWhere(CampaignQuery{}, 1)
	if !strings.Contains(where, "review_status = 'ACTIVE'") {
		t.Errorf("unfiltered discovery should restrict to ACTIVE: %q", where)
	}
	if len(args) != 0 {
		t.Errorf("unfiltered query should have no args, got %d", len(args))
	}
}

// An explicit status filter (admin/internal use) must still override the
// public ACTIVE default rather than being ANDed with it.
func TestBuildDiscoveryWhere_ExplicitStatus(t *testing.T) {
	where, args := buildDiscoveryWhere(CampaignQuery{Status: "PENDING_REVIEW"}, 1)
	if strings.Contains(where, "'ACTIVE'") {
		t.Errorf("explicit status should replace the ACTIVE default, not add to it: %q", where)
	}
	if !strings.Contains(where, "c.review_status = $1") || len(args) != 1 || args[0] != "PENDING_REVIEW" {
		t.Errorf("explicit status predicate/args wrong: where=%q args=%#v", where, args)
	}
}

// Owner-paused campaigns must leave the PUBLIC rails. The pause lives in
// campaigns.paused_at rather than review_status (migration 20270112000000), so
// it needs its own predicate — without it, pause would hide nothing at all.
func TestBuildDiscoveryWhere_ExcludesPaused(t *testing.T) {
	for _, q := range []CampaignQuery{{}, {Collection: "featured"}, {Category: "medical"}} {
		where, _ := buildDiscoveryWhere(q, 1)
		if !strings.Contains(where, "c.paused_at IS NULL") {
			t.Errorf("public discovery must exclude paused campaigns: %q", where)
		}
	}
}

// ...but an ADMIN listing by explicit status must STILL see paused campaigns —
// an operator who cannot see a paused campaign cannot moderate it.
func TestBuildDiscoveryWhere_AdminSeesPaused(t *testing.T) {
	where, _ := buildDiscoveryWhere(CampaignQuery{Status: "ACTIVE"}, 1)
	if strings.Contains(where, "paused_at") {
		t.Errorf("explicit-status (admin) listing should not filter on paused_at: %q", where)
	}
}

// A soft-deleted campaign is gone from EVERY surface, admin listings included.
func TestBuildDiscoveryWhere_ExcludesDeletedAlways(t *testing.T) {
	for _, q := range []CampaignQuery{{}, {Status: "PENDING_REVIEW"}, {Collection: "urgent"}} {
		where, _ := buildDiscoveryWhere(q, 1)
		if !strings.Contains(where, "c.deleted_at IS NULL") {
			t.Errorf("every discovery query must exclude soft-deleted campaigns: %q", where)
		}
	}
}

// The unconditional deleted_at term must not disturb positional placeholder
// numbering for the bound args that follow it.
func TestBuildDiscoveryWhere_PlaceholderNumberingUnaffected(t *testing.T) {
	where, args := buildDiscoveryWhere(CampaignQuery{Category: "medical", Type: "DONATION"}, 1)
	if !strings.Contains(where, "c.category = $1") || !strings.Contains(where, "c.type = $2") {
		t.Errorf("placeholder numbering shifted: %q", where)
	}
	if len(args) != 2 || args[0] != "medical" || args[1] != "DONATION" {
		t.Errorf("args mismatch: %#v", args)
	}
}

func TestBuildDiscoveryWhere_CategoryAndSearch(t *testing.T) {
	where, args := buildDiscoveryWhere(CampaignQuery{Category: "medical", Search: "zara"}, 1)
	if !strings.Contains(where, "c.category = $1") {
		t.Errorf("category placeholder wrong: %q", where)
	}
	if !strings.Contains(where, "$2") {
		t.Errorf("search placeholder wrong: %q", where)
	}
	if len(args) != 2 || args[0] != "medical" || args[1] != "zara" {
		t.Errorf("args mismatch: %#v", args)
	}
}

func TestSortClause(t *testing.T) {
	if !strings.Contains(sortClause("most_funded"), "raised_kobo DESC") {
		t.Error("most_funded should sort by raised desc")
	}
	if !strings.Contains(sortClause(""), "verified DESC") {
		t.Error("default sort should be recommended (verified first)")
	}
}

func TestMobileStatus(t *testing.T) {
	if mobileStatus("CHANGES_REQUESTED") != "PENDING_REVIEW" {
		t.Error("CHANGES_REQUESTED should map to PENDING_REVIEW for mobile")
	}
	if mobileStatus("ACTIVE") != "ACTIVE" {
		t.Error("ACTIVE should pass through")
	}
}

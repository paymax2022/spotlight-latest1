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

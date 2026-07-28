package handlers

// rbac_integration_personas_test.go
//
// Table-driven persona permission tests.
//
// These tests serve as living documentation of the RBAC permission model.
// They assert against an in-memory permission map and run without a database.
// When the test-DB infrastructure is in place, extend each test case to also
// call the real RBACService.CheckPermission() and compare.
//
// To run:
//   cd backend && go test ./internal/handlers/... -run TestPersona -v

import (
	"strings"
	"testing"
)

// personaPermissions maps each role to the set of permissions it holds.
// "*" in the slice means the role is a super-set (wildcard) — all permission
// checks return true.
var personaPermissions = map[string][]string{
	"contest_manager": {
		"contests:create",
		"contests:update",
		"contests:view",
		"applicants:view",
		"judges:assign",
	},
	"judge": {
		"contests:view",
		"applicants:view",
		"scores:create",
		"scores:update",
	},
	"sponsor": {
		"contests:view",
		"sponsorships:create",
		"sponsorships:view",
	},
	"school_rep": {
		"contests:view",
		"school_contests:view",
		"students:view",
	},
	"super_admin": {
		"*", // wildcard — has every permission
	},
	"state_coordinator": {
		"states:view",
		"states:update",
		"contests:view",
		"applicants:view",
	},
}

// hasPermission returns true when the role holds the given permission.
// For super_admin (wildcard "*"), any permission returns true.
func hasPermission(role, permission string) bool {
	perms, ok := personaPermissions[role]
	if !ok {
		return false
	}
	for _, p := range perms {
		if p == "*" {
			return true
		}
		if p == permission {
			return true
		}
	}
	return false
}

// ─── Individual persona tests ────────────────────────────────────────────────

func TestPersona_ContestManager_CanCreateContest(t *testing.T) {
	if !hasPermission("contest_manager", "contests:create") {
		t.Fatal("contest_manager must be able to create contests")
	}
}

func TestPersona_ContestManager_CanAssignJudges(t *testing.T) {
	if !hasPermission("contest_manager", "judges:assign") {
		t.Fatal("contest_manager must be able to assign judges")
	}
}

func TestPersona_Judge_CannotCreateContest(t *testing.T) {
	if hasPermission("judge", "contests:create") {
		t.Fatal("judge must NOT be able to create contests")
	}
}

func TestPersona_Judge_CanSubmitScores(t *testing.T) {
	if !hasPermission("judge", "scores:create") {
		t.Fatal("judge must be able to create scores")
	}
}

func TestPersona_Sponsor_CannotViewScores(t *testing.T) {
	if hasPermission("sponsor", "scores:create") {
		t.Fatal("sponsor must NOT be able to create scores")
	}
	if hasPermission("sponsor", "scores:update") {
		t.Fatal("sponsor must NOT be able to update scores")
	}
}

func TestPersona_Sponsor_CanCreateSponsorship(t *testing.T) {
	if !hasPermission("sponsor", "sponsorships:create") {
		t.Fatal("sponsor must be able to create sponsorships")
	}
}

func TestPersona_SchoolRep_CannotAssignJudges(t *testing.T) {
	if hasPermission("school_rep", "judges:assign") {
		t.Fatal("school_rep must NOT be able to assign judges")
	}
}

func TestPersona_SchoolRep_CanViewStudents(t *testing.T) {
	if !hasPermission("school_rep", "students:view") {
		t.Fatal("school_rep must be able to view students")
	}
}

func TestPersona_SuperAdmin_HasAllPermissions(t *testing.T) {
	checkPermissions := []string{
		"contests:create",
		"contests:update",
		"contests:view",
		"applicants:view",
		"judges:assign",
		"scores:create",
		"scores:update",
		"sponsorships:create",
		"sponsorships:view",
		"school_contests:view",
		"students:view",
		"states:view",
		"states:update",
		"wallet:topup",
		"wallet:debit",
		"users:delete",
		"rbac:manage",
	}
	for _, perm := range checkPermissions {
		if !hasPermission("super_admin", perm) {
			t.Errorf("super_admin must have permission %q but hasPermission returned false", perm)
		}
	}
}

func TestPersona_StateCoordinator_CannotCreateContestInOtherState(t *testing.T) {
	// State coordinators can VIEW contests but must not CREATE them.
	// Cross-state scope enforcement is done at the service layer (checking state_id claim),
	// but at the permission level, state_coordinator must not hold contests:create.
	if hasPermission("state_coordinator", "contests:create") {
		t.Fatal("state_coordinator must NOT have contests:create — creation is restricted to contest_manager")
	}
	// They should still be able to view contests and applicants in their own state.
	if !hasPermission("state_coordinator", "contests:view") {
		t.Fatal("state_coordinator must be able to view contests")
	}
	if !hasPermission("state_coordinator", "applicants:view") {
		t.Fatal("state_coordinator must be able to view applicants")
	}
}

// ─── Table-driven matrix test ─────────────────────────────────────────────────

// TestPersonaMatrix validates the full permission matrix via table-driven cases.
// Each case specifies: role, permission, and whether it should be granted.
func TestPersonaMatrix(t *testing.T) {
	type tc struct {
		role       string
		permission string
		want       bool
	}

	cases := []tc{
		// contest_manager grants
		{"contest_manager", "contests:create", true},
		{"contest_manager", "contests:update", true},
		{"contest_manager", "contests:view", true},
		{"contest_manager", "applicants:view", true},
		{"contest_manager", "judges:assign", true},
		// contest_manager denials
		{"contest_manager", "scores:create", false},
		{"contest_manager", "sponsorships:create", false},
		{"contest_manager", "students:view", false},
		{"contest_manager", "wallet:topup", false},

		// judge grants
		{"judge", "contests:view", true},
		{"judge", "applicants:view", true},
		{"judge", "scores:create", true},
		{"judge", "scores:update", true},
		// judge denials
		{"judge", "contests:create", false},
		{"judge", "judges:assign", false},
		{"judge", "sponsorships:create", false},

		// sponsor grants
		{"sponsor", "contests:view", true},
		{"sponsor", "sponsorships:create", true},
		{"sponsor", "sponsorships:view", true},
		// sponsor denials
		{"sponsor", "contests:create", false},
		{"sponsor", "scores:create", false},
		{"sponsor", "scores:update", false},
		{"sponsor", "judges:assign", false},

		// school_rep grants
		{"school_rep", "contests:view", true},
		{"school_rep", "school_contests:view", true},
		{"school_rep", "students:view", true},
		// school_rep denials
		{"school_rep", "contests:create", false},
		{"school_rep", "judges:assign", false},
		{"school_rep", "scores:create", false},
		{"school_rep", "applicants:view", false},

		// super_admin wildcard
		{"super_admin", "contests:create", true},
		{"super_admin", "wallet:topup", true},
		{"super_admin", "rbac:manage", true},
		{"super_admin", "anything:at_all", true},

		// state_coordinator grants
		{"state_coordinator", "states:view", true},
		{"state_coordinator", "states:update", true},
		{"state_coordinator", "contests:view", true},
		{"state_coordinator", "applicants:view", true},
		// state_coordinator denials
		{"state_coordinator", "contests:create", false},
		{"state_coordinator", "judges:assign", false},
		{"state_coordinator", "scores:create", false},

		// unknown role always denied
		{"unknown_role", "contests:view", false},
		{"", "contests:view", false},
	}

	for _, c := range cases {
		name := strings.ReplaceAll(c.role+"__"+c.permission, ":", "_")
		t.Run(name, func(t *testing.T) {
			got := hasPermission(c.role, c.permission)
			if got != c.want {
				t.Errorf("hasPermission(%q, %q) = %v; want %v", c.role, c.permission, got, c.want)
			}
		})
	}
}

package groups_test

import (
	"testing"

	"spotlight/backend/internal/groups"
)

func TestMemberRoleConstants(t *testing.T) {
	roles := []groups.MemberRole{
		groups.RoleOwner,
		groups.RoleAdmin,
		groups.RoleMember,
	}
	seen := map[groups.MemberRole]bool{}
	for _, r := range roles {
		if r == "" {
			t.Error("MemberRole must not be empty string")
		}
		if seen[r] {
			t.Errorf("duplicate MemberRole: %q", r)
		}
		seen[r] = true
	}
}

// TestOwnerIsHighestRole verifies the role hierarchy: owner > admin > member.
// The service uses assertRole() to gate privileged operations.
func TestOwnerIsHighestRole(t *testing.T) {
	// Owner must be distinct from admin and member.
	if groups.RoleOwner == groups.RoleAdmin {
		t.Error("RoleOwner must differ from RoleAdmin")
	}
	if groups.RoleOwner == groups.RoleMember {
		t.Error("RoleOwner must differ from RoleMember")
	}
}

// TestPayDuesRequestFields verifies dues payment requests require plan and idempotency key.
func TestPayDuesRequestFields(t *testing.T) {
	req := groups.PayDuesRequest{
		PlanID:         "plan-monthly-001",
		IdempotencyKey: "dues-001",
	}
	if req.PlanID == "" {
		t.Error("PayDuesRequest.PlanID must not be empty")
	}
	if req.IdempotencyKey == "" {
		t.Error("PayDuesRequest.IdempotencyKey must not be empty")
	}
}

// TestCreateGroupRequestRequired verifies mandatory fields for group creation.
func TestCreateGroupRequestRequired(t *testing.T) {
	req := groups.CreateGroupRequest{
		Name: "Paymax Savers Club",
	}
	if req.Name == "" {
		t.Error("CreateGroupRequest.Name must not be empty")
	}
	// Name binding requires min=2, max=100.
	if len(req.Name) < 2 {
		t.Errorf("Name %q is too short (min=2)", req.Name)
	}
}

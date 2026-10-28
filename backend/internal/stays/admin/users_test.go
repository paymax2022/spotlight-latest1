package admin

import "testing"

func TestMaskName(t *testing.T) {
	cases := []struct{ name, email, want string }{
		{"Ada Okafor", "ada@x.ng", "Ada O••••"},
		{"Zara", "z@x.ng", "Zara••••"},
		{"", "tunde@x.ng", "t••••"},
	}
	for _, c := range cases {
		if got := maskName(c.name, c.email); got != c.want {
			t.Errorf("maskName(%q,%q) = %q, want %q", c.name, c.email, got, c.want)
		}
	}
}

func TestMaskEmail(t *testing.T) {
	if got := maskEmail("spec.ng+staging1@gmail.com"); got != "s••@gmail.com" {
		t.Errorf("maskEmail = %q", got)
	}
	if got := maskEmail("not-an-email"); got != "" {
		t.Errorf("maskEmail(no @) = %q, want empty", got)
	}
}

func TestHotelierRolePermissions_OnlyManagementRolesHoldCapabilities(t *testing.T) {
	for _, role := range []string{"OWNER", "MANAGER"} {
		if len(hotelierRolePermissions[role]) == 0 {
			t.Errorf("%s should hold management capabilities", role)
		}
	}
	for _, role := range []string{"FRONT_DESK", "FINANCE", "READ_ONLY"} {
		if len(hotelierRolePermissions[role]) != 0 {
			t.Errorf("%s should hold no management capability, has %v", role, hotelierRolePermissions[role])
		}
	}
}

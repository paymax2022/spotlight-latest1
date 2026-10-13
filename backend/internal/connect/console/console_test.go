package connectconsole

import (
	"strings"
	"testing"
	"time"
)

func TestMaskEmail(t *testing.T) {
	for in, want := range map[string]string{
		"ada.obi@gmail.com": "a•••@gmail.com",
		"a@b.co":            "a•••@b.co",
		"":                  "",
		"not-an-email":      "",
		"@nolocal.com":      "",
		"x@":                "",
	} {
		if got := maskEmail(in); got != want {
			t.Errorf("maskEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMaskPhone(t *testing.T) {
	for in, want := range map[string]string{
		"+2348012345678": "••••678",
		"08012345678":    "••••678",
		"12":             "",
		"":               "",
	} {
		if got := maskPhone(in); got != want {
			t.Errorf("maskPhone(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUserStatusPrecedence(t *testing.T) {
	for _, c := range []struct{ restriction, platform, want string }{
		{"banned", "active", "banned"},
		{"banned", "suspended", "banned"},
		{"suspended", "active", "suspended"},
		{"", "suspended", "suspended"},
		{"", "locked", "restricted"},
		{"", "pending", "pending"},
		{"", "active", "active"},
		{"", "", "active"},
	} {
		if got := userStatus(c.restriction, c.platform); got != c.want {
			t.Errorf("userStatus(%q,%q) = %q, want %q", c.restriction, c.platform, got, c.want)
		}
	}
}

func TestBVNNINStatus(t *testing.T) {
	if idStatus(true) != "verified" || idStatus(false) != "none" {
		t.Fatal("id status mapping")
	}
}

func TestUserListFilters(t *testing.T) {
	if _, ok := parseUserStatus("bogus"); ok {
		t.Fatal("bogus status accepted")
	}
	for _, s := range []string{"", "all", "active", "suspended", "banned", "restricted", "pending"} {
		if _, ok := parseUserStatus(s); !ok {
			t.Errorf("status %q rejected", s)
		}
	}
	for in, want := range map[string]int{"": 100, "x": 100, "0": 100, "20": 20, "999": 200} {
		if got := userLimit(in); got != want {
			t.Errorf("limit %q -> %d want %d", in, got, want)
		}
	}
}

func TestSearchPatternEscapesWildcards(t *testing.T) {
	if got := searchPattern("ad%a_"); got != `%ad\%a\_%` {
		t.Fatalf("pattern = %q", got)
	}
	if searchPattern("   ") != "" {
		t.Fatal("blank search must be no filter")
	}
	long := strings.Repeat("a", 500)
	if got := searchPattern(long); len(got) > 70 {
		t.Fatalf("search term not capped: %d", len(got))
	}
}

func TestUserSummaryFallbacks(t *testing.T) {
	created := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	u := summaryOf(userRow{ID: "u1", DisplayName: nil, CreatedAt: created})
	if u.Handle != "user u1" || u.Status != "active" || u.Verification != "unverified" || u.Flags == nil {
		t.Fatalf("summary = %+v", u)
	}
	if u.LastActiveAt != created.Format(time.RFC3339) {
		t.Fatalf("last_active falls back to created_at, got %q", u.LastActiveAt)
	}
	last := time.Date(2026, 10, 10, 0, 0, 0, 0, time.UTC)
	u2 := summaryOf(userRow{ID: "u2", LastLoginAt: &last, CreatedAt: created, OpenCases: 2})
	if u2.LastActiveAt != last.Format(time.RFC3339) {
		t.Fatalf("last_active = %q", u2.LastActiveAt)
	}
	found := false
	for _, f := range u2.Flags {
		if f == "open_case" {
			found = true
		}
	}
	if !found {
		t.Fatalf("flags = %v", u2.Flags)
	}
}

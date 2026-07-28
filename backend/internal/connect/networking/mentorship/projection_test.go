package connectmentor

import (
	"reflect"
	"strings"
	"testing"
)

// PN-7 (mode-privacy): the mentorship discovery projection must expose ONLY
// mentorship/professional fields and NEVER any Dating-mode profile signal. This test
// pins the safe projection three ways: (1) the SafeMentorProfile struct has no
// Dating-mode field; (2) the column allow-list select touches no Dating-mode column;
// (3) the built SELECT list never references the Dating-mode table (connect_profiles).
func TestSafeProjection_NoDatingModeFields(t *testing.T) {
	// (1) Reflect over the returned discovery struct — every JSON field must be a
	// mentorship/professional field, none on the Dating-mode denylist.
	allowed := map[string]bool{
		"userId": true, "role": true, "domains": true, "capacity": true, "displayName": true,
	}
	rt := reflect.TypeOf(SafeMentorProfile{})
	for i := 0; i < rt.NumField(); i++ {
		tag := rt.Field(i).Tag.Get("json")
		name := strings.Split(tag, ",")[0]
		if !allowed[name] {
			t.Errorf("SafeMentorProfile exposes unexpected field %q (PN-7: only mentorship/professional fields allowed)", name)
		}
		for _, banned := range datingModeFieldDenylist {
			if strings.EqualFold(name, banned) {
				t.Errorf("SafeMentorProfile leaks Dating-mode field %q (PN-7 violation)", name)
			}
		}
	}

	// (2) The column allow-list must contain only mp.* (mentorship) or pp.* (professional)
	// columns, and none from the Dating-mode denylist.
	for _, col := range safeMentorProjectionColumns {
		if !strings.HasPrefix(col, "mp.") && !strings.HasPrefix(col, "pp.") {
			t.Errorf("projection column %q is neither mentorship (mp.) nor professional (pp.)", col)
		}
		for _, banned := range datingModeFieldDenylist {
			if strings.Contains(strings.ToLower(col), strings.ToLower(banned)) {
				t.Errorf("projection column %q references Dating-mode signal %q (PN-7 violation)", col, banned)
			}
		}
	}

	// (3) The concrete SELECT list the repo builds must never mention the Dating-mode
	// table (connect_profiles) or the connect_dating_* namespace.
	sel := strings.ToLower(discoverSafeSelect)
	for _, banned := range []string{"connect_profiles", "connect_dating", "dating"} {
		if strings.Contains(sel, banned) {
			t.Errorf("discoverSafeSelect references forbidden Dating-mode source %q: %s", banned, discoverSafeSelect)
		}
	}
	if !strings.Contains(sel, "mp.user_id") {
		t.Errorf("discoverSafeSelect missing the mentorship key column: %s", discoverSafeSelect)
	}
}

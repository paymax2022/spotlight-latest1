package restaurant

import (
	"strings"
	"testing"
)

// With FEATURE_BANK_ACCOUNT_NAME_MATCH off, no bank-account read may name a
// name_match_* column: the backend can deploy before migration 20271088000000
// lands, and a reference to a missing column turns every add/list/withdraw into
// a 500 (review finding H1 on PR #871). The live-DB withdrawal tests cover the
// whole flow; this pins the select expression without a database.
func TestNameMatchStatusColumn_FlagOffNeverReferencesColumn(t *testing.T) {
	off := (&Service{}).nameMatchStatusColumn()
	if strings.Contains(off, "name_match") {
		t.Fatalf("flag off must not reference name_match_*; got %q", off)
	}
	on := (&Service{nameMatchOn: true}).nameMatchStatusColumn()
	if !strings.Contains(on, "name_match_status") {
		t.Fatalf("flag on must read name_match_status; got %q", on)
	}
}

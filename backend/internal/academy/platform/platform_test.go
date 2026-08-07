package platform

// platform_test.go — package-local unit tests for the academy platform package.
//
// Scope: the pure, DB-free logic only — the composition-root FlagResolver (fail-closed
// default-off semantics) and the pure handler/repo helpers. Every method that needs a
// *pgxpool.Pool (Repo.GetFlag/SetFlag/List*, FlagService.*, and the gin Handlers) is
// intentionally NOT exercised here: there is no fake pool, and the task forbids adding
// production seams. Those paths are covered by the live-DB integration suites.

import (
	"context"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// ── FlagResolver: the fail-closed composition-root resolver ────────────────────

func TestFlagResolver_NilResolver_ReturnsCompileDefault(t *testing.T) {
	var r *FlagResolver // nil receiver must be safe and fall back to the default
	if got := r.Resolve(FlagExam, true); got != true {
		t.Fatalf("nil resolver Resolve(default=true) = %v, want true", got)
	}
	if got := r.Resolve(FlagExam, false); got != false {
		t.Fatalf("nil resolver Resolve(default=false) = %v, want false", got)
	}
}

func TestFlagResolver_NoOverrides_ReturnsCompileDefault(t *testing.T) {
	// A resolver built from a nil repo has no overrides — every key falls through to
	// its compile-time default (fail-closed: the store never silently enables).
	r, err := NewFlagResolver(context.Background(), nil)
	if err != nil {
		t.Fatalf("NewFlagResolver(nil repo) unexpected err: %v", err)
	}
	if r == nil {
		t.Fatal("NewFlagResolver must always return a non-nil resolver")
	}
	if got := r.Resolve(FlagLive, false); got != false {
		t.Errorf("Resolve(default=false) with no overrides = %v, want false (default-off)", got)
	}
	if got := r.Resolve(FlagLive, true); got != true {
		t.Errorf("Resolve(default=true) with no overrides = %v, want true", got)
	}
}

func TestFlagResolver_Override_WinsOverDefault(t *testing.T) {
	// A stored override is authoritative in BOTH directions regardless of the default.
	r := &FlagResolver{overrides: map[string]bool{
		FlagExam:   true,  // override enables despite default-off
		FlagEduPay: false, // override disables despite default-on
	}}

	if got := r.Resolve(FlagExam, false); got != true {
		t.Errorf("Resolve(%q, default=false) = %v, want true (override enables)", FlagExam, got)
	}
	if got := r.Resolve(FlagEduPay, true); got != false {
		t.Errorf("Resolve(%q, default=true) = %v, want false (override disables)", FlagEduPay, got)
	}
	// A key with no override still falls back to the default.
	if got := r.Resolve(FlagSpine, true); got != true {
		t.Errorf("Resolve(%q, default=true) = %v, want true (no override)", FlagSpine, got)
	}
	if got := r.Resolve(FlagSpine, false); got != false {
		t.Errorf("Resolve(%q, default=false) = %v, want false (no override)", FlagSpine, got)
	}
}

func TestFlagResolver_EmptyOverrideMap_FallsBackToDefault(t *testing.T) {
	// A non-nil but empty override map behaves like "no overrides".
	r := &FlagResolver{overrides: map[string]bool{}}
	if got := r.Resolve(FlagSchools, false); got != false {
		t.Errorf("empty overrides Resolve(default=false) = %v, want false", got)
	}
	if got := r.Resolve(FlagSchools, true); got != true {
		t.Errorf("empty overrides Resolve(default=true) = %v, want true", got)
	}
}

func TestFlagKeys_AreDistinctAndNamespaced(t *testing.T) {
	keys := []string{
		FlagExam, FlagSpine, FlagEduPay, FlagCredentials,
		FlagLive, FlagSchools, FlagTutor, FlagFees,
	}
	seen := make(map[string]bool, len(keys))
	for _, k := range keys {
		if k == "" {
			t.Error("flag key must not be empty")
		}
		if len(k) < len("academy.") || k[:len("academy.")] != "academy." {
			t.Errorf("flag key %q must be namespaced under 'academy.'", k)
		}
		if seen[k] {
			t.Errorf("duplicate flag key %q", k)
		}
		seen[k] = true
	}
}

// ── firstNonEmpty ─────────────────────────────────────────────────────────────

func TestFirstNonEmpty(t *testing.T) {
	cases := []struct {
		a, b, want string
	}{
		{"x", "y", "x"},
		{"", "y", "y"},
		{"", "", ""},
		{"x", "", "x"},
	}
	for _, tc := range cases {
		if got := firstNonEmpty(tc.a, tc.b); got != tc.want {
			t.Errorf("firstNonEmpty(%q,%q) = %q, want %q", tc.a, tc.b, got, tc.want)
		}
	}
}

// ── topByGMV: selection sort + top-n truncation ────────────────────────────────

func TestTopByGMV_SortsDescendingAndTruncates(t *testing.T) {
	rows := []gin.H{
		{"school_id": "a", "gmv_kobo": int64(100)},
		{"school_id": "b", "gmv_kobo": int64(500)},
		{"school_id": "c", "gmv_kobo": int64(300)},
		{"school_id": "d", "gmv_kobo": int64(50)},
		{"school_id": "e", "gmv_kobo": int64(400)},
	}
	got := topByGMV(rows, 3)
	if len(got) != 3 {
		t.Fatalf("topByGMV len = %d, want 3", len(got))
	}
	wantOrder := []string{"b", "e", "c"} // 500, 400, 300
	for i, w := range wantOrder {
		if got[i]["school_id"] != w {
			t.Errorf("top[%d] = %v, want %q", i, got[i]["school_id"], w)
		}
	}
}

func TestTopByGMV_FewerThanN_ReturnsAllSorted(t *testing.T) {
	rows := []gin.H{
		{"school_id": "a", "gmv_kobo": int64(10)},
		{"school_id": "b", "gmv_kobo": int64(90)},
	}
	got := topByGMV(rows, 4)
	if len(got) != 2 {
		t.Fatalf("topByGMV len = %d, want 2", len(got))
	}
	if got[0]["school_id"] != "b" || got[1]["school_id"] != "a" {
		t.Errorf("order = [%v %v], want [b a]", got[0]["school_id"], got[1]["school_id"])
	}
}

func TestTopByGMV_Empty(t *testing.T) {
	if got := topByGMV([]gin.H{}, 4); len(got) != 0 {
		t.Errorf("topByGMV(empty) len = %d, want 0", len(got))
	}
}

// ── dateOrEmpty ───────────────────────────────────────────────────────────────

func TestDateOrEmpty(t *testing.T) {
	if got := dateOrEmpty(nil); got != "" {
		t.Errorf("dateOrEmpty(nil) = %q, want empty", got)
	}
	ts := time.Date(2026, 7, 27, 15, 4, 5, 0, time.UTC)
	if got := dateOrEmpty(&ts); got != "2026-07-27" {
		t.Errorf("dateOrEmpty = %q, want 2026-07-27", got)
	}
}

// ── rfc / rfcPtr ──────────────────────────────────────────────────────────────

func TestRFC_FormatsUTC(t *testing.T) {
	// A non-UTC zone must be normalized to UTC / Z.
	loc := time.FixedZone("WAT", 1*60*60)
	ts := time.Date(2026, 7, 27, 13, 0, 0, 0, loc)
	if got := rfc(ts); got != "2026-07-27T12:00:00Z" {
		t.Errorf("rfc = %q, want 2026-07-27T12:00:00Z", got)
	}
}

func TestRFCPtr(t *testing.T) {
	if got := rfcPtr(nil); got != nil {
		t.Errorf("rfcPtr(nil) = %v, want nil", got)
	}
	ts := time.Date(2026, 7, 27, 0, 0, 0, 0, time.UTC)
	if got := rfcPtr(&ts); got != "2026-07-27T00:00:00Z" {
		t.Errorf("rfcPtr = %v, want 2026-07-27T00:00:00Z", got)
	}
}

// ── itoa ──────────────────────────────────────────────────────────────────────

func TestItoa(t *testing.T) {
	cases := map[int]string{0: "0", 1: "1", 9: "9", 10: "10", 42: "42", 100: "100", 123456: "123456"}
	for in, want := range cases {
		if got := itoa(in); got != want {
			t.Errorf("itoa(%d) = %q, want %q", in, got, want)
		}
	}
}

// ── trustJSON: pure projection of a TrustRow ──────────────────────────────────

func TestTrustJSON_ZeroUpdatedAt_OmitsTimestamp(t *testing.T) {
	row := TrustRow{
		SchoolID:       "sch_1",
		SchoolName:     "Acme High",
		Score:          0.82,
		Overridden:     true,
		OverrideReason: "manual review",
		// UpdatedAt zero-value
	}
	j := trustJSON(row)
	if j["school_id"] != "sch_1" || j["school_name"] != "Acme High" {
		t.Errorf("identity fields mismatch: %v", j)
	}
	if j["score"] != 0.82 {
		t.Errorf("score = %v, want 0.82", j["score"])
	}
	if j["overridden"] != true {
		t.Errorf("overridden = %v, want true", j["overridden"])
	}
	if j["override_reason"] != "manual review" {
		t.Errorf("override_reason = %v", j["override_reason"])
	}
	if j["updated_at"] != "" {
		t.Errorf("zero UpdatedAt should yield empty updated_at, got %v", j["updated_at"])
	}
	comps, ok := j["components"].([]gin.H)
	if !ok || len(comps) != 4 {
		t.Fatalf("components = %v, want 4 weighted components", j["components"])
	}
	// Weights are documented to sum to 1.0 across the four components.
	var sum float64
	for _, c := range comps {
		sum += c["weight"].(float64)
		if c["value"] != row.Score {
			t.Errorf("component value = %v, want score %v", c["value"], row.Score)
		}
	}
	if sum < 0.999 || sum > 1.001 {
		t.Errorf("component weights sum = %v, want 1.0", sum)
	}
}

func TestTrustJSON_NonZeroUpdatedAt_FormatsRFC(t *testing.T) {
	ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	j := trustJSON(TrustRow{SchoolID: "s", Score: 0.5, UpdatedAt: ts})
	if j["updated_at"] != "2026-01-02T03:04:05Z" {
		t.Errorf("updated_at = %v, want RFC3339 UTC", j["updated_at"])
	}
}

package connectaml

import (
	"context"
	"errors"
	"testing"
	"time"
)

// These tests cover the pure, DB-free decision surface of the Connect AML
// package:
//
//   - DefaultThresholds — the backend-owned CBN/NFIU-aligned policy constants
//     that drive every allow/flag boundary (threshold, velocity, structuring);
//   - NewService — the fail-safe default-injection logic (nil screener -> Noop,
//     zero thresholds -> DefaultThresholds, provided values preserved);
//   - NoopScreener.Screen — the documented fail-open default (never blocks);
//   - OpenCase — the report-type classifier (str/sar allowed, everything else
//     -> ErrInvalidType, fail-closed before any persistence);
//   - the persisted ReasonCode / EventKind string contracts (stored in the DB,
//     so their exact wire values are a stability guarantee).
//
// Service.score (the velocity/structuring/threshold rules engine) is
// intentionally NOT unit-tested here: it dereferences a concrete *Repository
// backed by *pgxpool.Pool with no seam to fake, so exercising it needs a live
// DB. See the coverage note at the end of this file.

// ---- DefaultThresholds -------------------------------------------------------

func TestDefaultThresholds_Values(t *testing.T) {
	got := DefaultThresholds()

	// ₦1,000,000 single-event reporting line, in kobo.
	if got.SingleEventKobo != 100_000_000 {
		t.Errorf("SingleEventKobo = %d, want 100_000_000 (₦1,000,000)", got.SingleEventKobo)
	}
	// ₦5,000,000 aggregate structuring line, in kobo.
	if got.StructuringAggKobo != 500_000_000 {
		t.Errorf("StructuringAggKobo = %d, want 500_000_000 (₦5,000,000)", got.StructuringAggKobo)
	}
	if got.VelocityWindow != time.Hour {
		t.Errorf("VelocityWindow = %v, want 1h", got.VelocityWindow)
	}
	if got.VelocityMaxCount != 20 {
		t.Errorf("VelocityMaxCount = %d, want 20", got.VelocityMaxCount)
	}
	if got.StructuringWindow != 24*time.Hour {
		t.Errorf("StructuringWindow = %v, want 24h", got.StructuringWindow)
	}
}

// The structuring aggregate line must sit above the single-event line, otherwise
// the aggregation rule could never fire on genuinely sub-threshold events (each
// event would already trip THRESHOLD_EXCEEDED). This is an invariant of the
// policy, not an arbitrary constant.
func TestDefaultThresholds_StructuringLineAboveSingleEvent(t *testing.T) {
	th := DefaultThresholds()
	if th.StructuringAggKobo <= th.SingleEventKobo {
		t.Errorf("structuring line %d must exceed single-event line %d",
			th.StructuringAggKobo, th.SingleEventKobo)
	}
}

// DefaultThresholds is a pure value producer: repeated calls are identical and
// mutating one result never leaks into the next.
func TestDefaultThresholds_PureAndIndependent(t *testing.T) {
	a := DefaultThresholds()
	a.SingleEventKobo = 1
	a.VelocityMaxCount = 999
	b := DefaultThresholds()
	if b.SingleEventKobo != 100_000_000 || b.VelocityMaxCount != 20 {
		t.Errorf("DefaultThresholds leaked mutation: got %+v", b)
	}
}

// ---- NewService: fail-safe default injection --------------------------------

// fakeScreener is a controllable SanctionsScreener for constructor identity checks.
type fakeScreener struct {
	res ScreenResult
	err error
}

func (f fakeScreener) Screen(context.Context, string) (ScreenResult, error) {
	return f.res, f.err
}

func TestNewService_NilScreenerBecomesNoop(t *testing.T) {
	s := NewService(nil, nil, nil, DefaultThresholds())
	if s == nil {
		t.Fatal("NewService returned nil")
	}
	if _, ok := s.screener.(NoopScreener); !ok {
		t.Errorf("nil screener should default to NoopScreener, got %T", s.screener)
	}
}

func TestNewService_ProvidedScreenerPreserved(t *testing.T) {
	fs := fakeScreener{res: ScreenResult{Hit: true}}
	s := NewService(nil, nil, fs, DefaultThresholds())
	if _, ok := s.screener.(fakeScreener); !ok {
		t.Errorf("provided screener not preserved, got %T", s.screener)
	}
}

// Zero-value thresholds (detected via SingleEventKobo == 0) fall back to the
// safe CBN/NFIU defaults rather than running with an all-zero (never-fires or
// always-fires) policy.
func TestNewService_ZeroThresholdsBecomeDefaults(t *testing.T) {
	s := NewService(nil, nil, nil, Thresholds{})
	if s.limits != DefaultThresholds() {
		t.Errorf("zero thresholds should fall back to DefaultThresholds, got %+v", s.limits)
	}
}

// A caller-supplied policy with a non-zero single-event line is preserved
// verbatim — the default-injection only triggers on the zero sentinel.
func TestNewService_NonZeroThresholdsPreserved(t *testing.T) {
	custom := Thresholds{
		SingleEventKobo:    42,
		VelocityWindow:     2 * time.Minute,
		VelocityMaxCount:   3,
		StructuringWindow:  time.Hour,
		StructuringAggKobo: 1000,
	}
	s := NewService(nil, nil, nil, custom)
	if s.limits != custom {
		t.Errorf("custom thresholds mutated: got %+v want %+v", s.limits, custom)
	}
}

// ---- NoopScreener: documented fail-open default ------------------------------

func TestNoopScreener_NeverHits(t *testing.T) {
	res, err := NoopScreener{}.Screen(context.Background(), "any-subject")
	if err != nil {
		t.Fatalf("NoopScreener.Screen returned error: %v", err)
	}
	if res.Hit {
		t.Error("NoopScreener must never report a hit (money path stays unblocked)")
	}
	if res.ListName != "" || res.MatchCode != "" {
		t.Errorf("NoopScreener must not carry match metadata: %+v", res)
	}
}

// ---- OpenCase: report-type classifier (fail-closed before persistence) -------

// OpenCase validates the report type BEFORE touching the repository, so the
// invalid-type branch is reachable with a nil repo. Valid types are not exercised
// here because they would proceed to the DB-backed repository.
func TestOpenCase_ReportTypeValidation(t *testing.T) {
	// nil repo/audit is safe: the invalid-type branch returns before any use.
	s := &Service{}
	ctx := context.Background()

	cases := []struct {
		name       string
		reportType string
	}{
		{"empty", ""},
		{"uppercase STR is rejected (codes are lowercase)", "STR"},
		{"uppercase SAR is rejected", "SAR"},
		{"mixed case", "Str"},
		{"unknown word", "report"},
		{"whitespace padded", " str "},
		{"numeric", "1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, err := s.OpenCase(ctx, "subject-1", tc.reportType, []string{"VELOCITY_BURST"}, "admin-1")
			if !errors.Is(err, ErrInvalidType) {
				t.Errorf("reportType %q: err = %v, want ErrInvalidType", tc.reportType, err)
			}
			if c != nil {
				t.Errorf("reportType %q: case = %+v, want nil on rejection", tc.reportType, c)
			}
		})
	}
}

// ---- Sentinel errors ---------------------------------------------------------

func TestSentinelErrors_DistinctAndStable(t *testing.T) {
	if errors.Is(ErrInvalidType, ErrCaseNotFound) {
		t.Error("ErrInvalidType and ErrCaseNotFound must be distinct sentinels")
	}
	if ErrInvalidType.Error() != "aml: report type must be str or sar" {
		t.Errorf("ErrInvalidType message drifted: %q", ErrInvalidType.Error())
	}
	if ErrCaseNotFound.Error() != "aml: case not found or not open" {
		t.Errorf("ErrCaseNotFound message drifted: %q", ErrCaseNotFound.Error())
	}
}

// ---- Persisted string contracts ---------------------------------------------

// ReasonCode and EventKind values are written verbatim into connect_aml_alerts /
// connect_aml_events. Changing any of these strings silently breaks historical
// rows and downstream NFIU reporting, so their exact values are pinned here.
func TestReasonCodeContract(t *testing.T) {
	pairs := map[ReasonCode]string{
		ReasonThresholdExceeded: "THRESHOLD_EXCEEDED",
		ReasonVelocity:          "VELOCITY_BURST",
		ReasonStructuring:       "STRUCTURING",
		ReasonSanctionsHit:      "SANCTIONS_HIT",
	}
	for got, want := range pairs {
		if string(got) != want {
			t.Errorf("ReasonCode drift: got %q want %q", string(got), want)
		}
	}
}

func TestEventKindContract(t *testing.T) {
	pairs := map[EventKind]string{
		EventGift:     "gift",
		EventPaidVote: "paid_vote",
		EventPayout:   "payout",
	}
	for got, want := range pairs {
		if string(got) != want {
			t.Errorf("EventKind drift: got %q want %q", string(got), want)
		}
	}
}

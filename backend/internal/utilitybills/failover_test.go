package utilitybills

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"spotlight/backend/internal/provider"
)

// FailoverOrder and ProviderAnswered are the two PURE decisions on the purchase
// path. Between them they decide which provider is tried, in what order, and —
// crucially — whether a failed attempt is safe to retry at all. Both are tested
// here with zero I/O.

func route(providerID, adapterCode string, providerStatus ProviderOperationalStatus, health HealthStatus,
	mappingStatus MappingStatus, cats []Category, routePriority, providerPriority int) Route {
	prov := Provider{
		ID:                  providerID,
		Status:              providerStatus,
		HealthStatus:        health,
		SupportedCategories: cats,
		Priority:            providerPriority,
	}
	return Route{
		Candidate: RouteCandidate{
			Provider: prov,
			Mapping:  ProviderMapping{Status: mappingStatus},
			Priority: routePriority,
		},
		Provider: ProviderRow{ID: providerID, AdapterCode: adapterCode, Code: providerID},
		Mapping:  MappingRow{ID: "map-" + providerID, ProviderID: providerID},
	}
}

var allCats = []Category{CategoryElectricity, CategoryAirtime}

func TestFailoverOrder_SortsByRouteThenProviderPriority(t *testing.T) {
	routes := []Route{
		route("c", "vtpass", ProviderStatusActive, HealthHealthy, MappingStatusActive, allCats, 20, 1),
		route("a", "vtpass", ProviderStatusActive, HealthHealthy, MappingStatusActive, allCats, 10, 50),
		route("b", "vtpass", ProviderStatusActive, HealthHealthy, MappingStatusActive, allCats, 10, 5),
	}
	got := FailoverOrder(routes, CategoryElectricity)
	want := []string{"b", "a", "c"} // route prio 10 first, broken by provider prio 5 < 50
	if len(got) != len(want) {
		t.Fatalf("got %d routes want %d", len(got), len(want))
	}
	for i, id := range want {
		if got[i].Provider.ID != id {
			t.Fatalf("position %d: got %s want %s (full order %v)", i, got[i].Provider.ID, id, ids(got))
		}
	}
}

func TestFailoverOrder_ExcludesDisabledAndDownAndUnsupported(t *testing.T) {
	routes := []Route{
		route("ok", "vtpass", ProviderStatusActive, HealthHealthy, MappingStatusActive, allCats, 10, 10),
		route("provider-disabled", "vtpass", ProviderStatusDisabled, HealthHealthy, MappingStatusActive, allCats, 1, 1),
		route("provider-maintenance", "vtpass", ProviderStatusMaintenance, HealthHealthy, MappingStatusActive, allCats, 1, 1),
		route("mapping-disabled", "vtpass", ProviderStatusActive, HealthHealthy, MappingStatusDisabled, allCats, 1, 1),
		route("health-down", "vtpass", ProviderStatusActive, HealthDown, MappingStatusActive, allCats, 1, 1),
		route("wrong-category", "vtpass", ProviderStatusActive, HealthHealthy, MappingStatusActive, []Category{CategoryData}, 1, 1),
	}
	got := FailoverOrder(routes, CategoryElectricity)
	if len(got) != 1 || got[0].Provider.ID != "ok" {
		t.Fatalf("filter chain wrong: %v", ids(got))
	}
}

func TestFailoverOrder_DegradedAndUnknownHealthStayEligible(t *testing.T) {
	// routing.ts excludes ONLY health_status === 'down'. A degraded or
	// never-health-checked provider is still tried — excluding them would take the
	// whole module down the moment a health check has not run yet.
	routes := []Route{
		route("degraded", "vtpass", ProviderStatusActive, HealthDegraded, MappingStatusActive, allCats, 10, 10),
		route("unknown", "vtpass", ProviderStatusActive, HealthUnknown, MappingStatusActive, allCats, 20, 10),
	}
	if got := FailoverOrder(routes, CategoryElectricity); len(got) != 2 {
		t.Fatalf("degraded/unknown must stay eligible, got %v", ids(got))
	}
}

func TestFailoverOrder_ReassociatesRowsWithSortedCandidates(t *testing.T) {
	// The pure sort works on slim candidates; the caller needs the full rows back.
	// A mismatch here would route a purchase through provider A's priority but
	// provider B's credentials and biller codes.
	routes := []Route{
		route("slow", "adapter-slow", ProviderStatusActive, HealthHealthy, MappingStatusActive, allCats, 99, 99),
		route("fast", "adapter-fast", ProviderStatusActive, HealthHealthy, MappingStatusActive, allCats, 1, 1),
	}
	got := FailoverOrder(routes, CategoryElectricity)
	if got[0].Provider.AdapterCode != "adapter-fast" || got[0].Mapping.ID != "map-fast" {
		t.Fatalf("rows not re-associated with the sorted candidate: %+v", got[0])
	}
	if got[0].Candidate.Priority != 1 {
		t.Fatalf("sorted candidate not carried through: %d", got[0].Candidate.Priority)
	}
}

func TestFailoverOrder_EmptyInputs(t *testing.T) {
	if got := FailoverOrder(nil, CategoryElectricity); got != nil {
		t.Fatalf("nil input should yield nil, got %v", ids(got))
	}
	routes := []Route{route("x", "vtpass", ProviderStatusDisabled, HealthHealthy, MappingStatusActive, allCats, 1, 1)}
	if got := FailoverOrder(routes, CategoryElectricity); len(got) != 0 {
		t.Fatalf("all-filtered input should yield none, got %v", ids(got))
	}
}

func ids(routes []Route) []string {
	out := make([]string, 0, len(routes))
	for _, r := range routes {
		out = append(out, r.Provider.ID)
	}
	return out
}

// ── ProviderAnswered ────────────────────────────────────────────────────────
//
// This is the single most consequential predicate in the module. True means "the
// provider refused, nothing exists upstream" → safe to fail over or auto-reverse.
// False means "we do not know" → lock the key, park as pending, never reverse.
// It must fail toward "unknown" for anything it does not positively recognise.

func TestProviderAnswered_OnlyRefusedIsDefinite(t *testing.T) {
	if !ProviderAnswered(fmt.Errorf("wrapped: %w", provider.ErrProviderRefused)) {
		t.Fatal("a wrapped ErrProviderRefused must count as a definite refusal")
	}
	if !ProviderAnswered(provider.ErrProviderRefused) {
		t.Fatal("ErrProviderRefused itself must count as a definite refusal")
	}
}

func TestProviderAnswered_AmbiguousErrorsAreNotDefinite(t *testing.T) {
	ambiguous := []error{
		context.DeadlineExceeded,
		context.Canceled,
		errors.New("connection reset by peer"),
		errors.New("EOF"),
		fmt.Errorf("vtpass: http request: %w", errors.New("dial tcp: i/o timeout")),
	}
	for _, err := range ambiguous {
		if ProviderAnswered(err) {
			t.Fatalf("%v was classified as a definite refusal — it would authorise an unsafe retry or auto-reverse", err)
		}
	}
}

func TestProviderAnswered_NilIsNotAnAnswer(t *testing.T) {
	if ProviderAnswered(nil) {
		t.Fatal("nil must not be classified as a refusal")
	}
}

// ── billOutcome ─────────────────────────────────────────────────────────────

func TestBillOutcome(t *testing.T) {
	cases := []struct {
		status string
		want   ProviderOutcome
	}{
		{"SUCCESS", ProviderOutcomeSuccessful},
		{"success", ProviderOutcomeSuccessful}, // case-insensitive, defensively
		{"PENDING", ProviderOutcomePending},
		{"FAILED", ProviderOutcomeFailed},
		{"", ProviderOutcomeFailed},
		{"WHO KNOWS", ProviderOutcomeFailed}, // unrecognised → failed, per the state machine
	}
	for _, tc := range cases {
		if got := billOutcome(&provider.Bill{Status: tc.status}); got != tc.want {
			t.Fatalf("status %q: got %s want %s", tc.status, got, tc.want)
		}
	}
	if got := billOutcome(nil); got != ProviderOutcomeFailed {
		t.Fatalf("nil bill: got %s want failed", got)
	}
}

// ── ProviderRegistry ────────────────────────────────────────────────────────

type stubBills struct{ name string }

func (s stubBills) PurchaseBill(context.Context, provider.BillRequest) (*provider.Bill, error) {
	return nil, nil
}
func (s stubBills) GetBill(context.Context, string) (*provider.Bill, error) { return nil, nil }
func (s stubBills) Name() string                                            { return s.name }

type stubValidatingBills struct{ stubBills }

func (s stubValidatingBills) ValidateCustomer(context.Context, provider.BillValidationRequest) (*provider.BillValidation, error) {
	return &provider.BillValidation{Valid: true}, nil
}

func TestProviderRegistry_DropsNilAdapters(t *testing.T) {
	// A nil stored in the map would produce a non-nil interface value that panics
	// at the call site — the classic Go nil-interface trap.
	reg := NewProviderRegistry(map[string]provider.BillsProvider{
		"vtpass": stubBills{name: "vtpass"},
		"ghost":  nil,
		"":       stubBills{name: "unnamed"},
	})
	if _, ok := reg.Adapter("ghost"); ok {
		t.Fatal("nil adapter was registered")
	}
	if _, ok := reg.Adapter(""); ok {
		t.Fatal("empty adapter code was registered")
	}
	if _, ok := reg.Adapter("vtpass"); !ok {
		t.Fatal("vtpass adapter missing")
	}
}

func TestProviderRegistry_ValidatorIsOptional(t *testing.T) {
	reg := NewProviderRegistry(map[string]provider.BillsProvider{
		"plain":      stubBills{name: "plain"},
		"validating": stubValidatingBills{stubBills{name: "validating"}},
	})
	if _, ok := reg.Validator("plain"); ok {
		t.Fatal("an adapter without ValidateCustomer must not satisfy BillsValidator")
	}
	if _, ok := reg.Validator("validating"); !ok {
		t.Fatal("an adapter with ValidateCustomer must satisfy BillsValidator")
	}
	if _, ok := reg.Validator("absent"); ok {
		t.Fatal("unknown adapter must not resolve")
	}
}

func TestProviderRegistry_AdapterCodesAreSorted(t *testing.T) {
	reg := NewProviderRegistry(map[string]provider.BillsProvider{
		"zeta":  stubBills{name: "zeta"},
		"alpha": stubBills{name: "alpha"},
	})
	got := reg.AdapterCodes()
	if len(got) != 2 || got[0] != "alpha" || got[1] != "zeta" {
		t.Fatalf("expected sorted codes, got %v", got)
	}
}

// ── ReceiptNumber / ParseCategory ───────────────────────────────────────────

func TestReceiptNumber(t *testing.T) {
	at := time.Date(2026, 9, 15, 13, 45, 0, 0, time.UTC)
	got := ReceiptNumber("9f3c1a2b-4d5e-6f70-8192-a3b4c5d6e7f8", at)
	if got != "UTL-20260915-9F3C1A2B" {
		t.Fatalf("got %q want %q", got, "UTL-20260915-9F3C1A2B")
	}
	// A short id must not panic on the slice.
	if got := ReceiptNumber("abc", at); got != "UTL-20260915-ABC" {
		t.Fatalf("short id: got %q", got)
	}
}

func TestParseCategory(t *testing.T) {
	for _, valid := range []string{"airtime", "data", "electricity", "cable_tv", "internet", "education"} {
		if _, err := ParseCategory(valid); err != nil {
			t.Fatalf("%s should be valid: %v", valid, err)
		}
	}
	for _, invalid := range []string{"", "Airtime", "water", "cable-tv"} {
		if _, err := ParseCategory(invalid); !errors.Is(err, ErrInvalidCategory) {
			t.Fatalf("%q should be rejected, got %v", invalid, err)
		}
	}
}

// ── ProviderRow.TimeoutMs ───────────────────────────────────────────────────

func TestProviderRowTimeoutMs(t *testing.T) {
	cases := []struct {
		name     string
		config   string
		fallback int
		want     int
	}{
		{"no config uses fallback", ``, 20_000, 20_000},
		{"empty object uses fallback", `{}`, 20_000, 20_000},
		{"config wins", `{"timeout_ms":30000}`, 20_000, 30_000},
		{"config below floor ignored", `{"timeout_ms":500}`, 20_000, 20_000},
		{"config above cap clamped", `{"timeout_ms":999999}`, 20_000, 120_000},
		{"fallback above cap clamped", ``, 999_999, 120_000},
		{"fallback below floor defaults", ``, 10, 15_000},
		{"non-numeric config ignored", `{"timeout_ms":"soon"}`, 20_000, 20_000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := ProviderRow{Config: []byte(tc.config)}
			if got := p.TimeoutMs(tc.fallback); got != tc.want {
				t.Fatalf("got %d want %d", got, tc.want)
			}
		})
	}
}

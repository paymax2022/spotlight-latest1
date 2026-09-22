package utilitybills

import (
	"errors"
	"testing"
)

func activeMapping() ProviderMapping {
	return ProviderMapping{Status: MappingStatusActive}
}

func TestGetViableRoutes_DisabledProviderFilteredOut(t *testing.T) {
	candidates := []RouteCandidate{
		{
			Provider: Provider{ID: "p1", Status: ProviderStatusDisabled, HealthStatus: HealthHealthy, SupportedCategories: []Category{CategoryElectricity}},
			Mapping:  activeMapping(),
		},
	}
	got := GetViableRoutes(candidates, CategoryElectricity)
	if len(got) != 0 {
		t.Errorf("GetViableRoutes() = %+v, want empty (disabled provider)", got)
	}
}

func TestGetViableRoutes_MaintenanceProviderFilteredOut(t *testing.T) {
	candidates := []RouteCandidate{
		{
			Provider: Provider{ID: "p1", Status: ProviderStatusMaintenance, HealthStatus: HealthHealthy, SupportedCategories: []Category{CategoryElectricity}},
			Mapping:  activeMapping(),
		},
	}
	got := GetViableRoutes(candidates, CategoryElectricity)
	if len(got) != 0 {
		t.Errorf("GetViableRoutes() = %+v, want empty (maintenance provider)", got)
	}
}

func TestGetViableRoutes_DisabledMappingFilteredOut(t *testing.T) {
	candidates := []RouteCandidate{
		{
			Provider: Provider{ID: "p1", Status: ProviderStatusActive, HealthStatus: HealthHealthy, SupportedCategories: []Category{CategoryElectricity}},
			Mapping:  ProviderMapping{Status: MappingStatusDisabled},
		},
	}
	got := GetViableRoutes(candidates, CategoryElectricity)
	if len(got) != 0 {
		t.Errorf("GetViableRoutes() = %+v, want empty (disabled mapping)", got)
	}
}

func TestGetViableRoutes_DownHealthProviderFilteredOut(t *testing.T) {
	candidates := []RouteCandidate{
		{
			Provider: Provider{ID: "p1", Status: ProviderStatusActive, HealthStatus: HealthDown, SupportedCategories: []Category{CategoryElectricity}},
			Mapping:  activeMapping(),
		},
	}
	got := GetViableRoutes(candidates, CategoryElectricity)
	if len(got) != 0 {
		t.Errorf("GetViableRoutes() = %+v, want empty (down health)", got)
	}
}

// Only HealthDown excludes a route — degraded/unknown providers stay
// eligible, mirroring routing.ts's `provider.health_status !== 'down'`
// (not an allow-list of only "healthy").
func TestGetViableRoutes_DegradedAndUnknownHealthAreNotFilteredOut(t *testing.T) {
	candidates := []RouteCandidate{
		{Provider: Provider{ID: "degraded", Status: ProviderStatusActive, HealthStatus: HealthDegraded, SupportedCategories: []Category{CategoryElectricity}}, Mapping: activeMapping()},
		{Provider: Provider{ID: "unknown", Status: ProviderStatusActive, HealthStatus: HealthUnknown, SupportedCategories: []Category{CategoryElectricity}}, Mapping: activeMapping()},
	}
	got := GetViableRoutes(candidates, CategoryElectricity)
	if len(got) != 2 {
		t.Errorf("GetViableRoutes() returned %d routes, want 2 (degraded/unknown must stay eligible)", len(got))
	}
}

func TestGetViableRoutes_CategoryMismatchFilteredOut(t *testing.T) {
	candidates := []RouteCandidate{
		{
			Provider: Provider{ID: "p1", Status: ProviderStatusActive, HealthStatus: HealthHealthy, SupportedCategories: []Category{CategoryAirtime, CategoryData}},
			Mapping:  activeMapping(),
		},
	}
	got := GetViableRoutes(candidates, CategoryElectricity)
	if len(got) != 0 {
		t.Errorf("GetViableRoutes() = %+v, want empty (category not supported)", got)
	}
}

func TestGetViableRoutes_SortsByRoutePriorityThenProviderPriorityTiebreak(t *testing.T) {
	// Two candidates share RouteCandidate.Priority (0); the lower
	// Provider.Priority must win. A third candidate has a worse (higher)
	// RouteCandidate.Priority and must sort last regardless of its
	// Provider.Priority being the lowest of all three.
	slow := RouteCandidate{
		Provider: Provider{ID: "slow-provider", Status: ProviderStatusActive, HealthStatus: HealthHealthy, SupportedCategories: []Category{CategoryElectricity}, Priority: 5},
		Mapping:  activeMapping(),
		Priority: 0,
	}
	fast := RouteCandidate{
		Provider: Provider{ID: "fast-provider", Status: ProviderStatusActive, HealthStatus: HealthHealthy, SupportedCategories: []Category{CategoryElectricity}, Priority: 1},
		Mapping:  activeMapping(),
		Priority: 0,
	}
	deprioritizedRoute := RouteCandidate{
		Provider: Provider{ID: "best-provider-worst-route", Status: ProviderStatusActive, HealthStatus: HealthHealthy, SupportedCategories: []Category{CategoryElectricity}, Priority: 0},
		Mapping:  activeMapping(),
		Priority: 9,
	}

	got := GetViableRoutes([]RouteCandidate{slow, deprioritizedRoute, fast}, CategoryElectricity)
	if len(got) != 3 {
		t.Fatalf("GetViableRoutes() returned %d routes, want 3", len(got))
	}
	wantOrder := []string{"fast-provider", "slow-provider", "best-provider-worst-route"}
	for i, id := range wantOrder {
		if got[i].Provider.ID != id {
			t.Errorf("position %d: got provider %q, want %q (full order: %v)", i, got[i].Provider.ID, id, providerIDs(got))
		}
	}
}

func providerIDs(routes []RouteCandidate) []string {
	ids := make([]string, len(routes))
	for i, r := range routes {
		ids[i] = r.Provider.ID
	}
	return ids
}

func TestSelectProvider_ReturnsHighestPriorityViableRoute(t *testing.T) {
	best := RouteCandidate{
		Provider: Provider{ID: "best", Status: ProviderStatusActive, HealthStatus: HealthHealthy, SupportedCategories: []Category{CategoryElectricity}, Priority: 0},
		Mapping:  activeMapping(),
		Priority: 0,
	}
	worse := RouteCandidate{
		Provider: Provider{ID: "worse", Status: ProviderStatusActive, HealthStatus: HealthHealthy, SupportedCategories: []Category{CategoryElectricity}, Priority: 1},
		Mapping:  activeMapping(),
		Priority: 0,
	}

	got, err := SelectProvider([]RouteCandidate{worse, best}, CategoryElectricity)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Provider.ID != "best" {
		t.Errorf("SelectProvider() = provider %q, want %q", got.Provider.ID, "best")
	}
}

func TestSelectProvider_EmptyViableListReturnsErrNoViableRoute(t *testing.T) {
	candidates := []RouteCandidate{
		{
			Provider: Provider{ID: "p1", Status: ProviderStatusDisabled, HealthStatus: HealthHealthy, SupportedCategories: []Category{CategoryElectricity}},
			Mapping:  activeMapping(),
		},
	}
	_, err := SelectProvider(candidates, CategoryElectricity)
	if !errors.Is(err, ErrNoViableRoute) {
		t.Errorf("err = %v, want ErrNoViableRoute", err)
	}
}

func TestSelectProvider_EmptyCandidateListReturnsErrNoViableRoute(t *testing.T) {
	_, err := SelectProvider(nil, CategoryElectricity)
	if !errors.Is(err, ErrNoViableRoute) {
		t.Errorf("err = %v, want ErrNoViableRoute", err)
	}
}

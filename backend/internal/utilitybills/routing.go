package utilitybills

import "sort"

// This file ports frontend-web/src/server/utility/routing.ts (39 lines)
// exactly: getViableUtilityRoutes / selectUtilityProvider's filter chain and
// priority sort.
//
// routing.ts's exported functions take an `input: { category, product,
// amountKobo }` bag, but only `input.category` is ever read in the filter
// chain — `product` and `amountKobo` are unused dead parameters in the TS
// source. GetViableRoutes/SelectProvider below take just `category`,
// matching actual behavior rather than the wider unused signature; flagged
// as a judgment call in the task report.

// GetViableRoutes mirrors routing.ts's getViableUtilityRoutes: filters
// candidates through the full AND chain (provider active, mapping active,
// health not down, category supported), then sorts ascending by
// (RouteCandidate.Priority, Provider.Priority) — lower number tried first,
// route-level priority breaking ties before provider-level priority.
func GetViableRoutes(candidates []RouteCandidate, category Category) []RouteCandidate {
	viable := make([]RouteCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.Provider.Status != ProviderStatusActive {
			continue
		}
		if candidate.Mapping.Status != MappingStatusActive {
			continue
		}
		if candidate.Provider.HealthStatus == HealthDown {
			continue
		}
		if !supportsCategory(candidate.Provider.SupportedCategories, category) {
			continue
		}
		viable = append(viable, candidate)
	}

	// SliceStable to mirror Array.prototype.sort, stable since ES2019 (the
	// JS engines this codebase targets) — candidates that compare equal on
	// both priorities keep their input relative order rather than an
	// arbitrary one.
	sort.SliceStable(viable, func(i, j int) bool {
		if viable[i].Priority != viable[j].Priority {
			return viable[i].Priority < viable[j].Priority
		}
		return viable[i].Provider.Priority < viable[j].Provider.Priority
	})

	return viable
}

// SelectProvider mirrors routing.ts's selectUtilityProvider: the first
// viable route, or ErrNoViableRoute if none exist.
func SelectProvider(candidates []RouteCandidate, category Category) (RouteCandidate, error) {
	viable := GetViableRoutes(candidates, category)
	if len(viable) == 0 {
		return RouteCandidate{}, ErrNoViableRoute
	}
	return viable[0], nil
}

func supportsCategory(supported []Category, category Category) bool {
	for _, c := range supported {
		if c == category {
			return true
		}
	}
	return false
}

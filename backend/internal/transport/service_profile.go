package transport

import (
	"context"
	_ "embed"
	"encoding/json"
	"net/http"
	"strings"
)

// Canonical allow-lists for delivery-provider onboarding (Slice A). The server
// owns these so the mobile client and DB validation cannot drift (the lesson
// from the insurance doc_type 500). Order is the display order.
var serviceInterestOptions = []Option{
	{Value: "rides", Label: "Rides"},
	{Value: "parcel_delivery", Label: "Parcel delivery"},
	{Value: "bus_services", Label: "Bus services"},
	{Value: "car_bus_hire", Label: "Car / bus hire"},
	{Value: "movers", Label: "Movers"},
	{Value: "bulk_goods_delivery", Label: "Bulk goods delivery"},
	{Value: "bus_shuttle", Label: "Bus hailing / shuttle"},
}

// Coverage areas are every LGA of every state (plus the FCT), grouped by state
// so onboarding can ask for a state first and then offer that state's cities.
// The dataset is the same one the mobile app ships (data/nigeria.ts); it is
// embedded here so the server still owns the allow-list the client and DB
// validation agree on.
//
// A driver covers ONE state, but the stored value is still fully qualified —
// "<state>/<lga>" — because six LGA names exist in more than one state (e.g.
// Bassa in Kogi and Plateau). The bare area name would be ambiguous on read.
//
//go:embed data/nigeria_states.json
var nigeriaStatesJSON []byte

type nigeriaState struct {
	Name string   `json:"name"`
	LGAs []string `json:"lgas"`
}

var (
	stateOptions        []Option
	coverageAreaOptions []Option
)

func init() {
	var states []nigeriaState
	if err := json.Unmarshal(nigeriaStatesJSON, &states); err != nil {
		// A corrupt embedded asset is a build-time defect, not a runtime
		// condition — fail loudly at startup rather than serve an empty list.
		panic("transport: embedded data/nigeria_states.json: " + err.Error())
	}
	for _, s := range states {
		stateSlug := areaSlug(s.Name)
		stateOptions = append(stateOptions, Option{Value: stateSlug, Label: s.Name})
		for _, lga := range s.LGAs {
			coverageAreaOptions = append(coverageAreaOptions, Option{
				Value: stateSlug + "/" + areaSlug(lga),
				Label: lga,
				State: stateSlug,
			})
		}
	}
}

// areaSlug lowers a display name to the id form used in coverage_areas:
// lowercase, every run of non-alphanumerics collapsed to one underscore, no
// leading/trailing underscore. "FCT - Abuja" → "fct_abuja",
// "Irepodun/Ifelodun" → "irepodun_ifelodun". The mobile client applies the same
// rule in deliveryOnboarding.areaSlug so the two lists cannot disagree.
func areaSlug(name string) string {
	var b strings.Builder
	pendingUnderscore := false
	for _, r := range strings.ToLower(name) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			if pendingUnderscore && b.Len() > 0 {
				b.WriteByte('_')
			}
			pendingUnderscore = false
			b.WriteRune(r)
			continue
		}
		pendingUnderscore = true
	}
	return b.String()
}

// Option is one selectable value plus its human label. State is set on coverage
// areas so the client can filter a state's cities without a second lookup.
type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
	State string `json:"state,omitempty"`
}

// OnboardingOptionsResp is the body of GET /driver/onboarding-options.
type OnboardingOptionsResp struct {
	Services      []Option `json:"services"`
	States        []Option `json:"states"`
	CoverageAreas []Option `json:"coverage_areas"`
}

// OnboardingOptions returns the canonical selectable services, states and
// coverage areas. CoverageAreas is flat; each entry carries its state so the
// client can show a state first and then only that state's cities.
func OnboardingOptions() OnboardingOptionsResp {
	return OnboardingOptionsResp{
		Services:      serviceInterestOptions,
		States:        stateOptions,
		CoverageAreas: coverageAreaOptions,
	}
}

func allowedSet(opts []Option) map[string]bool {
	m := make(map[string]bool, len(opts))
	for _, o := range opts {
		m[o.Value] = true
	}
	return m
}

// dedupeAllowed keeps the first occurrence of each value, in input order, and
// errors on the first value not in the allow-list.
func dedupeAllowed(values []string, allowed map[string]bool, label string) ([]string, error) {
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, v := range values {
		if !allowed[v] {
			return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "unknown "+label+": "+v)
		}
		if seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out, nil
}

func validateServiceInterests(values []string) ([]string, error) {
	return dedupeAllowed(values, allowedSet(serviceInterestOptions), "service interest")
}

func validateCoverageAreas(values []string) ([]string, error) {
	return dedupeAllowed(values, allowedSet(coverageAreaOptions), "coverage area")
}

// SetServiceProfile validates and persists a driver's service interests and
// coverage areas (an overwrite of both array columns). Returns the stored,
// deduped values. No money path, so no Idempotency-Key.
func (s *Service) SetServiceProfile(ctx context.Context, userID string, interests, areas []string) ([]string, []string, error) {
	driverID, err := s.resolveDriverID(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	vi, err := validateServiceInterests(interests)
	if err != nil {
		return nil, nil, err
	}
	ca, err := validateCoverageAreas(areas)
	if err != nil {
		return nil, nil, err
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE drivers SET service_interests=$2, coverage_areas=$3 WHERE id=$1`,
		driverID, vi, ca); err != nil {
		return nil, nil, err
	}
	return vi, ca, nil
}

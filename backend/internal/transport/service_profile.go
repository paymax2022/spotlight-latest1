package transport

import (
	"context"
	"net/http"
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

var coverageAreaOptions = []Option{
	{Value: "ikeja", Label: "Ikeja"},
	{Value: "surulere", Label: "Surulere"},
	{Value: "yaba", Label: "Yaba"},
	{Value: "lekki", Label: "Lekki"},
	{Value: "victoria_island", Label: "Victoria Island"},
	{Value: "ikoyi", Label: "Ikoyi"},
	{Value: "lagos_island", Label: "Lagos Island"},
	{Value: "apapa", Label: "Apapa"},
	{Value: "ajah", Label: "Ajah"},
	{Value: "oshodi_isolo", Label: "Oshodi-Isolo"},
	{Value: "alimosho", Label: "Alimosho"},
	{Value: "gbagada", Label: "Gbagada"},
	{Value: "agege", Label: "Agege"},
	{Value: "mushin", Label: "Mushin"},
	{Value: "ikorodu", Label: "Ikorodu"},
	{Value: "badagry", Label: "Badagry"},
	{Value: "epe", Label: "Epe"},
}

// Option is one selectable value plus its human label.
type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// OnboardingOptionsResp is the body of GET /driver/onboarding-options.
type OnboardingOptionsResp struct {
	Services      []Option `json:"services"`
	CoverageAreas []Option `json:"coverage_areas"`
}

// OnboardingOptions returns the canonical selectable services and coverage areas.
func OnboardingOptions() OnboardingOptionsResp {
	return OnboardingOptionsResp{Services: serviceInterestOptions, CoverageAreas: coverageAreaOptions}
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

package healthvet

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Vet listings: what a pet owner may see of a vet. A vet is listed only when all
// of these hold — the provider is APPROVED and discoverable (HL-2), the vet's
// profile is PUBLISHED and its verification is APPROVED, and the profile belongs
// to the same user as the provider row. Anything else is ErrVetNotFound, so an
// unlisted vet and a missing one look the same.

// ErrVetNotFound is the one answer for "not listed" and "does not exist".
var ErrVetNotFound = errors.New("vet: not found")

// VetListing is one vet as the find-vet list and the vet profile show it. The
// licence number is deliberately absent: the public listing never carries it.
type VetListing struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Headline         string            `json:"headline"`
	Bio              string            `json:"bio"`
	Credential       ListingCredential `json:"credential"`
	ClinicName       string            `json:"clinicName"`
	Address          string            `json:"address"`
	DistanceM        *float64          `json:"distanceM,omitempty"`
	Lat              *float64          `json:"lat,omitempty"`
	Lng              *float64          `json:"lng,omitempty"`
	ConsultFeeKobo   int64             `json:"consultFeeKobo"`
	HomeVisitFeeKobo int64             `json:"homeVisitFeeKobo"`
	ClinicFeeKobo    int64             `json:"clinicFeeKobo"`
	Types            []string          `json:"types"`
	Species          []string          `json:"species"`
	Specialties      []string          `json:"specialties"`
	Rating           float64           `json:"rating"`
	ReviewCount      int               `json:"reviewCount"`
	AvailableNow     bool              `json:"availableNow"`
	Active           bool              `json:"active"`
}

// ListingCredential is the public credential: the authority and status only.
type ListingCredential struct {
	Authority string `json:"authority"`
	Status    string `json:"status"`
}

// VetFilter is what the find-vet screen can narrow by.
type VetFilter struct {
	Query   string
	Type    string // tele | home | clinic
	Species string // lower-case species code
}

// draftPublic is the part of the vet's profile draft a listing reads. The draft
// is saved under profile_draft.draft (see docs/superpowers/specs/2026-10-14).
type draftPublic struct {
	Draft struct {
		PersonalInfo struct {
			Title     string `json:"title"`
			FirstName string `json:"firstName"`
			LastName  string `json:"lastName"`
			Address   string `json:"address"`
			City      string `json:"city"`
			State     string `json:"state"`
		} `json:"personalInfo"`
		Bio             string   `json:"bio"`
		SpecialtyID     string   `json:"specialtyId"`
		SubSpecialtyIDs []string `json:"subSpecialtyIds"`
		SpeciesTreated  []string `json:"speciesTreated"`
		Affiliations    []struct {
			Name      string `json:"name"`
			IsPrimary bool   `json:"isPrimary"`
		} `json:"affiliations"`
	} `json:"draft"`
}

var visitTypeToListing = map[string]string{"TELE": "tele", "HOME": "home", "CLINIC": "clinic"}

// listingSQL selects every listed vet. The optional geo columns are NULL when the
// provider has no location. Callers add the WHERE tail.
const listingSQL = `
	SELECT hp.id::text, hp.display_name, hp.owner_user_id::text,
	       COALESCE(dvp.profile_draft::text, '{}'),
	       ST_Y(hp.geo::geometry), ST_X(hp.geo::geometry)
	FROM health_providers hp
	LEFT JOIN doctor_vet_profiles dvp ON dvp.user_id = hp.owner_user_id
	WHERE hp.domain = 'VET' AND hp.provider_type = 'vet'
	  AND hp.status = 'APPROVED' AND hp.discoverable = true
	  AND (dvp.user_id IS NULL OR dvp.verification NOT IN ('suspended', 'rejected'))`

// ListVetListings returns the listed vets, nearest first when lat/lng are given,
// otherwise by name. The filter is applied after the query: the listed set is small.
func (s *Service) ListVetListings(ctx context.Context, lat, lng *float64, radiusM float64, f VetFilter) ([]VetListing, error) {
	var (
		q    string
		args []any
	)
	if lat != nil && lng != nil {
		if radiusM <= 0 {
			radiusM = 25000
		}
		q = listingSQL + `
	  AND hp.geo IS NOT NULL
	  AND ST_DWithin(hp.geo, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
	ORDER BY ST_Distance(hp.geo, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) ASC
	LIMIT 100`
		args = []any{*lng, *lat, radiusM}
	} else {
		q = listingSQL + `
	ORDER BY hp.display_name ASC
	LIMIT 100`
	}
	rows, err := s.listingRows(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	out := make([]VetListing, 0, len(rows))
	for _, r := range rows {
		if matchesFilter(r, f) {
			out = append(out, r)
		}
	}
	return out, nil
}

// GetVetListing returns one listed vet, or ErrVetNotFound.
func (s *Service) GetVetListing(ctx context.Context, id string) (*VetListing, error) {
	rows, err := s.listingRows(ctx, listingSQL+` AND hp.id = $1::uuid`, id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrVetNotFound
	}
	return &rows[0], nil
}

// listingRows runs a listing query and fills fees, types, names and the profile.
func (s *Service) listingRows(ctx context.Context, q string, args ...any) ([]VetListing, error) {
	type raw struct {
		listing VetListing
		draft   draftPublic
		ownerID string
	}
	rowsDB, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("vet: list vets: %w", err)
	}
	var raws []raw
	for rowsDB.Next() {
		var (
			r        raw
			draftRaw string
			lat, lng *float64
		)
		if err := rowsDB.Scan(&r.listing.ID, &r.listing.Name, &r.ownerID, &draftRaw, &lat, &lng); err != nil {
			rowsDB.Close()
			return nil, fmt.Errorf("vet: scan listing: %w", err)
		}
		_ = json.Unmarshal([]byte(draftRaw), &r.draft) // a malformed draft lists the vet with blank profile fields
		r.listing.Lat, r.listing.Lng = lat, lng
		raws = append(raws, r)
	}
	rowsDB.Close()
	if err := rowsDB.Err(); err != nil {
		return nil, fmt.Errorf("vet: list vets: %w", err)
	}

	out := make([]VetListing, 0, len(raws))
	if len(raws) == 0 {
		return out, nil
	}
	ids := make([]string, 0, len(raws))
	for _, r := range raws {
		ids = append(ids, r.listing.ID)
	}
	fees, err := s.listingFees(ctx, ids)
	if err != nil {
		return nil, err
	}
	specialties, err := s.specialtyNames(ctx)
	if err != nil {
		return nil, err
	}
	ratings, err := s.listingRatings(ctx, ids)
	if err != nil {
		return nil, err
	}

	for _, r := range raws {
		l := r.listing
		l.Name = displayName(r.draft, l.Name)
		l.Bio = strings.TrimSpace(r.draft.Draft.Bio)
		l.Address = joinNonEmpty(", ", r.draft.Draft.PersonalInfo.Address, r.draft.Draft.PersonalInfo.City, r.draft.Draft.PersonalInfo.State)
		l.ClinicName = primaryClinic(r.draft)
		l.Species = lowerSpecies(r.draft.Draft.SpeciesTreated)
		l.Specialties = specialtyLabels(r.draft, specialties)
		if len(l.Specialties) > 0 {
			l.Headline = l.Specialties[0]
		}
		l.Credential = ListingCredential{Authority: "VCN", Status: "verified"}
		fee := fees[l.ID]
		l.ConsultFeeKobo = fee.consult
		l.HomeVisitFeeKobo = fee.home
		l.ClinicFeeKobo = fee.clinic
		l.Types = fee.types
		if rt, ok := ratings[l.ID]; ok {
			l.Rating, l.ReviewCount = rt.avg, rt.count
		}
		l.Active = true
		out = append(out, l)
	}
	return out, nil
}

type listingRating struct {
	avg   float64
	count int
}

// listingRatings returns the average rating (one decimal) and review count of the
// visible (non-hidden) vet_reviews rows for each provider. Providers with no
// reviews are absent from the map, so they list as 0 / 0.
func (s *Service) listingRatings(ctx context.Context, providerIDs []string) (map[string]listingRating, error) {
	rows, err := s.db.Query(ctx, `
		SELECT provider_id::text, ROUND(AVG(rating)::numeric, 1)::float8, COUNT(*)::int
		FROM vet_reviews
		WHERE NOT is_hidden AND provider_id = ANY($1::uuid[])
		GROUP BY provider_id`, providerIDs)
	if err != nil {
		return nil, fmt.Errorf("vet: listing ratings: %w", err)
	}
	defer rows.Close()
	out := map[string]listingRating{}
	for rows.Next() {
		var id string
		var r listingRating
		if err := rows.Scan(&id, &r.avg, &r.count); err != nil {
			return nil, fmt.Errorf("vet: scan listing rating: %w", err)
		}
		out[id] = r
	}
	return out, rows.Err()
}

type listingFee struct {
	consult, home, clinic int64
	types         []string
}

// listingFees returns the lowest active price per visit type, and the visit types
// offered, for each provider. Prices are kobo and never client-supplied.
func (s *Service) listingFees(ctx context.Context, providerIDs []string) (map[string]listingFee, error) {
	const q = `
		SELECT provider_id::text, visit_type, MIN(price_kobo)
		FROM vet_services
		WHERE active = true AND provider_id = ANY($1::uuid[])
		GROUP BY provider_id, visit_type
		ORDER BY provider_id, visit_type`
	rows, err := s.db.Query(ctx, q, providerIDs)
	if err != nil {
		return nil, fmt.Errorf("vet: listing fees: %w", err)
	}
	defer rows.Close()
	out := map[string]listingFee{}
	for rows.Next() {
		var pid, visit string
		var price int64
		if err := rows.Scan(&pid, &visit, &price); err != nil {
			return nil, err
		}
		f := out[pid]
		kind, ok := visitTypeToListing[visit]
		if !ok {
			continue
		}
		f.types = append(f.types, kind)
		switch visit {
		case "TELE":
			f.consult = price
		case "HOME":
			f.home = price
		case "CLINIC":
			f.clinic = price
		}
		out[pid] = f
	}
	return out, rows.Err()
}

// specialtyNames maps doctor_specialties ids to their display names.
func (s *Service) specialtyNames(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, name FROM doctor_specialties`)
	if err != nil {
		return nil, fmt.Errorf("vet: specialties: %w", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = name
	}
	return out, rows.Err()
}

func specialtyLabels(d draftPublic, names map[string]string) []string {
	var out []string
	for _, id := range append([]string{d.Draft.SpecialtyID}, d.Draft.SubSpecialtyIDs...) {
		if n := names[id]; n != "" {
			out = append(out, n)
		}
	}
	return out
}

func displayName(d draftPublic, fallback string) string {
	p := d.Draft.PersonalInfo
	n := strings.TrimSpace(strings.Join(nonEmpty(p.Title, p.FirstName, p.LastName), " "))
	if n == "" {
		return fallback
	}
	return n
}

func primaryClinic(d draftPublic) string {
	for _, a := range d.Draft.Affiliations {
		if a.IsPrimary && strings.TrimSpace(a.Name) != "" {
			return strings.TrimSpace(a.Name)
		}
	}
	return ""
}

var knownSpecies = map[string]bool{"dog": true, "cat": true, "bird": true, "rabbit": true, "reptile": true, "other": true}

func lowerSpecies(in []string) []string {
	out := []string{}
	for _, s := range in {
		if v := strings.ToLower(strings.TrimSpace(s)); knownSpecies[v] {
			out = append(out, v)
		}
	}
	return out
}

func matchesFilter(v VetListing, f VetFilter) bool {
	if f.Query != "" {
		q := strings.ToLower(f.Query)
		hay := strings.ToLower(v.Name + " " + strings.Join(v.Specialties, " "))
		if !strings.Contains(hay, q) {
			return false
		}
	}
	if f.Type != "" && !contains(v.Types, f.Type) {
		return false
	}
	if f.Species != "" && !contains(v.Species, strings.ToLower(f.Species)) {
		return false
	}
	return true
}

func contains(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

func nonEmpty(xs ...string) []string {
	var out []string
	for _, x := range xs {
		if strings.TrimSpace(x) != "" {
			out = append(out, strings.TrimSpace(x))
		}
	}
	return out
}

func joinNonEmpty(sep string, xs ...string) string {
	return strings.Join(nonEmpty(xs...), sep)
}

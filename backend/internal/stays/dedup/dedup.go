package dedup

import (
	"context"
	"math"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/stays/gateway"
)

// The dedup layer sits ABOVE the supply adapters. The same hotel surfaced from
// multiple rails must show ONCE, and the lowest BOOKABLE total wins; genuine
// conflicts route to an admin mapping queue (stays_mapping_record). This is a
// fuzzy name+geo+address mapping skeleton — the production-grade matcher (Vervotech
// style, PRD §5.3) plugs in here without changing the gateway or service.
//
// best-bookable-rate selection: after dedup groups offers by mapped_property_id,
// the cheapest total (incl. tax, after the pricing engine) per group is kept and
// the winning rail is recorded.

// Service performs mapping + dedup + best-rate selection.
type Service struct {
	db *pgxpool.Pool
	// matchThreshold is the confidence above which two offers auto-map. Below it,
	// a candidate is queued for admin review (D-7). Config-driven.
	matchThreshold float64
}

// NewService constructs the dedup service. threshold<=0 uses a sane default.
func NewService(db *pgxpool.Pool, threshold float64) *Service {
	if threshold <= 0 {
		threshold = 0.82
	}
	return &Service{db: db, matchThreshold: threshold}
}

// PricedTotal is the function the pricing engine exposes so dedup can compare the
// final BOOKABLE total (display price incl. markup/commission + tax + FX) — never
// the raw net rate. Injected to avoid a dedup→pricing import.
type PricedTotal func(o gateway.PropertyOffer) int64

// Dedup maps each offer to a mapped_property_id, groups by it, and returns ONE
// best-bookable offer per group (lowest priced total). Offers whose identity is
// ambiguous are still returned but flagged for the mapping queue by EnqueueConflicts.
func (s *Service) Dedup(ctx context.Context, offers []gateway.PropertyOffer, priced PricedTotal) []gateway.PropertyOffer {
	if priced == nil {
		priced = func(o gateway.PropertyOffer) int64 { return o.NetRateKobo + o.TaxKobo }
	}
	// Assign a mapped id to each offer (DB-backed mapping first, else a synthesised
	// fingerprint so identical hotels across rails collapse).
	for i := range offers {
		if offers[i].MappedPropertyID == "" {
			offers[i].MappedPropertyID = s.resolveMappedID(ctx, offers[i])
		}
	}
	// Group by mapped id; keep the lowest bookable total per group.
	best := map[string]gateway.PropertyOffer{}
	for _, o := range offers {
		cur, ok := best[o.MappedPropertyID]
		if !ok || priced(o) < priced(cur) {
			best[o.MappedPropertyID] = o
		}
	}
	out := make([]gateway.PropertyOffer, 0, len(best))
	for _, o := range best {
		out = append(out, o)
	}
	// Stable order: cheapest first.
	sort.Slice(out, func(i, j int) bool { return priced(out[i]) < priced(out[j]) })
	return out
}

// resolveMappedID looks up an existing cross-supplier mapping; if none, it returns
// a deterministic fingerprint so the same physical hotel collapses across rails.
func (s *Service) resolveMappedID(ctx context.Context, o gateway.PropertyOffer) string {
	if s.db != nil {
		var mapped string
		err := s.db.QueryRow(ctx, `
			SELECT mapped_property_id FROM public.stays_mapping_record
			WHERE source_rail = $1 AND supplier_code = $2 AND supplier_property_ref = $3
			  AND status = 'MAPPED' AND mapped_property_id IS NOT NULL
			LIMIT 1`,
			string(o.Rail), o.SupplierCode, o.SupplierPropertyRef,
		).Scan(&mapped)
		if err == nil && mapped != "" {
			return mapped
		}
	}
	return fingerprint(o)
}

// EnqueueConflicts compares every cross-rail pair and, when two offers look like
// the same hotel with confidence below the auto-map threshold, records a candidate
// in the mapping queue for admin review (MAPPING_CONFLICT, PRD §28 A). High-
// confidence matches above the threshold are written as MAPPED auto-mappings.
func (s *Service) EnqueueConflicts(ctx context.Context, offers []gateway.PropertyOffer) error {
	if s.db == nil {
		return nil
	}
	for i := 0; i < len(offers); i++ {
		for j := i + 1; j < len(offers); j++ {
			a, b := offers[i], offers[j]
			if a.Rail == b.Rail {
				continue // only cross-rail identity is interesting
			}
			conf := similarity(a, b)
			if conf < 0.55 {
				continue // clearly different hotels
			}
			status := "PENDING_REVIEW"
			if conf >= s.matchThreshold {
				status = "MAPPED"
			}
			// Parameterized upsert into the mapping queue (additive; idempotent).
			_, err := s.db.Exec(ctx, `
				INSERT INTO public.stays_mapping_record
					(source_rail, supplier_code, supplier_property_ref, candidate_rail,
					 candidate_supplier_code, candidate_supplier_property_ref, confidence, status)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
				ON CONFLICT (source_rail, supplier_code, supplier_property_ref,
				             candidate_rail, candidate_supplier_code, candidate_supplier_property_ref)
				DO UPDATE SET confidence = EXCLUDED.confidence`,
				string(a.Rail), a.SupplierCode, a.SupplierPropertyRef,
				string(b.Rail), b.SupplierCode, b.SupplierPropertyRef,
				conf, status,
			)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

// --- fuzzy matching primitives (skeleton; swap for a production matcher) ---

// fingerprint builds a deterministic mapped id from normalised name + coarse geo so
// near-identical hotels across rails collapse to the same group.
func fingerprint(o gateway.PropertyOffer) string {
	name := normalize(o.Name)
	// Round geo to ~100m grid so two suppliers' slightly different coordinates for
	// the same hotel land in the same cell.
	cell := func(f float64) int { return int(math.Round(f * 1000)) }
	var sb strings.Builder
	sb.WriteString("fp:")
	sb.WriteString(name)
	sb.WriteString(":")
	sb.WriteString(strings.ToLower(normalize(o.City)))
	if o.Lat != 0 || o.Lng != 0 {
		sb.WriteString(":")
		sb.WriteString(itoa(cell(o.Lat)))
		sb.WriteString(",")
		sb.WriteString(itoa(cell(o.Lng)))
	}
	return sb.String()
}

// similarity scores two offers as the same hotel (0..1) on name + geo + address.
func similarity(a, b gateway.PropertyOffer) float64 {
	nameScore := jaccard(tokens(a.Name), tokens(b.Name))
	addrScore := jaccard(tokens(a.Address), tokens(b.Address))
	geoScore := 0.0
	if (a.Lat != 0 || a.Lng != 0) && (b.Lat != 0 || b.Lng != 0) {
		km := haversineKm(a.Lat, a.Lng, b.Lat, b.Lng)
		switch {
		case km < 0.05:
			geoScore = 1.0
		case km < 0.2:
			geoScore = 0.8
		case km < 0.5:
			geoScore = 0.5
		default:
			geoScore = 0.0
		}
	}
	// Weighted: name dominates, geo strongly corroborates, address breaks ties.
	return 0.5*nameScore + 0.35*geoScore + 0.15*addrScore
}

func normalize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == ' ' {
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func tokens(s string) map[string]struct{} {
	m := map[string]struct{}{}
	for _, t := range strings.Fields(normalize(s)) {
		m[t] = struct{}{}
	}
	return m
}

func jaccard(a, b map[string]struct{}) float64 {
	if len(a) == 0 && len(b) == 0 {
		return 0
	}
	inter := 0
	for t := range a {
		if _, ok := b[t]; ok {
			inter++
		}
	}
	union := len(a) + len(b) - inter
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

// haversineKm returns great-circle distance in km.
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371.0
	dLat := rad(lat2 - lat1)
	dLng := rad(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return r * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func rad(d float64) float64 { return d * math.Pi / 180 }

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

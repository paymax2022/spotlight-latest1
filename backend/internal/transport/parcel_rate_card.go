package transport

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"
)

// Parcel rate card: one admin-editable row per (zone, size, speed) in
// transport_parcel_rate_card, carrying a fare multiplier (basis points) and a
// minimum fare for that combination. It replaces the two hardcoded
// size × speed multipliers, which could not express "Priority on a large box
// needs a car, so its floor is higher" and gave every combination the same
// minimum. The distance/time base still comes from transport_pricing_config.
//
// Behind FEATURE_PARCEL_RATE_CARD_ENABLED. Off, or a combination with no row,
// prices with the legacy multipliers (parcelSizeMultiplier × parcelSpeedMultiplier).

// parcelSizes and parcelOfferedSpeeds are the combinations quoted on the
// estimate, in display order. "scheduled" is still accepted on a booking but is
// not offered in the app, so it is not quoted.
var (
	parcelSizes         = []string{"small", "medium", "large"}
	parcelOfferedSpeeds = []string{"standard", "express", "same_day"}
)

// parcelRate is one rate-card cell. Integer basis points, never a float, so a
// stored multiplier prices identically every time it is read.
type parcelRate struct {
	MultiplierBps int64 `json:"multiplierBps"`
	MinFareKobo   int64 `json:"minFareKobo"`
}

// parcelRateCard maps "size/speed" to its cell.
type parcelRateCard map[string]parcelRate

func rateCardKey(size, speed string) string { return size + "/" + speed }

// ParcelPriceOption is one size × speed price on the estimate, so the app can
// show the price of every choice, not just the selected one.
type ParcelPriceOption struct {
	Size     string `json:"size"`
	Speed    string `json:"speed"`
	FareKobo int64  `json:"fareKobo"`
}

// WithParcelRateCard turns on pricing from transport_parcel_rate_card.
func (s *Service) WithParcelRateCard(enabled bool) *Service {
	s.parcelRateCardOn = enabled
	return s
}

// normalizeParcelSpeed lower-cases a requested speed, defaults it to standard
// and maps the app's display name "priority" to its stored value "same_day".
// Unknown values are returned as-is (the parcels.speed CHECK rejects them).
func normalizeParcelSpeed(speed string) string {
	switch sp := strings.ToLower(strings.TrimSpace(speed)); sp {
	case "":
		return "standard"
	case "priority":
		return "same_day"
	default:
		return sp
	}
}

// parcelFareWithRate prices one rate-card cell:
// (base + per_km*km + per_min*min) × multiplier, floored at the higher of the
// config minimum and the cell's own minimum. A zero/negative multiplier (a
// broken row) is treated as 1×, never as a free or negative fare.
func parcelFareWithRate(distanceM, durationS int, r parcelRate, cfg *PricingConfig) int64 {
	bps := r.MultiplierBps
	if bps <= 0 {
		bps = 10000
	}
	km := float64(distanceM) / 1000.0
	mins := float64(durationS) / 60.0
	raw := float64(cfg.BaseFareKobo) + km*float64(cfg.PerKMKobo) + mins*float64(cfg.PerMinKobo)
	fare := int64(math.Round(raw * float64(bps) / 10000.0))
	return max(fare, cfg.MinFareKobo, r.MinFareKobo)
}

// parcelFareFor prices size × speed from the card, falling back to the legacy
// multipliers for a combination the card does not have.
func parcelFareFor(distanceM, durationS int, size, speed string, cfg *PricingConfig, card parcelRateCard) (int64, *parcelRate) {
	if r, ok := card[rateCardKey(size, speed)]; ok {
		return parcelFareWithRate(distanceM, durationS, r, cfg), &r
	}
	return parcelFare(distanceM, durationS, size, speed, cfg), nil
}

// parcelPriceOptions quotes every offered size × speed for one route.
func parcelPriceOptions(distanceM, durationS int, cfg *PricingConfig, card parcelRateCard) []ParcelPriceOption {
	out := make([]ParcelPriceOption, 0, len(parcelSizes)*len(parcelOfferedSpeeds))
	for _, size := range parcelSizes {
		for _, speed := range parcelOfferedSpeeds {
			fare, _ := parcelFareFor(distanceM, durationS, size, speed, cfg, card)
			out = append(out, ParcelPriceOption{Size: size, Speed: speed, FareKobo: fare})
		}
	}
	return out
}

// loadParcelRateCard reads the active cells for zone, falling back to the
// 'default' zone. Returns nil (legacy pricing) when the card is switched off.
// A read error is returned, never swallowed: the estimate and the charged
// booking must price from the same card, so a failed read fails the request
// rather than silently quoting legacy prices.
func (s *Service) loadParcelRateCard(ctx context.Context, zone string) (parcelRateCard, error) {
	if !s.parcelRateCardOn || s.db == nil {
		return nil, nil
	}
	if zone == "" {
		zone = "default"
	}
	rows, err := s.db.Query(ctx, `
		SELECT size, speed, multiplier_bps, min_fare_kobo
		FROM public.transport_parcel_rate_card
		WHERE active AND zone = (
			SELECT z FROM (VALUES ($1::text, 0), ('default', 1)) v(z, pref)
			WHERE EXISTS (SELECT 1 FROM public.transport_parcel_rate_card c WHERE c.zone = v.z AND c.active)
			ORDER BY pref LIMIT 1)`, zone)
	if err != nil {
		return nil, fmt.Errorf("transport: load parcel rate card: %w", err)
	}
	defer rows.Close()
	card := parcelRateCard{}
	for rows.Next() {
		var size, speed string
		var r parcelRate
		if err := rows.Scan(&size, &speed, &r.MultiplierBps, &r.MinFareKobo); err != nil {
			return nil, fmt.Errorf("transport: scan parcel rate card: %w", err)
		}
		card[rateCardKey(size, speed)] = r
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("transport: read parcel rate card: %w", err)
	}
	return card, nil
}

// parcelCategories mirrors the parcels.category CHECK (20271046000000 widened
// it with the app's documents/clothing/other).
var parcelCategories = map[string]bool{
	"document": true, "small": true, "medium": true, "large": true, "fragile": true, "food": true,
	"electronics": true, "fashion": true, "custom": true, "documents": true, "clothing": true, "other": true,
}

// normalizeParcelOptions lower-cases and defaults size, speed and category and
// refuses anything the parcels table would reject. It runs while pricing, so
// the wallet path — which escrows the fare BEFORE inserting the parcel — can
// never move money for a booking whose INSERT is bound to fail.
func normalizeParcelOptions(size, speed, category string) (string, string, string, error) {
	size = strings.ToLower(strings.TrimSpace(size))
	if size == "" {
		size = "small"
	}
	speed = normalizeParcelSpeed(speed)
	category = strings.ToLower(strings.TrimSpace(category))
	if category == "" {
		category = "small"
	}
	switch {
	case size != "small" && size != "medium" && size != "large":
		return "", "", "", codedErr(http.StatusUnprocessableEntity, "INVALID_PARCEL_SIZE", "size must be small, medium or large")
	case speed != "standard" && speed != "express" && speed != "same_day" && speed != "scheduled":
		return "", "", "", codedErr(http.StatusUnprocessableEntity, "INVALID_PARCEL_SPEED", "speed must be standard, express, same_day (priority) or scheduled")
	case !parcelCategories[category]:
		return "", "", "", codedErr(http.StatusUnprocessableEntity, "INVALID_PARCEL_CATEGORY", "unknown parcel category")
	}
	return size, speed, category, nil
}

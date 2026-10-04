package maps

import (
	"errors"
	"math"
	"strings"
)

// the spatial cell key used across the v2 layer (MAPSERVICE.md §8).
// The spec calls for H3 hexagonal indexing. The canonical H3 library is CGO-based
// (uber/h3-go), which complicates the build. We adopt a dependency-free, pure-Go
// geohash cell as the spatial key: it provides the same architectural role —
// indexing gazetteer points, cache entries, coverage tiers, couriers, and
// proximity batching — and is swappable for real H3 later WITHOUT touching the
// orchestrator or callers (everything depends on string cell keys, never on H3
// internals). The DB column is named `h3` to match the spec's data model.
// Precision guide (geohash): 5 ≈ 5 km, 6 ≈ 1.2 km, 7 ≈ 150 m. We default to 6 for
// coverage tiering (≈ H3 res 7–8) and 7 for gazetteer/cache keys.

const (
	// CellPrecisionCoverage keys coverage cells (~1 km neighborhoods).
	CellPrecisionCoverage = 6
	// CellPrecisionPoint keys gazetteer/cache points (~150 m).
	CellPrecisionPoint = 7
)

const geohashAlphabet = "0123456789bcdefghjkmnpqrstuvwxyz"

// CellKey returns the coverage-resolution cell key for a coordinate.
func CellKey(lat, lng float64) string { return CellKeyPrec(lat, lng, CellPrecisionCoverage) }

// PointCellKey returns the finer point-resolution cell key for a coordinate.
func PointCellKey(lat, lng float64) string { return CellKeyPrec(lat, lng, CellPrecisionPoint) }

// CellParent returns a coarser cell containing the given one (one level up).
// Used to roll coverage up when a fine cell has no data.
func CellParent(cell string) string {
	if len(cell) <= 1 {
		return cell
	}
	return cell[:len(cell)-1]
}

// SameNeighborhood reports whether two cells fall in the same coarse area
// (shared coverage-precision prefix) — a cheap proximity test for batching.
func SameNeighborhood(a, b string) bool {
	n := CellPrecisionCoverage
	if len(a) < n || len(b) < n {
		return a == b
	}
	return a[:n] == b[:n]
}

// CellKeyPrec encodes a coordinate into a geohash of the given precision.
func CellKeyPrec(lat, lng float64, precision int) string {
	if precision <= 0 {
		precision = CellPrecisionCoverage
	}
	latRange := [2]float64{-90, 90}
	lngRange := [2]float64{-180, 180}
	var sb strings.Builder
	sb.Grow(precision)
	even := true
	bit := 0
	ch := 0
	for sb.Len() < precision {
		if even { // longitude
			mid := (lngRange[0] + lngRange[1]) / 2
			if lng >= mid {
				ch |= 1 << (4 - bit)
				lngRange[0] = mid
			} else {
				lngRange[1] = mid
			}
		} else { // latitude
			mid := (latRange[0] + latRange[1]) / 2
			if lat >= mid {
				ch |= 1 << (4 - bit)
				latRange[0] = mid
			} else {
				latRange[1] = mid
			}
		}
		even = !even
		if bit < 4 {
			bit++
		} else {
			sb.WriteByte(geohashAlphabet[ch])
			bit = 0
			ch = 0
		}
	}
	return sb.String()
}

// olcAlphabet is the Open Location Code (Plus Code) symbol set.
const olcAlphabet = "23456789CFGHJMPQRVWX"

const (
	olcSeparator    = '+'
	olcSeparatorPos = 8
	olcPadding      = '0'
	olcCodeLength   = 10 // full code: 5 lat/lng pairs ≈ 13.9 m precision
)

// pairResolutions are the degree spans for each of the 5 encoding pairs.
var pairResolutions = []float64{20.0, 1.0, 0.05, 0.0025, 0.000125}

// olcCodec implements PlusCodec (Open Location Code). It is self-contained — no
// network, no third-party library — so encode/decode is deterministic and free.
type olcCodec struct{}

// NewPlusCodec returns the Open Location Code implementation of PlusCodec.
func NewPlusCodec() PlusCodec { return olcCodec{} }

func clipLatitude(lat float64) float64 {
	if lat < -90 {
		return -90
	}
	if lat > 90 {
		return 90
	}
	return lat
}

func normalizeLongitude(lng float64) float64 {
	for lng < -180 {
		lng += 360
	}
	for lng >= 180 {
		lng -= 360
	}
	return lng
}

// Encode returns the full (length-10) Plus Code for a coordinate, or "" when
// the coordinate is not finite — NaN passes clipLatitude/normalizeLongitude
// untouched and produces a negative digit index (panic, AUD-BE-010), and an
// infinite lng would spin normalizeLongitude's loops forever. PlusCode is an
// annotation on the result, not a key, so degrading to empty is safe.
func (olcCodec) Encode(lat, lng float64) string {
	if math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) {
		return ""
	}
	lat = clipLatitude(lat)
	lng = normalizeLongitude(lng)
	// Keep the latitude digit in range when sitting exactly on the north pole.
	if lat == 90 {
		lat -= pairResolutions[len(pairResolutions)-1] / 2
	}

	latVal := lat + 90
	lngVal := lng + 180

	var b strings.Builder
	for i := 0; i < len(pairResolutions); i++ {
		res := pairResolutions[i]
		latDigit := int(math.Floor(latVal / res))
		latVal -= float64(latDigit) * res
		lngDigit := int(math.Floor(lngVal / res))
		lngVal -= float64(lngDigit) * res
		// Clamp BOTH ends: float remainder can drift to -1e-16 after the
		// subtractions, yielding digit -1 → panic (AUD-BE-010).
		if latDigit < 0 {
			latDigit = 0
		}
		if latDigit > 19 {
			latDigit = 19
		}
		if lngDigit < 0 {
			lngDigit = 0
		}
		if lngDigit > 19 {
			lngDigit = 19
		}
		b.WriteByte(olcAlphabet[latDigit])
		b.WriteByte(olcAlphabet[lngDigit])
		if b.Len() == olcSeparatorPos {
			b.WriteByte(olcSeparator)
		}
	}
	return b.String()
}

// Decode returns the center Point of a Plus Code's cell.
func (olcCodec) Decode(code string) (Point, error) {
	clean := strings.ToUpper(strings.TrimSpace(code))
	clean = strings.ReplaceAll(clean, string(olcSeparator), "")
	clean = strings.TrimRight(clean, string(olcPadding))
	if len(clean) < 2 || len(clean)%2 != 0 {
		return Point{}, errors.New("maps: invalid plus code length")
	}

	latVal := -90.0
	lngVal := -180.0
	var lastRes float64
	for i := 0; i+1 < len(clean) && i/2 < len(pairResolutions); i += 2 {
		res := pairResolutions[i/2]
		lastRes = res
		latIdx := strings.IndexByte(olcAlphabet, clean[i])
		lngIdx := strings.IndexByte(olcAlphabet, clean[i+1])
		if latIdx < 0 || lngIdx < 0 {
			return Point{}, errors.New("maps: invalid plus code symbol")
		}
		latVal += float64(latIdx) * res
		lngVal += float64(lngIdx) * res
	}
	return Point{
		Lat:    latVal + lastRes/2,
		Lng:    lngVal + lastRes/2,
		Source: SourceOwn,
	}, nil
}

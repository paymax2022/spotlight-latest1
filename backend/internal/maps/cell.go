package maps

import "strings"

// cell.go — the spatial cell key used across the v2 layer (MAPSERVICE.md §8).
//
// The spec calls for H3 hexagonal indexing. The canonical H3 library is CGO-based
// (uber/h3-go), which complicates the build. We adopt a dependency-free, pure-Go
// geohash cell as the spatial key: it provides the same architectural role —
// indexing gazetteer points, cache entries, coverage tiers, couriers, and
// proximity batching — and is swappable for real H3 later WITHOUT touching the
// orchestrator or callers (everything depends on string cell keys, never on H3
// internals). The DB column is named `h3` to match the spec's data model.
//
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

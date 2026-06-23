package maps

import (
	"errors"
	"math"
	"strings"
)

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

// Encode returns the full (length-10) Plus Code for a coordinate.
func (olcCodec) Encode(lat, lng float64) string {
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
		if latDigit > 19 {
			latDigit = 19
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
	// Return the cell center.
	return Point{
		Lat:    latVal + lastRes/2,
		Lng:    lngVal + lastRes/2,
		Source: SourceOwn,
	}, nil
}

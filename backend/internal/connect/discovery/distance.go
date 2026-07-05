package connectdiscovery

import (
	"fmt"
	"math"
)

// haversineKm returns the great-circle distance in km between two lat/lng points.
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthKm = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// bucketKm snaps a precise distance to the smallest configured bucket that
// contains it, preserving privacy by never exposing the exact value. Buckets must
// be ascending. A distance beyond the largest bucket returns (lastBucket, false).
func bucketKm(distKm float64, buckets []int) (int, bool) {
	for _, b := range buckets {
		if distKm <= float64(b) {
			return b, true
		}
	}
	if len(buckets) > 0 {
		return buckets[len(buckets)-1], false
	}
	return 0, false
}

// distanceLabel renders a privacy-preserving, bucketed distance string.
// withinBucket=false means the candidate is farther than the largest bucket.
func distanceLabel(bucket int, withinBucket bool) string {
	if bucket <= 0 {
		return ""
	}
	if withinBucket {
		return fmt.Sprintf("within %d km", bucket)
	}
	return fmt.Sprintf("over %d km", bucket)
}

// snapMaxDistance returns the smallest configured bucket >= the requested cap so a
// search radius is itself coarse (no exact-radius probing). 0/absent → largest bucket.
func snapMaxDistance(requestedKm int, buckets []int) int {
	if len(buckets) == 0 {
		return requestedKm
	}
	if requestedKm <= 0 {
		return buckets[len(buckets)-1]
	}
	for _, b := range buckets {
		if requestedKm <= b {
			return b
		}
	}
	return buckets[len(buckets)-1]
}

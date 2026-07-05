package connectdiscovery

import (
	"math"
	"strings"
	"testing"
)

func TestBucketKmSnapsToSmallestContaining(t *testing.T) {
	buckets := []int{5, 10, 25, 50, 100}
	cases := []struct {
		dist   float64
		want   int
		within bool
	}{
		{2, 5, true},
		{5, 5, true},
		{7, 10, true},
		{24.9, 25, true},
		{60, 100, true},
		{500, 100, false}, // beyond largest bucket
	}
	for _, c := range cases {
		got, within := bucketKm(c.dist, buckets)
		if got != c.want || within != c.within {
			t.Errorf("bucketKm(%.1f) = (%d,%v), want (%d,%v)", c.dist, got, within, c.want, c.within)
		}
	}
}

// Privacy invariant: a label must NEVER reveal an exact distance — only a bucket.
func TestDistanceLabelIsCoarse(t *testing.T) {
	if l := distanceLabel(25, true); l != "within 25 km" {
		t.Errorf("unexpected label %q", l)
	}
	if l := distanceLabel(100, false); l != "over 100 km" {
		t.Errorf("unexpected label %q", l)
	}
	// An exact decimal distance must not leak into any label.
	label := distanceLabel(25, true)
	if strings.ContainsAny(label, ".") {
		t.Errorf("label leaked a precise distance: %q", label)
	}
}

func TestSnapMaxDistance(t *testing.T) {
	buckets := []int{5, 10, 25, 50, 100}
	if got := snapMaxDistance(0, buckets); got != 100 {
		t.Errorf("zero cap should snap to largest bucket, got %d", got)
	}
	if got := snapMaxDistance(12, buckets); got != 25 {
		t.Errorf("12 should snap up to 25, got %d", got)
	}
	if got := snapMaxDistance(200, buckets); got != 100 {
		t.Errorf("over-max should clamp to largest, got %d", got)
	}
}

func TestHaversineKnownDistance(t *testing.T) {
	// Lagos (6.45,3.40) → Abuja (9.06,7.49) ≈ 525 km.
	d := haversineKm(6.4541, 3.3947, 9.0579, 7.4951)
	if math.Abs(d-525) > 40 {
		t.Errorf("haversine off: got %.1f km, expected ~525", d)
	}
}

func TestBuildReasonScoresAndFactors(t *testing.T) {
	weights := map[string]float64{"shared_intent": 0.4, "distance": 0.3, "verification": 0.3}
	rc := rawCandidate{verified: true, intentTags: []string{"hiking", "coffee"}}
	r := buildReason(rc, []string{"hiking"}, weights, "within 10 km")
	if r == nil {
		t.Fatal("expected a reason card")
	}
	// shared(0.4) + verified(0.3) + within-distance(0.3) = 1.0
	if math.Abs(r.Score-1.0) > 1e-9 {
		t.Errorf("expected score 1.0, got %f", r.Score)
	}
	if len(r.Factors) != 3 {
		t.Errorf("expected 3 factors, got %d: %v", len(r.Factors), r.Factors)
	}
	if !strings.Contains(r.Headline, "hiking") {
		t.Errorf("headline should reference shared intent, got %q", r.Headline)
	}
}

func TestBuildReasonNoSharedNoDistanceScore(t *testing.T) {
	weights := map[string]float64{"shared_intent": 0.4, "distance": 0.3, "verification": 0.3}
	rc := rawCandidate{verified: false, intentTags: []string{"gaming"}}
	r := buildReason(rc, []string{"hiking"}, weights, "over 100 km")
	if r.Score != 0 {
		t.Errorf("no shared intent, unverified, far away → score 0, got %f", r.Score)
	}
}

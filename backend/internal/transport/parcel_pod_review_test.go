package transport

import (
	"net/http"
	"testing"
)

func TestValidatePodReview(t *testing.T) {
	proof := "https://r2.example/pod.jpg"
	blank := "  "
	cases := []struct {
		name, decision, reason string
		proof                  *string
		wantStatus             int
	}{
		{"approve ok", "approved", "photo matches address", &proof, 0},
		{"reject ok", "rejected", "wrong house", &proof, 0},
		{"unknown decision", "submitted", "x", &proof, http.StatusBadRequest},
		{"approve without reason ok", "approved", "", &proof, 0},
		{"reject needs reason", "rejected", " ", &proof, http.StatusBadRequest},
		{"no proof", "approved", "x", nil, http.StatusConflict},
		{"blank proof", "rejected", "x", &blank, http.StatusConflict},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validatePodReview(c.decision, c.reason, c.proof)
			if c.wantStatus == 0 {
				if err != nil {
					t.Fatalf("unexpected error %v", err)
				}
				return
			}
			if err == nil || err.Status != c.wantStatus {
				t.Fatalf("got %v, want status %d", err, c.wantStatus)
			}
		})
	}
}

func TestParcelPodStatusPrefersReview(t *testing.T) {
	proof := "u"
	rej := "rejected"
	if got := parcelPodStatus("delivered", &proof, &rej); got != "rejected" {
		t.Fatalf("explicit review must win, got %q", got)
	}
	if got := parcelPodStatus("delivered", &proof, nil); got != "approved" {
		t.Fatalf("no review falls back to derivation, got %q", got)
	}
}

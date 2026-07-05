package metrics

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestWriteProm(t *testing.T) {
	r := New()

	r.Observe(200, 30*time.Millisecond)
	r.Observe(500, 2*time.Second)

	r.IncInFlight()
	r.IncInFlight()
	r.DecInFlight()

	var buf bytes.Buffer
	r.WriteProm(&buf)
	out := buf.String()

	want := []string{
		"crypto_requests_in_flight 1",
		`crypto_requests_total{status="200"} 1`,
		`crypto_requests_total{status="500"} 1`,
		"crypto_request_duration_seconds_count 2",
	}
	for _, w := range want {
		if !strings.Contains(out, w) {
			t.Errorf("WriteProm output missing %q\n--- output ---\n%s", w, out)
		}
	}
}

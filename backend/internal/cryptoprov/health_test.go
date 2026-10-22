package cryptoprov

import (
	"testing"
	"time"
)

func TestCallRecorderSummarisesTheRecentWindow(t *testing.T) {
	var r CallRecorder
	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	r.Record(now.Add(-time.Hour), time.Second, 500, "old") // outside the window
	for i := 1; i <= 10; i++ {
		r.Record(now.Add(-time.Minute), time.Duration(i)*10*time.Millisecond, 200, "GET /x -> 200")
	}
	r.Record(now.Add(-30*time.Second), 5*time.Millisecond, 429, "GET /y -> 429")
	r.Record(now.Add(-10*time.Second), 5*time.Millisecond, 0, "POST /z -> transport error")
	h := r.Snapshot(now)
	if h.Calls != 12 || h.Failures != 1 || h.Throttled != 1 {
		t.Fatalf("health = %+v", h)
	}
	if h.LastFailure != "POST /z -> transport error" || !h.LastFailureAt.Equal(now.Add(-10*time.Second)) {
		t.Fatalf("last failure = %q at %v", h.LastFailure, h.LastFailureAt)
	}
	if h.P95 < h.P50 || h.P95 == 0 {
		t.Fatalf("percentiles p50=%v p95=%v", h.P50, h.P95)
	}
	var nilRec *CallRecorder
	nilRec.Record(now, 0, 200, "")
	if nilRec.Snapshot(now).Calls != 0 {
		t.Fatal("a nil recorder is a no-op")
	}
}

func TestCallRecorderIsBounded(t *testing.T) {
	var r CallRecorder
	now := time.Now()
	for i := 0; i < maxSamples*3; i++ {
		r.Record(now, time.Millisecond, 200, "")
	}
	if len(r.samples) != maxSamples || r.Snapshot(now).Calls != maxSamples {
		t.Fatalf("samples = %d", len(r.samples))
	}
}

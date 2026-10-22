package cryptoprov

import (
	"sort"
	"sync"
	"time"
)

// Provider health telemetry (workplan QDX-ADM-011): every real API call an adapter makes is
// recorded here, so the admin health page reports measured latency, throttling and failure
// rates with timestamps rather than a guess.

// HealthReporter is implemented by adapters that record their own calls.
type HealthReporter interface {
	Health(now time.Time) Health
}

// Health is a snapshot over the recent window.
type Health struct {
	Window        time.Duration
	Calls         int
	Failures      int // transport errors and 5xx
	Throttled     int // 429 / 444
	P50, P95      time.Duration
	LastSuccessAt time.Time
	LastFailureAt time.Time
	LastFailure   string // "GET /path -> 503" (no secrets, no bodies)
}

type callSample struct {
	at        time.Time
	latency   time.Duration
	failed    bool
	throttled bool
}

// CallRecorder keeps the last maxSamples calls.
type CallRecorder struct {
	mu            sync.Mutex
	samples       []callSample
	next          int
	lastSuccessAt time.Time
	lastFailureAt time.Time
	lastFailure   string
}

const (
	maxSamples   = 500
	healthWindow = 15 * time.Minute
)

// Record notes one call. status is the HTTP status (0 for a transport error).
func (r *CallRecorder) Record(at time.Time, latency time.Duration, status int, what string) {
	if r == nil {
		return
	}
	s := callSample{at: at, latency: latency, failed: status == 0 || status >= 500, throttled: status == 429 || status == 444}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.samples) < maxSamples {
		r.samples = append(r.samples, s)
	} else {
		r.samples[r.next] = s
		r.next = (r.next + 1) % maxSamples
	}
	if s.failed || s.throttled {
		r.lastFailureAt, r.lastFailure = at, what
	} else {
		r.lastSuccessAt = at
	}
}

// Snapshot summarises the calls in the last healthWindow.
func (r *CallRecorder) Snapshot(now time.Time) Health {
	h := Health{Window: healthWindow}
	if r == nil {
		return h
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	h.LastSuccessAt, h.LastFailureAt, h.LastFailure = r.lastSuccessAt, r.lastFailureAt, r.lastFailure
	var lat []time.Duration
	for _, s := range r.samples {
		if now.Sub(s.at) > healthWindow {
			continue
		}
		h.Calls++
		if s.failed {
			h.Failures++
		}
		if s.throttled {
			h.Throttled++
		}
		lat = append(lat, s.latency)
	}
	if len(lat) > 0 {
		sort.Slice(lat, func(i, j int) bool { return lat[i] < lat[j] })
		h.P50 = lat[(len(lat)-1)*50/100]
		h.P95 = lat[(len(lat)-1)*95/100]
	}
	return h
}

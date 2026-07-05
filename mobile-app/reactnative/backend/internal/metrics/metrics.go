// Package metrics provides a small, dependency-free, in-process metrics
// registry that exposes request counters, an in-flight gauge, and a request
// duration histogram in the Prometheus text exposition format.
package metrics

import (
	"fmt"
	"io"
	"sort"
	"sync"
	"time"
)

// buckets are the fixed, upper-bound histogram buckets in seconds. The
// histogram uses cumulative ("le") semantics: an observation falls into every
// bucket whose upper bound is greater than or equal to the observed value.
var buckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

// Registry is a thread-safe collection of metrics. The zero value is not
// usable; construct one with New.
type Registry struct {
	mu sync.Mutex

	// requestsTotal counts finished requests keyed by HTTP status code.
	requestsTotal map[int]int64

	// inFlight is the number of requests currently being served.
	inFlight int64

	// bucketCounts holds the non-cumulative count of observations per bucket,
	// aligned with the buckets slice. An additional implicit "+Inf" bucket is
	// represented by count.
	bucketCounts []int64

	// sum is the total of all observed durations in seconds.
	sum float64

	// count is the total number of observed durations.
	count int64
}

// New returns a ready-to-use Registry.
func New() *Registry {
	return &Registry{
		requestsTotal: make(map[int]int64),
		bucketCounts:  make([]int64, len(buckets)),
	}
}

// IncInFlight increments the in-flight request gauge.
func (r *Registry) IncInFlight() {
	r.mu.Lock()
	r.inFlight++
	r.mu.Unlock()
}

// DecInFlight decrements the in-flight request gauge.
func (r *Registry) DecInFlight() {
	r.mu.Lock()
	r.inFlight--
	r.mu.Unlock()
}

// Observe records one finished request with the given HTTP status code and
// duration.
func (r *Registry) Observe(status int, d time.Duration) {
	secs := d.Seconds()

	r.mu.Lock()
	defer r.mu.Unlock()

	r.requestsTotal[status]++

	r.sum += secs
	r.count++
	for i, ub := range buckets {
		if secs <= ub {
			r.bucketCounts[i]++
		}
	}
}

// WriteProm writes the current metrics to w in the Prometheus text exposition
// format. It holds the lock for the duration of the read.
func (r *Registry) WriteProm(w io.Writer) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// crypto_requests_total
	fmt.Fprintln(w, "# HELP crypto_requests_total Total number of finished HTTP requests by status code.")
	fmt.Fprintln(w, "# TYPE crypto_requests_total counter")
	statuses := make([]int, 0, len(r.requestsTotal))
	for s := range r.requestsTotal {
		statuses = append(statuses, s)
	}
	sort.Ints(statuses)
	for _, s := range statuses {
		fmt.Fprintf(w, "crypto_requests_total{status=\"%d\"} %d\n", s, r.requestsTotal[s])
	}

	// crypto_requests_in_flight
	fmt.Fprintln(w, "# HELP crypto_requests_in_flight Number of HTTP requests currently being served.")
	fmt.Fprintln(w, "# TYPE crypto_requests_in_flight gauge")
	fmt.Fprintf(w, "crypto_requests_in_flight %d\n", r.inFlight)

	// crypto_request_duration_seconds
	fmt.Fprintln(w, "# HELP crypto_request_duration_seconds Histogram of HTTP request durations in seconds.")
	fmt.Fprintln(w, "# TYPE crypto_request_duration_seconds histogram")
	var cumulative int64
	for i, ub := range buckets {
		cumulative += r.bucketCounts[i]
		fmt.Fprintf(w, "crypto_request_duration_seconds_bucket{le=\"%s\"} %d\n", formatFloat(ub), cumulative)
	}
	fmt.Fprintf(w, "crypto_request_duration_seconds_bucket{le=\"+Inf\"} %d\n", r.count)
	fmt.Fprintf(w, "crypto_request_duration_seconds_sum %s\n", formatFloat(r.sum))
	fmt.Fprintf(w, "crypto_request_duration_seconds_count %d\n", r.count)
}

// formatFloat renders a float without a trailing exponent or superfluous
// zeros, matching the style Prometheus uses for bucket bounds and sums.
func formatFloat(f float64) string {
	return fmt.Sprintf("%g", f)
}

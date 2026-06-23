package maps

import (
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// metrics is a tiny, dependency-free, process-wide registry exposed in Prometheus
// text exposition format at GET /api/finance/maps/metrics. It covers the RED
// signals (Rate, Errors, Duration) per endpoint plus maps-specific counters
// (cache hit/miss, provider degradations). Pairing this with the monthly
// map_usage snapshot gives cost + health in one scrape.
//
// We avoid the Prometheus client library so no new module dependency is added;
// the text output is fully scrape-compatible.
type metricsRegistry struct {
	mu           sync.Mutex
	httpCount    map[string]int64   // "path|status" → count
	durSum       map[string]float64 // path → total seconds
	durCount     map[string]int64   // path → request count
	cacheHit     int64
	cacheMiss    int64
	degradations map[string]int64 // primitive → count
}

var mx = &metricsRegistry{
	httpCount:    map[string]int64{},
	durSum:       map[string]float64{},
	durCount:     map[string]int64{},
	degradations: map[string]int64{},
}

func (m *metricsRegistry) recordHTTP(path string, status int, secs float64) {
	m.mu.Lock()
	m.httpCount[path+"|"+strconv.Itoa(status)]++
	m.durSum[path] += secs
	m.durCount[path]++
	m.mu.Unlock()
}

func (m *metricsRegistry) cacheHitInc()  { m.mu.Lock(); m.cacheHit++; m.mu.Unlock() }
func (m *metricsRegistry) cacheMissInc() { m.mu.Lock(); m.cacheMiss++; m.mu.Unlock() }
func (m *metricsRegistry) degradationInc(primitive string) {
	m.mu.Lock()
	m.degradations[primitive]++
	m.mu.Unlock()
}

func (m *metricsRegistry) render() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var b strings.Builder

	b.WriteString("# HELP maps_http_requests_total Maps proxy requests by path and status.\n")
	b.WriteString("# TYPE maps_http_requests_total counter\n")
	for _, k := range sortedKeys(m.httpCount) {
		parts := strings.SplitN(k, "|", 2)
		b.WriteString("maps_http_requests_total{path=\"" + esc(parts[0]) + "\",status=\"" + parts[1] + "\"} " + i64(m.httpCount[k]) + "\n")
	}

	b.WriteString("# HELP maps_http_request_duration_seconds Request duration summary by path.\n")
	b.WriteString("# TYPE maps_http_request_duration_seconds summary\n")
	for _, p := range sortedKeysF(m.durSum) {
		b.WriteString("maps_http_request_duration_seconds_sum{path=\"" + esc(p) + "\"} " + f64(m.durSum[p]) + "\n")
		b.WriteString("maps_http_request_duration_seconds_count{path=\"" + esc(p) + "\"} " + i64(m.durCount[p]) + "\n")
	}

	b.WriteString("# HELP maps_cache_hits_total Geocode cache hits.\n# TYPE maps_cache_hits_total counter\n")
	b.WriteString("maps_cache_hits_total " + i64(m.cacheHit) + "\n")
	b.WriteString("# HELP maps_cache_misses_total Geocode cache misses.\n# TYPE maps_cache_misses_total counter\n")
	b.WriteString("maps_cache_misses_total " + i64(m.cacheMiss) + "\n")

	b.WriteString("# HELP maps_degradations_total Cost-guard degradations by primitive.\n# TYPE maps_degradations_total counter\n")
	for _, p := range sortedKeys(m.degradations) {
		b.WriteString("maps_degradations_total{primitive=\"" + esc(p) + "\"} " + i64(m.degradations[p]) + "\n")
	}
	return b.String()
}

// renderUsage turns the monthly map_usage snapshot into Prometheus gauges.
func renderUsage(rows []UsageRow) string {
	var b strings.Builder
	b.WriteString("# HELP maps_usage_month_count Per-provider/primitive calls this month.\n")
	b.WriteString("# TYPE maps_usage_month_count gauge\n")
	for _, r := range rows {
		b.WriteString("maps_usage_month_count{provider=\"" + esc(r.Provider) + "\",primitive=\"" + esc(r.Primitive) + "\"} " + i64(r.Count) + "\n")
	}
	return b.String()
}

// MetricsMiddleware records RED metrics for every maps request. Register it
// BEFORE the rate limiter so 429s are captured too.
func MetricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		path := c.FullPath()
		if path == "" {
			path = "unknown"
		}
		mx.recordHTTP(path, c.Writer.Status(), time.Since(start).Seconds())
	}
}

func esc(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	return strings.ReplaceAll(s, "\"", "\\\"")
}
func i64(v int64) string   { return strconv.FormatInt(v, 10) }
func f64(v float64) string { return strconv.FormatFloat(v, 'f', 6, 64) }

func sortedKeys(m map[string]int64) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
func sortedKeysF(m map[string]float64) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

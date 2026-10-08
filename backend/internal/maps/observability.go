package maps

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewWebhookAlerter returns an AlertFunc that POSTs budget alerts (50/75/90% of a
// provider SKU cap) to a webhook (Slack-compatible JSON with a "text" field, plus
// structured fields). Falls back to logging if the URL is empty. Wire it into the
// UsageTracker so cost overruns page someone instead of only hitting the log.
func NewWebhookAlerter(url string) AlertFunc {
	if url == "" {
		return defaultAlert
	}
	client := &http.Client{Timeout: 5 * time.Second}
	return func(provider string, primitive Primitive, pct int, count, cap int64) {
		// Always log too, so the signal survives webhook failures.
		defaultAlert(provider, primitive, pct, count, cap)
		body, err := json.Marshal(map[string]any{
			"text":      "[maps] budget alert " + strconv.Itoa(pct) + "% — " + provider + "." + string(primitive),
			"provider":  provider,
			"primitive": string(primitive),
			"pct":       pct,
			"count":     count,
			"cap":       cap,
		})
		if err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[maps] budget alert webhook failed: %v", err)
			return
		}
		_ = resp.Body.Close()
	}
}

// metrics is a tiny, dependency-free, process-wide registry exposed in Prometheus
// text exposition format at GET /api/finance/maps/metrics. It covers the RED
// signals (Rate, Errors, Duration) per endpoint plus maps-specific counters
// (cache hit/miss, provider degradations). Pairing this with the monthly
// map_usage snapshot gives cost + health in one scrape.
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

// UsageTracker records per-provider, per-primitive monthly call counts in the
// map_usage table and powers the cost guard:
//   - budget alerts at 50/75/90% of the configured per-SKU soft cap, and
//   - a cap check the router consults to DEGRADE GRACEFULLY (fall back to the
//     OpenStack adapter / manual pin-drop) instead of hard-failing — and never
//     by switching keys or accounts.
type UsageTracker struct {
	pool   *pgxpool.Pool
	caps   map[string]int64
	alert  AlertFunc
	mu     sync.Mutex
	firedF map[string]bool // de-dupe alerts per "cap|threshold|month"
}

// AlertFunc receives budget alerts. Default logs; wire to Slack/email/metrics.
type AlertFunc func(provider string, primitive Primitive, pct int, count, cap int64)

func defaultAlert(provider string, primitive Primitive, pct int, count, cap int64) {
	log.Printf("[maps] BUDGET ALERT %d%% — %s.%s usage=%d cap=%d", pct, provider, primitive, count, cap)
}

// NewUsageTracker builds a tracker. caps maps "<provider>.<primitive>" -> cap.
func NewUsageTracker(pool *pgxpool.Pool, caps map[string]int64, alert AlertFunc) *UsageTracker {
	if alert == nil {
		alert = defaultAlert
	}
	if caps == nil {
		caps = map[string]int64{}
	}
	return &UsageTracker{pool: pool, caps: caps, alert: alert, firedF: map[string]bool{}}
}

func currentMonth() string { return time.Now().UTC().Format("2006-01") }

// Record increments this month's counter for a provider+primitive and evaluates
// alert thresholds. Returns the new count. It never blocks the request path on
// failure — usage accounting is best-effort.
func (u *UsageTracker) Record(ctx context.Context, provider string, primitive Primitive) int64 {
	if u == nil {
		return 0
	}
	count := int64(0)
	if u.pool != nil {
		const q = `
			INSERT INTO map_usage (provider, primitive, month, count)
			VALUES ($1, $2, $3, 1)
			ON CONFLICT (provider, primitive, month)
			DO UPDATE SET count = map_usage.count + 1
			RETURNING count`
		if err := u.pool.QueryRow(ctx, q, provider, string(primitive), currentMonth()).Scan(&count); err != nil {
			log.Printf("[maps] usage record failed (%s.%s): %v", provider, primitive, err)
			return 0
		}
	}
	u.evaluate(provider, primitive, count)
	return count
}

// Count returns this month's count for a provider+primitive.
func (u *UsageTracker) Count(ctx context.Context, provider string, primitive Primitive) int64 {
	if u == nil || u.pool == nil {
		return 0
	}
	var count int64
	const q = `SELECT COALESCE(count,0) FROM map_usage WHERE provider=$1 AND primitive=$2 AND month=$3`
	_ = u.pool.QueryRow(ctx, q, provider, string(primitive), currentMonth()).Scan(&count)
	return count
}

// OverSoftCap reports whether this month's usage has reached the configured soft
// cap for provider+primitive. When true, the router degrades to the fallback.
func (u *UsageTracker) OverSoftCap(ctx context.Context, provider string, primitive Primitive) bool {
	if u == nil {
		return false
	}
	cap, ok := u.caps[capKey(provider, primitive)]
	if !ok || cap <= 0 {
		return false
	}
	return u.Count(ctx, provider, primitive) >= cap
}

// evaluate fires 50/75/90% alerts once each per cap per month.
func (u *UsageTracker) evaluate(provider string, primitive Primitive, count int64) {
	cap, ok := u.caps[capKey(provider, primitive)]
	if !ok || cap <= 0 {
		return
	}
	pct := int(count * 100 / cap)
	var threshold int
	switch {
	case pct >= 90:
		threshold = 90
	case pct >= 75:
		threshold = 75
	case pct >= 50:
		threshold = 50
	default:
		return
	}
	key := capKey(provider, primitive) + "|" + strconv.Itoa(threshold) + "|" + currentMonth()
	u.mu.Lock()
	already := u.firedF[key]
	if !already {
		u.firedF[key] = true
	}
	u.mu.Unlock()
	if !already {
		u.alert(provider, primitive, threshold, count, cap)
	}
}

// UsageRow is one row of the metrics endpoint.
type UsageRow struct {
	Provider  string `json:"provider"`
	Primitive string `json:"primitive"`
	Month     string `json:"month"`
	Count     int64  `json:"count"`
	Cap       int64  `json:"cap,omitempty"`
	Pct       int    `json:"pct,omitempty"`
}

// Snapshot returns the current month's usage rows for the metrics endpoint.
func (u *UsageTracker) Snapshot(ctx context.Context) ([]UsageRow, error) {
	if u == nil || u.pool == nil {
		return []UsageRow{}, nil
	}
	const q = `SELECT provider, primitive, month, count FROM map_usage WHERE month=$1 ORDER BY provider, primitive`
	rows, err := u.pool.Query(ctx, q, currentMonth())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UsageRow{}
	for rows.Next() {
		var r UsageRow
		if err := rows.Scan(&r.Provider, &r.Primitive, &r.Month, &r.Count); err != nil {
			return nil, err
		}
		if cap, ok := u.caps[r.Provider+"."+r.Primitive]; ok && cap > 0 {
			r.Cap = cap
			r.Pct = int(r.Count * 100 / cap)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

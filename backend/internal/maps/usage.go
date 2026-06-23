package maps

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

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
	key := capKey(provider, primitive) + "|" + itoa(threshold) + "|" + currentMonth()
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

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var b [12]byte
	p := len(b)
	for i > 0 {
		p--
		b[p] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		p--
		b[p] = '-'
	}
	return string(b[p:])
}

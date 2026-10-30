package healthpharmacy

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strconv"
	"time"
)

const csvOrders = "orders"

// ErrBadPeriod — reporting period is not one of 7d / 30d / 90d.
var ErrBadPeriod = errors.New("pharmacy: period must be 7d, 30d or 90d")

var reportPeriods = map[string]struct {
	days  int
	label string
}{
	"7d": {7, "Last 7 days"}, "30d": {30, "Last 30 days"}, "90d": {90, "Last 90 days"},
}

// AdminReport is the platform pharmacy reporting rollup for a trailing period.
// GMV = total_kobo of completed (DELIVERED/COLLECTED/CLOSED) orders; net revenue
// = commission_earnings recorded for health.pharmacy in the period. Ratios are
// floats by design (display only — never used for money math).
type AdminReport struct {
	GeneratedAt      time.Time       `json:"generated_at"`
	Period           string          `json:"period"`
	PeriodLabel      string          `json:"period_label"`
	GMVKobo          int64           `json:"gmv_kobo"`
	NetRevenueKobo   int64           `json:"net_revenue_kobo"`
	CommissionKobo   int64           `json:"commission_kobo"`
	Orders           int64           `json:"orders"`
	RxOrders         int64           `json:"rx_orders"`
	OTCOrders        int64           `json:"otc_orders"`
	RefundRate       float64         `json:"refund_rate"`
	AvgVerifyMinutes int64           `json:"avg_verify_minutes"`
	NafdacBlockRate  float64         `json:"nafdac_block_rate"`
	ControlledBlock  int64           `json:"controlled_blocked"`
	RecallsIssued    int64           `json:"recalls_issued"`
	PayoutsKycHold   int64           `json:"payouts_kyc_hold"`
	ByState          []ReportByState `json:"by_state"`
	Monthly          []ReportMonth   `json:"monthly"`
}

// ReportByState is reserved for a per-state split; pharmacies carry no state
// field yet, so it is always empty rather than fabricated.
type ReportByState struct {
	State    string  `json:"state"`
	Orders   int64   `json:"orders"`
	GMVKobo  int64   `json:"gmv_kobo"`
	SharePct float64 `json:"share_pct"`
}

// ReportMonth is one calendar month of completed-order GMV.
type ReportMonth struct {
	Month   string `json:"month"`
	GMVKobo int64  `json:"gmv_kobo"`
	NetKobo int64  `json:"net_kobo"`
	Orders  int64  `json:"orders"`
}

// AdminReporting builds the rollup for period ("" ⇒ 30d).
func (s *Service) AdminReporting(ctx context.Context, period string) (*AdminReport, error) {
	if period == "" {
		period = "30d"
	}
	p, ok := reportPeriods[period]
	if !ok {
		return nil, ErrBadPeriod
	}
	r := &AdminReport{GeneratedAt: time.Now().UTC(), Period: period, PeriodLabel: p.label,
		ByState: []ReportByState{}, Monthly: []ReportMonth{}}
	since := time.Now().Add(-time.Duration(p.days) * 24 * time.Hour)

	var cancelled int64
	const qOrders = `
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE prescription_id IS NOT NULL),
		       COALESCE(SUM(total_kobo) FILTER (WHERE state IN ('DELIVERED','COLLECTED','CLOSED')), 0),
		       COUNT(*) FILTER (WHERE state IN ('CANCELLED','REFUNDED'))
		FROM pharmacy_orders WHERE created_at >= $1`
	if err := s.db.QueryRow(ctx, qOrders, since).Scan(&r.Orders, &r.RxOrders, &r.GMVKobo, &cancelled); err != nil {
		return nil, fmt.Errorf("pharmacy: report orders: %w", err)
	}
	r.OTCOrders = r.Orders - r.RxOrders
	if r.Orders > 0 {
		r.RefundRate = float64(cancelled) / float64(r.Orders)
	}

	const qRevenue = `
		SELECT COALESCE(SUM(spotlight_revenue_kobo), 0), COALESCE(SUM(commission_kobo), 0)
		FROM commission_earnings WHERE source_module = 'health.pharmacy' AND created_at >= $1`
	if err := s.db.QueryRow(ctx, qRevenue, since).Scan(&r.NetRevenueKobo, &r.CommissionKobo); err != nil {
		return nil, fmt.Errorf("pharmacy: report revenue: %w", err)
	}

	var total, blocked int64
	const qCatalog = `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE nafdac_status <> 'REGISTERED' OR btrim(COALESCE(nafdac_ref, '')) = '')
		FROM pharmacy_products WHERE created_at >= $1`
	if err := s.db.QueryRow(ctx, qCatalog, since).Scan(&total, &blocked); err != nil {
		return nil, fmt.Errorf("pharmacy: report catalog: %w", err)
	}
	if total > 0 {
		r.NafdacBlockRate = float64(blocked) / float64(total)
	}

	const qKyc = `
		SELECT COUNT(DISTINCT hp.id)
		FROM health_providers hp
		JOIN pharmacy_orders o ON o.pharmacy_provider_id = hp.id
		JOIN escrow_holds eh   ON eh.id = o.escrow_id AND eh.state = 'HELD'
		LEFT JOIN user_profiles up ON up.id = hp.owner_user_id
		WHERE hp.domain = 'PHARMACY' AND COALESCE(up.kyc_tier, 0) < 1`
	if err := s.db.QueryRow(ctx, qKyc).Scan(&r.PayoutsKycHold); err != nil {
		return nil, fmt.Errorf("pharmacy: report kyc hold: %w", err)
	}

	const qMonthly = `
		SELECT to_char(m.month, 'Mon YY'),
		       COALESCE((SELECT SUM(o.total_kobo) FROM pharmacy_orders o
		                 WHERE o.state IN ('DELIVERED','COLLECTED','CLOSED')
		                   AND o.created_at >= m.month AND o.created_at < m.month + interval '1 month'), 0),
		       COALESCE((SELECT SUM(ce.spotlight_revenue_kobo) FROM commission_earnings ce
		                 WHERE ce.source_module = 'health.pharmacy'
		                   AND ce.created_at >= m.month AND ce.created_at < m.month + interval '1 month'), 0),
		       (SELECT COUNT(*) FROM pharmacy_orders o
		         WHERE o.created_at >= m.month AND o.created_at < m.month + interval '1 month')
		FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m(month)
		ORDER BY m.month ASC`
	rows, err := s.db.Query(ctx, qMonthly)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: report monthly: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var m ReportMonth
		if err := rows.Scan(&m.Month, &m.GMVKobo, &m.NetKobo, &m.Orders); err != nil {
			return nil, err
		}
		r.Monthly = append(r.Monthly, m)
	}
	return r, rows.Err()
}

// WriteReportCSV renders the rollup as CSV (metric,value then the monthly
// table). Kobo stays integer kobo — the sheet never sees floats for money.
func WriteReportCSV(w io.Writer, r *AdminReport) error {
	cw := csv.NewWriter(w)
	i := func(v int64) string { return strconv.FormatInt(v, 10) }
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', 4, 64) }
	rows := make([][]string, 0, 14+len(r.Monthly))
	rows = append(rows,
		[]string{"metric", "value"},
		[]string{"period", r.Period},
		[]string{"generated_at", r.GeneratedAt.Format(time.RFC3339)},
		[]string{"gmv_kobo", i(r.GMVKobo)},
		[]string{"net_revenue_kobo", i(r.NetRevenueKobo)},
		[]string{"commission_kobo", i(r.CommissionKobo)},
		[]string{csvOrders, i(r.Orders)},
		[]string{"rx_orders", i(r.RxOrders)},
		[]string{"otc_orders", i(r.OTCOrders)},
		[]string{"refund_rate", f(r.RefundRate)},
		[]string{"nafdac_block_rate", f(r.NafdacBlockRate)},
		[]string{"payouts_kyc_hold", i(r.PayoutsKycHold)},
		[]string{},
		[]string{"month", "gmv_kobo", "net_kobo", csvOrders},
	)
	for _, m := range r.Monthly {
		rows = append(rows, []string{m.Month, i(m.GMVKobo), i(m.NetKobo), i(m.Orders)})
	}
	if err := cw.WriteAll(rows); err != nil {
		return err
	}
	cw.Flush()
	return cw.Error()
}

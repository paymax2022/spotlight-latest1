package admin

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"spotlight/backend/go-common/httperr"

	"github.com/gin-gonic/gin"
)

// Dashboard windows are Lagos calendar days. "Today" is the current Lagos day
// and the 30-day window is today plus the 29 days before it, so the headline
// numbers and the daily trend always cover the same days.
const (
	dashboardTZ         = "Africa/Lagos"
	dashboardWindowDays = 30
	dashboardActivity   = 15
	// A PAYMENT_HELD/BOOKING reservation is normal while the book saga runs; only
	// one stuck this long with money held or taken counts as paid-but-unconfirmed.
	paidUnconfirmedAfter = "15 minutes"
)

// SupplierMixRow is one supplier's share of 30-day booked GMV.
type SupplierMixRow struct {
	Supplier string  `json:"supplier"`
	Rail     string  `json:"rail"`
	Bookings int     `json:"bookings"`
	GMVKobo  int64   `json:"gmv_kobo"`
	SharePct float64 `json:"share_pct"`
}

// TrendDay is one Lagos day of booked GMV and net revenue.
type TrendDay struct {
	Date    string `json:"date"`
	GMVKobo int64  `json:"gmv_kobo"`
	NetKobo int64  `json:"net_kobo"`
}

// ActivityItem is one entry in the recent-activity feed.
type ActivityItem struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Label     string    `json:"label"`
	Ref       *string   `json:"ref"`
	CreatedAt time.Time `json:"created_at"`
}

// StaysDashboard is the GET /dashboard payload. Money is integer kobo (NGN);
// rates are 0..1 ratios. See contracts/stays-admin.openapi.yaml for definitions.
type StaysDashboard struct {
	GMVTodayKobo                 int64            `json:"gmv_today_kobo"`
	GMV30dKobo                   int64            `json:"gmv_30d_kobo"`
	BookingsToday                int              `json:"bookings_today"`
	Bookings30d                  int              `json:"bookings_30d"`
	TakeRate                     float64          `json:"take_rate"`
	Conversion                   float64          `json:"conversion"`
	NetRevenue30dKobo            int64            `json:"net_revenue_30d_kobo"`
	Commission30dKobo            int64            `json:"commission_30d_kobo"`
	ReconciliationBreaksOpen     int              `json:"reconciliation_breaks_open"`
	ReconciliationBreakValueKobo int64            `json:"reconciliation_break_value_kobo"`
	RefundsPending               int              `json:"refunds_pending"`
	PaidUnconfirmed              int              `json:"paid_unconfirmed"`
	MappingConflictsOpen         int              `json:"mapping_conflicts_open"`
	ModerationPending            int              `json:"moderation_pending"`
	AvgBookingValueKobo          int64            `json:"avg_booking_value_kobo"`
	SupplierMix                  []SupplierMixRow `json:"supplier_mix"`
	GMVTrend                     []TrendDay       `json:"gmv_trend"`
	Activity                     []ActivityItem   `json:"activity"`
	// Metrics with no source table yet. They are returned as 0, and named here so a
	// 0 can be told apart from a measured zero.
	UnavailableMetrics []string `json:"unavailable_metrics"`
}

func newDashboard() StaysDashboard {
	return StaysDashboard{
		SupplierMix: []SupplierMixRow{},
		GMVTrend:    []TrendDay{},
		Activity:    []ActivityItem{},
		UnavailableMetrics: []string{
			"reconciliation_breaks_open",
			"reconciliation_break_value_kobo",
		},
	}
}

// ratio is num/den clamped to >= 0, and 0 when den <= 0 (JSON cannot carry NaN/Inf).
func ratio(num, den int64) float64 {
	if den <= 0 || num <= 0 {
		return 0
	}
	return float64(num) / float64(den)
}

// avgKobo is the truncated integer mean; 0 with no bookings.
func avgKobo(sum, n int64) int64 {
	if n <= 0 {
		return 0
	}
	return sum / n
}

// withShare fills SharePct on each row as its fraction of totalGMV.
func withShare(rows []SupplierMixRow, totalGMV int64) {
	for i := range rows {
		rows[i].SharePct = ratio(rows[i].GMVKobo, totalGMV)
	}
}

// refundLabel renders a cancellation's refund as feed text from integer kobo.
func refundLabel(refundKobo int64) string {
	if refundKobo <= 0 {
		return "Cancellation processed, no refund due"
	}
	naira := refundKobo / 100
	// Group the naira part by thousands without floats.
	s := fmt.Sprintf("%d", naira)
	var grouped []byte
	for i, ch := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			grouped = append(grouped, ',')
		}
		grouped = append(grouped, ch)
	}
	return fmt.Sprintf("Cancellation refund of ₦%s.%02d issued", grouped, refundKobo%100)
}

// lagosWindow returns the first and last Lagos calendar dates (YYYY-MM-DD) of a
// days-long window ending on the Lagos day containing at.
func lagosWindow(at time.Time, days int) (start, today string) {
	loc, err := time.LoadLocation(dashboardTZ)
	if err != nil {
		loc = time.FixedZone("WAT", 3600) // Lagos has no DST; UTC+1 year-round
	}
	t := at.In(loc)
	day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return day.AddDate(0, 0, -(days - 1)).Format("2006-01-02"), day.Format("2006-01-02")
}

// Dashboard (admin): GET /dashboard — read-only operations aggregates.
func (h *Handler) Dashboard(c *gin.Context) {
	d, err := h.loadDashboard(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": d})
}

func (h *Handler) loadDashboard(ctx context.Context) (StaysDashboard, error) {
	d := newDashboard()
	start, today := lagosWindow(time.Now(), dashboardWindowDays)

	// Booked = CONFIRMED/COMPLETED NGN reservations; the Lagos day is taken from created_at.
	const booked = `state IN ('CONFIRMED','COMPLETED') AND currency = 'NGN'
		AND (created_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1::date AND $2::date`

	var netRev int64
	var created int64
	if err := h.db.QueryRow(ctx, `
		SELECT
		  COALESCE(SUM(gross_amount_kobo) FILTER (WHERE (created_at AT TIME ZONE 'Africa/Lagos')::date = $2::date), 0),
		  COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Africa/Lagos')::date = $2::date),
		  COALESCE(SUM(gross_amount_kobo), 0),
		  COUNT(*),
		  COALESCE(SUM(markup_kobo + commission_kobo), 0)
		FROM public.stays_reservation WHERE `+booked, start, today,
	).Scan(&d.GMVTodayKobo, &d.BookingsToday, &d.GMV30dKobo, &d.Bookings30d, &netRev); err != nil {
		return d, fmt.Errorf("dashboard totals: %w", err)
	}
	d.NetRevenue30dKobo = netRev
	d.TakeRate = ratio(netRev, d.GMV30dKobo)
	d.AvgBookingValueKobo = avgKobo(d.GMV30dKobo, int64(d.Bookings30d))

	if err := h.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM public.stays_reservation
		WHERE state <> 'VOID'
		  AND (created_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1::date AND $2::date`, start, today,
	).Scan(&created); err != nil {
		return d, fmt.Errorf("dashboard conversion: %w", err)
	}
	d.Conversion = ratio(int64(d.Bookings30d), created)

	if err := h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo), 0) FROM public.stays_commission_entry
		WHERE currency = 'NGN'
		  AND (created_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1::date AND $2::date`, start, today,
	).Scan(&d.Commission30dKobo); err != nil {
		return d, fmt.Errorf("dashboard commission: %w", err)
	}

	if err := h.db.QueryRow(ctx, `
		SELECT
		  (SELECT COUNT(*) FROM public.stays_mapping_record WHERE status = 'PENDING_REVIEW'),
		  (SELECT COUNT(*) FROM public.stays_property WHERE status = 'PENDING_REVIEW'),
		  (SELECT COUNT(DISTINCT pi.reservation_id)
		     FROM public.stays_payment_intent pi
		     JOIN public.stays_reservation r ON r.id = pi.reservation_id
		    WHERE pi.status = 'held'
		      AND r.state IN ('CANCELLED_BY_GUEST','CANCELLED_BY_HOTEL','BOOK_FAILED','PREBOOK_FAILED','VOID')),
		  (SELECT COUNT(*) FROM public.stays_reservation r
		    WHERE r.state IN ('PAYMENT_HELD','BOOKING')
		      AND r.updated_at < now() - interval '`+paidUnconfirmedAfter+`'
		      AND EXISTS (SELECT 1 FROM public.stays_payment_intent pi
		                   WHERE pi.reservation_id = r.id AND pi.status IN ('held','charged')))`,
	).Scan(&d.MappingConflictsOpen, &d.ModerationPending, &d.RefundsPending, &d.PaidUnconfirmed); err != nil {
		return d, fmt.Errorf("dashboard counters: %w", err)
	}

	rows, err := h.db.Query(ctx, `
		SELECT source_rail, supplier_code, COUNT(*), COALESCE(SUM(gross_amount_kobo), 0)
		FROM public.stays_reservation WHERE `+booked+`
		GROUP BY source_rail, supplier_code ORDER BY SUM(gross_amount_kobo) DESC, supplier_code`, start, today)
	if err != nil {
		return d, fmt.Errorf("dashboard supplier mix: %w", err)
	}
	for rows.Next() {
		var m SupplierMixRow
		if err := rows.Scan(&m.Rail, &m.Supplier, &m.Bookings, &m.GMVKobo); err != nil {
			rows.Close()
			return d, fmt.Errorf("dashboard supplier mix scan: %w", err)
		}
		d.SupplierMix = append(d.SupplierMix, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return d, fmt.Errorf("dashboard supplier mix: %w", err)
	}
	withShare(d.SupplierMix, d.GMV30dKobo)

	trend, err := h.db.Query(ctx, `
		WITH b AS (
		  SELECT (created_at AT TIME ZONE 'Africa/Lagos')::date AS d,
		         SUM(gross_amount_kobo) AS gmv, SUM(markup_kobo + commission_kobo) AS net
		  FROM public.stays_reservation WHERE `+booked+` GROUP BY 1)
		SELECT to_char(g.d, 'YYYY-MM-DD'), COALESCE(b.gmv, 0), COALESCE(b.net, 0)
		FROM generate_series($1::date, $2::date, interval '1 day') AS g(d)
		LEFT JOIN b ON b.d = g.d::date ORDER BY g.d`, start, today)
	if err != nil {
		return d, fmt.Errorf("dashboard trend: %w", err)
	}
	for trend.Next() {
		var t TrendDay
		if err := trend.Scan(&t.Date, &t.GMVKobo, &t.NetKobo); err != nil {
			trend.Close()
			return d, fmt.Errorf("dashboard trend scan: %w", err)
		}
		d.GMVTrend = append(d.GMVTrend, t)
	}
	trend.Close()
	if err := trend.Err(); err != nil {
		return d, fmt.Errorf("dashboard trend: %w", err)
	}

	if err := h.loadActivity(ctx, &d, start); err != nil {
		return d, err
	}
	return d, nil
}

func (h *Handler) loadActivity(ctx context.Context, d *StaysDashboard, start string) error {
	rows, err := h.db.Query(ctx, `
		SELECT id, kind, ref, refund_kobo, at FROM (
		  SELECT id::text, CASE state WHEN 'CONFIRMED' THEN 'booking_confirmed' ELSE 'book_failed' END AS kind,
		         id::text AS ref, 0::bigint AS refund_kobo, updated_at AS at
		    FROM public.stays_reservation
		   WHERE state IN ('CONFIRMED','BOOK_FAILED') AND updated_at >= $1::date
		  UNION ALL
		  SELECT id::text, 'refund_issued', reservation_id::text, refund_kobo, created_at
		    FROM public.stays_cancellation WHERE created_at >= $1::date
		  UNION ALL
		  SELECT id::text, 'mapping_conflict', id::text, 0::bigint, created_at
		    FROM public.stays_mapping_record WHERE status = 'PENDING_REVIEW' AND created_at >= $1::date
		) x ORDER BY at DESC, id LIMIT $2`, start, dashboardActivity)
	if err != nil {
		return fmt.Errorf("dashboard activity: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var a ActivityItem
		var ref string
		var refund int64
		if err := rows.Scan(&a.ID, &a.Kind, &ref, &refund, &a.CreatedAt); err != nil {
			return fmt.Errorf("dashboard activity scan: %w", err)
		}
		a.Ref = &ref
		switch a.Kind {
		case "booking_confirmed":
			a.Label = "Booking confirmed"
		case "book_failed":
			a.Label = "Booking failed at the supplier"
		case "refund_issued":
			a.Label = refundLabel(refund)
		case "mapping_conflict":
			a.Label = "Property mapping needs review"
		}
		d.Activity = append(d.Activity, a)
	}
	return rows.Err()
}

package restaurant

// FOOD-UAT-G-007 admin reporting (RBAC restaurant.admin.reports, wired in routes):
//   GET /api/restaurant/admin/reports/gmv          ?from&to&restaurant_id&zone&group_by
//   GET /api/restaurant/admin/reports/net-revenue  ?from&to&restaurant_id&zone&group_by
//   GET /api/restaurant/admin/reports/cohorts      ?from&to
//   GET /api/restaurant/admin/reports/export       ?kind=gmv|net-revenue|cohorts&format=csv + the same filters
//
// READ-ONLY. Nothing here posts to the ledger or mutates a row, so ADR-040
// conservation is unaffected. Every amount is integer kobo; rates are integer
// basis points (never floats).
//
// Definitions (kept explicit because "revenue" is easy to get wrong):
//   - A "settled order" is an orders row whose settlement (orders.settlement_id)
//     has status='settled'. GMV sums orders.total_kobo of those, bucketed by the
//     order's created_at.
//   - Net revenue is the PLATFORM share: settlements.fee_kobo (commission % of the
//     base + the fixed service fee — see settlement.Split), bucketed by settled_at.
//     The ledger holds no 'platform_commission' account/column to sum; fee_kobo is
//     the persisted projection of the platform leg written in the same transaction
//     as the ledger postings.
//   - zone has no first-class column on orders/restaurants, so it is a
//     case-insensitive substring match on orders.delivery_address.

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/httperr"
)

// ErrReportBadRequest marks a malformed report query (→ 400).
var ErrReportBadRequest = errors.New("restaurant: invalid report query")

// ReportFilter is the parsed, validated query shared by every report.
type ReportFilter struct {
	From         time.Time // inclusive
	To           time.Time // exclusive
	RestaurantID string    // "" = all
	Zone         string    // "" = all
	GroupBy      string    // day | week | month
}

type GMVBucket struct {
	Bucket  string `json:"bucket"`
	Orders  int64  `json:"orders"`
	GMVKobo int64  `json:"gmv_kobo"`
}

type GMVReport struct {
	From      string      `json:"from"`
	To        string      `json:"to"`
	GroupBy   string      `json:"group_by"`
	Orders    int64       `json:"orders"`
	TotalKobo int64       `json:"total_kobo"`
	Buckets   []GMVBucket `json:"buckets"`
}

type NetRevenueBucket struct {
	Bucket  string `json:"bucket"`
	Orders  int64  `json:"orders"`
	FeeKobo int64  `json:"fee_kobo"`
}

type NetRevenueReport struct {
	From      string             `json:"from"`
	To        string             `json:"to"`
	GroupBy   string             `json:"group_by"`
	Orders    int64              `json:"orders"`
	TotalKobo int64              `json:"total_kobo"`
	Buckets   []NetRevenueBucket `json:"buckets"`
}

type CohortRetention struct {
	MonthOffset     int   `json:"month_offset"`
	ActiveCustomers int64 `json:"active_customers"`
	RateBps         int64 `json:"rate_bps"`
}

type CohortRow struct {
	CohortMonth     string            `json:"cohort_month"`
	Customers       int64             `json:"customers"`
	RepeatCustomers int64             `json:"repeat_customers"`
	RepeatRateBps   int64             `json:"repeat_rate_bps"`
	Retention       []CohortRetention `json:"retention"`
}

type CohortReport struct {
	From    string      `json:"from"`
	To      string      `json:"to"`
	Cohorts []CohortRow `json:"cohorts"`
}

// parseReportDate accepts YYYY-MM-DD or RFC3339.
func parseReportDate(v string) (time.Time, bool, error) {
	if t, err := time.Parse("2006-01-02", v); err == nil {
		return t.UTC(), true, nil
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t.UTC(), false, nil
	}
	return time.Time{}, false, fmt.Errorf("%w: bad date %q (use YYYY-MM-DD or RFC3339)", ErrReportBadRequest, v)
}

func parseReportFilter(c *gin.Context) (ReportFilter, error) {
	f := ReportFilter{GroupBy: "day"}
	now := time.Now().UTC()
	f.To = now.Truncate(24 * time.Hour).Add(24 * time.Hour)
	f.From = f.To.AddDate(0, 0, -30)
	if v := c.Query("from"); v != "" {
		t, _, err := parseReportDate(v)
		if err != nil {
			return f, err
		}
		f.From = t
	}
	if v := c.Query("to"); v != "" {
		t, dateOnly, err := parseReportDate(v)
		if err != nil {
			return f, err
		}
		if dateOnly {
			t = t.AddDate(0, 0, 1) // a date-only "to" is inclusive of that whole day
		}
		f.To = t
	}
	if !f.To.After(f.From) {
		return f, fmt.Errorf("%w: to must be after from", ErrReportBadRequest)
	}
	if f.To.Sub(f.From) > 3660*24*time.Hour {
		return f, fmt.Errorf("%w: range is limited to 10 years", ErrReportBadRequest)
	}
	if v := c.Query("restaurant_id"); v != "" {
		if _, err := uuid.Parse(v); err != nil {
			return f, fmt.Errorf("%w: restaurant_id must be a uuid", ErrReportBadRequest)
		}
		f.RestaurantID = v
	}
	f.Zone = strings.TrimSpace(c.Query("zone"))
	if len(f.Zone) > 100 {
		return f, fmt.Errorf("%w: zone too long", ErrReportBadRequest)
	}
	if v := c.Query("group_by"); v != "" {
		switch v {
		case "day", "week", "month":
			f.GroupBy = v
		default:
			return f, fmt.Errorf("%w: group_by must be day|week|month", ErrReportBadRequest)
		}
	}
	return f, nil
}

// likeEscape neutralises LIKE metacharacters in an operator-typed zone string.
func likeEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

func bucketLabel(t time.Time, groupBy string) string {
	if groupBy == "month" {
		return t.UTC().Format("2006-01")
	}
	return t.UTC().Format("2006-01-02")
}

// AdminGMVReport sums settled order totals.
func (s *Service) AdminGMVReport(ctx context.Context, f ReportFilter) (*GMVReport, error) {
	rows, err := s.db.Query(ctx, `
		SELECT date_trunc($5, o.created_at AT TIME ZONE 'UTC') AS bucket,
		       COUNT(*)::bigint, COALESCE(SUM(o.total_kobo),0)::bigint
		  FROM orders o
		  JOIN settlements st ON st.id = o.settlement_id AND st.status = 'settled'
		 WHERE o.created_at >= $1 AND o.created_at < $2
		   AND ($3 = '' OR o.restaurant_id = $3::uuid)
		   AND ($4 = '' OR o.delivery_address ILIKE '%' || $4 || '%')
		 GROUP BY 1 ORDER BY 1`,
		f.From, f.To, f.RestaurantID, likeEscape(f.Zone), f.GroupBy)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &GMVReport{From: f.From.Format(time.RFC3339), To: f.To.Format(time.RFC3339), GroupBy: f.GroupBy, Buckets: []GMVBucket{}}
	for rows.Next() {
		var b GMVBucket
		var t time.Time
		if err := rows.Scan(&t, &b.Orders, &b.GMVKobo); err != nil {
			return nil, err
		}
		b.Bucket = bucketLabel(t, f.GroupBy)
		out.Orders += b.Orders
		out.TotalKobo += b.GMVKobo
		out.Buckets = append(out.Buckets, b)
	}
	return out, rows.Err()
}

// AdminNetRevenueReport sums the platform share (settlements.fee_kobo).
func (s *Service) AdminNetRevenueReport(ctx context.Context, f ReportFilter) (*NetRevenueReport, error) {
	rows, err := s.db.Query(ctx, `
		SELECT date_trunc($5, st.settled_at AT TIME ZONE 'UTC') AS bucket,
		       COUNT(*)::bigint, COALESCE(SUM(st.fee_kobo),0)::bigint
		  FROM settlements st
		  JOIN orders o ON o.settlement_id = st.id
		 WHERE st.module_type = 'food_delivery' AND st.status = 'settled'
		   AND st.settled_at >= $1 AND st.settled_at < $2
		   AND ($3 = '' OR o.restaurant_id = $3::uuid)
		   AND ($4 = '' OR o.delivery_address ILIKE '%' || $4 || '%')
		 GROUP BY 1 ORDER BY 1`,
		f.From, f.To, f.RestaurantID, likeEscape(f.Zone), f.GroupBy)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &NetRevenueReport{From: f.From.Format(time.RFC3339), To: f.To.Format(time.RFC3339), GroupBy: f.GroupBy, Buckets: []NetRevenueBucket{}}
	for rows.Next() {
		var b NetRevenueBucket
		var t time.Time
		if err := rows.Scan(&t, &b.Orders, &b.FeeKobo); err != nil {
			return nil, err
		}
		b.Bucket = bucketLabel(t, f.GroupBy)
		out.Orders += b.Orders
		out.TotalKobo += b.FeeKobo
		out.Buckets = append(out.Buckets, b)
	}
	return out, rows.Err()
}

// AdminCohortReport groups customers by the month of their first settled order and
// reports, per cohort, how many were active again N months later plus the share
// that ever ordered twice. Only cohorts whose first-order month falls in [from,to)
// are returned; activity is counted over all time so late repeat orders show up.
func (s *Service) AdminCohortReport(ctx context.Context, f ReportFilter) (*CohortReport, error) {
	const cte = `
		WITH settled AS (
		  SELECT o.customer_id, date_trunc('month', o.created_at AT TIME ZONE 'UTC') AS m
		    FROM orders o
		    JOIN settlements st ON st.id = o.settlement_id AND st.status = 'settled'
		), first AS (
		  SELECT customer_id, MIN(m) AS cm FROM settled GROUP BY customer_id
		)`
	out := &CohortReport{From: f.From.Format(time.RFC3339), To: f.To.Format(time.RFC3339), Cohorts: []CohortRow{}}
	idx := map[string]int{}

	rows, err := s.db.Query(ctx, cte+`
		SELECT fr.cm,
		       COUNT(*)::bigint,
		       COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM settled x WHERE x.customer_id = fr.customer_id) >= 2)::bigint
		  FROM first fr
		 WHERE fr.cm >= date_trunc('month', $1::timestamptz AT TIME ZONE 'UTC') AND fr.cm < $2::timestamp
		 GROUP BY fr.cm ORDER BY fr.cm`, f.From, f.To.UTC())
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var cm time.Time
		var r CohortRow
		if err := rows.Scan(&cm, &r.Customers, &r.RepeatCustomers); err != nil {
			rows.Close()
			return nil, err
		}
		r.CohortMonth = cm.UTC().Format("2006-01")
		if r.Customers > 0 {
			r.RepeatRateBps = r.RepeatCustomers * 10000 / r.Customers
		}
		r.Retention = []CohortRetention{}
		idx[r.CohortMonth] = len(out.Cohorts)
		out.Cohorts = append(out.Cohorts, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	act, err := s.db.Query(ctx, cte+`
		SELECT fr.cm,
		       ((EXTRACT(YEAR FROM a.m) - EXTRACT(YEAR FROM fr.cm)) * 12
		         + EXTRACT(MONTH FROM a.m) - EXTRACT(MONTH FROM fr.cm))::int AS off,
		       COUNT(DISTINCT a.customer_id)::bigint
		  FROM first fr
		  JOIN settled a ON a.customer_id = fr.customer_id
		 WHERE fr.cm >= date_trunc('month', $1::timestamptz AT TIME ZONE 'UTC') AND fr.cm < $2::timestamp
		 GROUP BY fr.cm, off ORDER BY fr.cm, off`, f.From, f.To.UTC())
	if err != nil {
		return nil, err
	}
	defer act.Close()
	for act.Next() {
		var cm time.Time
		var off int
		var n int64
		if err := act.Scan(&cm, &off, &n); err != nil {
			return nil, err
		}
		i, ok := idx[cm.UTC().Format("2006-01")]
		if !ok {
			continue
		}
		row := &out.Cohorts[i]
		var rate int64
		if row.Customers > 0 {
			rate = n * 10000 / row.Customers
		}
		row.Retention = append(row.Retention, CohortRetention{MonthOffset: off, ActiveCustomers: n, RateBps: rate})
	}
	return out, act.Err()
}

func reportFail(c *gin.Context, err error) {
	if errors.Is(err, ErrReportBadRequest) {
		c.JSON(http.StatusBadRequest, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
}

// AdminReportGMV → GET /api/restaurant/admin/reports/gmv.
func (h *Handler) AdminReportGMV(c *gin.Context) {
	f, err := parseReportFilter(c)
	if err != nil {
		reportFail(c, err)
		return
	}
	r, err := h.svc.AdminGMVReport(c.Request.Context(), f)
	if err != nil {
		reportFail(c, err)
		return
	}
	c.JSON(http.StatusOK, r)
}

// AdminReportNetRevenue → GET /api/restaurant/admin/reports/net-revenue.
func (h *Handler) AdminReportNetRevenue(c *gin.Context) {
	f, err := parseReportFilter(c)
	if err != nil {
		reportFail(c, err)
		return
	}
	r, err := h.svc.AdminNetRevenueReport(c.Request.Context(), f)
	if err != nil {
		reportFail(c, err)
		return
	}
	c.JSON(http.StatusOK, r)
}

// AdminReportCohorts → GET /api/restaurant/admin/reports/cohorts.
func (h *Handler) AdminReportCohorts(c *gin.Context) {
	f, err := parseReportFilter(c)
	if err != nil {
		reportFail(c, err)
		return
	}
	r, err := h.svc.AdminCohortReport(c.Request.Context(), f)
	if err != nil {
		reportFail(c, err)
		return
	}
	c.JSON(http.StatusOK, r)
}

// AdminReportExport → GET /api/restaurant/admin/reports/export?kind=&format=csv.
func (h *Handler) AdminReportExport(c *gin.Context) {
	kind := c.Query("kind")
	if fm := c.DefaultQuery("format", "csv"); fm != "csv" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "only format=csv is supported"})
		return
	}
	f, err := parseReportFilter(c)
	if err != nil {
		reportFail(c, err)
		return
	}
	var rows [][]string
	switch kind {
	case "gmv":
		r, err := h.svc.AdminGMVReport(c.Request.Context(), f)
		if err != nil {
			reportFail(c, err)
			return
		}
		rows = append(rows, []string{"bucket", "orders", "gmv_kobo"})
		for _, b := range r.Buckets {
			rows = append(rows, []string{b.Bucket, strconv.FormatInt(b.Orders, 10), strconv.FormatInt(b.GMVKobo, 10)})
		}
	case "net-revenue":
		r, err := h.svc.AdminNetRevenueReport(c.Request.Context(), f)
		if err != nil {
			reportFail(c, err)
			return
		}
		rows = append(rows, []string{"bucket", "orders", "fee_kobo"})
		for _, b := range r.Buckets {
			rows = append(rows, []string{b.Bucket, strconv.FormatInt(b.Orders, 10), strconv.FormatInt(b.FeeKobo, 10)})
		}
	case "cohorts":
		r, err := h.svc.AdminCohortReport(c.Request.Context(), f)
		if err != nil {
			reportFail(c, err)
			return
		}
		rows = append(rows, []string{"cohort_month", "customers", "repeat_customers", "repeat_rate_bps", "month_offset", "active_customers", "retention_rate_bps"})
		for _, co := range r.Cohorts {
			for _, rt := range co.Retention {
				rows = append(rows, []string{co.CohortMonth, strconv.FormatInt(co.Customers, 10), strconv.FormatInt(co.RepeatCustomers, 10),
					strconv.FormatInt(co.RepeatRateBps, 10), strconv.Itoa(rt.MonthOffset), strconv.FormatInt(rt.ActiveCustomers, 10), strconv.FormatInt(rt.RateBps, 10)})
			}
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{keyError: "kind must be gmv|net-revenue|cohorts"})
		return
	}
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="restaurant-%s-%s.csv"`, kind, time.Now().UTC().Format("20060102")))
	w := csv.NewWriter(c.Writer)
	_ = w.WriteAll(rows)
	w.Flush()
}

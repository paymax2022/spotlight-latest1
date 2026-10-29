package transport

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Bus revenue report (admin). All amounts are integer kobo. The period filters
// on the ticket's booking time (bus_tickets.created_at), half-open [from, to+1d).
// Operator payout and platform commission come from the settlement legs that
// actually moved (settlements.provider_kobo / fee_kobo), counted only once the
// ticket's payout_state is 'released' — never recomputed from live config.

const maxBusReportRangeDays = 366

// BusRevenueRow is one group (a day or an operator) of the revenue report.
type BusRevenueRow struct {
	Key                    string `json:"key"`
	Label                  string `json:"label"`
	TicketsCount           int64  `json:"ticketsCount"`
	GrossBookedKobo        int64  `json:"grossBookedKobo"`
	CancelledCount         int64  `json:"cancelledCount"`
	RefundedKobo           int64  `json:"refundedKobo"`
	ManualRefundKobo       int64  `json:"manualRefundKobo"`
	HeldKobo               int64  `json:"heldKobo"`
	ReleasedCount          int64  `json:"releasedCount"`
	NetToOperatorKobo      int64  `json:"netToOperatorKobo"`
	PlatformCommissionKobo int64  `json:"platformCommissionKobo"`
}

// BusRevenueReport is the GET /admin/transport/bus/reports/revenue payload.
type BusRevenueReport struct {
	From    string          `json:"from"`
	To      string          `json:"to"`
	GroupBy string          `json:"groupBy"`
	Rows    []BusRevenueRow `json:"rows"`
	Totals  BusRevenueRow   `json:"totals"`
}

const (
	busReportByDay      = "day"
	busReportByOperator = "operator"
)

// busReportPeriod is a validated half-open [From, ToExcl) UTC window.
type busReportPeriod struct {
	From, ToExcl time.Time
	GroupBy      string
}

// parseBusReportPeriod validates from/to (YYYY-MM-DD, inclusive) and group_by.
// Defaults: last 30 days ending today (UTC), grouped by day.
func parseBusReportPeriod(fromS, toS, groupBy string, now time.Time) (busReportPeriod, error) {
	var p busReportPeriod
	u := now.UTC()
	to := time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
	if toS != "" {
		t, err := time.Parse(time.DateOnly, toS)
		if err != nil {
			return p, codedErr(http.StatusBadRequest, "INVALID_DATE", "to must be YYYY-MM-DD")
		}
		to = t
	}
	from := to.AddDate(0, 0, -29)
	if fromS != "" {
		f, err := time.Parse(time.DateOnly, fromS)
		if err != nil {
			return p, codedErr(http.StatusBadRequest, "INVALID_DATE", "from must be YYYY-MM-DD")
		}
		from = f
	}
	if from.After(to) {
		return p, codedErr(http.StatusBadRequest, "INVALID_RANGE", "from must not be after to")
	}
	if to.Sub(from) >= maxBusReportRangeDays*24*time.Hour {
		return p, codedErr(http.StatusBadRequest, "INVALID_RANGE",
			fmt.Sprintf("range must not exceed %d days", maxBusReportRangeDays))
	}
	switch groupBy {
	case "", busReportByDay:
		p.GroupBy = busReportByDay
	case busReportByOperator:
		p.GroupBy = busReportByOperator
	default:
		return p, codedErr(http.StatusBadRequest, "INVALID_GROUP_BY", "group_by must be day or operator")
	}
	p.From, p.ToExcl = from, to.AddDate(0, 0, 1)
	return p, nil
}

const busRevenueAggregates = `
	COUNT(*),
	COALESCE(SUM(t.fare_kobo), 0),
	COUNT(*) FILTER (WHERE t.status IN ('cancelled','refunded')),
	COALESCE(SUM(t.fare_kobo) FILTER (WHERE t.refund_status = 'refunded'), 0),
	COALESCE(SUM(t.fare_kobo) FILTER (WHERE t.refund_status = 'manual_required'), 0),
	COALESCE(SUM(t.fare_kobo) FILTER (WHERE t.payout_state IN ('held','releasing') AND t.status NOT IN ('cancelled','refunded')), 0),
	COUNT(*) FILTER (WHERE t.payout_state = 'released'),
	COALESCE(SUM(st.provider_kobo) FILTER (WHERE t.payout_state = 'released'), 0),
	COALESCE(SUM(st.fee_kobo) FILTER (WHERE t.payout_state = 'released'), 0)`

// BusRevenueReport aggregates bus ticket money for [from, toExcl) by day or operator.
func (a *AdminService) BusRevenueReport(ctx context.Context, fromS, toS, groupBy string) (*BusRevenueReport, error) {
	period, err := parseBusReportPeriod(fromS, toS, groupBy, time.Now())
	if err != nil {
		return nil, err
	}
	from, toExcl, gb := period.From, period.ToExcl, period.GroupBy
	keyExpr, labelExpr := `to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`, `to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
	if gb == busReportByOperator {
		keyExpr = `COALESCE(r.provider_id::text, r.operator_id::text)`
		labelExpr = `COALESCE(MAX(p.business_name), 'operator ' || LEFT(MAX(COALESCE(r.provider_id::text, r.operator_id::text)), 8))`
	}
	q := `SELECT ` + keyExpr + `, ` + labelExpr + `,` + busRevenueAggregates + `
		FROM bus_tickets t
		JOIN bus_schedules s ON s.id = t.schedule_id
		JOIN bus_routes r ON r.id = s.route_id
		LEFT JOIN bus_providers p ON p.id = r.provider_id
		LEFT JOIN settlements st ON st.id = t.settlement_id
		WHERE t.created_at >= $1 AND t.created_at < $2
		GROUP BY 1
		ORDER BY 1`
	rows, err := a.svc.db.Query(ctx, q, from, toExcl)
	if err != nil {
		return nil, fmt.Errorf("transport: bus revenue report: %w", err)
	}
	defer rows.Close()
	rep := &BusRevenueReport{
		From: from.Format(time.DateOnly), To: toExcl.AddDate(0, 0, -1).Format(time.DateOnly),
		GroupBy: gb, Rows: []BusRevenueRow{}, Totals: BusRevenueRow{Key: "total", Label: "Total"},
	}
	for rows.Next() {
		var r BusRevenueRow
		if err := rows.Scan(&r.Key, &r.Label, &r.TicketsCount, &r.GrossBookedKobo, &r.CancelledCount,
			&r.RefundedKobo, &r.ManualRefundKobo, &r.HeldKobo, &r.ReleasedCount,
			&r.NetToOperatorKobo, &r.PlatformCommissionKobo); err != nil {
			return nil, err
		}
		rep.Rows = append(rep.Rows, r)
		addBusRevenue(&rep.Totals, r)
	}
	return rep, rows.Err()
}

func addBusRevenue(dst *BusRevenueRow, r BusRevenueRow) {
	dst.TicketsCount += r.TicketsCount
	dst.GrossBookedKobo += r.GrossBookedKobo
	dst.CancelledCount += r.CancelledCount
	dst.RefundedKobo += r.RefundedKobo
	dst.ManualRefundKobo += r.ManualRefundKobo
	dst.HeldKobo += r.HeldKobo
	dst.ReleasedCount += r.ReleasedCount
	dst.NetToOperatorKobo += r.NetToOperatorKobo
	dst.PlatformCommissionKobo += r.PlatformCommissionKobo
}

// csvCellSafe neutralizes spreadsheet formula injection: a cell starting with a
// formula trigger (= + - @ or a tab/CR leader) is prefixed with an apostrophe.
func csvCellSafe(v string) string {
	if v == "" {
		return v
	}
	switch v[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + v
	}
	return v
}

const busRevenueCSVColumns = "label,tickets,gross_booked_kobo,cancelled_count,refunded_kobo,manual_refund_kobo," +
	"held_kobo,released_count,net_to_operator_kobo,platform_commission_kobo"

// BusRevenueCSV renders the report as CSV (kobo integers, totals row last).
func BusRevenueCSV(rep *BusRevenueReport) ([]byte, error) {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	_ = w.Write(append([]string{rep.GroupBy}, strings.Split(busRevenueCSVColumns, ",")...))
	write := func(r BusRevenueRow) {
		i := func(n int64) string { return strconv.FormatInt(n, 10) }
		_ = w.Write([]string{csvCellSafe(r.Key), csvCellSafe(r.Label), i(r.TicketsCount), i(r.GrossBookedKobo),
			i(r.CancelledCount), i(r.RefundedKobo), i(r.ManualRefundKobo), i(r.HeldKobo), i(r.ReleasedCount),
			i(r.NetToOperatorKobo), i(r.PlatformCommissionKobo)})
	}
	for _, r := range rep.Rows {
		write(r)
	}
	write(rep.Totals)
	w.Flush()
	return buf.Bytes(), w.Error()
}

// AdminBusRevenueReport serves GET /bus/reports/revenue (JSON, or CSV with format=csv).
func (h *AdminHandler) AdminBusRevenueReport(c *gin.Context) {
	rep, err := h.svc.BusRevenueReport(c.Request.Context(), c.Query("from"), c.Query("to"), c.Query("group_by"))
	if err != nil {
		respondErr(c, err)
		return
	}
	if c.Query("format") != "csv" {
		c.JSON(http.StatusOK, rep)
		return
	}
	body, err := BusRevenueCSV(rep)
	if err != nil {
		respondErr(c, err)
		return
	}
	name := fmt.Sprintf("bus-revenue-%s-%s-by-%s.csv", rep.From, rep.To, rep.GroupBy)
	c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "text/csv; charset=utf-8", body)
}

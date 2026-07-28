package estate

import (
	"context"
	"fmt"
	"time"
)

// analytics.go — Block 44 reports & analytics: nine date-filtered, chart-ready
// aggregate endpoints exposed via GET /estate/:id/analytics/:type?from=&to=.

// AnalyticsPoint is one bar/line datum.
type AnalyticsPoint struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
}

// AnalyticsResult is the chart-ready response shape shared by every type.
type AnalyticsResult struct {
	Type    string           `json:"type"`
	From    string           `json:"from"`
	To      string           `json:"to"`
	Series  []AnalyticsPoint `json:"series"`
	Summary map[string]any   `json:"summary"`
}

// AnalyticsTypes is the supported set (Block 44).
var AnalyticsTypes = []string{
	"visitors", "gate", "payments", "repairs", "facilities",
	"meetings", "elections", "security", "vendors",
}

func validAnalyticsType(t string) bool {
	for _, x := range AnalyticsTypes {
		if x == t {
			return true
		}
	}
	return false
}

// resolveRange returns the [from,to] window, defaulting to the last 30 days when
// either bound is blank/invalid. Dates are YYYY-MM-DD; `to` is inclusive (end of
// day). Pure (now injected) for unit testing.
func resolveRange(from, to string, now time.Time) (time.Time, time.Time) {
	end := now
	if t, err := time.Parse("2006-01-02", to); err == nil {
		end = t.Add(24*time.Hour - time.Second)
	}
	start := end.Add(-30 * 24 * time.Hour)
	if t, err := time.Parse("2006-01-02", from); err == nil {
		start = t
	}
	if start.After(end) {
		start = end.Add(-30 * 24 * time.Hour)
	}
	return start, end
}

// GetAnalytics dispatches to the requested analytics query (estate admin only).
func (s *Service) GetAnalytics(ctx context.Context, estateID, adminID, typ, from, to string) (*AnalyticsResult, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if !validAnalyticsType(typ) {
		return nil, fmt.Errorf("estate: unknown analytics type %q", typ)
	}
	start, end := resolveRange(from, to, time.Now())
	res := &AnalyticsResult{
		Type: typ, From: start.Format("2006-01-02"), To: end.Format("2006-01-02"),
		Series: []AnalyticsPoint{}, Summary: map[string]any{},
	}

	var seriesQ string
	var summary func() error
	switch typ {
	case "visitors": // access codes issued per day
		seriesQ = `SELECT to_char(created_at::date,'YYYY-MM-DD'), count(*)::float8
			FROM visitor_access_codes WHERE estate_id=$1 AND created_at BETWEEN $2 AND $3
			GROUP BY 1 ORDER BY 1`
		summary = func() error {
			var total int
			if err := s.db.QueryRow(ctx, `SELECT count(*) FROM visitor_access_codes WHERE estate_id=$1 AND created_at BETWEEN $2 AND $3`, estateID, start, end).Scan(&total); err != nil {
				return err
			}
			res.Summary["total_codes"] = total
			return nil
		}
	case "gate": // check-ins/outs grouped by event
		seriesQ = `SELECT vc.event, count(*)::float8
			FROM visitor_checkins vc JOIN visitor_access_codes c ON c.id = vc.code_id
			WHERE c.estate_id=$1 AND vc.captured_at BETWEEN $2 AND $3 GROUP BY vc.event ORDER BY 2 DESC`
		summary = func() error {
			var total int
			if err := s.db.QueryRow(ctx, `SELECT count(*) FROM visitor_checkins vc JOIN visitor_access_codes c ON c.id=vc.code_id WHERE c.estate_id=$1 AND vc.captured_at BETWEEN $2 AND $3`, estateID, start, end).Scan(&total); err != nil {
				return err
			}
			res.Summary["total_events"] = total
			return nil
		}
	case "payments": // collected per day
		seriesQ = `SELECT to_char(created_at::date,'YYYY-MM-DD'), COALESCE(sum(amount_kobo),0)::float8
			FROM estate_payments WHERE estate_id=$1 AND status='successful' AND created_at BETWEEN $2 AND $3
			GROUP BY 1 ORDER BY 1`
		summary = func() error {
			var total int64
			var cnt int
			if err := s.db.QueryRow(ctx, `SELECT COALESCE(sum(amount_kobo),0), count(*) FROM estate_payments WHERE estate_id=$1 AND status='successful' AND created_at BETWEEN $2 AND $3`, estateID, start, end).Scan(&total, &cnt); err != nil {
				return err
			}
			res.Summary["total_collected_kobo"] = total
			res.Summary["payment_count"] = cnt
			return nil
		}
	case "repairs": // by status
		seriesQ = `SELECT status, count(*)::float8 FROM estate_repair_requests
			WHERE estate_id=$1 AND created_at BETWEEN $2 AND $3 GROUP BY status ORDER BY 2 DESC`
		summary = func() error {
			var total, open int
			if err := s.db.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE status NOT IN ('completed','cancelled')) FROM estate_repair_requests WHERE estate_id=$1 AND created_at BETWEEN $2 AND $3`, estateID, start, end).Scan(&total, &open); err != nil {
				return err
			}
			res.Summary["total"] = total
			res.Summary["open"] = open
			return nil
		}
	case "facilities": // bookings per facility
		seriesQ = `SELECT f.name, count(b.id)::float8
			FROM facility_bookings b JOIN estate_facilities f ON f.id=b.facility_id
			WHERE b.estate_id=$1 AND b.created_at BETWEEN $2 AND $3 GROUP BY f.id,f.name ORDER BY 2 DESC`
		summary = func() error {
			var cnt int
			var rev int64
			if err := s.db.QueryRow(ctx, `SELECT count(*), COALESCE(sum(amount_kobo),0) FROM facility_bookings WHERE estate_id=$1 AND created_at BETWEEN $2 AND $3`, estateID, start, end).Scan(&cnt, &rev); err != nil {
				return err
			}
			res.Summary["total_bookings"] = cnt
			res.Summary["booking_revenue_kobo"] = rev
			return nil
		}
	case "meetings": // attendance per meeting
		seriesQ = `SELECT m.title, count(a.id)::float8
			FROM estate_meetings m LEFT JOIN meeting_attendees a ON a.meeting_id=m.id
			WHERE m.estate_id=$1 AND m.starts_at BETWEEN $2 AND $3 GROUP BY m.id,m.title ORDER BY m.starts_at`
		summary = func() error {
			var meetings, attendance int
			if err := s.db.QueryRow(ctx, `SELECT count(DISTINCT m.id), count(a.id) FROM estate_meetings m LEFT JOIN meeting_attendees a ON a.meeting_id=m.id WHERE m.estate_id=$1 AND m.starts_at BETWEEN $2 AND $3`, estateID, start, end).Scan(&meetings, &attendance); err != nil {
				return err
			}
			res.Summary["meetings"] = meetings
			res.Summary["total_attendance"] = attendance
			return nil
		}
	case "elections": // turnout per election
		seriesQ = `SELECT e.title, count(v.id)::float8
			FROM elections e LEFT JOIN election_votes v ON v.election_id=e.id
			WHERE e.estate_id=$1 AND e.created_at BETWEEN $2 AND $3 GROUP BY e.id,e.title ORDER BY e.created_at`
		summary = func() error {
			var elections, votes, residents int
			if err := s.db.QueryRow(ctx, `SELECT count(DISTINCT e.id), count(v.id) FROM elections e LEFT JOIN election_votes v ON v.election_id=e.id WHERE e.estate_id=$1 AND e.created_at BETWEEN $2 AND $3`, estateID, start, end).Scan(&elections, &votes); err != nil {
				return err
			}
			_ = s.db.QueryRow(ctx, `SELECT count(*) FROM estate_residents WHERE estate_id=$1`, estateID).Scan(&residents)
			res.Summary["elections"] = elections
			res.Summary["total_votes"] = votes
			res.Summary["eligible_residents"] = residents
			return nil
		}
	case "security": // incidents by kind
		seriesQ = `SELECT kind, count(*)::float8 FROM estate_emergency_alerts
			WHERE estate_id=$1 AND created_at BETWEEN $2 AND $3 GROUP BY kind ORDER BY 2 DESC`
		summary = func() error {
			var total, open int
			if err := s.db.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE status <> 'resolved') FROM estate_emergency_alerts WHERE estate_id=$1 AND created_at BETWEEN $2 AND $3`, estateID, start, end).Scan(&total, &open); err != nil {
				return err
			}
			res.Summary["total"] = total
			res.Summary["unresolved"] = open
			return nil
		}
	case "vendors": // jobs per vendor
		seriesQ = `SELECT v.name, count(j.id)::float8
			FROM estate_vendors v LEFT JOIN vendor_jobs j ON j.vendor_id=v.id AND j.created_at BETWEEN $2 AND $3
			WHERE v.estate_id=$1 GROUP BY v.id,v.name ORDER BY 2 DESC`
		summary = func() error {
			var vendors int
			var avg *float64
			if err := s.db.QueryRow(ctx, `SELECT count(*), avg(rating) FROM estate_vendors WHERE estate_id=$1`, estateID).Scan(&vendors, &avg); err != nil {
				return err
			}
			res.Summary["vendors"] = vendors
			if avg != nil {
				res.Summary["avg_rating"] = *avg
			}
			return nil
		}
	}

	rows, err := s.db.Query(ctx, seriesQ, estateID, start, end)
	if err != nil {
		return nil, fmt.Errorf("estate: analytics %s: %w", typ, err)
	}
	defer rows.Close()
	for rows.Next() {
		var p AnalyticsPoint
		if err := rows.Scan(&p.Label, &p.Value); err != nil {
			return nil, err
		}
		res.Series = append(res.Series, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if summary != nil {
		if err := summary(); err != nil {
			return nil, fmt.Errorf("estate: analytics %s summary: %w", typ, err)
		}
	}
	return res, nil
}

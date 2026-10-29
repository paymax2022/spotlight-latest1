package transport

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestParseBusReportPeriod(t *testing.T) {
	now := time.Date(2026, 10, 29, 15, 0, 0, 0, time.UTC)
	p, err := parseBusReportPeriod("", "", "", now)
	if err != nil {
		t.Fatalf("defaults: %v", err)
	}
	from, toExcl, gb := p.From, p.ToExcl, p.GroupBy
	if got := from.Format(time.DateOnly); got != "2026-09-30" {
		t.Errorf("default from = %s", got)
	}
	if got := toExcl.Format(time.DateOnly); got != "2026-10-30" {
		t.Errorf("default toExcl = %s (to must be inclusive)", got)
	}
	if gb != "day" {
		t.Errorf("default group_by = %s", gb)
	}

	if p, err := parseBusReportPeriod("2026-01-01", "2026-01-31", "operator", now); err != nil || p.GroupBy != "operator" {
		t.Errorf("operator: gb=%s err=%v", p.GroupBy, err)
	}
	// Exactly 366 days inclusive is allowed; 367 is not.
	if _, err := parseBusReportPeriod("2025-01-01", "2026-01-01", "", now); err != nil {
		t.Errorf("366-day range rejected: %v", err)
	}
	cases := map[string][3]string{
		"bad from":       {"2026/01/01", "", ""},
		"bad to":         {"", "tomorrow", ""},
		"inverted":       {"2026-02-01", "2026-01-01", ""},
		"too long":       {"2024-12-31", "2026-01-01", ""},
		"bad group_by":   {"", "", "provider"},
		"sql in groupBy": {"", "", "day; DROP TABLE x"},
	}
	for name, c := range cases {
		_, err := parseBusReportPeriod(c[0], c[1], c[2], now)
		var ce *CodedError
		if !errors.As(err, &ce) || ce.Status != 400 {
			t.Errorf("%s: want 400 CodedError, got %v", name, err)
		}
	}
}

func TestCSVCellSafe(t *testing.T) {
	for in, want := range map[string]string{
		"":              "",
		"GreenLine":     "GreenLine",
		"=HYPERLINK(1)": "'=HYPERLINK(1)",
		"+1":            "'+1",
		"-2":            "'-2",
		"@SUM(A1)":      "'@SUM(A1)",
		"\tx":           "'\tx",
		"2026-10-29":    "2026-10-29",
	} {
		if got := csvCellSafe(in); got != want {
			t.Errorf("csvCellSafe(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBusRevenueCSV(t *testing.T) {
	rep := &BusRevenueReport{From: "2026-10-01", To: "2026-10-02", GroupBy: "operator",
		Rows: []BusRevenueRow{{Key: "p1", Label: "=evil, \"co\"", TicketsCount: 2, GrossBookedKobo: 500000,
			ReleasedCount: 1, NetToOperatorKobo: 225000, PlatformCommissionKobo: 25000}},
		Totals: BusRevenueRow{Key: "total", Label: "Total", TicketsCount: 2, GrossBookedKobo: 500000,
			ReleasedCount: 1, NetToOperatorKobo: 225000, PlatformCommissionKobo: 25000}}
	b, err := BusRevenueCSV(rep)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) != 3 {
		t.Fatalf("want header+row+total, got %d lines: %q", len(lines), b)
	}
	if !strings.HasPrefix(lines[0], "operator,label,tickets,gross_booked_kobo") {
		t.Errorf("header = %s", lines[0])
	}
	if lines[1] != `p1,"'=evil, ""co""",2,500000,0,0,0,0,1,225000,25000` {
		t.Errorf("row = %s", lines[1])
	}
	if !strings.HasPrefix(lines[2], "total,Total,2,500000") {
		t.Errorf("total = %s", lines[2])
	}
}

package admin

import (
	"encoding/json"
	"testing"
	"time"
)

func TestRatio(t *testing.T) {
	cases := []struct {
		num, den int64
		want     float64
	}{
		{0, 0, 0},     // no GMV: a zero rate, never NaN/Inf (JSON cannot encode those)
		{5, 0, 0},     // zero denominator is safe whatever the numerator
		{1, 4, 0.25},
		{10, 10, 1},
		{-3, 10, 0},   // a net-negative period reads as 0, not a negative rate
	}
	for _, c := range cases {
		if got := ratio(c.num, c.den); got != c.want {
			t.Errorf("ratio(%d,%d) = %v, want %v", c.num, c.den, got, c.want)
		}
	}
}

func TestAvgKoboIsIntegerDivision(t *testing.T) {
	if got := avgKobo(10_000_00, 3); got != 333_333 {
		t.Errorf("avgKobo = %d, want 333333 (truncated)", got)
	}
	if got := avgKobo(500, 0); got != 0 {
		t.Errorf("avgKobo with no bookings = %d, want 0", got)
	}
}

func TestSupplierShareSumsToGMVShare(t *testing.T) {
	mix := []SupplierMixRow{
		{Supplier: "ratehawk", Rail: "BEDBANK", Bookings: 3, GMVKobo: 750},
		{Supplier: "self", Rail: "DIRECT", Bookings: 1, GMVKobo: 250},
	}
	withShare(mix, 1000)
	if mix[0].SharePct != 0.75 || mix[1].SharePct != 0.25 {
		t.Errorf("shares = %v / %v, want 0.75 / 0.25", mix[0].SharePct, mix[1].SharePct)
	}
	withShare(mix, 0)
	if mix[0].SharePct != 0 || mix[1].SharePct != 0 {
		t.Errorf("shares with zero total GMV must be 0, got %v / %v", mix[0].SharePct, mix[1].SharePct)
	}
}

func TestDashboardJSONNeverEmitsNullCollections(t *testing.T) {
	// The admin page maps over these; a null array is a runtime crash in the console.
	d := newDashboard()
	b, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"supplier_mix", "gmv_trend", "activity", "unavailable_metrics"} {
		arr, ok := m[k].([]any)
		if !ok {
			t.Errorf("%s = %#v, want an empty array, not null", k, m[k])
			continue
		}
		_ = arr
	}
}

func TestUnavailableMetricsNamesTheReconciliationPair(t *testing.T) {
	// No reconciliation-break source exists yet. The 0s must be flagged so they
	// cannot be mistaken for a measured "no breaks".
	d := newDashboard()
	got := map[string]bool{}
	for _, m := range d.UnavailableMetrics {
		got[m] = true
	}
	for _, want := range []string{"reconciliation_breaks_open", "reconciliation_break_value_kobo"} {
		if !got[want] {
			t.Errorf("unavailable_metrics is missing %q", want)
		}
	}
}

func TestRefundActivityLabelFormatsKobo(t *testing.T) {
	if got := refundLabel(12_345_67); got != "Cancellation refund of ₦12,345.67 issued" {
		t.Errorf("refundLabel = %q", got)
	}
	if got := refundLabel(5); got != "Cancellation refund of ₦0.05 issued" {
		t.Errorf("refundLabel(5) = %q", got)
	}
	if got := refundLabel(0); got != "Cancellation processed, no refund due" {
		t.Errorf("refundLabel(0) = %q", got)
	}
}

func TestLagosDayWindow(t *testing.T) {
	// 23:30 UTC on 10 Oct is already 00:30 on 11 Oct in Lagos (UTC+1).
	at := time.Date(2026, 10, 10, 23, 30, 0, 0, time.UTC)
	start, today := lagosWindow(at, 30)
	if today != "2026-10-11" {
		t.Errorf("today = %s, want 2026-10-11", today)
	}
	if start != "2026-09-12" {
		t.Errorf("start = %s, want 2026-09-12 (29 days before today)", start)
	}
}

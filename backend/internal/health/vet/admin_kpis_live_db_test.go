package healthvet_test

// LIVE-DB: dashboard KPIs move by exactly what the fixture seeds, and the
// reporting period / CSV export honour the window. Skips without TEST_DATABASE_URL.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	healthvet "spotlight/backend/internal/health/vet"
)

func TestLiveDB_AdminDashboardKPIs_AndReportingPeriod(t *testing.T) {
	pool := vetAdminDashboardPool(t)
	ctx := t.Context()
	svc := healthvet.NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	before, err := svc.AdminDashboard(ctx)
	if err != nil {
		t.Fatal(err)
	}
	rBefore, err := svc.AdminConsoleReporting(ctx, "7d")
	if err != nil {
		t.Fatal(err)
	}

	f := newVetAdminFixture(t, ctx, pool)
	if _, err := pool.Exec(ctx, `UPDATE vet_appointment_payments SET pay_state='RELEASED' WHERE appointment_id=$1`, f.completedID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE vet_appointment_payments SET pay_state='REFUNDED' WHERE appointment_id=$1`, f.cancelledID); err != nil {
		t.Fatal(err)
	}

	after, err := svc.AdminDashboard(ctx)
	if err != nil {
		t.Fatal(err)
	}
	checks := []struct {
		name      string
		got, want int64
	}{
		{"appointments_today", after.AppointmentsToday, before.AppointmentsToday + 3},
		{"appointments_30d", after.Appointments30d, before.Appointments30d + 3},
		{"consults_completed_30d", after.ConsultsCompleted30d, before.ConsultsCompleted30d + 1},
		{"gmv_30d_kobo", after.GMV30dKobo, before.GMV30dKobo + 1_000_000},
		{"held_balance_kobo", after.HeldBalanceKobo, before.HeldBalanceKobo + 500_000},
		{"released_30d_kobo", after.Released30dKobo, before.Released30dKobo + 500_000},
		{"refunded_30d_kobo", after.Refunded30dKobo, before.Refunded30dKobo + 500_000},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %d, want %d", c.name, c.got, c.want)
		}
	}
	if len(after.AppointmentsTrend) != 14 || after.AppointmentsTrend[13].Appointments < 3 {
		t.Errorf("trend: %+v", after.AppointmentsTrend)
	}
	if after.CompletionRate < 0 || after.CompletionRate > 1 || after.TakeRate < 0 {
		t.Errorf("rates out of range: %+v", after.AdminDashboardKPIs)
	}

	r, err := svc.AdminConsoleReporting(ctx, "7d")
	if err != nil {
		t.Fatal(err)
	}
	if r.PeriodLabel != "Last 7 days" || r.Appointments != rBefore.Appointments+3 {
		t.Errorf("7d reporting: label=%q appts=%d (before %d)", r.PeriodLabel, r.Appointments, rBefore.Appointments)
	}
	for _, st := range r.ByState {
		if st.SharePct < 0 || st.SharePct > 1 {
			t.Errorf("share_pct must be a fraction: %+v", st)
		}
	}
	if _, err := svc.AdminConsoleReporting(ctx, "fortnight"); err == nil {
		t.Error("unknown period must be refused")
	}

	gin.SetMode(gin.TestMode)
	eng := gin.New()
	eng.GET("/export.csv", healthvet.NewHandler(svc, nil).AdminReportingExportCSV)
	w := httptest.NewRecorder()
	eng.ServeHTTP(w, httptest.NewRequestWithContext(ctx, http.MethodGet, "/export.csv?period=30d", nil))
	if w.Code != http.StatusOK || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/csv") ||
		!strings.Contains(w.Body.String(), "summary,period,Last 30 days") {
		t.Fatalf("csv: %d %s %q", w.Code, w.Header().Get("Content-Type"), w.Body.String())
	}
}

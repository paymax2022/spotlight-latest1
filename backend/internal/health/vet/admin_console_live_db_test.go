package healthvet

// LIVE-DB smoke for the read-only console views: every query must execute
// against the real schema and return a non-nil slice. Skips without
// TEST_DATABASE_URL (listAppointmentsLivePool).

import "testing"

func TestLiveDB_AdminConsoleViews_QueriesRunAndNeverReturnNil(t *testing.T) {
	ctx := t.Context()
	svc := NewService(listAppointmentsLivePool(t), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	if v, err := svc.AdminConsoleAppointments(ctx); err != nil || v == nil {
		t.Fatalf("appointments: %v %v", v, err)
	}
	if v, err := svc.AdminConsoleVCN(ctx); err != nil || v == nil {
		t.Fatalf("vcn: %v %v", v, err)
	}
	if v, err := svc.AdminConsoleERx(ctx); err != nil || v == nil {
		t.Fatalf("erx: %v %v", v, err)
	}
	if v, err := svc.AdminConsoleServices(ctx); err != nil || v == nil {
		t.Fatalf("services: %v %v", v, err)
	}
	if v, err := svc.AdminConsolePayouts(ctx); err != nil || v == nil {
		t.Fatalf("payouts: %v %v", v, err)
	}
	r, err := svc.AdminConsoleReporting(ctx)
	if err != nil || r == nil || r.ByState == nil || r.Monthly == nil {
		t.Fatalf("reporting: %+v %v", r, err)
	}
	if r.GMVKobo < 0 || r.CompletionRate < 0 || r.CompletionRate > 1 {
		t.Fatalf("reporting out of range: %+v", r)
	}
}

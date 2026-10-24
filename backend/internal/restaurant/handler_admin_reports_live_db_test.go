package restaurant

// LIVE-DB regression for FOOD-UAT-G-006/G-007 (admin order trace + GMV /
// net-revenue / cohort reports). Skipped unless TEST_DATABASE_URL is set.
// Seeds orders dated in 2001 so no real data can leak into the asserted windows.

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

type rptOrder struct {
	cust, addr          string
	at                  time.Time
	total, fee          int64
	settled             bool
	orderID, settlement string
}

func TestLiveDB_AdminReports_GMVNetRevenueCohorts(t *testing.T) {
	pool := withdrawalPool(t)
	t.Cleanup(pool.Close)
	ctx := t.Context()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	custs := map[string]string{"A": uuid.New().String(), "B": uuid.New().String(), "C": uuid.New().String()}
	for _, u := range append([]string{owner}, custs["A"], custs["B"], custs["C"]) {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Report Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	d := func(s string) time.Time { x, _ := time.Parse("2006-01-02", s); return x.Add(10 * time.Hour) }
	seed := []rptOrder{
		{cust: "A", addr: "Lekki Phase 1", at: d("2001-03-05"), total: 10000, fee: 1000, settled: true},
		{cust: "A", addr: "Lekki Phase 1", at: d("2001-04-10"), total: 20000, fee: 2000, settled: true},
		{cust: "B", addr: "Lekki Phase 1", at: d("2001-03-20"), total: 30000, fee: 3000, settled: true},
		{cust: "C", addr: "Ikeja", at: d("2001-04-02"), total: 40000, fee: 4000, settled: true},
		{cust: "B", addr: "Lekki Phase 1", at: d("2001-03-25"), total: 99999, fee: 0, settled: false}, // escrowed: excluded
	}
	for i := range seed {
		o := &seed[i]
		o.orderID, o.settlement = uuid.New().String(), uuid.New().String()
		st, settledAt := "escrowed", any(nil)
		if o.settled {
			st, settledAt = "settled", o.at
		}
		if _, err := pool.Exec(ctx, `INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, fee_kobo, provider_kobo, status, escrowed_at, settled_at, idempotency_key)
			VALUES ($1,$2,'food_delivery',$3,$4,$5,0,$6,$7,$8,$9)`,
			o.settlement, "order:"+o.orderID, custs[o.cust], o.total, o.fee, st, o.at, settledAt, "rpt-"+o.settlement); err != nil {
			t.Fatalf("seed settlement: %v", err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, delivery_kobo, total_kobo, status, idempotency_key, settlement_id, delivery_address, created_at)
			VALUES ($1,$2,$3,$4,0,$4,'delivered',$5,$6,$7,$8)`,
			o.orderID, custs[o.cust], restID, o.total, "rpt-ord-"+o.orderID, o.settlement, o.addr, o.at); err != nil {
			t.Fatalf("seed order: %v", err)
		}
	}
	t.Cleanup(func() {
		for _, o := range seed {
			_, _ = pool.Exec(t.Context(), `DELETE FROM orders WHERE id=$1`, o.orderID)
			_, _ = pool.Exec(t.Context(), `DELETE FROM settlements WHERE id=$1`, o.settlement)
		}
		_, _ = pool.Exec(t.Context(), `DELETE FROM restaurants WHERE id=$1`, restID)
	})

	f := ReportFilter{From: d("2001-03-01").Truncate(24 * time.Hour), To: d("2001-05-01").Truncate(24 * time.Hour), RestaurantID: restID, GroupBy: "month"}

	g, err := svc.AdminGMVReport(ctx, f)
	if err != nil {
		t.Fatalf("gmv: %v", err)
	}
	if g.TotalKobo != 100000 || g.Orders != 4 || len(g.Buckets) != 2 ||
		g.Buckets[0] != (GMVBucket{"2001-03", 2, 40000}) || g.Buckets[1] != (GMVBucket{"2001-04", 2, 60000}) {
		t.Fatalf("gmv month: %+v", g)
	}
	fz := f
	fz.Zone = "lekki"
	if g, _ = svc.AdminGMVReport(ctx, fz); g.TotalKobo != 60000 || g.Orders != 3 {
		t.Fatalf("gmv zone=lekki: %+v", g)
	}
	fd := f
	fd.GroupBy = "day"
	if g, _ = svc.AdminGMVReport(ctx, fd); len(g.Buckets) != 4 || g.Buckets[0].Bucket != "2001-03-05" {
		t.Fatalf("gmv day: %+v", g)
	}
	fw := f
	fw.GroupBy = "week"
	if g, _ = svc.AdminGMVReport(ctx, fw); g.TotalKobo != 100000 || len(g.Buckets) != 4 {
		t.Fatalf("gmv week: %+v", g)
	}

	n, err := svc.AdminNetRevenueReport(ctx, f)
	if err != nil {
		t.Fatalf("net revenue: %v", err)
	}
	if n.TotalKobo != 10000 || n.Orders != 4 || len(n.Buckets) != 2 || n.Buckets[0].FeeKobo != 4000 || n.Buckets[1].FeeKobo != 6000 {
		t.Fatalf("net revenue: %+v", n)
	}

	// Cohorts are not restaurant-scoped; the 2001 window isolates the seed.
	c, err := svc.AdminCohortReport(ctx, f)
	if err != nil {
		t.Fatalf("cohorts: %v", err)
	}
	if len(c.Cohorts) != 2 {
		t.Fatalf("cohorts: %+v", c)
	}
	mar, apr := c.Cohorts[0], c.Cohorts[1]
	if mar.CohortMonth != "2001-03" || mar.Customers != 2 || mar.RepeatCustomers != 1 || mar.RepeatRateBps != 5000 ||
		len(mar.Retention) != 2 || mar.Retention[0] != (CohortRetention{0, 2, 10000}) || mar.Retention[1] != (CohortRetention{1, 1, 5000}) {
		t.Fatalf("march cohort: %+v", mar)
	}
	if apr.CohortMonth != "2001-04" || apr.Customers != 1 || apr.RepeatCustomers != 0 || len(apr.Retention) != 1 || apr.Retention[0].RateBps != 10000 {
		t.Fatalf("april cohort: %+v", apr)
	}
}

func TestLiveDB_AdminOrderTrace(t *testing.T) {
	pool := withdrawalPool(t)
	t.Cleanup(pool.Close)
	ctx := t.Context()
	svc := NewService(pool, nil)

	owner, cust, rider := uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, cust, rider} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	restID, orderID, stID, dispID := uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	at := time.Now().UTC().Add(-time.Hour)
	mustExec := func(q string, a ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, a...); err != nil {
			t.Fatalf("seed: %v\n%s", err, q)
		}
	}
	mustExec(`INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Trace Kitchen','1 St',TRUE)`, restID, owner)
	mustExec(`INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, fee_kobo, provider_kobo, status, escrowed_at, settled_at, idempotency_key)
		VALUES ($1,$2,'food_delivery',$3,10000,1000,8000,'settled',$4,$5,$6)`, stID, "order:"+orderID, cust, at, at.Add(30*time.Minute), "trace-"+stID)
	mustExec(`INSERT INTO orders (id, customer_id, restaurant_id, rider_id, subtotal_kobo, delivery_kobo, total_kobo, status, idempotency_key, settlement_id, delivery_address, created_at, pickup_attempts, pickup_locked_until)
		VALUES ($1,$2,$3,$4,10000,0,10000,'delivered',$5,$6,'Lekki',$7,5,now()+interval '10 minutes')`, orderID, cust, restID, rider, "trace-ord-"+orderID, stID, at)
	mustExec(`INSERT INTO audit_logs (action, module, resource_type, resource_id, old_values, new_values, created_at)
		VALUES ('order.status.confirmed','restaurant','order',$1,'{"status":"pending"}','{"from":"pending","to":"confirmed"}',$2)`, orderID, at.Add(time.Minute))
	mustExec(`INSERT INTO restaurant_delivery_offers (order_id, rider_id, status, created_at, responded_at) VALUES ($1,$2,'accepted',$3,$4)`, orderID, rider, at.Add(2*time.Minute), at.Add(3*time.Minute))
	mustExec(`INSERT INTO disputes (id, user_id, reference, module_type, type, description, status) VALUES ($1,$2,$3,'food','late_delivery','the food arrived very cold and late',  'open')`, dispID, cust, orderID)
	t.Cleanup(func() {
		ctx := t.Context()
		_, _ = pool.Exec(ctx, `DELETE FROM disputes WHERE id=$1`, dispID)
		_, _ = pool.Exec(ctx, `DELETE FROM audit_logs WHERE resource_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant_delivery_offers WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM orders WHERE id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM settlements WHERE id=$1`, stID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurants WHERE id=$1`, restID)
	})

	ev, err := svc.AdminOrderTrace(ctx, orderID)
	if err != nil {
		t.Fatalf("trace: %v", err)
	}
	kinds := map[string]int{}
	for i, e := range ev {
		kinds[e.Kind]++
		if i > 0 && e.At.Before(ev[i-1].At) {
			t.Fatalf("events not chronological at %d: %+v", i, ev)
		}
	}
	for k, want := range map[string]int{"order": 1, "transition": 1, "dispatch": 2, "payment": 2, "dispute": 1, "code_lockout": 1} {
		if kinds[k] != want {
			t.Fatalf("kind %s: got %d want %d (all=%v)", k, kinds[k], want, kinds)
		}
	}
	for _, e := range ev {
		if e.Kind == "transition" && !strings.Contains(string(e.After), `"to": "confirmed"`) && !strings.Contains(string(e.After), `"to":"confirmed"`) {
			t.Fatalf("transition after: %s", e.After)
		}
	}
	if _, err := svc.AdminOrderTrace(ctx, uuid.New().String()); err == nil {
		t.Fatal("unknown order must error")
	}
}

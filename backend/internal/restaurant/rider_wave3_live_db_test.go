package restaurant

// LIVE-DB tests for the Wave-3 rider fixes: suspension releases in-flight orders
// (FOOD-UAT-A-001), licence expiry gates approval/dispatch/online (A-013), and the
// mark-failed route (E-011). Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/transport"
)

func seedRiderDriver(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID, verification, status string) string {
	t.Helper()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, userID+"@seed.test")
	testsupport.CleanupUser(t, pool, userID)
	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO drivers (user_id, name, vehicle_reg, vehicle_type, status, verification_status)
		 VALUES ($1,'Wave3 Rider','W3-'||substr($1::uuid::text,1,6),'bike',$2,$3) RETURNING id`,
		userID, status, verification).Scan(&id); err != nil {
		t.Fatalf("seed driver: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM driver_documents WHERE driver_id=$1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM drivers WHERE id=$1`, id)
	})
	return id
}

func TestLiveDB_SuspendRiderReleasesInFlightOrders(t *testing.T) {
	pool := fsmPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := fsmService(pool)
	admin := transport.NewAdminService(transport.NewService(pool, nil))

	owner, customer, riderU, adminU := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, u := range []string{owner, customer, adminU} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
		testsupport.CleanupUser(t, pool, u)
	}
	driverID := seedRiderDriver(t, ctx, pool, riderU, "approved", "online")
	restID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'W3 Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// (b) picked-up order => suspension refused, nothing changes.
	pickedUp, _ := seedOrderWithEscrow(t, ctx, pool, restID, customer, &riderU, "picked_up", "assigned", nil)
	if err := admin.SetVerification(ctx, adminU, driverID, "suspended", "test"); err == nil {
		t.Fatal("suspending a rider mid-delivery on a picked-up order must be refused")
	} else if !strings.Contains(err.Error(), "picked-up") {
		t.Fatalf("want actionable picked-up error, got %v", err)
	}
	var vs string
	_ = pool.QueryRow(ctx, `SELECT verification_status FROM drivers WHERE id=$1`, driverID).Scan(&vs)
	if vs != "approved" {
		t.Fatalf("refused suspension must not change status, got %s", vs)
	}
	if _, err := pool.Exec(ctx, `UPDATE orders SET status='delivered' WHERE id=$1`, pickedUp); err != nil {
		t.Fatal(err)
	}

	// (a) assigned (pre-pickup) order => released back to the dispatch pool.
	oid, _ := seedOrderWithEscrow(t, ctx, pool, restID, customer, &riderU, "ready", "assigned", nil)
	if _, err := pool.Exec(ctx, `INSERT INTO restaurant_delivery_offers (order_id, rider_id, status) VALUES ($1,$2,'accepted')`, oid, riderU); err != nil {
		t.Fatal(err)
	}
	if err := admin.SetVerification(ctx, adminU, driverID, "suspended", "test"); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	var rider *string
	var disp, ost string
	_ = pool.QueryRow(ctx, `SELECT rider_id::text, dispatch_status, status FROM orders WHERE id=$1`, oid).Scan(&rider, &disp, &ost)
	if rider != nil || disp != "searching" || ost != "ready" {
		t.Fatalf("order not released: rider=%v dispatch=%s status=%s", rider, disp, ost)
	}
	var offerSt string
	_ = pool.QueryRow(ctx, `SELECT status FROM restaurant_delivery_offers WHERE order_id=$1 AND rider_id=$2`, oid, riderU).Scan(&offerSt)
	if offerSt != "expired" {
		t.Fatalf("offer = %s, want expired", offerSt)
	}
	// The suspended rider can no longer pick up.
	if err := svc.ConfirmPickup(ctx, oid, riderU, "0000"); err == nil {
		t.Fatal("suspended rider must not be able to pick up a released order")
	}
}

func TestLiveDB_ExpiredLicenceBlocksApprovalAndDispatch(t *testing.T) {
	pool := fsmPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := fsmService(pool)
	admin := transport.NewAdminService(transport.NewService(pool, nil))

	owner, customer, riderU, adminU := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, u := range []string{owner, customer, adminU} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
		testsupport.CleanupUser(t, pool, u)
	}
	driverID := seedRiderDriver(t, ctx, pool, riderU, "under_review", "online")
	if _, err := pool.Exec(ctx, `INSERT INTO driver_documents (driver_id, doc_type, file_url, status, expiry_date)
		VALUES ($1,'drivers_licence','https://x/y.jpg','approved', CURRENT_DATE - 3)`, driverID); err != nil {
		t.Fatal(err)
	}
	if err := admin.SetVerification(ctx, adminU, driverID, "approved", "t"); err == nil {
		t.Fatal("approving a rider with an expired licence must be refused")
	}
	// Force-approve (legacy data) then prove dispatch skips them.
	_, _ = pool.Exec(ctx, `UPDATE drivers SET verification_status='approved' WHERE id=$1`, driverID)
	restID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'W3 Kitchen2','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatal(err)
	}
	oid, _ := seedOrderWithEscrow(t, ctx, pool, restID, customer, nil, "ready", "none", nil)
	if err := svc.DispatchOrder(ctx, oid); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_delivery_offers WHERE order_id=$1 AND rider_id=$2`, oid, riderU).Scan(&n)
	if n != 0 {
		t.Fatal("expired-licence rider must not receive a dispatch offer")
	}
	// Renewal restores eligibility.
	_, _ = pool.Exec(ctx, `INSERT INTO driver_documents (driver_id, doc_type, file_url, status, expiry_date)
		VALUES ($1,'drivers_licence','https://x/z.jpg','approved', CURRENT_DATE + 300)`, driverID)
	_, _ = pool.Exec(ctx, `UPDATE orders SET dispatch_attempts=0 WHERE id=$1`, oid)
	if err := svc.DispatchOrder(ctx, oid); err != nil {
		t.Fatal(err)
	}
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_delivery_offers WHERE order_id=$1 AND rider_id=$2`, oid, riderU).Scan(&n)
	if n != 1 {
		t.Fatalf("renewed-licence rider should be offered the order, offers=%d", n)
	}
}

func TestLiveDB_MarkFailedRoute(t *testing.T) {
	pool := fsmPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	h := NewHandler(fsmService(pool))

	owner, customer, riderU, other := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, u := range []string{owner, customer, riderU, other} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
		testsupport.CleanupUser(t, pool, u)
	}
	restID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'W3 Kitchen3','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatal(err)
	}
	oid, _ := seedOrderWithEscrow(t, ctx, pool, restID, customer, &riderU, "picked_up", "assigned", nil)

	gin.SetMode(gin.TestMode)
	call := func(user, body string) *httptest.ResponseRecorder {
		r := gin.New()
		r.Use(func(c *gin.Context) { c.Set("user_id", user) })
		r.POST("/orders/:orderId/mark-failed", h.MarkDeliveryFailed)
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/orders/"+oid+"/mark-failed", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		return w
	}
	if w := call(other, `{"reason":"x"}`); w.Code != http.StatusForbidden {
		t.Fatalf("non-assigned rider: got %d %s", w.Code, w.Body)
	}
	if w := call(riderU, `{}`); w.Code != http.StatusBadRequest {
		t.Fatalf("missing reason: got %d", w.Code)
	}
	if w := call(riderU, `{"reason":"customer unreachable","evidence_url":"ftp://bad"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("bad evidence url: got %d", w.Code)
	}
	w := call(riderU, `{"reason":"customer unreachable","evidence_url":"https://cdn.example.com/p.jpg"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("mark-failed: got %d %s", w.Code, w.Body)
	}
	if st := orderStatusFSM(t, ctx, pool, oid); st != "delivery_failed" {
		t.Fatalf("status = %s", st)
	}
}

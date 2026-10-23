package restaurant

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func i64p(v int64) *int64 { return &v }

func TestApplyServiceFeePolicy(t *testing.T) {
	cases := []struct {
		name     string
		fee      int64
		min, max *int64
		mode     string
		want     int64
	}{
		{"zero fee stays zero even with a floor", 0, i64p(5000), nil, FeeRoundNone, 0},
		{"none leaves fee", 1234, nil, nil, FeeRoundNone, 1234},
		{"nearest naira up", 1250, nil, nil, FeeRoundNearest, 1300},
		{"nearest naira down", 1249, nil, nil, FeeRoundNearest, 1200},
		{"up naira", 1201, nil, nil, FeeRoundUp, 1300},
		{"up naira exact", 1200, nil, nil, FeeRoundUp, 1200},
		{"down naira", 1299, nil, nil, FeeRoundDown, 1200},
		{"floor", 100, i64p(5000), nil, FeeRoundNone, 5000},
		{"cap", 90000, nil, i64p(50000), FeeRoundNone, 50000},
		{"cap wins over round-up", 49950, nil, i64p(49950), FeeRoundUp, 49950},
		{"unknown mode ignored", 777, nil, nil, "bogus", 777},
	}
	for _, c := range cases {
		if got := ApplyServiceFeePolicy(c.fee, c.min, c.max, c.mode); got != c.want {
			t.Errorf("%s: got %d want %d", c.name, got, c.want)
		}
	}
}

// F-003 follow-up: the promo cap tracks a non-default split, and the zero split is the legacy 80/10/10.
func TestPromoFunderCapKoboSplit_NonDefault(t *testing.T) {
	cs := CommissionSplit{ProviderBps: 6000, RiderBps: 1500, PlatformBps: 2500}
	const gross = 100_000
	if got := promoFunderCapKoboSplit(FunderPlatform, gross, cs); got != 25_000 {
		t.Errorf("platform cap = %d want 25000", got)
	}
	if got := promoFunderCapKoboSplit(FunderRestaurant, gross, cs); got != 60_000 {
		t.Errorf("restaurant cap = %d want 60000", got)
	}
	if got, want := promoFunderCapKoboSplit(FunderRestaurant, gross, CommissionSplit{}), promoFunderCapKobo(FunderRestaurant, gross); got != want {
		t.Errorf("zero split = %d want default %d", got, want)
	}
	if err := assertDiscountFundable(appliedPromo{Funder: FunderPlatform, DiscountKobo: 25_001, Split: cs}, gross); err == nil {
		t.Error("discount above the non-default platform leg must be refused")
	}
}

func TestStatusCodeFor_RiderIneligibleAndTransitionConflictAre409(t *testing.T) {
	for _, e := range []error{ErrRiderIneligible, ErrOrderTransitionConflict} {
		if got := statusCodeFor(e); got != http.StatusConflict {
			t.Errorf("%v -> %d, want 409", e, got)
		}
	}
}

type w7Fixture struct {
	svc                                  *Service
	owner, customer, rider, restID, ordID string
}

func newW7Fixture(t *testing.T, status string, withRider bool) w7Fixture {
	t.Helper()
	pool := fsmPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := w7Fixture{svc: fsmService(pool), owner: uuid.New().String(), customer: uuid.New().String(), rider: uuid.New().String(), restID: uuid.New().String()}
	for _, u := range []string{f.owner, f.customer, f.rider} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatal(err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, kyb_status) VALUES ($1,$2,'W7 Kitchen','1 St',TRUE,'approved')`, f.restID, f.owner); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM restaurants WHERE id=$1`, f.restID) })
	var rider *string
	if withRider {
		rider = &f.rider
	}
	f.ordID, _ = seedOrderWithEscrow(t, ctx, pool, f.restID, f.customer, rider, status, "assigned", nil)
	return f
}

func TestLiveDB_W7_PermitBackfill(t *testing.T) {
	f := newW7Fixture(t, "pending", false)
	ctx := context.Background()
	admin := uuid.New().String()
	// the fixture restaurant is open with a NULL permit
	if _, err := f.svc.BackfillNullPermits(ctx, admin, time.Now().Add(-time.Hour), time.Now()); err == nil {
		t.Fatal("a past default_expires_at must be rejected")
	}
	exp := time.Now().Add(180 * 24 * time.Hour)
	ids, err := f.svc.BackfillNullPermits(ctx, admin, exp, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, id := range ids {
		found = found || id == f.restID
	}
	if !found {
		t.Fatalf("fixture restaurant not backfilled (touched %d)", len(ids))
	}
	ok, err := f.svc.PermitValidFor(ctx, f.restID, time.Now())
	if err != nil || !ok {
		t.Fatalf("permit valid after backfill = %v err=%v", ok, err)
	}
	// idempotent: the stamped row is no longer NULL
	again, _ := f.svc.BackfillNullPermits(ctx, admin, exp, time.Now())
	for _, id := range again {
		if id == f.restID {
			t.Fatal("second backfill re-touched an already-stamped restaurant")
		}
	}
}

func TestLiveDB_W7_LocationGateAndPurge(t *testing.T) {
	f := newW7Fixture(t, "ready", true)
	ctx := context.Background()
	if err := f.svc.PostLocation(ctx, f.ordID, f.rider, 6.5, 3.4); !errors.Is(err, ErrLocationNotTrackable) {
		t.Fatalf("pre-pickup post: %v, want ErrLocationNotTrackable", err)
	}
	if _, err := f.svc.db.Exec(ctx, `UPDATE orders SET status='picked_up' WHERE id=$1`, f.ordID); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.PostLocation(ctx, f.ordID, f.rider, 6.5, 3.4); err != nil {
		t.Fatalf("post while picked_up: %v", err)
	}
	// retention: age the breadcrumb past 30 days and purge
	if _, err := f.svc.db.Exec(ctx, `UPDATE restaurant_rider_locations SET created_at = now() - interval '31 days' WHERE order_id=$1`, f.ordID); err != nil {
		t.Fatal(err)
	}
	if n, err := f.svc.PurgeRiderLocations(ctx, time.Now()); err != nil || n < 1 {
		t.Fatalf("purge n=%d err=%v", n, err)
	}
}

// E-009: a refused FSM transition must not leave delivered_at stamped.
func TestLiveDB_W7_ConfirmHandoffGuardBeforeWrite(t *testing.T) {
	f := newW7Fixture(t, "cancelled", true)
	ctx := context.Background()
	if _, err := f.svc.db.Exec(ctx, `UPDATE orders SET delivery_code='4321' WHERE id=$1`, f.ordID); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ConfirmHandoff(ctx, f.ordID, f.rider, "4321"); err == nil {
		t.Fatal("handoff of a cancelled order must be refused")
	}
	var delivered *time.Time
	var ds string
	_ = f.svc.db.QueryRow(ctx, `SELECT delivered_at, COALESCE(dispatch_status,'') FROM orders WHERE id=$1`, f.ordID).Scan(&delivered, &ds)
	if delivered != nil || ds == "delivered" {
		t.Fatalf("refused handoff still wrote delivered_at=%v dispatch_status=%q", delivered, ds)
	}
}

func TestLiveDB_W7_IncidentAndEvidence(t *testing.T) {
	f := newW7Fixture(t, "delivered", true)
	ctx := context.Background()
	if _, err := f.svc.ReportRiderIncident(ctx, f.ordID, f.customer, "theft", "someone grabbed it", nil, nil); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-rider incident: %v, want ErrForbidden", err)
	}
	if _, err := f.svc.ReportRiderIncident(ctx, f.ordID, f.rider, "nonsense", "something happened", nil, nil); !errors.Is(err, ErrIncidentInvalid) {
		t.Fatalf("bad kind: %v", err)
	}
	inc, err := f.svc.ReportRiderIncident(ctx, f.ordID, f.rider, "unsafe_dropoff", "dark alley, felt unsafe", nil, nil)
	if err != nil || inc.Status != "open" {
		t.Fatalf("incident: %v %+v", err, inc)
	}
	list, err := f.svc.AdminListRiderIncidents(ctx, "open", 50, 0)
	if err != nil || len(list) == 0 {
		t.Fatalf("admin list: %v n=%d", err, len(list))
	}

	d, err := f.svc.RaiseFoodDispute(ctx, f.ordID, f.customer, "wrong_item", "got the wrong meal entirely, nothing I ordered")
	if err != nil {
		t.Fatalf("raise dispute: %v", err)
	}
	if _, err := f.svc.AttachDisputeEvidence(ctx, d.ID, f.customer, "javascript:alert(1)", ""); !errors.Is(err, ErrDisputeInvalid) {
		t.Fatalf("bad url: %v", err)
	}
	if _, err := f.svc.AttachDisputeEvidence(ctx, d.ID, uuid.New().String(), "https://r2.example/p.jpg", ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger attach: %v", err)
	}
	if _, err := f.svc.AttachDisputeEvidence(ctx, d.ID, f.customer, "https://r2.example/p.jpg", "photo"); err != nil {
		t.Fatalf("attach: %v", err)
	}
	ev, err := f.svc.ListDisputeEvidence(ctx, d.ID, f.owner)
	if err != nil || len(ev) != 1 {
		t.Fatalf("merchant list: %v n=%d", err, len(ev))
	}
}

// HTTP-level check of the backfill route + the 409 mapping on rider accept.
func TestLiveDB_W7_BackfillRouteHTTP(t *testing.T) {
	f := newW7Fixture(t, "pending", false)
	h := NewHandler(f.svc)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", f.owner) })
	r.POST("/permits/backfill-null", h.AdminBackfillNullPermits)
	r.POST("/orders/:orderId/accept", h.AcceptDelivery)
	call := func(path string) (int, string) {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, nil))
		return w.Code, w.Body.String()
	}
	if code, _ := call("/permits/backfill-null"); code != http.StatusBadRequest {
		t.Errorf("missing date = %d, want 400", code)
	}
	past := url.QueryEscape(time.Now().Add(-24 * time.Hour).UTC().Format(time.RFC3339))
	if code, _ := call("/permits/backfill-null?default_expires_at=" + past); code != http.StatusBadRequest {
		t.Errorf("past date = %d, want 400", code)
	}
	future := url.QueryEscape(time.Now().Add(365 * 24 * time.Hour).UTC().Format(time.RFC3339))
	if code, body := call("/permits/backfill-null?default_expires_at=" + future); code != http.StatusOK {
		t.Errorf("valid backfill = %d %s, want 200", code, body)
	}
	// approved-but-offline rider with a live offer -> ErrRiderIneligible -> 409
	ctx := context.Background()
	seedRiderDriver(t, ctx, f.svc.db, f.rider, "approved", "offline")
	if _, err := f.svc.db.Exec(ctx,
		`INSERT INTO restaurant_delivery_offers (order_id, rider_id, status) VALUES ($1,$2,'offered')`, f.ordID, f.rider); err != nil {
		t.Fatalf("seed offer: %v", err)
	}
	r2 := gin.New()
	r2.Use(func(c *gin.Context) { c.Set("user_id", f.rider) })
	r2.POST("/orders/:orderId/accept", h.AcceptDelivery)
	w := httptest.NewRecorder()
	r2.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/orders/"+f.ordID+"/accept", nil))
	if w.Code != http.StatusConflict {
		t.Errorf("offline rider accept = %d %s, want 409", w.Code, w.Body.String())
	}
}

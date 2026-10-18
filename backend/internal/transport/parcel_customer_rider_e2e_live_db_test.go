package transport

// One end-to-end run of a parcel through the real HTTP handlers, played by
// both sides at once: the customer estimates and books an insured parcel, two
// riders race for it, the winner verifies the pickup PIN, picks it up and
// delivers it with the drop-off PIN, and the customer reads the result.
//
// Every response body is what the mobile app receives (the Next /api/v1
// proxy forwards Go's JSON unchanged). Set PARCEL_E2E_DUMP=<dir> to write
// each one to <dir>/<step>.json for comparison with the app's types.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

type parcelE2E struct {
	t      *testing.T
	router *gin.Engine
	dump   string
}

func newParcelE2ERouter(h *Handler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// Stands in for RequireAuthContext: the caller is whoever the test says.
	r.Use(func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-Test-User")) })
	mob := r.Group("/api/finance/mobility")
	mob.POST("/parcels/estimate", h.ParcelEstimate)
	mob.POST("/parcels", h.ParcelBook)
	mob.GET("/parcels", h.ParcelList)
	mob.GET("/parcels/:id", h.ParcelGet)
	drv := r.Group("/api/finance/driver")
	drv.GET("/parcels/requests", h.ParcelRequests)
	drv.POST("/parcels/:id/accept", h.ParcelAccept)
	drv.POST("/parcels/:id/verify-pickup-pin", h.ParcelVerifyPickupPin)
	drv.POST("/parcels/:id/picked-up", h.ParcelPickedUp)
	drv.POST("/parcels/:id/verify-dropoff", h.ParcelVerifyDropoff)
	return r
}

// call sends one request as `user` and returns the status and decoded body.
func (e *parcelE2E) call(step, user, method, path string, body any, idemKey string) (int, map[string]any) {
	e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-User", user)
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	raw := w.Body.Bytes()
	e.t.Logf("%s → %d %s", step, w.Code, raw)
	if e.dump != "" {
		_ = os.WriteFile(filepath.Join(e.dump, step+".json"), raw, 0o644)
	}
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return w.Code, out
}

func seedParcelRider(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string) string {
	t.Helper()
	userID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, userID+"@parcele2e.test"); err != nil {
		t.Fatalf("seed rider user: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)
	if _, err := pool.Exec(ctx, `
		INSERT INTO drivers (user_id, name, vehicle_reg, vehicle_type, status, verification_status, current_lat, current_lng)
		VALUES ($1,$2,$3,'bike','online','approved',6.5,3.4)`, userID, name, "LND-"+userID[:6]); err != nil {
		t.Fatalf("seed rider: %v", err)
	}
	return userID
}

func kobo(m map[string]any, k string) int64 {
	f, _ := m[k].(float64)
	return int64(f)
}

func TestLiveDB_ParcelCustomerAndRiderEndToEnd(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	ctx := context.Background()
	riderA := seedParcelRider(t, ctx, f.pool, "Rider A")
	riderB := seedParcelRider(t, ctx, f.pool, "Rider B")
	e := &parcelE2E{t: t, router: newParcelE2ERouter(NewHandler(f.svc)), dump: os.Getenv("PARCEL_E2E_DUMP")}
	if e.dump != "" {
		_ = os.MkdirAll(e.dump, 0o755)
	}
	walletStart := f.wallet(t)

	// ── Customer: estimate, then book with insurance ticked ──────────────────
	req := insuredReq()
	code, est := e.call("01-customer-estimate", f.sender, "POST", "/api/finance/mobility/parcels/estimate", map[string]any{
		"pickup": req.Pickup, "dropoff": req.Dropoff, "category": "documents", "size": req.Size, "speed": req.Speed,
		"declared_value_kobo": req.DeclaredValueKobo,
	}, "")
	if code != http.StatusOK {
		t.Fatalf("estimate: %d %v", code, est)
	}
	fare, premium := kobo(est, "fareKobo"), kobo(est, "insuranceKobo")
	if fare <= 0 || premium <= 0 {
		t.Fatalf("estimate must quote a fare and a premium: %v", est)
	}

	bookKey := "e2e-book-" + uuid.NewString()
	code, booked := e.call("02-customer-book", f.sender, "POST", "/api/finance/mobility/parcels", map[string]any{
		"pickup": req.Pickup, "dropoff": req.Dropoff, "category": "documents", "size": req.Size, "speed": req.Speed,
		"declared_value_kobo": req.DeclaredValueKobo, "receiver_name": "Chioma Eze", "receiver_phone": "+2348030000010",
		"prohibited_ack": true, "payment_method": "wallet",
		"expected_fare_kobo": fare, "insure": true, "expected_insurance_kobo": premium,
	}, bookKey)
	if code != http.StatusCreated {
		t.Fatalf("book: %d %v", code, booked)
	}
	parcelID, _ := booked["id"].(string)
	if parcelID == "" {
		t.Fatalf("book returned no id: %v", booked)
	}
	if got := walletStart - f.wallet(t); got != fare+premium {
		t.Fatalf("booking must debit fare+premium (%d), debited %d", fare+premium, got)
	}

	// ── Riders: both see the request; A wins the race, B is refused ─────────
	code, reqs := e.call("03-rider-requests", riderA, "GET", "/api/finance/driver/parcels/requests", nil, "")
	if code != http.StatusOK {
		t.Fatalf("requests: %d %v", code, reqs)
	}
	list, _ := reqs["requests"].([]any)
	seen := false
	for _, r := range list {
		if m, _ := r.(map[string]any); m["id"] == parcelID {
			seen = true
		}
	}
	if !seen {
		t.Fatalf("rider A must see the new parcel in open requests")
	}

	code, accepted := e.call("04-rider-accept", riderA, "POST", "/api/finance/driver/parcels/"+parcelID+"/accept", nil, "e2e-accept-"+uuid.NewString())
	if code != http.StatusOK {
		t.Fatalf("accept: %d %v", code, accepted)
	}
	if accepted["pickupPin"] != nil || accepted["dropoffPin"] != nil {
		t.Fatalf("the rider must never be shown the PINs: %v", accepted)
	}
	if code, body := e.call("05-rider-b-accept-late", riderB, "POST", "/api/finance/driver/parcels/"+parcelID+"/accept", nil, "e2e-accept-"+uuid.NewString()); code != http.StatusConflict {
		t.Fatalf("a second rider must be refused: %d %v", code, body)
	}
	if code, body := e.call("06-rider-b-reads-parcel", riderB, "GET", "/api/finance/mobility/parcels/"+parcelID, nil, ""); code != http.StatusForbidden {
		t.Fatalf("an unassigned rider must not read the parcel: %d %v", code, body)
	}

	// Cover binds at accept from the premium held at booking.
	_, cust := e.call("07-customer-after-accept", f.sender, "GET", "/api/finance/mobility/parcels/"+parcelID, nil, "")
	if cust["status"] != "courier_assigned" || cust["insuranceStatus"] != "bound" {
		t.Fatalf("after accept the customer must see courier_assigned + bound cover: %v", cust)
	}
	pickupPin, _ := cust["pickupPin"].(string)
	dropoffPin, _ := cust["dropoffPin"].(string)
	if len(pickupPin) != 4 || len(dropoffPin) != 4 {
		t.Fatalf("the sender must see both PINs: %v", cust)
	}

	// ── Rider: pickup PIN (wrong, then right), picked up ────────────────────
	wrong := "0000"
	if wrong == pickupPin {
		wrong = "1111"
	}
	if code, body := e.call("08-rider-wrong-pickup-pin", riderA, "POST", "/api/finance/driver/parcels/"+parcelID+"/verify-pickup-pin", map[string]any{"pin": wrong}, ""); code != http.StatusUnprocessableEntity {
		t.Fatalf("a wrong pickup PIN must be refused: %d %v", code, body)
	}
	if code, body := e.call("09-rider-pickup-pin", riderA, "POST", "/api/finance/driver/parcels/"+parcelID+"/verify-pickup-pin", map[string]any{"pin": pickupPin}, ""); code != http.StatusOK {
		t.Fatalf("pickup PIN: %d %v", code, body)
	}
	if code, body := e.call("10-rider-picked-up", riderA, "POST", "/api/finance/driver/parcels/"+parcelID+"/picked-up", map[string]any{"photo_url": "https://example.test/pickup.jpg"}, ""); code != http.StatusOK {
		t.Fatalf("picked up: %d %v", code, body)
	}
	_, cust = e.call("11-customer-in-transit", f.sender, "GET", "/api/finance/mobility/parcels/"+parcelID, nil, "")
	if cust["status"] != "in_transit" {
		t.Fatalf("customer must see in_transit: %v", cust)
	}

	// ── Rider: drop-off (no proof, then proof + PIN) ────────────────────────
	if code, body := e.call("12-rider-dropoff-no-proof", riderA, "POST", "/api/finance/driver/parcels/"+parcelID+"/verify-dropoff", map[string]any{"pin": dropoffPin}, ""); code != http.StatusUnprocessableEntity && code != http.StatusBadRequest {
		t.Fatalf("drop-off without proof must be refused: %d %v", code, body)
	}
	if code, body := e.call("13-rider-dropoff", riderA, "POST", "/api/finance/driver/parcels/"+parcelID+"/verify-dropoff", map[string]any{"pin": dropoffPin, "proof_url": "https://example.test/proof.jpg"}, ""); code != http.StatusOK {
		t.Fatalf("drop-off: %d %v", code, body)
	}

	// ── Customer: final view ────────────────────────────────────────────────
	_, cust = e.call("14-customer-delivered", f.sender, "GET", "/api/finance/mobility/parcels/"+parcelID, nil, "")
	if cust["status"] != "delivered" || cust["insuranceStatus"] != "bound" {
		t.Fatalf("customer must see delivered + bound cover: %v", cust)
	}
	if code, body := e.call("15-customer-list", f.sender, "GET", "/api/finance/mobility/parcels", nil, ""); code != http.StatusOK {
		t.Fatalf("list: %d %v", code, body)
	}

	// ── Money ───────────────────────────────────────────────────────────────
	// The customer paid fare + premium once; nothing came back on delivery.
	if got := walletStart - f.wallet(t); got != fare+premium {
		t.Fatalf("customer net debit = %d, want fare+premium %d", got, fare+premium)
	}
	// The rider was paid from the fare escrow only (never the premium).
	var courierID string
	if err := f.pool.QueryRow(ctx, `SELECT id FROM drivers WHERE user_id=$1`, riderA).Scan(&courierID); err != nil {
		t.Fatalf("courier id: %v", err)
	}
	riderPaid, err := f.led.GetBalance(ctx, riderA)
	if err != nil {
		t.Fatalf("rider balance: %v", err)
	}
	if riderPaid <= 0 || riderPaid > fare {
		t.Fatalf("rider earnings %d must be positive and at most the fare %d", riderPaid, fare)
	}
	// The premium left the hold for the insurer (bound), so nothing is stranded.
	if typ, amt := entryAccountType(t, f.pool, "parcel:insurance:"+parcelID+":premium:debit"); typ != string(ledger.AccountInsurancePremiumHold) || amt != premium {
		t.Fatalf("hold drain = %s %d, want %s %d", typ, amt, ledger.AccountInsurancePremiumHold, premium)
	}
	var status string
	_ = f.pool.QueryRow(ctx, `SELECT status FROM drivers WHERE id=$1`, courierID).Scan(&status)
	if status != "online" {
		t.Fatalf("rider must be back online after delivery, got %q", status)
	}
	t.Log(fmt.Sprintf("fare=%d premium=%d riderEarned=%d", fare, premium, riderPaid))
}

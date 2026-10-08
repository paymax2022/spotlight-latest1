package paystackcheckout

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/transport"
)

type fakeParcels struct {
	quote      int64
	quotePrice json.RawMessage
	bookPrice  []json.RawMessage
	quoteReqs  []transport.ParcelBookRequest
	bookReqs   []transport.ParcelBookRequest
	bookIdem   []string
	bookAmt    []int64
	bookID     string
	findID     string
	findFound  bool
	quoteErr   error
	wantSender string
}

func (f *fakeParcels) QuoteParcelBookingFrozen(_ context.Context, r transport.ParcelBookRequest) (int64, json.RawMessage, error) {
	f.quoteReqs = append(f.quoteReqs, r)
	return f.quote, f.quotePrice, f.quoteErr
}
func (f *fakeParcels) FindParcelByIdempotencyKey(_ context.Context, sender, _ string) (string, bool, error) {
	f.wantSender = sender
	return f.findID, f.findFound, nil
}
func (f *fakeParcels) BookParcelPaystackFundedFrozen(_ context.Context, _ string, r transport.ParcelBookRequest, idem string, amt int64, pricing json.RawMessage) (string, error) {
	f.bookPrice = append(f.bookPrice, pricing)
	f.bookReqs, f.bookIdem, f.bookAmt = append(f.bookReqs, r), append(f.bookIdem, idem), append(f.bookAmt, amt)
	return f.bookID, nil
}

const goodParcel = `{"pickup":{"lat":6.5,"lng":3.4,"address":"A"},"dropoff":{"lat":6.6,"lng":3.3,"address":"B"},
 "receiver_name":"Ada","receiver_phone":"+2348000000000","size":"small","speed":"standard","prohibited_ack":true,"declared_value_kobo":500000}`

func TestParcelDomain_Identity(t *testing.T) {
	d := NewParcelDomain(&fakeParcels{})
	if d.Name() != "parcel" || d.ReferencePrefix() != "parcelorder:" || d.RoutePrefix() != "/parcels/paystack" || d.EntityIDKey() != "parcelId" {
		t.Fatalf("identity drifted: %s %s %s %s", d.Name(), d.ReferencePrefix(), d.RoutePrefix(), d.EntityIDKey())
	}
	// The refund registry key transport files parcel refunds under must be the
	// same string the adapter reports (transport/parcel.go uses "parcel").
	if ParcelDomainName != "parcel" {
		t.Fatal("transport.CancelParcel files refunds under \"parcel\"")
	}
	// Prefix must not collide with the ride/food/dues/fees prefixes the shared
	// webhook already routes.
	for _, other := range []string{"rideorder:", "foodorder:", "duespay:", "feespay:"} {
		if strings.HasPrefix(d.ReferencePrefix(), other) || strings.HasPrefix(other, d.ReferencePrefix()) {
			t.Errorf("prefix collides with %s", other)
		}
	}
}

func TestParcelDomain_Quote_UsesServerQuoteOnly_AndDecodesRequest(t *testing.T) {
	f := &fakeParcels{quote: 345_000}
	d := NewParcelDomain(f)
	f.quotePrice = json.RawMessage(`{"distanceM":9000}`)
	got, err := d.Quote(context.Background(), "u1", json.RawMessage(goodParcel))
	if err != nil || got.AmountKobo != 345_000 || string(got.Pricing) != `{"distanceM":9000}` {
		t.Fatalf("quote=%d err=%v", got, err)
	}
	r := f.quoteReqs[0]
	if !r.ProhibitedAck || r.ReceiverName != "Ada" || r.Size != "small" || r.DeclaredValueKobo != 500_000 || r.Pickup.Address != "A" {
		t.Errorf("request not decoded faithfully: %+v", r)
	}
}

func TestParcelDomain_Quote_RejectsBadRequestsBeforePricing(t *testing.T) {
	f := &fakeParcels{quote: 1}
	d := NewParcelDomain(f)
	for name, body := range map[string]string{
		"not json":    `[`,
		"no receiver": `{"pickup":{"lat":1,"lng":1,"address":"A"},"dropoff":{"lat":1,"lng":1,"address":"B"},"prohibited_ack":true}`,
	} {
		_, err := d.Quote(context.Background(), "u1", json.RawMessage(body))
		ce, ok := errors.AsType[*transport.CodedError](err)
		if !ok || ce.Status != http.StatusBadRequest {
			t.Errorf("%s: want 400 CodedError, got %v", name, err)
		}
	}
	if len(f.quoteReqs) != 0 {
		t.Errorf("pricing must not run on a malformed request")
	}
}

func TestParcelDomain_Book_PassesNamespacedKeyAndVerifiedAmountThrough(t *testing.T) {
	f := &fakeParcels{bookID: "p-1"}
	d := NewParcelDomain(f)
	id, err := d.Book(context.Background(), "u1", json.RawMessage(goodParcel), json.RawMessage(`{"distanceM":9000}`), "parcelorder:k", 345_000)
	if err != nil || id != "p-1" {
		t.Fatal(id, err)
	}
	if string(f.bookPrice[0]) != `{"distanceM":9000}` {
		t.Errorf("frozen pricing not handed to the booker: %s", f.bookPrice[0])
	}
	if f.bookIdem[0] != "parcelorder:k" || f.bookAmt[0] != 345_000 {
		t.Errorf("idem=%v amt=%v", f.bookIdem, f.bookAmt)
	}
	if _, err := d.Book(context.Background(), "u1", json.RawMessage(`{`), nil, "k", 1); err == nil {
		t.Error("undecodable frozen request must fail Book, not book a zero parcel")
	}
	if _, found, _ := d.Find(context.Background(), "u1", "k"); found {
		t.Error("find passthrough")
	}
	if f.wantSender != "u1" {
		t.Errorf("Find must scope by payer, got %q", f.wantSender)
	}
}

// The card-direct routes sit beside the wallet routes /parcels/:id and
// /parcels/:id/cancel on the same group. Gin must neither panic at
// registration nor mis-route either family.
func TestParcelRoutes_CoexistWithWalletParcelRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	f := &fakeParcels{quote: 345_000, bookID: "p-1"}
	r := newRig()
	r.gw.verify.AmountKobo = 345_000
	r.e = NewEngine(r.gw, r.st, r.lg)
	r.e.Register(NewParcelDomain(f))

	g := gin.New()
	g.Use(func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-Test-User")) })
	mob := g.Group("/mobility")
	hit := ""
	mob.POST("/parcels", func(c *gin.Context) { hit = "book" })
	mob.GET("/parcels/:id", func(c *gin.Context) { hit = "get:" + c.Param("id") })
	mob.POST("/parcels/:id/cancel", func(c *gin.Context) { hit = "cancel:" + c.Param("id") })
	r.e.RegisterRoutes(mob)

	req := func(method, path, body string) *httptest.ResponseRecorder {
		rq := httptest.NewRequest(method, path, strings.NewReader(body))
		rq.Header.Set("X-Test-User", "u1")
		rq.Header.Set("Idempotency-Key", "parcel-1700000000-abcd1234")
		w := httptest.NewRecorder()
		hit = ""
		g.ServeHTTP(w, rq)
		return w
	}
	if w := req("GET", "/mobility/parcels/abc", ""); hit != "get:abc" {
		t.Errorf("wallet get mis-routed: %q %d", hit, w.Code)
	}
	if w := req("POST", "/mobility/parcels/abc/cancel", ""); hit != "cancel:abc" {
		t.Errorf("wallet cancel mis-routed: %q %d", hit, w.Code)
	}
	w := req("POST", "/mobility/parcels/paystack/initiate", goodParcel)
	if w.Code != http.StatusCreated || hit != "" || !strings.Contains(w.Body.String(), `"reference":"parcelorder:parcel-1700000000-abcd1234"`) {
		t.Errorf("initiate: %d hit=%q %s", w.Code, hit, w.Body.String())
	}
	if len(f.quoteReqs) != 1 {
		t.Fatalf("quotes=%d", len(f.quoteReqs))
	}
	w = req("GET", "/mobility/parcels/paystack/parcelorder:parcel-1700000000-abcd1234/status", "")
	if w.Code != http.StatusOK || hit != "" || !strings.Contains(w.Body.String(), `"parcelId":"p-1"`) {
		t.Errorf("status: %d hit=%q %s", w.Code, hit, w.Body.String())
	}
}

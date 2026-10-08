package paystackcheckout

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/transport"
)

type fakeCarHire struct {
	quote      int64
	quotePrice json.RawMessage
	bookPrice  []json.RawMessage
	quoteReqs  []transport.CarHireBookRequest
	bookReqs   []transport.CarHireBookRequest
	bookIdem   []string
	bookAmt    []int64
	bookID     string
	findID     string
	findFound  bool
	quoteErr   error
	wantUser   string
	sweepCalls []string
}

func (f *fakeCarHire) QuoteCarHireBookingFrozen(_ context.Context, r transport.CarHireBookRequest) (int64, json.RawMessage, error) {
	f.quoteReqs = append(f.quoteReqs, r)
	return f.quote, f.quotePrice, f.quoteErr
}
func (f *fakeCarHire) FindCarHireByIdempotencyKey(_ context.Context, user, _ string) (string, bool, error) {
	f.wantUser = user
	return f.findID, f.findFound, nil
}
func (f *fakeCarHire) BookCarHirePaystackFundedFrozen(_ context.Context, _ string, r transport.CarHireBookRequest, idem string, amt int64, pricing json.RawMessage) (string, error) {
	f.bookPrice = append(f.bookPrice, pricing)
	f.bookReqs, f.bookIdem, f.bookAmt = append(f.bookReqs, r), append(f.bookIdem, idem), append(f.bookAmt, amt)
	return f.bookID, nil
}
func (f *fakeCarHire) SweepCancelledCardRefunds(_ context.Context, domain string, _ time.Duration, _ int) (transport.CancelSweepResult, error) {
	f.sweepCalls = append(f.sweepCalls, domain)
	return transport.CancelSweepResult{Completed: 2, Failed: 1}, nil
}

// startIn72h is a valid start for the strict (quote-time) pre-flight.
var startIn72h = time.Now().Add(72 * time.Hour).UTC().Format(time.RFC3339)

var goodCarHire = `{"hire_type":"daily","vehicle_class":"executive","start_at":"` + startIn72h + `","duration_hours":8,"chauffeur":true,"pickup_address":"Ikeja, Lagos"}`

func TestCarHireDomain_Identity(t *testing.T) {
	d := NewCarHireDomain(&fakeCarHire{})
	if d.Name() != "carhire" || d.ReferencePrefix() != "carhireorder:" || d.RoutePrefix() != "/car-hire/paystack" || d.EntityIDKey() != "bookingId" {
		t.Fatalf("identity drifted: %s %s %s %s", d.Name(), d.ReferencePrefix(), d.RoutePrefix(), d.EntityIDKey())
	}
	if CarHireDomainName != transport.RefundDomainCarHire {
		t.Fatalf("the engine registers the refunder under %q but transport files refunds under %q", CarHireDomainName, transport.RefundDomainCarHire)
	}
	for _, other := range []string{"rideorder:", "foodorder:", "duespay:", "feespay:", "parcelorder:", "towingorder:", "moversorder:"} {
		if strings.HasPrefix(d.ReferencePrefix(), other) || strings.HasPrefix(other, d.ReferencePrefix()) {
			t.Errorf("prefix collides with %s", other)
		}
	}
	if !transport.IsReservedIdempotencyKey(d.ReferencePrefix() + "x") {
		t.Error("carhireorder: must be a reserved wallet-path prefix")
	}
}

func TestCarHireDomain_Quote_UsesServerQuoteOnly_AndDecodesRequest(t *testing.T) {
	f := &fakeCarHire{quote: 1_064_000, quotePrice: json.RawMessage(`{"durationHours":8}`)}
	d := NewCarHireDomain(f)
	// A client-supplied amount is ignored: the adapter has nowhere to put it.
	body := `{"hire_type":"daily","vehicle_class":"executive","start_at":"` + startIn72h + `","duration_hours":8,"amount":1,"amount_kobo":1,"fare_kobo":1,"deposit_kobo":0}`
	got, err := d.Quote(context.Background(), "u1", json.RawMessage(body))
	if err != nil || got.AmountKobo != 1_064_000 || string(got.Pricing) != `{"durationHours":8}` {
		t.Fatalf("quote=%+v err=%v", got, err)
	}
	r := f.quoteReqs[0]
	if r.HireType != "daily" || r.VehicleClass != "executive" || r.DurationHours != 8 || r.StartAt != startIn72h {
		t.Errorf("request not decoded faithfully: %+v", r)
	}
}

func TestCarHireDomain_Quote_RejectsBadRequestsBeforePricing(t *testing.T) {
	f := &fakeCarHire{quote: 1}
	d := NewCarHireDomain(f)
	for name, body := range map[string]string{
		"not json":      `[`,
		"bad hire_type": `{"hire_type":"weekly","start_at":"` + startIn72h + `","duration_hours":8}`,
		"no start":      `{"hire_type":"daily","duration_hours":8}`,
		"zero hours":    `{"hire_type":"daily","start_at":"` + startIn72h + `","duration_hours":0}`,
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

func TestCarHireDomain_Book_PassesNamespacedKeyAndVerifiedAmountThrough(t *testing.T) {
	f := &fakeCarHire{bookID: "b-1"}
	d := NewCarHireDomain(f)
	id, err := d.Book(context.Background(), "u1", json.RawMessage(goodCarHire), json.RawMessage(`{"durationHours":8}`), "carhireorder:k", 1_064_000)
	if err != nil || id != "b-1" {
		t.Fatal(id, err)
	}
	if string(f.bookPrice[0]) != `{"durationHours":8}` || f.bookIdem[0] != "carhireorder:k" || f.bookAmt[0] != 1_064_000 {
		t.Errorf("pricing=%s idem=%v amt=%v", f.bookPrice[0], f.bookIdem, f.bookAmt)
	}
	if _, err := d.Book(context.Background(), "u1", json.RawMessage(`{`), nil, "k", 1); err == nil {
		t.Error("an undecodable frozen request must fail Book, not book an empty hire")
	}
	if _, found, _ := d.Find(context.Background(), "u1", "k"); found {
		t.Error("find passthrough")
	}
	if f.wantUser != "u1" {
		t.Errorf("Find must scope by payer, got %q", f.wantUser)
	}
}

func TestCarHireDomain_SweepDelegatesToTheCarHireDomainOnly(t *testing.T) {
	f := &fakeCarHire{}
	var sw CancelledRefundSweeper = NewCarHireDomain(f)
	res, err := sw.SweepCancelledRefunds(context.Background(), time.Minute, 50)
	if err != nil || res.Completed != 2 || res.Failed != 1 {
		t.Fatalf("%+v %v", res, err)
	}
	if len(f.sweepCalls) != 1 || f.sweepCalls[0] != transport.RefundDomainCarHire {
		t.Errorf("sweep domain %v", f.sweepCalls)
	}
}

// The card-direct routes sit beside every wallet car-hire route on the same
// group: gin must neither panic at registration nor mis-route either family.
func TestCarHireRoutes_CoexistWithWalletCarHireRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	f := &fakeCarHire{quote: 1_064_000, bookID: "b-1"}
	r := newRig()
	r.gw.verify.AmountKobo = 1_064_000
	r.e = NewEngine(r.gw, r.st, r.lg)
	r.e.Register(NewCarHireDomain(f))

	g := gin.New()
	g.Use(func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-Test-User")) })
	mob := g.Group("/mobility")
	hit := ""
	mob.POST("/car-hire/quote", func(c *gin.Context) { hit = "quote" })
	mob.POST("/car-hire/book", func(c *gin.Context) { hit = "book" })
	mob.GET("/car-hire", func(c *gin.Context) { hit = "list" })
	mob.GET("/car-hire/:id", func(c *gin.Context) { hit = "get:" + c.Param("id") })
	mob.POST("/car-hire/:id/activate", func(c *gin.Context) { hit = "activate:" + c.Param("id") })
	mob.POST("/car-hire/:id/extend", func(c *gin.Context) { hit = "extend:" + c.Param("id") })
	mob.POST("/car-hire/:id/complete", func(c *gin.Context) { hit = "complete:" + c.Param("id") })
	mob.POST("/car-hire/:id/cancel", func(c *gin.Context) { hit = "cancel:" + c.Param("id") })
	r.e.RegisterRoutes(mob)

	req := func(method, path, body string) *httptest.ResponseRecorder {
		rq := httptest.NewRequest(method, path, strings.NewReader(body))
		rq.Header.Set("X-Test-User", "u1")
		rq.Header.Set("Idempotency-Key", "carhire-1700000000-abcd1234")
		w := httptest.NewRecorder()
		hit = ""
		g.ServeHTTP(w, rq)
		return w
	}
	for _, c := range []struct{ method, path, want string }{
		{"POST", "/mobility/car-hire/quote", "quote"},
		{"POST", "/mobility/car-hire/book", "book"},
		{"GET", "/mobility/car-hire", "list"},
		{"GET", "/mobility/car-hire/abc", "get:abc"},
		{"POST", "/mobility/car-hire/abc/activate", "activate:abc"},
		{"POST", "/mobility/car-hire/abc/extend", "extend:abc"},
		{"POST", "/mobility/car-hire/abc/complete", "complete:abc"},
		{"POST", "/mobility/car-hire/abc/cancel", "cancel:abc"},
	} {
		if w := req(c.method, c.path, ""); hit != c.want {
			t.Errorf("wallet %s %s mis-routed: %q (%d)", c.method, c.path, hit, w.Code)
		}
	}
	w := req("POST", "/mobility/car-hire/paystack/initiate", goodCarHire)
	if w.Code != http.StatusCreated || hit != "" || !strings.Contains(w.Body.String(), `"reference":"carhireorder:carhire-1700000000-abcd1234"`) {
		t.Errorf("initiate: %d hit=%q %s", w.Code, hit, w.Body.String())
	}
	if len(f.quoteReqs) != 1 {
		t.Fatalf("quotes=%d", len(f.quoteReqs))
	}
	w = req("GET", "/mobility/car-hire/paystack/carhireorder:carhire-1700000000-abcd1234/status", "")
	if w.Code != http.StatusOK || hit != "" || !strings.Contains(w.Body.String(), `"bookingId":"b-1"`) {
		t.Errorf("status: %d hit=%q %s", w.Code, hit, w.Body.String())
	}
}

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

type fakeTowing struct {
	quote      int64
	quotePrice json.RawMessage
	bookPrice  []json.RawMessage
	quoteReqs  []transport.TowingBookRequest
	bookReqs   []transport.TowingBookRequest
	bookIdem   []string
	bookAmt    []int64
	bookID     string
	findID     string
	findFound  bool
	quoteErr   error
	wantUser   string
}

func (f *fakeTowing) QuoteTowingBookingFrozen(_ context.Context, r transport.TowingBookRequest) (int64, json.RawMessage, error) {
	f.quoteReqs = append(f.quoteReqs, r)
	return f.quote, f.quotePrice, f.quoteErr
}
func (f *fakeTowing) FindTowingByIdempotencyKey(_ context.Context, user, _ string) (string, bool, error) {
	f.wantUser = user
	return f.findID, f.findFound, nil
}
func (f *fakeTowing) BookTowingPaystackFundedFrozen(_ context.Context, _ string, r transport.TowingBookRequest, idem string, amt int64, pricing json.RawMessage) (string, error) {
	f.bookPrice = append(f.bookPrice, pricing)
	f.bookReqs, f.bookIdem, f.bookAmt = append(f.bookReqs, r), append(f.bookIdem, idem), append(f.bookAmt, amt)
	return f.bookID, nil
}

const goodTowing = `{"service_type":"flatbed","vehicle_type":"sedan","issue_type":"breakdown",
 "pickup":{"lat":6.5,"lng":3.4,"address":"3rd Mainland Bridge"},"dest":{"lat":6.6,"lng":3.35,"address":"AutoWorks, Ikeja"}}`

func TestTowingDomain_Identity(t *testing.T) {
	d := NewTowingDomain(&fakeTowing{})
	if d.Name() != "towing" || d.ReferencePrefix() != "towingorder:" || d.RoutePrefix() != "/towing/paystack" || d.EntityIDKey() != "towingJobId" {
		t.Fatalf("identity drifted: %s %s %s %s", d.Name(), d.ReferencePrefix(), d.RoutePrefix(), d.EntityIDKey())
	}
	// transport.CancelTowing files refunds under the same string.
	if TowingDomainName != "towing" {
		t.Fatal("transport.CancelTowing files refunds under \"towing\"")
	}
	for _, other := range []string{"rideorder:", "foodorder:", "duespay:", "feespay:", "parcelorder:"} {
		if strings.HasPrefix(d.ReferencePrefix(), other) || strings.HasPrefix(other, d.ReferencePrefix()) {
			t.Errorf("prefix collides with %s", other)
		}
	}
	// the prefix must be one the wallet handler refuses
	if !transport.IsReservedIdempotencyKey(d.ReferencePrefix() + "x") {
		t.Error("towingorder: must be a reserved wallet-path prefix")
	}
}

func TestTowingDomain_Quote_UsesServerQuoteOnly_AndDecodesRequest(t *testing.T) {
	f := &fakeTowing{quote: 845_000, quotePrice: json.RawMessage(`{"distanceM":9000}`)}
	d := NewTowingDomain(f)
	got, err := d.Quote(context.Background(), "u1", json.RawMessage(goodTowing))
	if err != nil || got.AmountKobo != 845_000 || string(got.Pricing) != `{"distanceM":9000}` {
		t.Fatalf("quote=%+v err=%v", got, err)
	}
	r := f.quoteReqs[0]
	if r.ServiceType != "flatbed" || r.IssueType != "breakdown" || r.VehicleType != "sedan" ||
		r.Pickup.Address != "3rd Mainland Bridge" || r.Dest == nil || r.Dest.Address != "AutoWorks, Ikeja" {
		t.Errorf("request not decoded faithfully: %+v", r)
	}
}

func TestTowingDomain_Quote_RejectsBadRequestsBeforePricing(t *testing.T) {
	f := &fakeTowing{quote: 1}
	d := NewTowingDomain(f)
	for name, body := range map[string]string{
		"not json":      `[`,
		"no pickup":     `{"service_type":"tow"}`,
		"empty address": `{"pickup":{"lat":1,"lng":1,"address":""}}`,
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

func TestTowingDomain_Book_PassesNamespacedKeyAndVerifiedAmountThrough(t *testing.T) {
	f := &fakeTowing{bookID: "j-1"}
	d := NewTowingDomain(f)
	id, err := d.Book(context.Background(), "u1", json.RawMessage(goodTowing), json.RawMessage(`{"distanceM":9000}`), "towingorder:k", 845_000)
	if err != nil || id != "j-1" {
		t.Fatal(id, err)
	}
	if string(f.bookPrice[0]) != `{"distanceM":9000}` {
		t.Errorf("frozen pricing not handed to the booker: %s", f.bookPrice[0])
	}
	if f.bookIdem[0] != "towingorder:k" || f.bookAmt[0] != 845_000 {
		t.Errorf("idem=%v amt=%v", f.bookIdem, f.bookAmt)
	}
	if _, err := d.Book(context.Background(), "u1", json.RawMessage(`{`), nil, "k", 1); err == nil {
		t.Error("undecodable frozen request must fail Book, not book an empty job")
	}
	if _, found, _ := d.Find(context.Background(), "u1", "k"); found {
		t.Error("find passthrough")
	}
	if f.wantUser != "u1" {
		t.Errorf("Find must scope by payer, got %q", f.wantUser)
	}
}

// The card-direct routes sit beside every wallet towing route on the same
// group: gin must neither panic at registration nor mis-route either family.
func TestTowingRoutes_CoexistWithWalletTowingRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	f := &fakeTowing{quote: 845_000, bookID: "j-1"}
	r := newRig()
	r.gw.verify.AmountKobo = 845_000
	r.e = NewEngine(r.gw, r.st, r.lg)
	r.e.Register(NewTowingDomain(f))

	g := gin.New()
	g.Use(func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-Test-User")) })
	mob := g.Group("/mobility")
	hit := ""
	mob.POST("/towing/estimate", func(c *gin.Context) { hit = "estimate" })
	mob.POST("/towing", func(c *gin.Context) { hit = "book" })
	mob.GET("/towing", func(c *gin.Context) { hit = "list" })
	mob.GET("/towing/:id", func(c *gin.Context) { hit = "get:" + c.Param("id") })
	mob.POST("/towing/:id/cancel", func(c *gin.Context) { hit = "cancel:" + c.Param("id") })
	mob.POST("/towing/:id/rate", func(c *gin.Context) { hit = "rate:" + c.Param("id") })
	r.e.RegisterRoutes(mob)

	req := func(method, path, body string) *httptest.ResponseRecorder {
		rq := httptest.NewRequest(method, path, strings.NewReader(body))
		rq.Header.Set("X-Test-User", "u1")
		rq.Header.Set("Idempotency-Key", "towing-1700000000-abcd1234")
		w := httptest.NewRecorder()
		hit = ""
		g.ServeHTTP(w, rq)
		return w
	}
	for _, c := range []struct{ method, path, want string }{
		{"POST", "/mobility/towing/estimate", "estimate"},
		{"POST", "/mobility/towing", "book"},
		{"GET", "/mobility/towing", "list"},
		{"GET", "/mobility/towing/abc", "get:abc"},
		{"POST", "/mobility/towing/abc/cancel", "cancel:abc"},
		{"POST", "/mobility/towing/abc/rate", "rate:abc"},
	} {
		if w := req(c.method, c.path, ""); hit != c.want {
			t.Errorf("wallet %s %s mis-routed: %q (%d)", c.method, c.path, hit, w.Code)
		}
	}
	w := req("POST", "/mobility/towing/paystack/initiate", goodTowing)
	if w.Code != http.StatusCreated || hit != "" || !strings.Contains(w.Body.String(), `"reference":"towingorder:towing-1700000000-abcd1234"`) {
		t.Errorf("initiate: %d hit=%q %s", w.Code, hit, w.Body.String())
	}
	if len(f.quoteReqs) != 1 {
		t.Fatalf("quotes=%d", len(f.quoteReqs))
	}
	w = req("GET", "/mobility/towing/paystack/towingorder:towing-1700000000-abcd1234/status", "")
	if w.Code != http.StatusOK || hit != "" || !strings.Contains(w.Body.String(), `"towingJobId":"j-1"`) {
		t.Errorf("status: %d hit=%q %s", w.Code, hit, w.Body.String())
	}
}

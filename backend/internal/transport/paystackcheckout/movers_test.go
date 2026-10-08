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

type fakeMovers struct {
	quote      int64
	quotePrice json.RawMessage
	quoteReqs  []transport.MoverAcceptRequest
	bookReqs   []transport.MoverAcceptRequest
	bookPrice  []json.RawMessage
	bookIdem   []string
	bookAmt    []int64
	bookID     string
	findID     string
	findFound  bool
	findErr    error
	wantPayer  string
	quoteErr   error
}

func (f *fakeMovers) QuoteMoverAcceptance(_ context.Context, _ string, r transport.MoverAcceptRequest) (int64, json.RawMessage, error) {
	f.quoteReqs = append(f.quoteReqs, r)
	return f.quote, f.quotePrice, f.quoteErr
}
func (f *fakeMovers) FindMoverAcceptanceByIdempotencyKey(_ context.Context, payer, _ string) (string, bool, error) {
	f.wantPayer = payer
	return f.findID, f.findFound, f.findErr
}
func (f *fakeMovers) AcceptMoverBidPaystackFunded(_ context.Context, _ string, r transport.MoverAcceptRequest, idem string, amt int64, pricing json.RawMessage) (string, error) {
	f.bookReqs, f.bookIdem, f.bookAmt, f.bookPrice = append(f.bookReqs, r), append(f.bookIdem, idem), append(f.bookAmt, amt), append(f.bookPrice, pricing)
	return f.bookID, nil
}

const goodMove = `{"job_id":"job-1","bid_id":"bid-1"}`

func TestMoversDomain_Identity(t *testing.T) {
	d := NewMoversDomain(&fakeMovers{})
	if d.Name() != "movers" || d.ReferencePrefix() != "moversorder:" || d.RoutePrefix() != "/movers/paystack" || d.EntityIDKey() != "moveId" {
		t.Fatalf("identity drifted: %s %s %s %s", d.Name(), d.ReferencePrefix(), d.RoutePrefix(), d.EntityIDKey())
	}
	// transport.CancelMover files refunds under this exact string.
	if MoversDomainName != "movers" {
		t.Fatal("transport.CancelMover files refunds under \"movers\"")
	}
	for _, other := range []string{"rideorder:", "foodorder:", "duespay:", "feespay:", "parcelorder:", "towingorder:", "carhireorder:", "busorder:", "eventorder:"} {
		if strings.HasPrefix(d.ReferencePrefix(), other) || strings.HasPrefix(other, d.ReferencePrefix()) {
			t.Errorf("prefix collides with %s", other)
		}
	}
	// the wallet handler must refuse this namespace
	if !transport.IsReservedIdempotencyKey(d.ReferencePrefix() + "abc") {
		t.Error("moversorder: must be a reserved wallet-path prefix")
	}
}

func TestMoversDomain_Quote_UsesServerQuoteOnly_IgnoresClientAmount(t *testing.T) {
	f := &fakeMovers{quote: 4_500_000, quotePrice: json.RawMessage(`{"bidId":"bid-1"}`)}
	d := NewMoversDomain(f)
	// a client-sent amount must not influence anything the adapter does
	body := `{"job_id":"job-1","bid_id":"bid-1","amount_kobo":1,"amount":1}`
	got, err := d.Quote(context.Background(), "u1", json.RawMessage(body))
	if err != nil || got.AmountKobo != 4_500_000 || string(got.Pricing) != `{"bidId":"bid-1"}` {
		t.Fatalf("quote=%+v err=%v", got, err)
	}
	if r := f.quoteReqs[0]; r.JobID != "job-1" || r.BidID != "bid-1" {
		t.Errorf("request not decoded faithfully: %+v", r)
	}
}

func TestMoversDomain_Quote_RejectsBadRequestsBeforePricing(t *testing.T) {
	f := &fakeMovers{quote: 1}
	d := NewMoversDomain(f)
	for name, body := range map[string]string{
		"not json": `[`, "no job": `{"bid_id":"b"}`, "no bid": `{"job_id":"j"}`, "empty": `{}`,
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

func TestMoversDomain_Book_PassesNamespacedKeyFrozenPricingAndVerifiedAmountThrough(t *testing.T) {
	f := &fakeMovers{bookID: "job-1"}
	d := NewMoversDomain(f)
	id, err := d.Book(context.Background(), "u1", json.RawMessage(goodMove), json.RawMessage(`{"bidId":"bid-1"}`), "moversorder:k", 4_500_000)
	if err != nil || id != "job-1" {
		t.Fatal(id, err)
	}
	if string(f.bookPrice[0]) != `{"bidId":"bid-1"}` || f.bookIdem[0] != "moversorder:k" || f.bookAmt[0] != 4_500_000 {
		t.Errorf("pricing=%s idem=%v amt=%v", f.bookPrice[0], f.bookIdem, f.bookAmt)
	}
	if _, err := d.Book(context.Background(), "u1", json.RawMessage(`{`), nil, "k", 1); err == nil {
		t.Error("undecodable frozen request must fail Book")
	}
	if len(f.bookReqs) != 1 {
		t.Error("Book must not run for an undecodable request")
	}
	f.findID, f.findFound = "job-1", true
	if id, found, _ := d.Find(context.Background(), "u1", "k"); !found || id != "job-1" || f.wantPayer != "u1" {
		t.Errorf("Find must scope by payer and pass through: %s %v payer=%q", id, found, f.wantPayer)
	}
	f.findErr = errors.New("db down")
	if _, _, err := d.Find(context.Background(), "u1", "k"); err == nil {
		t.Error("a Find error must propagate (the engine must not refund on a guess)")
	}
}

// The card-direct routes sit beside the wallet routes /movers/:id,
// /movers/:id/accept-bid, … on the same group.
func TestMoversRoutes_CoexistWithWalletMoverRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	f := &fakeMovers{quote: 4_500_000, bookID: "job-1", quotePrice: json.RawMessage(`{}`)}
	r := newRig()
	r.gw.verify.AmountKobo = 4_500_000
	r.e = NewEngine(r.gw, r.st, r.lg)
	r.e.Register(NewMoversDomain(f))

	g := gin.New()
	g.Use(func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-Test-User")) })
	mob := g.Group("/mobility")
	hit := ""
	mob.POST("/movers/quote", func(c *gin.Context) { hit = "quote" })
	mob.GET("/movers/:id", func(c *gin.Context) { hit = "get:" + c.Param("id") })
	mob.POST("/movers/:id/accept-bid", func(c *gin.Context) { hit = "accept:" + c.Param("id") })
	mob.POST("/movers/:id/cancel", func(c *gin.Context) { hit = "cancel:" + c.Param("id") })
	r.e.RegisterRoutes(mob)

	req := func(method, path, body string) *httptest.ResponseRecorder {
		rq := httptest.NewRequest(method, path, strings.NewReader(body))
		rq.Header.Set("X-Test-User", "u1")
		rq.Header.Set("Idempotency-Key", "mover-1700000000-abcd1234")
		w := httptest.NewRecorder()
		hit = ""
		g.ServeHTTP(w, rq)
		return w
	}
	if req("GET", "/mobility/movers/abc", ""); hit != "get:abc" {
		t.Errorf("wallet get mis-routed: %q", hit)
	}
	if req("POST", "/mobility/movers/abc/accept-bid", ""); hit != "accept:abc" {
		t.Errorf("wallet accept-bid mis-routed: %q", hit)
	}
	if req("POST", "/mobility/movers/abc/cancel", ""); hit != "cancel:abc" {
		t.Errorf("wallet cancel mis-routed: %q", hit)
	}
	if req("POST", "/mobility/movers/quote", ""); hit != "quote" {
		t.Errorf("wallet quote mis-routed: %q", hit)
	}
	w := req("POST", "/mobility/movers/paystack/initiate", goodMove)
	if w.Code != http.StatusCreated || hit != "" || !strings.Contains(w.Body.String(), `"reference":"moversorder:mover-1700000000-abcd1234"`) {
		t.Errorf("initiate: %d hit=%q %s", w.Code, hit, w.Body.String())
	}
	if len(f.quoteReqs) != 1 {
		t.Fatalf("quotes=%d", len(f.quoteReqs))
	}
	w = req("GET", "/mobility/movers/paystack/moversorder:mover-1700000000-abcd1234/status", "")
	if w.Code != http.StatusOK || hit != "" || !strings.Contains(w.Body.String(), `"moveId":"job-1"`) {
		t.Errorf("status: %d hit=%q %s", w.Code, hit, w.Body.String())
	}
}

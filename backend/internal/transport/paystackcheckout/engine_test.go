package paystackcheckout

// PURE tests for the shared card-direct Engine — in-memory fakes only (no
// gateway, DB or transport.Service). They pin the money-safety invariants the
// engine exists for, independently of any one domain:
//   - the amount charged is the SERVER quote, frozen; no client field moves it
//   - one Idempotency-Key ⇒ one intent, one charge; a different request on the
//     same key is a 409, never silently re-served
//   - a charge is booked at most once however webhook/poll/retry interleave
//   - a charge that cannot back a booking is ALWAYS refunded at the gateway —
//     and NEVER refunded when a booking exists (commit-then-error)
//   - a failed gateway refund leaves an honest, non-'refunded' status
//   - cancel-refund is gateway-first, ledger-second, and retryable without a
//     second gateway refund

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/provider"
)

type rig struct {
	e  *Engine
	gw *fakeGW
	st *fakeStore
	lg *fakeLedger
	d  *fakeDomain
	ev *events
}

func newRig() *rig {
	ev := &events{}
	gw := &fakeGW{ev: ev, verify: &provider.PaymentStatus{Status: "success", AmountKobo: 250_000, Currency: "NGN"}}
	st := newFakeStore()
	st.ev = ev
	lg := &fakeLedger{ev: ev}
	d := &fakeDomain{quote: 250_000, bookedID: "ent-1", ev: ev}
	e := NewEngine(gw, st, lg)
	e.Register(d)
	return &rig{e, gw, st, lg, d, ev}
}

const key1 = "key-0000001"

func (r *rig) initiate(t *testing.T, payer, key, body string) (*Checkout, error) {
	t.Helper()
	return r.e.Initiate(context.Background(), "fake", payer, json.RawMessage(body), key, "a@b.test", "https://cb")
}

// ── Initiate ────────────────────────────────────────────────────────────────

func TestInitiate_FreezesServerQuote_IgnoresClientAmount_StripsGatewayFields(t *testing.T) {
	r := newRig()
	out, err := r.initiate(t, "u1", key1, `{"a":1,"amount":1,"amount_kobo":1,"email":"x@y.z","callback_url":"https://evil","idempotency_key":"zzz"}`)
	if err != nil {
		t.Fatal(err)
	}
	if out.AmountKobo != 250_000 || r.gw.initCalls[0].AmountKobo != 250_000 {
		t.Fatalf("charged %d / %d, want the server quote 250000", out.AmountKobo, r.gw.initCalls[0].AmountKobo)
	}
	if out.Reference != "fakeorder:"+key1 || out.Status != StatusPending || out.AuthorizationURL == "" {
		t.Fatalf("bad checkout %+v", out)
	}
	rec, _ := r.st.Get(context.Background(), out.Reference)
	if string(rec.RequestJSON) != `{"a":1}` {
		t.Errorf("frozen request = %s, want only the domain fields", rec.RequestJSON)
	}
	if r.gw.initCalls[0].Email != "a@b.test" {
		t.Errorf("gateway email not forwarded")
	}
}

func TestInitiate_Validation(t *testing.T) {
	r := newRig()
	if _, err := r.e.Initiate(context.Background(), "fake", "", json.RawMessage(`{}`), key1, "", ""); !errors.Is(err, ErrUnauthenticated) {
		t.Errorf("no payer: %v", err)
	}
	if _, err := r.initiate(t, "u1", "", `{}`); !errors.Is(err, ErrIdempotencyRequired) {
		t.Errorf("no key: %v", err)
	}
	for _, bad := range []string{"short", "has space 123456", "../../etc/passwd1", "a/b/c/d/e/f/g/h", strings.Repeat("a", 101), "key:0000001", "key?x=1&&&&"} {
		if _, err := r.initiate(t, "u1", bad, `{}`); !errors.Is(err, ErrInvalidIdempotencyKey) {
			t.Errorf("key %q should be rejected as invalid, got %v", bad, err)
		}
	}
	if _, err := r.initiate(t, "u1", key1, `[1,2]`); err == nil {
		t.Errorf("non-object body must be rejected")
	}
	if _, err := r.e.Initiate(context.Background(), "nope", "u1", json.RawMessage(`{}`), key1, "", ""); !errors.Is(err, ErrUnknownDomain) {
		t.Errorf("unknown domain: %v", err)
	}
	if len(r.gw.initCalls) != 0 {
		t.Errorf("gateway must not be touched for invalid input")
	}
}

func TestInitiate_QuoteError_NothingPersistedNothingCharged(t *testing.T) {
	r := newRig()
	r.d.quoteErr = errors.New("maps down")
	if _, err := r.initiate(t, "u1", key1, `{}`); err == nil {
		t.Fatal("want error")
	}
	if len(r.st.byRef) != 0 || len(r.gw.initCalls) != 0 {
		t.Errorf("quote failure must persist nothing and charge nothing")
	}
	r.d.quoteErr, r.d.quote = nil, 0
	if _, err := r.initiate(t, "u1", key1, `{}`); err == nil {
		t.Fatal("a zero quote must be refused, never sent to the gateway")
	}
}

func TestInitiate_Replay_SameRequest_OneIntentOneGatewayInit_NoRequote(t *testing.T) {
	r := newRig()
	a, err := r.initiate(t, "u1", key1, `{"a":1,"b":2}`)
	if err != nil {
		t.Fatal(err)
	}
	r.d.quote = 999_999 // pricing moved between attempts — replay must not follow it
	b, err := r.initiate(t, "u1", key1, `{ "b":2, "a":1, "email":"other@x.y" }`)
	if err != nil {
		t.Fatal(err)
	}
	if a.Reference != b.Reference || b.AmountKobo != 250_000 {
		t.Fatalf("replay changed the intent: %+v vs %+v", a, b)
	}
	if len(r.gw.initCalls) != 1 {
		t.Errorf("gateway initialized %d times, want 1 (a duplicate reference would error at Paystack)", len(r.gw.initCalls))
	}
	if b.AuthorizationURL != a.AuthorizationURL {
		t.Errorf("replay must re-serve the stored authorization url")
	}
	if len(r.d.quotes) != 1 {
		t.Errorf("replay must not re-quote (got %d quotes)", len(r.d.quotes))
	}
}

func TestInitiate_Replay_DifferentRequestOrPayer_IsConflict(t *testing.T) {
	r := newRig()
	if _, err := r.initiate(t, "u1", key1, `{"a":1}`); err != nil {
		t.Fatal(err)
	}
	if _, err := r.initiate(t, "u1", key1, `{"a":2}`); !errors.Is(err, ErrIdempotencyConflict) {
		t.Errorf("different body on same key: want conflict, got %v", err)
	}
	if _, err := r.initiate(t, "u2", key1, `{"a":1}`); !errors.Is(err, ErrIdempotencyConflict) {
		t.Errorf("other payer on same key: want conflict, got %v", err)
	}
}

func TestInitiate_Replay_AfterConfirmed_ReturnsTerminalStatusNoGatewayInit(t *testing.T) {
	r := newRig()
	if _, err := r.initiate(t, "u1", key1, `{}`); err != nil {
		t.Fatal(err)
	}
	if _, err := r.e.OnChargeSuccess(context.Background(), "fakeorder:"+key1, ""); err != nil {
		t.Fatal(err)
	}
	out, err := r.initiate(t, "u1", key1, `{}`)
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != StatusConfirmed || out.AuthorizationURL != "" || len(r.gw.initCalls) != 1 {
		t.Errorf("replay of a paid key must not reopen the gateway: %+v inits=%d", out, len(r.gw.initCalls))
	}
}

func TestInitiate_GatewayRewritesReference_Refused(t *testing.T) {
	r := newRig()
	r.e.gateway = rewriteGW{r.gw}
	if _, err := r.initiate(t, "u1", key1, `{}`); err == nil {
		t.Fatal("a rewritten reference would orphan the charge from its intent; must be refused")
	}
}

type rewriteGW struct{ *fakeGW }

func (g rewriteGW) InitializePayment(ctx context.Context, r provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error) {
	return &provider.InitializePaymentResponse{Reference: "other", AuthorizationURL: "u"}, nil
}

// ── OnChargeSuccess ─────────────────────────────────────────────────────────

func paid(t *testing.T, r *rig) string {
	t.Helper()
	out, err := r.initiate(t, "u1", key1, `{}`)
	if err != nil {
		t.Fatal(err)
	}
	return out.Reference
}

func TestConfirm_HappyPath_BooksOnceWithVerifiedAmountAndNamespacedKey(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	res, err := r.e.OnChargeSuccess(context.Background(), ref, ref)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != StatusConfirmed || res.EntityID == nil || *res.EntityID != "ent-1" {
		t.Fatalf("bad result %+v", res)
	}
	if r.d.books != 1 || r.d.bookAmts[0] != 250_000 || r.d.bookIdem[0] != ref {
		t.Errorf("book called %d× amt=%v idem=%v; want 1× 250000 keyed by the namespaced reference", r.d.books, r.d.bookAmts, r.d.bookIdem)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Errorf("a successful booking must never refund")
	}
}

func TestConfirm_ReplayAndRace_BooksExactlyOnce(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ { // webhook + polls + retries interleaving
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
			_, _ = r.e.CheckStatus(context.Background(), ref)
		}()
	}
	wg.Wait()
	if got := atomic.LoadInt32(&r.d.books); got != 1 {
		t.Fatalf("Book ran %d times for one charge, want exactly 1", got)
	}
	rec, _ := r.st.Get(context.Background(), ref)
	if rec.Status != StatusConfirmed {
		t.Errorf("final status %q", rec.Status)
	}
}

func TestConfirm_ChargeNotSuccessful_And_VerifyUnavailable_DoNotClaimOrBook(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.gw.verify = &provider.PaymentStatus{Status: "abandoned", AmountKobo: 250_000}
	if _, err := r.e.OnChargeSuccess(context.Background(), ref, ref); !errors.Is(err, ErrChargeNotSuccessful) {
		t.Errorf("want ErrChargeNotSuccessful, got %v", err)
	}
	r.gw.verify, r.gw.verifyErr = nil, errors.New("timeout")
	if _, err := r.e.OnChargeSuccess(context.Background(), ref, ref); !errors.Is(err, ErrVerifyUnavailable) {
		t.Errorf("want ErrVerifyUnavailable, got %v", err)
	}
	// the poll endpoint turns both into "keep polling", not a failure
	for _, st := range []*provider.PaymentStatus{nil, {Status: "failed"}} {
		r.gw.verify = st
		res, err := r.e.CheckStatus(context.Background(), ref)
		if err != nil || res.Status != StatusPending {
			t.Errorf("poll: res=%+v err=%v, want pending", res, err)
		}
	}
	rec, _ := r.st.Get(context.Background(), ref)
	if rec.Status != StatusPending || r.d.books != 0 {
		t.Errorf("must stay pending and unbooked: %s books=%d", rec.Status, r.d.books)
	}
}

func TestConfirm_AmountMismatch_RefundsFullCollectedAmount_NeverBooks(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: 100_000, Currency: "NGN"} // underpaid
	_, err := r.e.OnChargeSuccess(context.Background(), ref, ref)
	if !errors.Is(err, ErrAmountMismatch) {
		t.Fatalf("want ErrAmountMismatch, got %v", err)
	}
	if r.d.books != 0 {
		t.Fatal("must NEVER book when the collected amount differs from the frozen quote")
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != 100_000 {
		t.Errorf("refund calls %v, want exactly one for what was collected (100000)", r.gw.refundCalls)
	}
	rec, _ := r.st.Get(context.Background(), ref)
	if rec.Status != StatusRefunded || rec.RefundReference == nil {
		t.Errorf("status=%q ref=%v, want refunded with a refund reference", rec.Status, rec.RefundReference)
	}
}

func TestConfirm_WrongCurrency_RefundedNeverBooked(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: 250_000, Currency: "USD"}
	if _, err := r.e.OnChargeSuccess(context.Background(), ref, ref); !errors.Is(err, ErrAmountMismatch) {
		t.Fatalf("want mismatch, got %v", err)
	}
	if r.d.books != 0 || len(r.gw.refundCalls) != 1 {
		t.Errorf("books=%d refunds=%d", r.d.books, len(r.gw.refundCalls))
	}
	// an adapter that leaves Currency empty is tolerated (documented contract)
	r2 := newRig()
	ref2 := paid(t, r2)
	r2.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: 250_000}
	if res, err := r2.e.OnChargeSuccess(context.Background(), ref2, ref2); err != nil || res.Status != StatusConfirmed {
		t.Errorf("empty currency: %+v %v", res, err)
	}
}

func TestConfirm_BookFails_NoBookingExists_RefundsAndMarksRefunded(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.d.bookErr = errors.New("insert failed")
	if _, err := r.e.OnChargeSuccess(context.Background(), ref, ref); err == nil {
		t.Fatal("want error")
	}
	rec, _ := r.st.Get(context.Background(), ref)
	if rec.Status != StatusRefunded || len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != 250_000 {
		t.Errorf("status=%q refunds=%v", rec.Status, r.gw.refundCalls)
	}
}

func TestConfirm_BookErrors_ButBookingExists_NeverRefundsAndConfirms(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.d.bookErr = errors.New("commit ok, response lost")
	r.d.findFound, r.d.findID = true, "ent-9"
	res, err := r.e.OnChargeSuccess(context.Background(), ref, ref)
	if err != nil {
		t.Fatalf("a booking exists, so this is a success: %v", err)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Fatal("REFUNDED A CHARGE THAT BACKS A REAL BOOKING")
	}
	if res.Status != StatusConfirmed || *res.EntityID != "ent-9" {
		t.Errorf("result %+v", res)
	}
}

func TestConfirm_BookAndFindBothFail_NoRefundOnAGuess_LeftProcessing(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.d.bookErr, r.d.findErr = errors.New("db down"), errors.New("db down")
	if _, err := r.e.OnChargeSuccess(context.Background(), ref, ref); err == nil {
		t.Fatal("want error")
	}
	if len(r.gw.refundCalls) != 0 {
		t.Fatal("must not refund when it cannot be determined whether a booking exists")
	}
	rec, _ := r.st.Get(context.Background(), ref)
	if rec.Status != StatusProcessing {
		t.Errorf("status %q, want processing (stale-claim retry converges)", rec.Status)
	}
}

func TestConfirm_StaleProcessingClaim_IsTakenOverAndConverges(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	base := time.Now()
	r.st.now = func() time.Time { return base }
	r.d.bookErr, r.d.findErr = errors.New("db down"), errors.New("db down")
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref) // crashes mid-flight, leaves processing

	// A fresh claim is honoured: a concurrent attempt must NOT re-book.
	r.d.bookErr, r.d.findErr = nil, nil
	res, err := r.e.OnChargeSuccess(context.Background(), ref, ref)
	if err != nil || res.Status != StatusProcessing {
		t.Fatalf("fresh claim must be respected: %+v %v", res, err)
	}
	// After the stale window another attempt takes over; Book is idempotent.
	r.st.now = func() time.Time { return base.Add(staleClaimAfter + time.Second) }
	res, err = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if err != nil || res.Status != StatusConfirmed {
		t.Fatalf("stale claim must be taken over: %+v %v", res, err)
	}
}

func TestConfirm_RefundFails_StatusStaysHonest_NotRefunded(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: 1, Currency: "NGN"}
	r.gw.refundErr = errors.New("paystack 500")
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	rec, _ := r.st.Get(context.Background(), ref)
	if rec.Status != StatusAmountMismatch || rec.RefundReference != nil {
		t.Errorf("status=%q refundRef=%v — must not claim 'refunded' when the gateway refused", rec.Status, rec.RefundReference)
	}
}

func TestConfirm_UnknownReference(t *testing.T) {
	r := newRig()
	if _, err := r.e.OnChargeSuccess(context.Background(), "fakeorder:nope0000", ""); !errors.Is(err, ErrUnknownReference) {
		t.Errorf("got %v", err)
	}
	if _, err := r.e.CheckStatus(context.Background(), "fakeorder:nope0000"); !errors.Is(err, ErrUnknownReference) {
		t.Errorf("got %v", err)
	}
}

// ── refund on cancel ────────────────────────────────────────────────────────

func confirmed(t *testing.T, r *rig) string {
	t.Helper()
	ref := paid(t, r)
	if _, err := r.e.OnChargeSuccess(context.Background(), ref, ref); err != nil {
		t.Fatal(err)
	}
	return ref
}

func TestRefundExternal_GatewayThenLedger_ExactAmount(t *testing.T) {
	r := newRig()
	ref := confirmed(t, r)
	if err := r.e.RefunderFor("fake").RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "cancelled"); err != nil {
		t.Fatal(err)
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != 250_000 || r.gw.refundedRefs[0] != ref {
		t.Errorf("gateway refund %v %v", r.gw.refundCalls, r.gw.refundedRefs)
	}
	if len(r.lg.calls) != 1 || r.lg.calls[0] != "sett-1|cancelled" {
		t.Errorf("ledger calls %v", r.lg.calls)
	}
}

func TestRefundExternal_GatewayFails_LedgerUntouched(t *testing.T) {
	r := newRig()
	_ = confirmed(t, r)
	r.gw.refundErr = errors.New("paystack down")
	if err := r.e.RefunderFor("fake").RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "x"); err == nil {
		t.Fatal("want error")
	}
	if len(r.lg.calls) != 0 {
		t.Fatal("ledger must not be reversed when the customer was not actually refunded")
	}
}

func TestRefundExternal_LedgerFails_RetrySkipsGatewayAndFinishesLedger(t *testing.T) {
	r := newRig()
	_ = confirmed(t, r)
	rf := r.e.RefunderFor("fake")
	r.lg.err = errors.New("db blip")
	if err := rf.RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "x"); err == nil {
		t.Fatal("want ledger error")
	}
	r.lg.err = nil
	if err := rf.RefundExternalSettlement(context.Background(), "ent-1", "sett-1", "x"); err != nil {
		t.Fatal(err)
	}
	if len(r.gw.refundCalls) != 1 {
		t.Fatalf("customer refunded %d times, want exactly once", len(r.gw.refundCalls))
	}
	if len(r.lg.calls) != 2 {
		t.Errorf("ledger attempts %d, want 2 (fail, then converge)", len(r.lg.calls))
	}
}

func TestRefundExternal_UnknownEntity(t *testing.T) {
	r := newRig()
	if err := r.e.RefunderFor("fake").RefundExternalSettlement(context.Background(), "ghost", "s", "x"); err == nil {
		t.Fatal("want error for an entity with no intent (must not guess a reference)")
	}
	if len(r.gw.refundCalls) != 0 {
		t.Error("no gateway call without an intent")
	}
}

// ── registration ────────────────────────────────────────────────────────────

type otherDomain struct{ fakeDomain }

func (*otherDomain) Name() string            { return "other" }
func (*otherDomain) ReferencePrefix() string { return "fakeorder:x:" } // overlaps "fakeorder:"

func TestRegister_RejectsOverlappingPrefixAndDuplicateName(t *testing.T) {
	r := newRig()
	mustPanic := func(name string, f func()) {
		defer func() {
			if recover() == nil {
				t.Errorf("%s: want panic (a mis-routed webhook prefix moves money to the wrong domain)", name)
			}
		}()
		f()
	}
	mustPanic("overlap", func() { r.e.Register(&otherDomain{}) })
	mustPanic("dup", func() { r.e.Register(r.d) })
}

// ── HTTP ────────────────────────────────────────────────────────────────────

func httpRig(t *testing.T) (*rig, *gin.Engine) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := newRig()
	g := gin.New()
	g.Use(func(c *gin.Context) { // minimal stand-in for RequireAuthContext
		if u := c.GetHeader("X-Test-User"); u != "" {
			c.Set("user_id", u)
		}
	})
	r.e.RegisterRoutes(g.Group("/m"))
	return r, g
}

func do(g *gin.Engine, method, path, user, idem, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	if idem != "" {
		req.Header.Set("Idempotency-Key", idem)
	}
	w := httptest.NewRecorder()
	g.ServeHTTP(w, req)
	return w
}

func TestHTTP_Initiate_RequiresAuthAndHeaderKey(t *testing.T) {
	_, g := httpRig(t)
	if w := do(g, "POST", "/m/fakes/paystack/initiate", "", key1, `{}`); w.Code != http.StatusUnauthorized {
		t.Errorf("no user: %d", w.Code)
	}
	if w := do(g, "POST", "/m/fakes/paystack/initiate", "u1", "", `{"idempotency_key":"body-key-000001"}`); w.Code != http.StatusBadRequest {
		t.Errorf("a body key must NOT satisfy the header requirement: %d", w.Code)
	}
	if w := do(g, "POST", "/m/fakes/paystack/initiate", "u1", key1, `not json`); w.Code != http.StatusBadRequest {
		t.Errorf("bad json: %d", w.Code)
	}
	w := do(g, "POST", "/m/fakes/paystack/initiate", "u1", key1, `{"email":"e@x.y"}`)
	if w.Code != http.StatusCreated || !strings.Contains(w.Body.String(), `"amountKobo":250000`) {
		t.Errorf("initiate: %d %s", w.Code, w.Body.String())
	}
	if w := do(g, "POST", "/m/fakes/paystack/initiate", "u1", key1, `{"x":1}`); w.Code != http.StatusConflict {
		t.Errorf("same key, different body: %d", w.Code)
	}
}

func TestHTTP_Status_OwnerOnly_404ForOthers_AndSelfHeals(t *testing.T) {
	r, g := httpRig(t)
	w := do(g, "POST", "/m/fakes/paystack/initiate", "u1", key1, `{}`)
	if w.Code != http.StatusCreated {
		t.Fatal(w.Body.String())
	}
	path := "/m/fakes/paystack/fakeorder:" + key1 + "/status"
	if w := do(g, "GET", path, "u2", "", ""); w.Code != http.StatusNotFound {
		t.Errorf("another user's reference must 404 (not 403): %d", w.Code)
	}
	if w := do(g, "GET", "/m/fakes/paystack/fakeorder:nope0000/status", "u1", "", ""); w.Code != http.StatusNotFound {
		t.Errorf("unknown: %d", w.Code)
	}
	if w := do(g, "GET", "/m/fakes/paystack/parcelorder:"+key1+"/status", "u1", "", ""); w.Code != http.StatusNotFound {
		t.Errorf("another domain's reference must not resolve here: %d", w.Code)
	}
	w = do(g, "GET", path, "u1", "", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"status":"confirmed"`) || !strings.Contains(w.Body.String(), `"fakeId":"ent-1"`) {
		t.Errorf("self-heal status: %d %s", w.Code, w.Body.String())
	}
	if r.d.books != 1 {
		t.Errorf("books=%d", r.d.books)
	}
}

func TestPrefixesAndConfirmer(t *testing.T) {
	r := newRig()
	if p := r.e.Prefixes(); len(p) != 1 || p[0] != "fakeorder:" {
		t.Errorf("prefixes %v", p)
	}
	ref := paid(t, r)
	out, err := r.e.Confirmer().OnChargeSuccess(context.Background(), ref, ref)
	if err != nil || out.(*Result).Status != StatusConfirmed {
		t.Errorf("webhook confirmer: %v %v", out, err)
	}
}

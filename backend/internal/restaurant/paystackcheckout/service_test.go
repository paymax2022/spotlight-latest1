package paystackcheckout

// PURE tests — no live gateway/DB/restaurant service. All three collaborators
// are in-memory fakes, so the money-safety invariants this package exists for
// are exercised in isolation:
//   - InitiateCheckout freezes the QUOTED amount, never a client-supplied one
//     (there is structurally no amount input to InitiateCheckout at all).
//   - OnChargeSuccess never places an order or refunds twice for one reference
//     (ClaimForProcessing's atomic claim).
//   - An amount mismatch or a placement failure ALWAYS attempts a refund before
//     returning an error — proven by asserting the fake gateway's refund was
//     actually called, not just that an error came back.
//   - A failed refund still leaves an honest terminal status (not silently
//     "refunded" when the gateway said no).

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/restaurant"
)

// ── fakeGateway ──────────────────────────────────────────────────────────

type fakeGateway struct {
	mu sync.Mutex

	initResp *provider.InitializePaymentResponse
	initErr  error

	verifyStatus *provider.PaymentStatus
	verifyErr    error

	refundResult *provider.RefundResult
	refundErr    error

	initCalls   []provider.InitializePaymentRequest
	verifyCalls []string
	refundCalls []struct {
		reference string
		amountKobo int64
	}
}

func (f *fakeGateway) InitializePayment(_ context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.initCalls = append(f.initCalls, req)
	if f.initErr != nil {
		return nil, f.initErr
	}
	if f.initResp != nil {
		return f.initResp, nil
	}
	return &provider.InitializePaymentResponse{Reference: req.Reference, AuthorizationURL: "https://paystack.test/" + req.Reference}, nil
}

func (f *fakeGateway) VerifyPayment(_ context.Context, reference string) (*provider.PaymentStatus, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.verifyCalls = append(f.verifyCalls, reference)
	if f.verifyErr != nil {
		return nil, f.verifyErr
	}
	return f.verifyStatus, nil
}

func (f *fakeGateway) RefundPayment(_ context.Context, reference string, amountKobo int64) (*provider.RefundResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refundCalls = append(f.refundCalls, struct {
		reference  string
		amountKobo int64
	}{reference, amountKobo})
	if f.refundErr != nil {
		return nil, f.refundErr
	}
	if f.refundResult != nil {
		return f.refundResult, nil
	}
	return &provider.RefundResult{Reference: reference, Status: "processed", AmountKobo: amountKobo}, nil
}

// ── fakeOrders ───────────────────────────────────────────────────────────

type fakeOrders struct {
	mu sync.Mutex

	quoteAmount int64
	quoteErr    error

	placedOrder *restaurant.Order
	placeErr    error

	quoteCalls []restaurant.PlaceOrderRequest
	placeCalls []struct {
		req        restaurant.PlaceOrderRequest
		verifiedKobo int64
	}
}

func (f *fakeOrders) QuoteOrder(_ context.Context, _ string, _ string, req restaurant.PlaceOrderRequest) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.quoteCalls = append(f.quoteCalls, req)
	if f.quoteErr != nil {
		return 0, f.quoteErr
	}
	return f.quoteAmount, nil
}

func (f *fakeOrders) PlaceOrderPaystackFunded(_ context.Context, _ string, _ string, req restaurant.PlaceOrderRequest, verifiedAmountKobo int64) (*restaurant.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.placeCalls = append(f.placeCalls, struct {
		req          restaurant.PlaceOrderRequest
		verifiedKobo int64
	}{req, verifiedAmountKobo})
	if f.placeErr != nil {
		return nil, f.placeErr
	}
	if f.placedOrder != nil {
		return f.placedOrder, nil
	}
	return &restaurant.Order{ID: "order-1", TotalKobo: verifiedAmountKobo}, nil
}

// ── fakeIntents (in-memory IntentStore) ────────────────────────────────────

type fakeIntents struct {
	mu   sync.Mutex
	byRef map[string]*intentRecord
	byKey map[string]string // idempotencyKey -> reference
}

func newFakeIntents() *fakeIntents {
	return &fakeIntents{byRef: map[string]*intentRecord{}, byKey: map[string]string{}}
}

func (f *fakeIntents) PutIntent(_ context.Context, in intentRecord) (*intentRecord, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if ref, ok := f.byKey[in.IdempotencyKey]; ok {
		existing := f.byRef[ref]
		cp := *existing
		return &cp, false, nil
	}
	cp := in
	f.byRef[in.Reference] = &cp
	f.byKey[in.IdempotencyKey] = in.Reference
	return nil, true, nil
}

func (f *fakeIntents) GetByReference(_ context.Context, reference string) (*intentRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.byRef[reference]
	if !ok {
		return nil, errors.New("not found")
	}
	cp := *rec
	return &cp, nil
}

func (f *fakeIntents) ClaimForProcessing(_ context.Context, reference string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.byRef[reference]
	if !ok || rec.Status != "pending" {
		return false, nil
	}
	rec.Status = "processing"
	return true, nil
}

func (f *fakeIntents) MarkStatus(_ context.Context, reference, status string, orderID, refundReference *string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.byRef[reference]
	if !ok {
		return errors.New("not found")
	}
	rec.Status = status
	if orderID != nil {
		rec.OrderID = orderID
	}
	return nil
}

func (f *fakeIntents) GetByOrderID(_ context.Context, orderID string) (*intentRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, rec := range f.byRef {
		if rec.OrderID != nil && *rec.OrderID == orderID {
			cp := *rec
			return &cp, nil
		}
	}
	return nil, errors.New("not found")
}

// ── fakeSettlementReverser ───────────────────────────────────────────────

type fakeSettlementReverser struct {
	mu    sync.Mutex
	calls []struct{ settlementID, reason string }
	err   error
}

func (f *fakeSettlementReverser) RefundExternal(_ context.Context, settlementID, reason string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, struct{ settlementID, reason string }{settlementID, reason})
	return f.err
}

// ── helpers ──────────────────────────────────────────────────────────────

func sampleReq(idemKey string) restaurant.PlaceOrderRequest {
	return restaurant.PlaceOrderRequest{
		Items:           []restaurant.OrderItemInput{{MenuItemID: "item-1", Quantity: 1}},
		DeliveryAddress: "1 Test St",
		IdempotencyKey:  idemKey,
	}
}

func successStatus(amountKobo int64) *provider.PaymentStatus {
	return &provider.PaymentStatus{Status: "success", AmountKobo: amountKobo}
}

// ── InitiateCheckout ─────────────────────────────────────────────────────

func TestInitiateCheckout_FreezesQuotedAmount(t *testing.T) {
	gw := &fakeGateway{}
	orders := &fakeOrders{quoteAmount: 150_000}
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	out, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq("idem-1"), "a@b.com", "https://cb")
	if err != nil {
		t.Fatalf("InitiateCheckout: %v", err)
	}
	if out.AmountKobo != 150_000 {
		t.Errorf("AmountKobo = %d, want the quoted 150000", out.AmountKobo)
	}
	if len(gw.initCalls) != 1 || gw.initCalls[0].AmountKobo != 150_000 {
		t.Errorf("gateway InitializePayment amount = %+v, want 150000", gw.initCalls)
	}
}

func TestInitiateCheckout_RejectsMissingIdempotencyKey(t *testing.T) {
	svc := NewService(&fakeGateway{}, &fakeOrders{quoteAmount: 1000}, newFakeIntents(), &fakeSettlementReverser{})
	_, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq(""), "a@b.com", "")
	if !errors.Is(err, ErrIdempotencyRequired) {
		t.Fatalf("err = %v, want ErrIdempotencyRequired", err)
	}
}

func TestInitiateCheckout_RejectsEmptyCart(t *testing.T) {
	svc := NewService(&fakeGateway{}, &fakeOrders{quoteAmount: 1000}, newFakeIntents(), &fakeSettlementReverser{})
	req := sampleReq("idem-1")
	req.Items = nil
	_, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", req, "a@b.com", "")
	if !errors.Is(err, ErrEmptyCart) {
		t.Fatalf("err = %v, want ErrEmptyCart", err)
	}
}

func TestInitiateCheckout_ReplayReusesFrozenAmount(t *testing.T) {
	gw := &fakeGateway{}
	orders := &fakeOrders{quoteAmount: 100_000}
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	req := sampleReq("idem-replay")
	first, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", req, "a@b.com", "")
	if err != nil {
		t.Fatalf("first initiate: %v", err)
	}

	// Menu price moved between the two calls — the replay must still use the
	// FIRST quote, not re-quote and re-charge a different amount.
	orders.quoteAmount = 999_999
	second, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", req, "a@b.com", "")
	if err != nil {
		t.Fatalf("replay initiate: %v", err)
	}
	if second.AmountKobo != first.AmountKobo {
		t.Errorf("replay amount = %d, want the frozen first-attempt amount %d", second.AmountKobo, first.AmountKobo)
	}
	if second.Reference != first.Reference {
		t.Errorf("replay reference = %s, want the same reference %s", second.Reference, first.Reference)
	}
}

// ── OnChargeSuccess: happy path ──────────────────────────────────────────

func TestOnChargeSuccess_PlacesOrderAndConfirms(t *testing.T) {
	gw := &fakeGateway{verifyStatus: successStatus(150_000)}
	orders := &fakeOrders{quoteAmount: 150_000, placedOrder: &restaurant.Order{ID: "order-42", TotalKobo: 150_000}}
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	intent, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq("idem-ok"), "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}

	res, err := svc.OnChargeSuccess(context.Background(), intent.Reference, "gw-ref")
	if err != nil {
		t.Fatalf("OnChargeSuccess: %v", err)
	}
	if res.Status != "confirmed" || res.OrderID == nil || *res.OrderID != "order-42" {
		t.Errorf("result = %+v, want confirmed/order-42", res)
	}
	if len(orders.placeCalls) != 1 {
		t.Fatalf("PlaceOrderPaystackFunded called %d times, want 1", len(orders.placeCalls))
	}
	if orders.placeCalls[0].verifiedKobo != 150_000 {
		t.Errorf("verified amount passed through = %d, want 150000", orders.placeCalls[0].verifiedKobo)
	}
	if len(gw.refundCalls) != 0 {
		t.Errorf("refund called on a successful placement: %+v", gw.refundCalls)
	}
}

func TestOnChargeSuccess_UnknownReferenceIsBenign(t *testing.T) {
	svc := NewService(&fakeGateway{}, &fakeOrders{}, newFakeIntents(), &fakeSettlementReverser{})
	_, err := svc.OnChargeSuccess(context.Background(), "foodorder:does-not-exist", "gw")
	if !errors.Is(err, ErrUnknownReference) {
		t.Fatalf("err = %v, want ErrUnknownReference", err)
	}
}

func TestOnChargeSuccess_NotSuccessfulMovesNothing(t *testing.T) {
	gw := &fakeGateway{verifyStatus: &provider.PaymentStatus{Status: "failed", AmountKobo: 150_000}}
	orders := &fakeOrders{quoteAmount: 150_000}
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	intent, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq("idem-fail"), "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	if _, err := svc.OnChargeSuccess(context.Background(), intent.Reference, "gw"); !errors.Is(err, ErrChargeNotSuccessful) {
		t.Fatalf("err = %v, want ErrChargeNotSuccessful", err)
	}
	if len(orders.placeCalls) != 0 {
		t.Errorf("PlaceOrderPaystackFunded called for a non-successful charge")
	}
	if len(gw.refundCalls) != 0 {
		t.Errorf("refund attempted for a charge that never collected money: %+v", gw.refundCalls)
	}
	// Intent must stay pending so a genuine future success can still confirm.
	rec, _ := intents.GetByReference(context.Background(), intent.Reference)
	if rec.Status != "pending" {
		t.Errorf("intent status = %s, want pending", rec.Status)
	}
}

// ── OnChargeSuccess: amount mismatch → refund ────────────────────────────

func TestOnChargeSuccess_AmountMismatchRefundsAndMarks(t *testing.T) {
	gw := &fakeGateway{verifyStatus: successStatus(200_000)} // Paystack actually collected 200k
	orders := &fakeOrders{quoteAmount: 150_000}               // but the frozen quote was 150k
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	intent, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq("idem-mismatch"), "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}

	_, err = svc.OnChargeSuccess(context.Background(), intent.Reference, "gw")
	if !errors.Is(err, ErrAmountMismatch) {
		t.Fatalf("err = %v, want ErrAmountMismatch", err)
	}
	if len(orders.placeCalls) != 0 {
		t.Errorf("order was placed despite an amount mismatch")
	}
	if len(gw.refundCalls) != 1 {
		t.Fatalf("refund calls = %d, want exactly 1", len(gw.refundCalls))
	}
	if gw.refundCalls[0].amountKobo != 200_000 {
		t.Errorf("refunded amount = %d, want the FULL verified amount 200000 (not the frozen quote)", gw.refundCalls[0].amountKobo)
	}
	rec, _ := intents.GetByReference(context.Background(), intent.Reference)
	if rec.Status != "refunded" {
		t.Errorf("intent status = %s, want refunded", rec.Status)
	}
}

// ── OnChargeSuccess: placement failure → refund ──────────────────────────

func TestOnChargeSuccess_PlacementFailureRefundsAndMarksOrderFailed(t *testing.T) {
	gw := &fakeGateway{verifyStatus: successStatus(150_000)}
	orders := &fakeOrders{quoteAmount: 150_000, placeErr: errors.New("restaurant closed")}
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	intent, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq("idem-placefail"), "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	if _, err := svc.OnChargeSuccess(context.Background(), intent.Reference, "gw"); err == nil {
		t.Fatal("expected an error when order placement fails")
	}
	if len(gw.refundCalls) != 1 {
		t.Fatalf("refund calls = %d, want exactly 1 (Paystack already collected the money)", len(gw.refundCalls))
	}
	rec, _ := intents.GetByReference(context.Background(), intent.Reference)
	if rec.Status != "refunded" {
		t.Errorf("intent status = %s, want refunded", rec.Status)
	}
}

// TestOnChargeSuccess_FailedRefundLeavesHonestStatus: if the refund itself
// fails, the intent must NOT claim "refunded" — it must keep the original
// failure reason so ops can find it for manual reconciliation.
func TestOnChargeSuccess_FailedRefundLeavesHonestStatus(t *testing.T) {
	gw := &fakeGateway{verifyStatus: successStatus(200_000), refundErr: errors.New("paystack: refund service unavailable")}
	orders := &fakeOrders{quoteAmount: 150_000}
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	intent, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq("idem-refundfail"), "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	if _, err := svc.OnChargeSuccess(context.Background(), intent.Reference, "gw"); !errors.Is(err, ErrAmountMismatch) {
		t.Fatalf("err = %v, want ErrAmountMismatch", err)
	}
	rec, _ := intents.GetByReference(context.Background(), intent.Reference)
	if rec.Status != "amount_mismatch" {
		t.Errorf("intent status = %s, want amount_mismatch (never falsely 'refunded' when the refund call itself failed)", rec.Status)
	}
}

// ── OnChargeSuccess: race safety ─────────────────────────────────────────

// TestOnChargeSuccess_ConcurrentDeliveriesActOnce: two "simultaneous" webhook
// deliveries for the same reference must never both place an order or both
// refund — only one wins the ClaimForProcessing race.
func TestOnChargeSuccess_ConcurrentDeliveriesActOnce(t *testing.T) {
	gw := &fakeGateway{verifyStatus: successStatus(150_000)}
	orders := &fakeOrders{quoteAmount: 150_000}
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	intent, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq("idem-race"), "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = svc.OnChargeSuccess(context.Background(), intent.Reference, "gw")
		}()
	}
	wg.Wait()

	orders.mu.Lock()
	placeCalls := len(orders.placeCalls)
	orders.mu.Unlock()
	if placeCalls != 1 {
		t.Errorf("PlaceOrderPaystackFunded called %d times across concurrent deliveries, want exactly 1", placeCalls)
	}
}

// ── CheckStatus self-heal ─────────────────────────────────────────────────

func TestCheckStatus_SelfHealsPendingIntent(t *testing.T) {
	gw := &fakeGateway{verifyStatus: successStatus(150_000)}
	orders := &fakeOrders{quoteAmount: 150_000, placedOrder: &restaurant.Order{ID: "order-9", TotalKobo: 150_000}}
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	intent, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq("idem-selfheal"), "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	res, err := svc.CheckStatus(context.Background(), intent.Reference)
	if err != nil {
		t.Fatalf("CheckStatus: %v", err)
	}
	if res.Status != "confirmed" {
		t.Errorf("status = %s, want confirmed (CheckStatus must self-heal via OnChargeSuccess)", res.Status)
	}
}

func TestCheckStatus_PendingWhenNotYetPaid(t *testing.T) {
	gw := &fakeGateway{verifyStatus: &provider.PaymentStatus{Status: "pending"}}
	orders := &fakeOrders{quoteAmount: 150_000}
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	intent, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq("idem-notyet"), "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	res, err := svc.CheckStatus(context.Background(), intent.Reference)
	if err != nil {
		t.Fatalf("CheckStatus should not error while awaiting payment: %v", err)
	}
	if res.Status != "pending" {
		t.Errorf("status = %s, want pending", res.Status)
	}
}

// TestCheckStatus_VerifyTransientErrorStaysPending pins the 2026-09-25 fix: a
// network/timeout failure calling Paystack's OWN verify endpoint must not
// surface as a hard error from CheckStatus. Before the fix, ANY error from
// gateway.VerifyPayment (not just an explicit "not successful" response) was
// returned as-is, which the HTTP handler mapped to a 500 — the mobile
// resolver screen read that as "unavailable" and oscillated with "pending"
// on every subsequent poll, even though the card charge had already
// succeeded (the in-app SDK's own onSuccess had already fired client-side).
func TestCheckStatus_VerifyTransientErrorStaysPending(t *testing.T) {
	gw := &fakeGateway{verifyErr: errors.New("dial tcp: i/o timeout")}
	orders := &fakeOrders{quoteAmount: 150_000}
	intents := newFakeIntents()
	svc := NewService(gw, orders, intents, &fakeSettlementReverser{})

	intent, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-1", sampleReq("idem-transient"), "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	res, err := svc.CheckStatus(context.Background(), intent.Reference)
	if err != nil {
		t.Fatalf("CheckStatus must not surface a transient verify error, got: %v", err)
	}
	if res.Status != "pending" {
		t.Errorf("status = %s, want pending (a network hiccup calling Paystack is not a payment failure)", res.Status)
	}
}

// TestIntentRecord_DecodeRequestRoundTrips pins that the exact cart survives
// the JSON freeze/thaw round trip InitiateCheckout/OnChargeSuccess rely on.
func TestIntentRecord_DecodeRequestRoundTrips(t *testing.T) {
	req := sampleReq("idem-roundtrip")
	req.PromoCode = "SAVE10"
	req.TipKobo = 5000
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	rec := &intentRecord{RequestJSON: b}
	got, err := rec.decodeRequest()
	if err != nil {
		t.Fatalf("decodeRequest: %v", err)
	}
	if got.PromoCode != req.PromoCode || got.TipKobo != req.TipKobo || len(got.Items) != len(req.Items) {
		t.Errorf("decoded request = %+v, want a faithful copy of %+v", got, req)
	}
}

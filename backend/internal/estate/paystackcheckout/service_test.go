package paystackcheckout

// PURE tests — no live gateway/DB/estate service. All three collaborators
// are in-memory fakes — see restaurant/paystackcheckout/service_test.go for
// the fully-commented reference this mirrors.

import (
	"context"
	"errors"
	"sync"
	"testing"

	"spotlight/backend/internal/estate"
	"spotlight/backend/internal/provider"
)

type fakeGateway struct {
	mu sync.Mutex

	initResp *provider.InitializePaymentResponse
	initErr  error

	verifyStatus *provider.PaymentStatus
	verifyErr    error

	refundErr error

	initCalls   []provider.InitializePaymentRequest
	refundCalls []struct {
		reference  string
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

func (f *fakeGateway) VerifyPayment(_ context.Context, _ string) (*provider.PaymentStatus, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
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
	return &provider.RefundResult{Reference: reference, Status: "processed", AmountKobo: amountKobo}, nil
}

type fakeDues struct {
	mu sync.Mutex

	quoteAmount int64
	quoteErr    error

	paidReceipt *estate.DuesPayment
	payErr      error

	payCalls []struct {
		req          estate.PayDuesRequest
		verifiedKobo int64
	}
}

func (f *fakeDues) QuoteDuesInvoice(_ context.Context, _, _, _ string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.quoteErr != nil {
		return 0, f.quoteErr
	}
	return f.quoteAmount, nil
}

func (f *fakeDues) PayDuesPaystackFunded(_ context.Context, _, _ string, req estate.PayDuesRequest, verifiedAmountKobo int64) (*estate.DuesPayment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.payCalls = append(f.payCalls, struct {
		req          estate.PayDuesRequest
		verifiedKobo int64
	}{req, verifiedAmountKobo})
	if f.payErr != nil {
		return nil, f.payErr
	}
	if f.paidReceipt != nil {
		return f.paidReceipt, nil
	}
	return &estate.DuesPayment{ID: "payment-1", AmountKobo: verifiedAmountKobo, Method: "paystack", Status: "successful"}, nil
}

type fakeIntents struct {
	mu    sync.Mutex
	byRef map[string]*intentRecord
	byKey map[string]string
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

func (f *fakeIntents) MarkStatus(_ context.Context, reference, status string, paymentID, refundReference *string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.byRef[reference]
	if !ok {
		return errors.New("not found")
	}
	rec.Status = status
	if paymentID != nil {
		rec.PaymentID = paymentID
	}
	return nil
}

func successStatus(amountKobo int64) *provider.PaymentStatus {
	return &provider.PaymentStatus{Status: "success", AmountKobo: amountKobo}
}

func TestInitiateCheckout_FreezesQuotedAmount(t *testing.T) {
	gw := &fakeGateway{}
	dues := &fakeDues{quoteAmount: 150_000}
	svc := NewService(gw, dues, newFakeIntents())

	out, err := svc.InitiateCheckout(context.Background(), "estate-1", "resident-1", "invoice-1", "idem-1", "a@b.com", "")
	if err != nil {
		t.Fatalf("InitiateCheckout: %v", err)
	}
	if out.AmountKobo != 150_000 {
		t.Errorf("AmountKobo = %d, want 150000", out.AmountKobo)
	}
}

func TestInitiateCheckout_RejectsMissingIdempotencyKey(t *testing.T) {
	svc := NewService(&fakeGateway{}, &fakeDues{quoteAmount: 1000}, newFakeIntents())
	_, err := svc.InitiateCheckout(context.Background(), "estate-1", "resident-1", "invoice-1", "", "a@b.com", "")
	if !errors.Is(err, ErrIdempotencyRequired) {
		t.Fatalf("err = %v, want ErrIdempotencyRequired", err)
	}
}

func TestOnChargeSuccess_PaysDuesAndConfirms(t *testing.T) {
	gw := &fakeGateway{verifyStatus: successStatus(150_000)}
	dues := &fakeDues{quoteAmount: 150_000, paidReceipt: &estate.DuesPayment{ID: "payment-42", AmountKobo: 150_000, Method: "paystack"}}
	intents := newFakeIntents()
	svc := NewService(gw, dues, intents)

	intent, err := svc.InitiateCheckout(context.Background(), "estate-1", "resident-1", "invoice-1", "idem-ok", "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	res, err := svc.OnChargeSuccess(context.Background(), intent.Reference, "gw")
	if err != nil {
		t.Fatalf("OnChargeSuccess: %v", err)
	}
	if res.Status != "confirmed" || res.PaymentID == nil || *res.PaymentID != "payment-42" {
		t.Errorf("result = %+v, want confirmed/payment-42", res)
	}
	if len(gw.refundCalls) != 0 {
		t.Errorf("refund called on a successful payment: %+v", gw.refundCalls)
	}
}

func TestOnChargeSuccess_AmountMismatchRefundsAndMarks(t *testing.T) {
	gw := &fakeGateway{verifyStatus: successStatus(200_000)}
	dues := &fakeDues{quoteAmount: 150_000}
	intents := newFakeIntents()
	svc := NewService(gw, dues, intents)

	intent, err := svc.InitiateCheckout(context.Background(), "estate-1", "resident-1", "invoice-1", "idem-mismatch", "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	if _, err := svc.OnChargeSuccess(context.Background(), intent.Reference, "gw"); !errors.Is(err, ErrAmountMismatch) {
		t.Fatalf("err = %v, want ErrAmountMismatch", err)
	}
	if len(dues.payCalls) != 0 {
		t.Errorf("dues paid despite an amount mismatch")
	}
	if len(gw.refundCalls) != 1 || gw.refundCalls[0].amountKobo != 200_000 {
		t.Fatalf("refund calls = %+v, want exactly one refund of 200000 (the FULL verified amount)", gw.refundCalls)
	}
	rec, _ := intents.GetByReference(context.Background(), intent.Reference)
	if rec.Status != "refunded" {
		t.Errorf("intent status = %s, want refunded", rec.Status)
	}
}

func TestOnChargeSuccess_PaymentFailureRefundsAndMarksOrderFailed(t *testing.T) {
	gw := &fakeGateway{verifyStatus: successStatus(150_000)}
	dues := &fakeDues{quoteAmount: 150_000, payErr: errors.New("invoice already waived")}
	intents := newFakeIntents()
	svc := NewService(gw, dues, intents)

	intent, err := svc.InitiateCheckout(context.Background(), "estate-1", "resident-1", "invoice-1", "idem-payfail", "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	if _, err := svc.OnChargeSuccess(context.Background(), intent.Reference, "gw"); err == nil {
		t.Fatal("expected an error when the dues payment fails")
	}
	if len(gw.refundCalls) != 1 {
		t.Fatalf("refund calls = %d, want exactly 1 (Paystack already collected the money)", len(gw.refundCalls))
	}
	rec, _ := intents.GetByReference(context.Background(), intent.Reference)
	if rec.Status != "refunded" {
		t.Errorf("intent status = %s, want refunded", rec.Status)
	}
}

func TestOnChargeSuccess_ConcurrentDeliveriesActOnce(t *testing.T) {
	gw := &fakeGateway{verifyStatus: successStatus(150_000)}
	dues := &fakeDues{quoteAmount: 150_000}
	intents := newFakeIntents()
	svc := NewService(gw, dues, intents)

	intent, err := svc.InitiateCheckout(context.Background(), "estate-1", "resident-1", "invoice-1", "idem-race", "a@b.com", "")
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

	dues.mu.Lock()
	payCalls := len(dues.payCalls)
	dues.mu.Unlock()
	if payCalls != 1 {
		t.Errorf("PayDuesPaystackFunded called %d times across concurrent deliveries, want exactly 1", payCalls)
	}
}

func TestOwnerCustomerID_ResolvesTheStartingResident(t *testing.T) {
	svc := NewService(&fakeGateway{}, &fakeDues{quoteAmount: 100_000}, newFakeIntents())
	intent, err := svc.InitiateCheckout(context.Background(), "estate-1", "resident-owner", "invoice-1", "idem-owner", "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	owner, err := svc.OwnerCustomerID(context.Background(), intent.Reference)
	if err != nil {
		t.Fatalf("OwnerCustomerID: %v", err)
	}
	if owner != "resident-owner" {
		t.Errorf("owner = %s, want resident-owner", owner)
	}
}

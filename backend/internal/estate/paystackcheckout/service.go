package paystackcheckout

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"spotlight/backend/internal/estate"
	"spotlight/backend/internal/provider"
)

// ReferencePrefix identifies a Paystack reference as belonging to this
// package (mirrors restaurant/paystackcheckout.ReferencePrefix's "foodorder:"
// idiom).
const ReferencePrefix = "duespay:"

func referenceFor(idempotencyKey string) string { return ReferencePrefix + idempotencyKey }

// Gateway is the slice of the Paystack provider this adapter uses — see
// restaurant/paystackcheckout.Gateway for why RefundPayment is not part of
// the broader provider.PaymentProvider interface.
type Gateway interface {
	InitializePayment(ctx context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error)
	VerifyPayment(ctx context.Context, reference string) (*provider.PaymentStatus, error)
	RefundPayment(ctx context.Context, reference string, amountKobo int64) (*provider.RefundResult, error)
}

// DuesPayer is the slice of estate.Service this adapter uses.
type DuesPayer interface {
	// QuoteDuesInvoice returns the exact amount owed on invoiceID — used ONLY
	// to decide the amount to ask Paystack for. Never trusted as final:
	// PayDuesPaystackFunded independently reloads and cross-checks it.
	QuoteDuesInvoice(ctx context.Context, estateID, payerID, invoiceID string) (int64, error)
	// PayDuesPaystackFunded settles the invoice funded by an already-verified
	// external charge of exactly verifiedAmountKobo.
	PayDuesPaystackFunded(ctx context.Context, estateID, payerID string, req estate.PayDuesRequest, verifiedAmountKobo int64) (*estate.DuesPayment, error)
}

// IntentStore persists the thin pending-intent mapping over
// public.estate_dues_paystack_intents.
type IntentStore interface {
	PutIntent(ctx context.Context, in intentRecord) (existing *intentRecord, inserted bool, err error)
	GetByReference(ctx context.Context, reference string) (*intentRecord, error)
	ClaimForProcessing(ctx context.Context, reference string) (claimed bool, err error)
	MarkStatus(ctx context.Context, reference, status string, paymentID, refundReference *string) error
}

// Service is the estate-dues Paystack-checkout adapter. Same shape as
// restaurant/paystackcheckout.Service (see that package for the fully
// commented reference this mirrors), minus a SettlementReverser: estate
// dues has no escrow/hold-release lifecycle and no existing cancel/refund
// path to retrofit, so there is nothing for a failure here to unwind beyond
// the external charge itself.
type Service struct {
	gateway Gateway
	dues    DuesPayer
	intents IntentStore
}

func NewService(gateway Gateway, dues DuesPayer, intents IntentStore) *Service {
	return &Service{gateway: gateway, dues: dues, intents: intents}
}

func (s *Service) InitiateCheckout(ctx context.Context, estateID, payerID, invoiceID, idempotencyKey, email, callbackURL string) (*CheckoutIntent, error) {
	if payerID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyRequired
	}

	reference := referenceFor(idempotencyKey)

	amountKobo, err := s.dues.QuoteDuesInvoice(ctx, estateID, payerID, invoiceID)
	if err != nil {
		return nil, err
	}

	existing, inserted, err := s.intents.PutIntent(ctx, intentRecord{
		Reference:      reference,
		EstateID:       estateID,
		InvoiceID:      invoiceID,
		PayerID:        payerID,
		AmountKobo:     amountKobo,
		IdempotencyKey: idempotencyKey,
		Status:         "pending",
	})
	if err != nil {
		return nil, err
	}
	if !inserted && existing != nil {
		reference = existing.Reference
		amountKobo = existing.AmountKobo
	}

	resp, err := s.gateway.InitializePayment(ctx, provider.InitializePaymentRequest{
		Email:          email,
		AmountKobo:     amountKobo,
		Reference:      reference,
		CallbackURL:    callbackURL,
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		return nil, err
	}

	out := &CheckoutIntent{
		Reference:        reference,
		AuthorizationURL: resp.AuthorizationURL,
		AccessCode:       resp.AccessCode,
		AmountKobo:       amountKobo,
	}
	if resp.Reference != "" {
		out.Reference = resp.Reference
	}
	return out, nil
}

// OnChargeSuccess mirrors restaurant/paystackcheckout.Service.OnChargeSuccess
// — see that method's doc comment for the full flow description. The one
// difference: on failure this refunds ONLY via the gateway (RefundPayment) —
// there is no settlement row / escrow to also reverse, since dues settle
// immediately with no hold-release step (see the package doc comment).
func (s *Service) OnChargeSuccess(ctx context.Context, reference, gatewayRef string) (*ConfirmResult, error) {
	rec, err := s.intents.GetByReference(ctx, reference)
	if err != nil {
		return nil, ErrUnknownReference
	}
	if rec.Status != "pending" {
		return &ConfirmResult{Reference: reference, Status: rec.Status, PaymentID: rec.PaymentID}, nil
	}

	status, err := s.gateway.VerifyPayment(ctx, reference)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrVerifyUnavailable, err)
	}
	if status == nil || strings.ToLower(status.Status) != "success" {
		return nil, ErrChargeNotSuccessful
	}

	claimed, err := s.intents.ClaimForProcessing(ctx, reference)
	if err != nil {
		return nil, err
	}
	if !claimed {
		if cur, cerr := s.intents.GetByReference(ctx, reference); cerr == nil && cur != nil {
			return &ConfirmResult{Reference: reference, Status: cur.Status, PaymentID: cur.PaymentID}, nil
		}
		return &ConfirmResult{Reference: reference, Status: "processing"}, nil
	}

	if status.AmountKobo != rec.AmountKobo {
		s.refundAndMark(ctx, rec, status.AmountKobo, "amount_mismatch")
		return nil, ErrAmountMismatch
	}

	req := estate.PayDuesRequest{InvoiceID: rec.InvoiceID, IdempotencyKey: rec.IdempotencyKey}
	payment, err := s.dues.PayDuesPaystackFunded(ctx, rec.EstateID, rec.PayerID, req, status.AmountKobo)
	if err != nil {
		s.refundAndMark(ctx, rec, status.AmountKobo, "order_failed")
		return nil, fmt.Errorf("paystackcheckout: pay dues: %w", err)
	}

	if merr := s.intents.MarkStatus(ctx, reference, "confirmed", &payment.ID, nil); merr != nil {
		log.Printf("[estate/paystackcheckout] mark confirmed failed for %s (payment=%s): %v", reference, payment.ID, merr)
	}
	return &ConfirmResult{Reference: reference, Status: "confirmed", PaymentID: &payment.ID, AmountKobo: status.AmountKobo}, nil
}

func (s *Service) refundAndMark(ctx context.Context, rec *intentRecord, amountKobo int64, failStatus string) {
	finalStatus := failStatus
	var refundRef *string
	if res, rerr := s.gateway.RefundPayment(ctx, rec.Reference, amountKobo); rerr == nil {
		ref := res.Reference
		refundRef = &ref
		finalStatus = "refunded"
	} else {
		log.Printf("[estate/paystackcheckout] REFUND FAILED for %s (amount=%d kobo, reason=%s): %v — needs manual reconciliation", rec.Reference, amountKobo, failStatus, rerr)
	}
	if merr := s.intents.MarkStatus(ctx, rec.Reference, finalStatus, nil, refundRef); merr != nil {
		log.Printf("[estate/paystackcheckout] mark %s failed for %s: %v", finalStatus, rec.Reference, merr)
	}
}

// CheckStatus mirrors restaurant/paystackcheckout.Service.CheckStatus — see
// that method for why this self-heal exists (Paystack cannot webhook a
// localhost callback URL).
func (s *Service) CheckStatus(ctx context.Context, reference string) (*ConfirmResult, error) {
	rec, err := s.intents.GetByReference(ctx, reference)
	if err != nil {
		return nil, ErrUnknownReference
	}
	if rec.Status != "pending" {
		return &ConfirmResult{Reference: reference, Status: rec.Status, PaymentID: rec.PaymentID}, nil
	}
	res, err := s.OnChargeSuccess(ctx, reference, reference)
	if errors.Is(err, ErrChargeNotSuccessful) || errors.Is(err, ErrVerifyUnavailable) {
		return &ConfirmResult{Reference: reference, Status: "pending"}, nil
	}
	return res, err
}

// OwnerCustomerID resolves which payer a checkout reference belongs to — see
// restaurant/paystackcheckout.Service.OwnerCustomerID's doc comment; same
// reasoning applies verbatim.
func (s *Service) OwnerCustomerID(ctx context.Context, reference string) (string, error) {
	rec, err := s.intents.GetByReference(ctx, reference)
	if err != nil {
		return "", ErrUnknownReference
	}
	return rec.PayerID, nil
}

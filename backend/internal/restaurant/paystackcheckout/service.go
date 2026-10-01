// Package paystackcheckout implements a Paystack-funded (card / bank-transfer)
// checkout path for restaurant food orders that never touches the customer's
// wallet and therefore never runs the KYC-tier daily-wallet-debit gate — the
// money is collected directly by Paystack, verified server-side, and escrowed
// via settlement.EscrowExternal (DR provider-clearing / CR escrow), not via a
// wallet debit.
// This is a DELIBERATELY narrow, audited alternative to an earlier, REJECTED
// design (FEATURE_CHECKOUT_TOPUP_TIER0 / ADR-042/043) that tried to let a
// Tier-0 customer top up their wallet with a card and immediately spend it —
// a ledger-auditor review found that design unsafe (see
// docs/audit/checkout-allowance-audit-findings.md) because a topped-up wallet
// balance persists and is spendable outside the checkout that funded it,
// defeating the whole point of the tier gate. This package never credits the
// wallet at all: the money is escrowed directly from an external clearing
// account straight into the specific order it paid for, and the ONLY way
// money comes back to the customer if something goes wrong is a real
// Paystack refund (RefundPayment) — never a wallet credit — precisely so the
// same hazard can't recur through a different door.
// Shape mirrors academy/fees/payment (Gateway/IntentStore interfaces, a thin
// intents table, VerifyPayment + exact-amount cross-check before any money
// moves, confirmation driven by the shared Paystack webhook pipeline). The
// two differences that matter:
//   - The "amount to charge" is not a client-supplied number: InitiateCheckout
//     calls restaurant.Service.QuoteOrder to compute it from the SAME pricing
//     logic PlaceOrder itself uses (see restaurant/service.go priceOrder).
//   - On any failure AFTER Paystack has collected the money (amount drifted,
//     the order could no longer be placed), the charge is REVERSED via
//     RefundPayment rather than credited anywhere internal — see OnChargeSuccess.
package paystackcheckout

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/restaurant"
)

// ReferencePrefix identifies a Paystack reference as belonging to this
// package (mirrors feespayment.FeesReferencePrefix's "feespay:" idiom). The
// shared webhook pipeline dispatches charge.success events carrying this
// prefix here instead of the wallet/VA path.
const ReferencePrefix = "foodorder:"

func referenceFor(idempotencyKey string) string { return ReferencePrefix + idempotencyKey }

// Gateway is the slice of the Paystack provider this adapter uses. The
// concrete *paystack.Client satisfies it as-is (structural typing) — no new
// provider integration, and no dependency on the broader
// provider.PaymentProvider interface (RefundPayment is deliberately NOT part
// of that interface; see provider.RefundResult's doc comment).
type Gateway interface {
	InitializePayment(ctx context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error)
	VerifyPayment(ctx context.Context, reference string) (*provider.PaymentStatus, error)
	// RefundPayment reverses a charge this package already collected but could
	// not turn into a placed order (amount drifted, or placement failed for
	// any other reason). This is the ONLY compensation path this package ever
	// uses — never a wallet credit (see the package doc comment for why).
	RefundPayment(ctx context.Context, reference string, amountKobo int64) (*provider.RefundResult, error)
}

// OrderPlacer is the slice of restaurant.Service this adapter uses.
type OrderPlacer interface {
	// QuoteOrder computes the exact price of a cart from current DB state —
	// used ONLY to decide the amount to ask Paystack for. Never trusted as the
	// final word: PlaceOrderPaystackFunded independently recomputes and
	// cross-checks it at confirmation time.
	QuoteOrder(ctx context.Context, restaurantID, customerID string, req restaurant.PlaceOrderRequest) (int64, error)
	// PlaceOrderPaystackFunded places the order funded by an already-verified
	// external charge of exactly verifiedAmountKobo. See its doc comment on
	// restaurant.Service for the invariants this package must uphold when
	// calling it (verification must have already happened; never reachable
	// from client-controlled input).
	PlaceOrderPaystackFunded(ctx context.Context, restaurantID, customerID string, req restaurant.PlaceOrderRequest, verifiedAmountKobo int64) (*restaurant.Order, error)
}

// IntentStore persists the thin pending-intent mapping over
// public.restaurant_order_paystack_intents. Lives in this package because its
// method set references the unexported intentRecord type.
type IntentStore interface {
	// PutIntent records a pending intent idempotently on idempotency_key. A
	// fresh insert returns (nil, true, nil); a replay (same key) returns the
	// EXISTING row (existing, false, nil) so a retried initiate reuses the
	// same reference/gateway session instead of quoting and charging twice.
	PutIntent(ctx context.Context, in intentRecord) (existing *intentRecord, inserted bool, err error)
	// GetByReference resolves a pending intent by gateway reference.
	GetByReference(ctx context.Context, reference string) (*intentRecord, error)
	// ClaimForProcessing atomically transitions a "pending" intent to
	// "processing" — the gate that lets exactly one concurrent
	// webhook/status-poll delivery run the side-effecting step (place the
	// order, or refund) for a given reference. claimed=false means another
	// delivery already owns it; the caller must treat that as a benign no-op,
	// never retry the side effect itself.
	ClaimForProcessing(ctx context.Context, reference string) (claimed bool, err error)
	// MarkStatus sets the intent's terminal (or "processing") status and,
	// when non-nil, the resulting order id / refund reference.
	MarkStatus(ctx context.Context, reference, status string, orderID, refundReference *string) error
	// GetByOrderID resolves the intent that placed orderID — used only by
	// RefundExternalSettlement, called from restaurant with an order id (not
	// a gateway reference).
	GetByOrderID(ctx context.Context, orderID string) (*intentRecord, error)
}

// SettlementReverser is the slice of settlement.Service this adapter needs to
// unwind the LEDGER side of a Paystack-funded order when refunding — see
// RefundExternalSettlement / restaurant.ExternalRefunder.
type SettlementReverser interface {
	RefundExternal(ctx context.Context, settlementID, reason string) error
}

// Service is the food-order Paystack-checkout adapter. It owns no money state
// itself — it orchestrates the gateway, the restaurant order placer, and the
// intent store, all injected (same composition-root shape as feespayment).
type Service struct {
	gateway    Gateway
	orders     OrderPlacer
	intents    IntentStore
	settlement SettlementReverser
}

func NewService(gateway Gateway, orders OrderPlacer, intents IntentStore, settlement SettlementReverser) *Service {
	return &Service{gateway: gateway, orders: orders, intents: intents, settlement: settlement}
}

// InitiateCheckout starts a Paystack checkout session for restaurantID's
// cart. It quotes the cart's exact price from CURRENT DB state (never trusts
// a client-supplied amount), freezes that quote plus the entire cart request
// against req.IdempotencyKey, and asks Paystack to collect exactly that
// amount. No money moves and no order exists yet — that only happens in
// OnChargeSuccess, after the charge is verified.
func (s *Service) InitiateCheckout(ctx context.Context, restaurantID, customerID string, req restaurant.PlaceOrderRequest, email, callbackURL string) (*CheckoutIntent, error) {
	if customerID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(restaurantID) == "" {
		return nil, ErrMissingRestaurant
	}
	if strings.TrimSpace(req.IdempotencyKey) == "" {
		return nil, ErrIdempotencyRequired
	}
	if len(req.Items) == 0 {
		return nil, ErrEmptyCart
	}

	reference := referenceFor(req.IdempotencyKey)

	// Quote FIRST: a pure read against current menu/promo/delivery-config
	// state (restaurant.Service.priceOrder — the SAME computation
	// PlaceOrderPaystackFunded itself re-runs at confirmation time). This
	// quote is what we ask Paystack to collect; it is never trusted as final —
	// see PlaceOrderPaystackFunded's cross-check.
	amountKobo, err := s.orders.QuoteOrder(ctx, restaurantID, customerID, req)
	if err != nil {
		return nil, err
	}

	reqJSON, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("paystackcheckout: encode cart: %w", err)
	}

	existing, inserted, err := s.intents.PutIntent(ctx, intentRecord{
		Reference:      reference,
		RestaurantID:   restaurantID,
		CustomerID:     customerID,
		RequestJSON:    reqJSON,
		AmountKobo:     amountKobo,
		IdempotencyKey: req.IdempotencyKey,
		Status:         "pending",
	})
	if err != nil {
		return nil, err
	}
	if !inserted && existing != nil {
		// Idempotent replay: reuse the FROZEN reference/amount from the first
		// attempt, not whatever this retry just quoted (menu/promo state may
		// have moved between the two calls — the first quote is the one
		// Paystack will be asked to collect either way).
		reference = existing.Reference
		amountKobo = existing.AmountKobo
	}

	resp, err := s.gateway.InitializePayment(ctx, provider.InitializePaymentRequest{
		Email:          email,
		AmountKobo:     amountKobo,
		Reference:      reference,
		CallbackURL:    callbackURL,
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		return nil, err
	}

	out := &CheckoutIntent{
		RestaurantID:     restaurantID,
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

// OnChargeSuccess is the confirmation entry point, driven by the shared
// Paystack webhook pipeline (webhooks.PaystackHandler, reference prefix
// ReferencePrefix) — see RegisterRestaurantPaystackCheckout's integration
// note. It is also called directly by CheckStatus as a self-heal read, since
// Paystack cannot webhook a localhost callback URL (see that method).
// Flow:
//  1. Resolve the pending intent (unknown reference / already-terminal status
//     ⇒ benign no-op, no re-processing).
//  2. VERIFY the charge via the gateway (fail-closed: not-success ⇒ no money
//     moves, intent stays pending for a genuine future success).
//  3. Claim the intent for processing (atomic pending→processing), so exactly
//     one delivery performs the side-effecting step below — a concurrent
//     redelivery that loses the race returns the winner's result instead of
//     double-refunding or double-placing.
//  4. Cross-check the verified amount against the frozen quote. A mismatch
//     (price/promo/availability drifted between quote and confirmation)
//     reverses the ENTIRE verified amount via Paystack refund — never a
//     wallet credit — and marks the intent amount_mismatch (or refunded, if
//     the refund itself succeeds).
//  5. Place the order via PlaceOrderPaystackFunded, funded by the verified
//     amount, using the EXACT frozen cart from intent creation. Any failure
//     here (restaurant closed, item no longer available, promo now invalid,
//     ITS OWN amount cross-check tripping on a between-check drift) is
//     handled the same way as an amount mismatch: refund, mark order_failed.
//  6. On success, mark the intent confirmed with the placed order's id.
func (s *Service) OnChargeSuccess(ctx context.Context, reference, gatewayRef string) (*ConfirmResult, error) {
	rec, err := s.intents.GetByReference(ctx, reference)
	if err != nil {
		return nil, ErrUnknownReference
	}
	if rec.Status != "pending" {
		return &ConfirmResult{Reference: reference, Status: rec.Status, OrderID: rec.OrderID}, nil
	}

	// Verification is a pure read against the gateway — safe to repeat on
	// every redelivery, so it runs BEFORE the atomic claim below (unlike the
	// side effects that follow, re-verifying has nothing to duplicate). An
	// error here (network/API failure, not "not successful") leaves the
	// intent pending so a genuine webhook retry can re-verify.
	status, err := s.gateway.VerifyPayment(ctx, reference)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrVerifyUnavailable, err)
	}
	if status == nil || strings.ToLower(status.Status) != "success" {
		return nil, ErrChargeNotSuccessful
	}

	// Every branch from here has a side effect that must run AT MOST ONCE
	// (refund, or place-order) — claim before touching either.
	claimed, err := s.intents.ClaimForProcessing(ctx, reference)
	if err != nil {
		return nil, err
	}
	if !claimed {
		if cur, cerr := s.intents.GetByReference(ctx, reference); cerr == nil && cur != nil {
			return &ConfirmResult{Reference: reference, Status: cur.Status, OrderID: cur.OrderID}, nil
		}
		return &ConfirmResult{Reference: reference, Status: "processing"}, nil
	}

	if status.AmountKobo != rec.AmountKobo {
		s.refundAndMark(ctx, rec, status.AmountKobo, "amount_mismatch")
		return nil, ErrAmountMismatch
	}

	req, err := rec.decodeRequest()
	if err != nil {
		s.refundAndMark(ctx, rec, status.AmountKobo, "order_failed")
		return nil, fmt.Errorf("paystackcheckout: decode frozen cart: %w", err)
	}

	order, err := s.orders.PlaceOrderPaystackFunded(ctx, rec.RestaurantID, rec.CustomerID, req, status.AmountKobo)
	if err != nil {
		// Paystack already collected real money for an order that did not end
		// up placed (restaurant closed since the quote, an item was 86'd, a
		// promo expired, or PlaceOrderPaystackFunded's OWN amount cross-check
		// caught a drift) — reverse it rather than keep it.
		s.refundAndMark(ctx, rec, status.AmountKobo, "order_failed")
		return nil, fmt.Errorf("paystackcheckout: place order: %w", err)
	}

	if merr := s.intents.MarkStatus(ctx, reference, "confirmed", &order.ID, nil); merr != nil {
		// The order is already correctly placed and paid for; failing to flip
		// the bookkeeping flag is a logged nuisance, not a money problem.
		log.Printf("[paystackcheckout] mark confirmed failed for %s (order=%s): %v", reference, order.ID, merr)
	}
	return &ConfirmResult{Reference: reference, Status: "confirmed", OrderID: &order.ID, AmountKobo: status.AmountKobo}, nil
}

// refundAndMark reverses the collected charge via Paystack and marks the
// intent's terminal status — "refunded" if the reversal itself succeeded,
// otherwise the ORIGINAL failure reason (failStatus), logged loudly: a failed
// refund needs manual reconciliation, and the intent must say so rather than
// silently claim money moved that never did.
func (s *Service) refundAndMark(ctx context.Context, rec *intentRecord, amountKobo int64, failStatus string) {
	finalStatus := failStatus
	var refundRef *string
	if res, rerr := s.gateway.RefundPayment(ctx, rec.Reference, amountKobo); rerr == nil {
		ref := res.Reference
		refundRef = &ref
		finalStatus = "refunded"
	} else {
		log.Printf("[paystackcheckout] REFUND FAILED for %s (amount=%d kobo, reason=%s): %v — needs manual reconciliation", rec.Reference, amountKobo, failStatus, rerr)
	}
	if merr := s.intents.MarkStatus(ctx, rec.Reference, finalStatus, nil, refundRef); merr != nil {
		log.Printf("[paystackcheckout] mark %s failed for %s: %v", finalStatus, rec.Reference, merr)
	}
}

// OwnerCustomerID resolves which customer a checkout reference belongs to, so
// an HTTP handler can enforce that only the customer who started a checkout
// may poll its status — CheckStatus itself has no caller identity to check
// (it is also invoked from the trusted server-side webhook path, which has
// none either), so this authorization check belongs at the HTTP layer, not
// in the service. Returns ErrUnknownReference for a reference this adapter
// has no record of, same as every other lookup here.
func (s *Service) OwnerCustomerID(ctx context.Context, reference string) (string, error) {
	rec, err := s.intents.GetByReference(ctx, reference)
	if err != nil {
		return "", ErrUnknownReference
	}
	return rec.CustomerID, nil
}

// CheckStatus resolves the current status of a checkout, self-healing a
// still-pending intent by running the exact confirmation path OnChargeSuccess
// uses. This exists because Paystack cannot deliver a webhook to a localhost
// callback URL (a standing gap in this codebase's dev environment — see the
// wallet-topup verify endpoint's own fallback) — without it, a pending intent
// in local dev would never confirm. In production this is a harmless,
// idempotent re-check: OnChargeSuccess only ever acts once per reference
// (ClaimForProcessing), so a client polling this endpoint after a webhook
// already confirmed just reads back the same terminal result.
func (s *Service) CheckStatus(ctx context.Context, reference string) (*ConfirmResult, error) {
	rec, err := s.intents.GetByReference(ctx, reference)
	if err != nil {
		return nil, ErrUnknownReference
	}
	if rec.Status != "pending" {
		return &ConfirmResult{Reference: reference, Status: rec.Status, OrderID: rec.OrderID}, nil
	}
	res, err := s.OnChargeSuccess(ctx, reference, reference)
	if errors.Is(err, ErrChargeNotSuccessful) || errors.Is(err, ErrVerifyUnavailable) {
		return &ConfirmResult{Reference: reference, Status: "pending"}, nil
	}
	return res, err
}

// RefundExternalSettlement implements restaurant.ExternalRefunder. It is the
// ONLY place restaurant's ordinary refund path (refundEscrowOnce, used by
// order cancellation and rejection) is allowed to reach for a Paystack-funded
// order — see that interface's doc comment on restaurant.Service for why
// settlement.Refund (a wallet credit) must never be used for these, and
// transport/paystackcheckout.Service.RefundExternalSettlement for the
// identical counterpart this mirrors. Does BOTH halves of a real refund: the
// actual Paystack reversal (customer-facing) and the internal ledger
// reversal (settlement.RefundExternal) — in that order, so a gateway failure
// never leaves the settlement wrongly marked refunded.
func (s *Service) RefundExternalSettlement(ctx context.Context, orderID, settlementID, reason string) error {
	rec, err := s.intents.GetByOrderID(ctx, orderID)
	if err != nil {
		return fmt.Errorf("paystackcheckout: no intent found for order %s: %w", orderID, err)
	}
	res, err := s.gateway.RefundPayment(ctx, rec.Reference, rec.AmountKobo)
	if err != nil {
		return fmt.Errorf("paystackcheckout: gateway refund for order %s: %w", orderID, err)
	}
	if err := s.settlement.RefundExternal(ctx, settlementID, reason); err != nil {
		return fmt.Errorf("paystackcheckout: ledger reversal for order %s: %w", orderID, err)
	}
	refundRef := res.Reference
	if merr := s.intents.MarkStatus(ctx, rec.Reference, "refunded", nil, &refundRef); merr != nil {
		log.Printf("[paystackcheckout] mark refunded failed for %s (order=%s): %v", rec.Reference, orderID, merr)
	}
	return nil
}

// intentRecord is the stored pending-intent row (public.restaurant_order_paystack_intents).
// Deliberately minimal plus one field academy's fees intent doesn't need: RequestJSON,
// the FROZEN PlaceOrderRequest, so confirmation can replay the exact cart the customer
// was quoted and charged for without trusting anything the webhook/verify caller supplies.
type intentRecord struct {
	Reference      string
	RestaurantID   string
	CustomerID     string
	RequestJSON    json.RawMessage
	AmountKobo     int64
	IdempotencyKey string
	Status         string
	OrderID        *string
}

// decodeRequest unmarshals the frozen cart back into the exact request type
// restaurant.Service expects.
func (r *intentRecord) decodeRequest() (restaurant.PlaceOrderRequest, error) {
	var req restaurant.PlaceOrderRequest
	err := json.Unmarshal(r.RequestJSON, &req)
	return req, err
}

// CheckoutIntent is the result of InitiateCheckout handed back to the client.
// No money has moved yet — AmountKobo is echoed for the client's own display
// only; it is NEVER trusted back from the client on confirmation.
type CheckoutIntent struct {
	RestaurantID     string `json:"restaurantId"`
	Reference        string `json:"reference"`
	AuthorizationURL string `json:"authorizationUrl"`
	AccessCode       string `json:"accessCode,omitempty"`
	AmountKobo       int64  `json:"amountKobo"`
}

// ConfirmResult is the outcome of OnChargeSuccess / CheckStatus.
type ConfirmResult struct {
	Reference  string  `json:"reference"`
	Status     string  `json:"status"` // pending | processing | confirmed | amount_mismatch | order_failed | refunded
	OrderID    *string `json:"orderId,omitempty"`
	AmountKobo int64   `json:"amountKobo,omitempty"`
}

var (
	ErrUnauthenticated     = errors.New("unauthenticated")
	ErrMissingRestaurant   = errors.New("missing_restaurant")
	ErrEmptyCart           = errors.New("empty_cart")
	ErrIdempotencyRequired = errors.New("idempotency_key_required")
	// ErrChargeNotSuccessful mirrors feespayment: never move money, place an
	// order, or refund for a charge the gateway does not report as successful.
	ErrChargeNotSuccessful = errors.New("charge_not_successful")
	// ErrVerifyUnavailable wraps a failure to REACH Paystack's verify
	// endpoint (network error, timeout, transient 5xx) — distinct from
	// ErrChargeNotSuccessful, which means Paystack was reached and explicitly
	// said the charge did not succeed. CheckStatus treats this the same as
	// "still pending" (keep polling) rather than a hard failure: the WebView
	// SDK's own onSuccess already told the client the card charge went
	// through, so a transient hiccup calling Paystack back MUST NOT surface
	// as a customer-facing "payment unavailable" — found 2026-09-25, a real
	// payment stuck oscillating between "processing" and "unavailable" on
	// every self-heal poll that happened to race a momentary verify failure.
	ErrVerifyUnavailable = errors.New("verify_unavailable")
	// ErrAmountMismatch is returned when the verified Paystack amount does not
	// equal the intent's frozen amount. The charge is refunded before this is
	// returned — see OnChargeSuccess.
	ErrAmountMismatch = errors.New("amount_mismatch")
	// ErrUnknownReference: confirmation/status arrived for a reference this
	// adapter never created an intent for. Benign no-op for callers.
	ErrUnknownReference = errors.New("unknown_reference")
)

// IntentRepository is the pgx-backed IntentStore over
// public.restaurant_order_paystack_intents. Lives in this package because
// IntentStore's method set references the unexported intentRecord type.
type IntentRepository struct{ db *pgxpool.Pool }

// NewIntentStore builds the pgx IntentStore. Wire it at the composition root.
func NewIntentStore(pool *pgxpool.Pool) *IntentRepository { return &IntentRepository{db: pool} }

const intentCols = `reference, restaurant_id, customer_id, request_json, amount_kobo, idempotency_key, status, order_id`

func scanIntent(row pgx.Row) (*intentRecord, error) {
	var r intentRecord
	if err := row.Scan(
		&r.Reference, &r.RestaurantID, &r.CustomerID, &r.RequestJSON,
		&r.AmountKobo, &r.IdempotencyKey, &r.Status, &r.OrderID,
	); err != nil {
		return nil, err
	}
	return &r, nil
}

// PutIntent records a pending intent idempotently on idempotency_key. On a
// fresh insert it returns (nil, true, nil). On a replay (same key) it returns
// the EXISTING row (existing, false, nil) so the caller reuses the same
// reference/gateway session.
func (s *IntentRepository) PutIntent(ctx context.Context, in intentRecord) (*intentRecord, bool, error) {
	const ins = `INSERT INTO public.restaurant_order_paystack_intents
	  (reference, restaurant_id, customer_id, request_json, amount_kobo, idempotency_key, status)
	  VALUES ($1,$2,$3,$4,$5,$6,'pending')
	  ON CONFLICT (idempotency_key) DO NOTHING
	  RETURNING ` + intentCols
	if _, err := scanIntent(s.db.QueryRow(ctx, ins,
		in.Reference, in.RestaurantID, in.CustomerID, in.RequestJSON,
		in.AmountKobo, in.IdempotencyKey,
	)); err == nil {
		return nil, true, nil // freshly inserted — no prior record
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	// Conflict on idempotency_key → return the existing row (replay).
	const sel = `SELECT ` + intentCols + ` FROM public.restaurant_order_paystack_intents WHERE idempotency_key = $1`
	existing, err := scanIntent(s.db.QueryRow(ctx, sel, in.IdempotencyKey))
	if err != nil {
		return nil, false, err
	}
	return existing, false, nil
}

// GetByReference resolves a pending intent by gateway reference. Not-found
// returns ErrUnknownReference so callers can treat it as a benign no-op.
func (s *IntentRepository) GetByReference(ctx context.Context, reference string) (*intentRecord, error) {
	const q = `SELECT ` + intentCols + ` FROM public.restaurant_order_paystack_intents WHERE reference = $1`
	rec, err := scanIntent(s.db.QueryRow(ctx, q, reference))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

// GetByOrderID resolves the intent that placed orderID. Used only by
// RefundExternalSettlement, called from restaurant with an order id (not a
// gateway reference) — see IntentStore's doc comment.
func (s *IntentRepository) GetByOrderID(ctx context.Context, orderID string) (*intentRecord, error) {
	const q = `SELECT ` + intentCols + ` FROM public.restaurant_order_paystack_intents WHERE order_id = $1`
	rec, err := scanIntent(s.db.QueryRow(ctx, q, orderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

// ClaimForProcessing atomically transitions "pending" → "processing" via a
// single conditional UPDATE, so two concurrent deliveries for the same
// reference (a redelivered webhook racing a status-poll self-heal, or two
// redelivered webhooks) can never both proceed to refund or place an order.
func (s *IntentRepository) ClaimForProcessing(ctx context.Context, reference string) (bool, error) {
	tag, err := s.db.Exec(ctx,
		`UPDATE public.restaurant_order_paystack_intents SET status = 'processing' WHERE reference = $1 AND status = 'pending'`,
		reference,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// MarkStatus sets the intent's terminal (or "processing") status and,
// when provided, the resulting order id / refund reference.
func (s *IntentRepository) MarkStatus(ctx context.Context, reference, status string, orderID, refundReference *string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE public.restaurant_order_paystack_intents
		 SET status = $2, order_id = COALESCE($3, order_id), refund_reference = COALESCE($4, refund_reference),
		     confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE confirmed_at END
		 WHERE reference = $1`,
		reference, status, orderID, refundReference,
	)
	return err
}

// Handler exposes the checkout-initiate + status-poll routes over Gin. The
// confirmation path (OnChargeSuccess) is NOT reached through either of these
// routes in production — it is driven by the shared Paystack webhook
// pipeline (see RegisterRestaurantPaystackCheckout's integration note).
// CheckStatus calls it too, but only as a self-heal read for environments
// Paystack cannot webhook (localhost) — see CheckStatus's doc comment.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string {
	if v := ginutil.UserID(c); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrMissingRestaurant):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_restaurant", "message": err.Error()})
	case errors.Is(err, ErrEmptyCart):
		c.JSON(http.StatusBadRequest, gin.H{"error": "empty_cart", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, ErrUnknownReference):
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_reference", "message": err.Error()})
	case errors.Is(err, ErrChargeNotSuccessful):
		c.JSON(http.StatusConflict, gin.H{"error": "charge_not_successful", "message": err.Error()})
	case errors.Is(err, ErrAmountMismatch):
		c.JSON(http.StatusConflict, gin.H{"error": "amount_mismatch", "message": err.Error()})
	case errors.Is(err, restaurant.ErrPromoInvalid):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "promo_invalid", "message": err.Error()})
	case errors.Is(err, restaurant.ErrInvalidModifierSelection):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_modifier_selection", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterRestaurantPaystackCheckout wires the two customer-facing routes
// onto the restaurant member group. The gateway / order-placer / intent-store
// collaborators are injected at the composition root so this package imports
// no vendor SDK.
//
//	restGroup: POST /:id/orders/paystack/initiate   start a checkout session (Idempotency-Key required)
//	           GET  /orders/paystack/:reference/status  poll + self-heal (see Service.CheckStatus)
//
// >>> INTEGRATION NOTE (confirmation) <<<
// There is no POST /orders/paystack/webhook route here. Service.OnChargeSuccess
// MUST be invoked from the EXISTING shared Paystack webhook pipeline
// (webhooks.PaystackHandler.handleChargeSuccess), not a new receiver — the
// integration task routes a charge.success whose reference carries the
// ReferencePrefix ("foodorder:") to svc.OnChargeSuccess(reference, gatewayRef).
// Signature verification is already done by that pipeline.
func RegisterRestaurantPaystackCheckout(restGroup *gin.RouterGroup, svc *Service) *Handler {
	h := NewHandler(svc)
	if restGroup != nil {
		restGroup.POST("/:id/orders/paystack/initiate", h.Initiate)
		restGroup.GET("/orders/paystack/:reference/status", h.Status)
	}
	return h
}

// initiateRequest bundles restaurant.PlaceOrderRequest with the gateway
// fields InitiateCheckout needs. Item-field normalization (item_id/qty vs
// menu_item_id/quantity) mirrors restaurant.Handler.PlaceOrder exactly, so
// the SAME cart shape reaches priceOrder either way it was paid for.
type initiateRequest struct {
	restaurant.PlaceOrderRequest

	Email       string `json:"email"`
	CallbackURL string `json:"callback_url"`
}

func (h *Handler) Initiate(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req initiateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	if hk := ginutil.IdempotencyKey(c); hk != "" {
		req.IdempotencyKey = hk
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": "Idempotency-Key is required"})
		return
	}
	for idx := range req.Items {
		req.Items[idx].MenuItemID = req.Items[idx].MenuItem()
		req.Items[idx].Quantity = req.Items[idx].QtyOf()
		if req.Items[idx].MenuItemID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": "each item requires an item_id"})
			return
		}
		if req.Items[idx].Quantity < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": "each item requires a quantity >= 1"})
			return
		}
	}

	out, err := h.svc.InitiateCheckout(c.Request.Context(), c.Param("id"), u, req.PlaceOrderRequest, req.Email, req.CallbackURL)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) Status(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	reference := c.Param("reference")
	// Ownership check: a reference is a bare Paystack transaction reference,
	// not a per-caller secret, so without this any authenticated user could
	// poll ANY other customer's checkout status/amount by reference.
	owner, err := h.svc.OwnerCustomerID(c.Request.Context(), reference)
	if err != nil {
		h.fail(c, err)
		return
	}
	if owner != u {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_reference"})
		return
	}
	out, err := h.svc.CheckStatus(c.Request.Context(), reference)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

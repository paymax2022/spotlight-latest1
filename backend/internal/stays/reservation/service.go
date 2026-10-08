package reservation

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/go-common/fsm"
	"spotlight/backend/go-common/strutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/stays/consent"
	"spotlight/backend/internal/stays/gateway"
	"spotlight/backend/internal/stays/pricing"
)

// Notifier emits guest/hotel notifications (confirm / auto-release). Tiny interface
// so the service does not import the notifications pkg.
type Notifier interface {
	Notify(ctx context.Context, userID, kind, message string)
}

// Auditor appends an immutable audit event. Tiny interface for the same reason.
type Auditor interface {
	Audit(ctx context.Context, userID, action string, detail map[string]any)
}

// Service owns the booking state machine + the prebook→hold→book→charge→release
// saga. It REUSES the finance settlement/ledger primitives (no new money
// primitives): HOLD = settlement.Escrow → AccountEscrow; CHARGE = settle split
// (commission → AccountCommission, net → AccountProviderClearing); RELEASE =
// settlement.Refund (reversing credit, no net debit). It performs object-level
// authZ (the guest owns the reservation).
type Service struct {
	repo       *Repository
	router     *gateway.Router
	pricing    *pricing.Engine
	consent    *consent.Service
	settlement *settlement.Service
	ledger     *ledger.Service
	notify     Notifier
	audit      Auditor

	// refund is the shared cancel-refund machinery (refund_ops.go) used by
	// guest Cancel, hotel cancel, and the supplier-webhook cancel sync.
	refund *RefundOps

	// directCommissionBps is the Rail-B commission split applied at settlement (the
	// pricing engine surfaces it on the breakdown; Settle posts it to AccountCommission).
	directCommissionBps int64

	// commission is the optional, nil-safe seam into the central Commission & Profit
	// registry. nil ⇒ realized-profit recording is a silent no-op (see
	// recordCommissionSafe). Injected post-construction by app-wiring.
	commission CommissionRecorder
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module. app-wiring injects a thin adapter over the finance commission service;
// when the commission feature is off (or no recorder is wired) the field is nil and
// recording is a silent no-op. Modeled as a LOCAL interface so reservation never
// imports the commission package at compile time (mirrors the Notifier / Auditor
// seams) — the adapter, which lives in app-wiring, discards the returned earning row
// and surfaces only the error.
// This records realized profit ONLY; it never moves money. Stays' own money
// movements (the settle split into commission/provider-clearing) are unchanged, and
// the injected recorder is deliberately constructed WITHOUT a ledger so RecordFor
// never re-posts to the ledger (no double count of the commission revenue account) —
// it appends the immutable earning row used by profit reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// Deps bundles the service dependencies.
type Deps struct {
	Repo                *Repository
	Router              *gateway.Router
	Pricing             *pricing.Engine
	Consent             *consent.Service
	Settlement          *settlement.Service
	Ledger              *ledger.Service
	Notifier            Notifier
	Auditor             Auditor
	DirectCommissionBps int64
}

// NewService constructs the reservation service.
func NewService(d Deps) *Service {
	return &Service{
		repo:                d.Repo,
		router:              d.Router,
		pricing:             d.Pricing,
		consent:             d.Consent,
		settlement:          d.Settlement,
		ledger:              d.Ledger,
		notify:              d.Notifier,
		audit:               d.Auditor,
		directCommissionBps: d.DirectCommissionBps,
		refund:              NewRefundOps(d.Repo, d.Ledger),
	}
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a confirmed stays
// booking. It is best-effort and MUST NEVER affect the caller's outcome: a nil
// recorder is a no-op, and any error is logged and swallowed so a profit-registry
// failure can never fail or reverse the booking / payout. The recorded breakdown is
// resolved server-side from the central rate card; the source ref (the reservation
// id) doubles as the idempotency key so retries and reconciliation sweeps never
// double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || grossKobo <= 0 {
		return
	}
	if err := s.commission.RecordFor(ctx, category, service, subtype, grossKobo,
		"stays", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[stays] commission record (source=%s gross=%d) failed, continuing: %v", sourceRef, grossKobo, err)
	}
}

// Sentinel errors surfaced to handlers (mapped to HTTP codes there).
var (
	ErrNotFound        = errors.New("reservation: not found")
	ErrForbidden       = errors.New("reservation: caller does not own this reservation")
	ErrConsentRequired = consent.ErrConsentRequired
	ErrBadState        = errors.New("reservation: illegal state transition")
	ErrPrebookFailed   = errors.New("reservation: prebook failed (price drift / sold out)")
	ErrInsufficient    = errors.New("reservation: insufficient funds")
)

// PrebookInput is the selected-offer input to Prebook.
type PrebookInput struct {
	Rail                gateway.SourceRail
	SupplierCode        string
	PropertyID          string
	RoomTypeID          string
	RatePlanID          string
	SupplierPropertyRef string
	SupplierRoomTypeRef string
	SupplierRatePlanRef string
	OfferToken          string
	CheckIn             time.Time
	CheckOut            time.Time
	Rooms               int
	Occupancy           map[string]any
	Currency            string
	LoyaltyTier         string
	PromoBps            int64
	PaymentMethod       gateway.PaymentMethod
}

// PrebookResult is what the client gets back after a successful prebook: a durable
// reservation in PREBOOK_OK with the re-validated, priced total + the book_token
// ref it must pass to Book.
type PrebookResult struct {
	Reservation *Reservation      `json:"reservation"`
	Breakdown   pricing.Breakdown `json:"breakdown"`
	BookToken   string            `json:"book_token"`
}

// Prebook runs the two-step gate: create the reservation (SEARCHING→OFFER_SELECTED),
// re-check live price+availability via the gateway, price the validated rate, and
// land in PREBOOK_OK with the short-lived book_token. Price drift / sold-out →
// PREBOOK_FAILED (the client re-quotes). NO money moves here.
func (s *Service) Prebook(ctx context.Context, userID string, in PrebookInput) (*PrebookResult, error) {
	gw, err := s.router.Resolve(ctx, in.Rail, in.SupplierCode)
	if err != nil {
		return nil, err
	}

	// (0) Create the reservation in SEARCHING then advance to OFFER_SELECTED. A
	// fresh idempotency_key is minted per prebook attempt; Book reuses the caller's.
	res, err := s.repo.Create(ctx, &Reservation{
		GuestUserID:    userID,
		PropertyID:     in.PropertyID,
		RoomTypeID:     in.RoomTypeID,
		RatePlanID:     in.RatePlanID,
		SourceRail:     in.Rail,
		SupplierCode:   in.SupplierCode,
		State:          StateSearching,
		CheckIn:        in.CheckIn,
		CheckOut:       in.CheckOut,
		Rooms:          maxInt(in.Rooms, 1),
		Occupancy:      orEmpty(in.Occupancy),
		Currency:       strutil.FirstNonEmpty(in.Currency, "NGN"),
		PaymentMethod:  orMethod(in.PaymentMethod, gateway.PaymentWallet),
		IdempotencyKey: "prebook:" + uuid.NewString(),
	})
	if err != nil {
		return nil, err
	}
	if err := s.transition(ctx, res, StateOfferSelected); err != nil {
		return nil, err
	}

	// (1) Re-check live price + availability and get the book_token.
	pre, err := gw.Prebook(ctx, gateway.PrebookRequest{
		Rail:                in.Rail,
		SupplierCode:        in.SupplierCode,
		SupplierPropertyRef: in.SupplierPropertyRef,
		SupplierRoomTypeRef: in.SupplierRoomTypeRef,
		SupplierRatePlanRef: in.SupplierRatePlanRef,
		OfferToken:          in.OfferToken,
		CheckIn:             in.CheckIn,
		CheckOut:            in.CheckOut,
		Rooms:               res.Rooms,
		Occupancy:           gateway.Occupancy{},
		Currency:            res.Currency,
	})
	if err != nil || pre.SoldOut || pre.BookToken == "" {
		_ = s.transition(ctx, res, StatePrebookFailed)
		s.auditSafe(ctx, userID, "stays.prebook_failed", map[string]any{"reservation_id": res.ID, "sold_out": pre.SoldOut})
		return nil, ErrPrebookFailed
	}

	// (2) Price the VALIDATED rate (markup/commission, taxes, FX — never silent).
	offer := gateway.PropertyOffer{
		Rail:         in.Rail,
		SupplierCode: in.SupplierCode,
		NetRateKobo:  pre.NetRateKobo,
		TaxKobo:      pre.TaxKobo,
		Currency:     pre.Currency,
	}
	bd, err := s.pricing.Price(offer, in.LoyaltyTier, in.PromoBps)
	if err != nil {
		// An FX failure is fail-closed: VOID the prebook rather than book at an
		// unknown price (FX-never-silent invariant).
		_ = s.transition(ctx, res, StatePrebookFailed)
		_ = s.transition(ctx, res, StateVoid)
		return nil, err
	}

	// Persist the validated price + policy snapshot + book_token on the reservation.
	commission := bps(pre.NetRateKobo, s.directCommissionBps)
	if in.Rail != gateway.RailDirect {
		commission = 0 // Rail A keeps markup, not a commission split
	}
	if err := s.repo.savePrebook(ctx, res.ID, PrebookSnapshot{
		GrossKobo:      bd.GrossKobo,
		TaxKobo:        bd.TaxKobo,
		NetRateKobo:    bd.NetRateKobo,
		MarkupKobo:     bd.MarkupKobo,
		CommissionKobo: commission,
		Policy:         pre.CancellationPolicy,
		BookToken:      pre.BookToken,
	}, res.Version); err != nil {
		return nil, err
	}
	// savePrebook bumped version on success — keep the in-memory copy in step or
	// the PREBOOK_OK transition below fails its own optimistic-lock check.
	res.Version++
	if err := s.transition(ctx, res, StatePrebookOK); err != nil {
		return nil, err
	}
	res, _ = s.repo.Get(ctx, res.ID)

	s.auditSafe(ctx, userID, "stays.prebook_ok", map[string]any{
		"reservation_id": res.ID, "gross_kobo": bd.GrossKobo, "rail": in.Rail,
	})
	return &PrebookResult{Reservation: res, Breakdown: bd, BookToken: pre.BookToken}, nil
}

// Book runs the hold→book→charge→release SAGA with MANDATORY auto-release. It is
// idempotent on the caller-supplied Idempotency-Key.
//  1. PREBOOK_OK → re-load reservation (object-level authZ; guest owns it).
//  2. NDPA consent gate (Book forwards guest PII to the supplier).
//  3. HOLD: settlement.Escrow(gross) → AccountEscrow (idempotency key). No charge
//     yet. PREBOOK_OK → PAYMENT_HELD → BOOKING.
//  4. gateway.Book(idempotency_key, book_token) — idempotent at the supplier.
//     - CONFIRMED: BOOKING → CONFIRMED; settle the escrow split (commission →
//     AccountCommission, net → AccountProviderClearing); persist supplier_ref +
//     voucher; audit; notify.
//     - BOOK_FAILED: BOOKING → BOOK_FAILED → settlement.Refund (RELEASE the hold,
//     reversing credit, NO net debit) → VOID. The guest is NEVER charged without
//     a confirmed room. This auto-release is the #1 invariant.
//
// idempotencyKey is the caller-supplied Idempotency-Key (REQUIRED on book); the same
// key threads the escrow + provider book + settle so the whole saga is replay-safe.
func (s *Service) Book(ctx context.Context, userID, reservationID, bookToken, idempotencyKey string, guest gateway.GuestInfo) (*Reservation, error) {
	if idempotencyKey == "" {
		return nil, errors.New("reservation: Idempotency-Key required for book")
	}
	// Idempotent replay: a prior book with this key returns the same reservation.
	if existing, err := s.repo.FindByIdempotencyKey(ctx, idempotencyKey); err == nil && existing != nil {
		if existing.GuestUserID != userID {
			return nil, ErrForbidden
		}
		return existing, nil
	}

	res, err := s.repo.Get(ctx, reservationID)
	if err != nil {
		return nil, err
	}
	if res.GuestUserID != userID {
		return nil, ErrForbidden // object-level authZ
	}
	if res.State != StatePrebookOK {
		return nil, fmt.Errorf("%w: book requires PREBOOK_OK, got %s", ErrBadState, res.State)
	}

	// NDPA gate — Book shares lead-guest PII with the supplier/hotel.
	consented, err := s.consent.HasCurrent(ctx, userID, consent.DefaultScope)
	if err != nil {
		return nil, err
	}
	if !consented {
		return nil, ErrConsentRequired
	}

	// Bind the caller idempotency key onto the reservation (the unique-key projection
	// the FindByIdempotencyKey replay reads on retry).
	if err := s.repo.setIdempotencyKey(ctx, res.ID, idempotencyKey, res.Version); err != nil {
		return nil, err
	}
	res.IdempotencyKey = idempotencyKey
	res.Version++

	// (3) HOLD — escrow the gross (no charge). Pay-at-property holds a guarantee
	// (deposit only); for brevity the full gross is held for prepay methods.
	holdKey := idempotencyKey + ":hold"
	sett, err := s.settlement.Escrow(ctx, userID, "stays:"+res.ID, holdKey, "stays", res.GrossAmountKobo)
	if err != nil {
		// Could not hold funds — PAYMENT_FAILED → VOID. Nothing booked, nothing to
		// release.
		_ = s.transition(ctx, res, StatePaymentFailed)
		_ = s.transition(ctx, res, StateVoid)
		s.auditSafe(ctx, userID, "stays.payment_failed", map[string]any{"reservation_id": res.ID, "err": err.Error()})
		return res, fmt.Errorf("%w: %w", ErrInsufficient, err)
	}
	_ = s.repo.RecordPaymentIntent(ctx, res.ID, string(res.PaymentMethod), "held", "stays:"+res.ID, holdKey, res.GrossAmountKobo)
	if err := s.transition(ctx, res, StatePaymentHeld); err != nil {
		return nil, err
	}
	if err := s.transition(ctx, res, StateBooking); err != nil {
		return nil, err
	}

	// (4) BOOK at the supplier (idempotent on idempotencyKey + book_token).
	gw, err := s.router.Resolve(ctx, res.SourceRail, res.SupplierCode)
	if err != nil {
		return s.autoRelease(ctx, res, sett.ID, err)
	}
	booked, bookErr := gw.Book(ctx, gateway.BookRequest{
		Rail:           res.SourceRail,
		SupplierCode:   res.SupplierCode,
		BookToken:      bookToken,
		IdempotencyKey: idempotencyKey,
		Guest:          guest,
		GuestRef:       "g:" + res.ID, // opaque ref, NOT the auth user id
		NetRateKobo:    res.NetRateKobo,
		Currency:       res.Currency,
	})
	if bookErr != nil || booked.Status != gateway.ResStatusConfirmed || booked.SupplierRef == "" {
		cause := bookErr
		if cause == nil {
			cause = fmt.Errorf("supplier returned status %q", booked.Status)
		}
		return s.autoRelease(ctx, res, sett.ID, cause)
	}

	// CONFIRMED: persist supplier_ref + voucher (UNIQUE(source_rail,supplier_ref)).
	if err := s.repo.SetConfirmed(ctx, res.ID, booked.SupplierRef, booked.VoucherRef, res.Version); err != nil {
		// The supplier book is idempotent; a reconciliation poller picks this up. Do
		// NOT auto-release — the room exists.
		log.Printf("[stays] WARN: book confirmed but persist failed for reservation %s: %v", res.ID, err)
		return nil, fmt.Errorf("reservation: confirm persisted partially: %w", err)
	}
	res.Version++

	// CHARGE — settle the escrow split: commission → AccountCommission (the only
	// revenue on a separate account), net → AccountProviderClearing pass-through.
	if err := s.settleConfirmed(ctx, res, sett.ID); err != nil {
		log.Printf("[stays] WARN: confirmed but settle failed for reservation %s: %v", res.ID, err)
		// Cover exists; reconciliation handles the settle break. Do not release.
	}
	_ = s.repo.RecordPaymentIntent(ctx, res.ID, string(res.PaymentMethod), "charged", "stays:settle:"+res.ID, idempotencyKey+":charge", res.GrossAmountKobo)

	// Revenue-realization point: record Spotlight profit in the central Commission
	// & Profit registry. Best-effort + idempotent (reservation id is the source ref
	// / idempotency key); a failure must never fail the booking — see
	// recordCommissionSafe. Central config: Property/Hotel = 10%.
	guestID := userID
	s.recordCommissionSafe(ctx, "Property", "Hotel", "", res.GrossAmountKobo, res.ID, &guestID)

	s.auditSafe(ctx, userID, "stays.book_confirmed", map[string]any{
		"reservation_id": res.ID, "supplier_ref": booked.SupplierRef, "gross_kobo": res.GrossAmountKobo,
	})
	s.notifySafe(ctx, userID, "stays.confirmed", "Your booking is confirmed.")
	return s.repo.Get(ctx, res.ID)
}

// settleConfirmed posts the CHARGE split. For Rail B the commission is the
// pre-computed split; for Rail A the markup is Paymax revenue and the net rate is
// owed to the supplier (provider-clearing). Both keep commission on a SEPARATE
// ledger account from the net-rate/hotel-payable.
//
// The provider counterparty is the AccountProviderClearing standing account,
// not a user wallet, so this settles via SettleToStandingAccounts. The platform
// leg is a fixed ServiceFeeKobo equal to the persisted commission/markup exactly
// (a float percentage could drift a kobo off it).
func (s *Service) settleConfirmed(ctx context.Context, res *Reservation, settlementID string) error {
	// commission portion (Rail A markup or Rail B commission) of the gross.
	revenueKobo := res.MarkupKobo
	if res.SourceRail == gateway.RailDirect {
		revenueKobo = res.CommissionKobo
	}
	if revenueKobo < 0 {
		revenueKobo = 0
	}
	if res.GrossAmountKobo <= 0 {
		return nil
	}
	split := settlement.Split{
		ProviderID:     "stays-clearing:" + res.SupplierCode, // annotation: net-rate remittance counterparty (standing account, not a user wallet)
		ProviderPct:    1.0,
		ServiceFeeKobo: revenueKobo,
	}
	if err := split.Validate(); err != nil {
		return err
	}
	return s.settlement.SettleToStandingAccounts(ctx, settlementID, split,
		ledger.AccountProviderClearing, ledger.AccountCommission)
}

// autoRelease executes the MANDATORY auto-release leg: BOOKING → BOOK_FAILED →
// settlement.Refund (RELEASE the hold, reversing credit back to the wallet, NO net
// debit) → VOID. The guest is NEVER left charged without a confirmed room.
func (s *Service) autoRelease(ctx context.Context, res *Reservation, settlementID string, cause error) (*Reservation, error) {
	_ = s.transition(ctx, res, StateBookFailed)

	if relErr := s.settlement.Refund(ctx, settlementID, "stays: book failed auto-release"); relErr != nil {
		// Release failed — the worst case. Leave BOOK_FAILED (NOT VOID) so the
		// reconciliation/release queue retries; alert loudly. Zero-tolerance gate.
		log.Printf("[stays] CRITICAL: auto-release FAILED for reservation %s — held, no room, no release: %v", res.ID, relErr)
		s.auditSafe(ctx, res.GuestUserID, "stays.auto_release_failed", map[string]any{
			"reservation_id": res.ID, "err": relErr.Error(),
		})
		return res, fmt.Errorf("reservation: book failed AND auto-release failed: book=%w release=%w", cause, relErr)
	}
	_ = s.repo.RecordPaymentIntent(ctx, res.ID, string(res.PaymentMethod), "released", "stays:release:"+res.ID, res.IdempotencyKey+":release", res.GrossAmountKobo)

	_ = s.transition(ctx, res, StateVoid)
	s.auditSafe(ctx, res.GuestUserID, "stays.book_failed_released", map[string]any{
		"reservation_id": res.ID, "gross_kobo": res.GrossAmountKobo, "cause": cause.Error(),
	})
	s.notifySafe(ctx, res.GuestUserID, "stays.released",
		"We couldn't confirm your room. Your held funds have been released to your wallet.")
	return res, fmt.Errorf("reservation: book failed, funds auto-released: %w", cause)
}

// transition applies a guarded optimistic-locked state change and refreshes res.
func (s *Service) transition(ctx context.Context, res *Reservation, to State) error {
	if !canTransition(res.State, to) {
		return fmt.Errorf("%w: %s → %s", ErrBadState, res.State, to)
	}
	if err := s.repo.SetState(ctx, res.ID, to, res.Version); err != nil {
		return err
	}
	res.State = to
	res.Version++
	return nil
}

// Get returns a reservation the caller owns.
func (s *Service) Get(ctx context.Context, userID, reservationID string) (*Reservation, error) {
	res, err := s.repo.Get(ctx, reservationID)
	if err != nil {
		return nil, err
	}
	if res.GuestUserID != userID {
		return nil, ErrForbidden
	}
	return res, nil
}

// List returns the caller's reservations.
func (s *Service) List(ctx context.Context, userID string, limit, offset int) ([]Reservation, error) {
	return s.repo.ListByUser(ctx, userID, limit, offset)
}

// Voucher returns the stored voucher ref for a CONFIRMED reservation the caller
// owns; the handler turns it into a signed URL.
func (s *Service) Voucher(ctx context.Context, userID, reservationID string) (string, error) {
	res, err := s.Get(ctx, userID, reservationID)
	if err != nil {
		return "", err
	}
	if res.VoucherRef == nil || *res.VoucherRef == "" {
		return "", errors.New("reservation: voucher not yet issued")
	}
	return *res.VoucherRef, nil
}

// Cancel cancels a CONFIRMED reservation the caller owns: supplier cancel → record
// the policy-allowed refund → reversing credit to the wallet → CANCELLED_BY_GUEST.
// Idempotent on the cancel key.
func (s *Service) Cancel(ctx context.Context, userID, reservationID, reason string) (*Reservation, error) {
	res, err := s.Get(ctx, userID, reservationID)
	if err != nil {
		return nil, err
	}
	// Serialize money draws per reservation — a concurrent Cancel/Modify pair
	// would otherwise both pass the CONFIRMED gate and double-draw the pooled
	// standing accounts. Re-read under the lock: the state may have moved.
	lockTx, lErr := s.repo.LockReservation(ctx, res.ID)
	if lErr != nil {
		return nil, fmt.Errorf("reservation: cancel lock: %w", lErr)
	}
	defer func() { _ = lockTx.Rollback(ctx) }()
	if res, err = s.repo.Get(ctx, res.ID); err != nil {
		return nil, err
	}
	if !canTransition(res.State, StateCancelledByGuest) {
		return nil, fmt.Errorf("%w: cannot cancel from %s", ErrBadState, res.State)
	}
	gw, rErr := s.router.Resolve(ctx, res.SourceRail, res.SupplierCode)
	if rErr != nil {
		return nil, rErr
	}
	supplierRef := ""
	if res.SupplierRef != nil {
		supplierRef = *res.SupplierRef
	}
	cancelKey := "stays:cancel:" + res.ID
	canc, cErr := gw.Cancel(ctx, gateway.CancelRequest{
		Rail:           res.SourceRail,
		SupplierCode:   res.SupplierCode,
		SupplierRef:    supplierRef,
		Reason:         reason,
		IdempotencyKey: cancelKey,
	})
	if cErr != nil {
		return nil, fmt.Errorf("reservation: supplier cancel: %w", cErr)
	}

	// Cancel queued payouts before refunding — the refund unwinds the parked
	// provider net, so a pending hotel payout must never release it.
	if _, pErr := s.repo.CancelPendingPayouts(ctx, res.ID); pErr != nil {
		return nil, fmt.Errorf("reservation: cancel pending payouts: %w", pErr)
	}

	// Refund per policy snapshot. Post-settle money sits in provider_clearing +
	// commission, so the refund draws those parked legs down — refunding pooled
	// escrow would pay the guest money still owed to the hotelier. Any leg
	// failure aborts before the terminal state so the cancel stays retryable.
	if canc.RefundKobo > 0 {
		if rErr := s.refund.postCancelRefund(ctx, res, canc.RefundKobo,
			"stays:refund:"+res.ID, cancelKey+":refund"); rErr != nil {
			s.auditSafe(ctx, userID, "stays.cancel_refund_failed", map[string]any{
				"reservation_id": res.ID, "refund_kobo": canc.RefundKobo, "err": rErr.Error(),
			})
			return nil, fmt.Errorf("reservation: cancel refund posting failed (retryable): %w", rErr)
		}
	}
	// Record the cancellation — refund_kobo is the ledger-truth total of the
	// booking's cancel-refund draws, which covers retried/partial legs better
	// than the supplier's policy number.
	draws, dErr := s.repo.CancelRefundDraws(ctx, res.ID)
	if dErr != nil {
		return nil, fmt.Errorf("reservation: cancel draws lookup for record: %w", dErr)
	}
	refunded := draws[string(ledger.AccountProviderClearing)] +
		draws[string(ledger.AccountCommission)] + draws[string(ledger.AccountEscrow)]
	if err := s.repo.RecordCancellation(ctx, res.ID, reason, refunded, canc.PenaltyKobo, res.CancellationPolicy, "stays:refund:"+res.ID); err != nil {
		return nil, fmt.Errorf("reservation: record cancellation: %w", err)
	}

	if err := s.transition(ctx, res, StateCancelledByGuest); err != nil {
		return nil, err
	}
	s.auditSafe(ctx, userID, "stays.cancelled", map[string]any{"reservation_id": res.ID, "refund_kobo": canc.RefundKobo, "reason": reason})
	s.notifySafe(ctx, userID, "stays.cancelled", "Your booking has been cancelled.")
	return s.repo.Get(ctx, res.ID)
}

// Modify re-prices the changed stay (new dates) and charges/refunds the price
// difference through the SAME finance primitives the Book path uses. The two-step
// gate still applies: a modify re-validates live availability + price BEFORE any
// money moves, and only mutates the reservation row AFTER the money movement
// succeeds. It is idempotent on the caller-supplied Idempotency-Key.
// Money legs (REUSE — no new ledger accounts):
//   - delta > 0 (CHARGE): settlement.Escrow(delta) → AccountEscrow with key
//     "stays:modify:charge:<id>:<key>:<delta>", then settleModifyDelta → each leg
//     posts its DELTA only (commission delta → AccountCommission, provider delta
//     → AccountProviderClearing); posting the whole recomputed share would
//     double-post the platform cut. Fail-closed: if the escrow debit fails,
//     nothing is mutated on the reservation.
//   - delta < 0 (REFUND): each parked leg unwinds by its own delta via
//     postModifyRefund — settled money is no longer in escrow, so an escrow
//     reversal would refund the guest out of the hotelier's pocket.
//   - delta == 0: no money movement.
//
// idempotencyKey is REQUIRED (the Idempotency-Key header). A retried modify with the
// same key returns the current reservation without re-charging (the payment-intent
// UNIQUE(idempotency_key) + ledger idempotency make the charge/refund replay-safe).
func (s *Service) Modify(ctx context.Context, userID, reservationID, idempotencyKey string, newCheckIn, newCheckOut time.Time) (*Reservation, error) {
	if idempotencyKey == "" {
		return nil, errors.New("reservation: Idempotency-Key required for modify")
	}
	res, err := s.Get(ctx, userID, reservationID)
	if err != nil {
		return nil, err
	}
	// Serialize money draws per reservation (see Cancel) and re-read under the lock.
	lockTx, lErr := s.repo.LockReservation(ctx, res.ID)
	if lErr != nil {
		return nil, fmt.Errorf("reservation: modify lock: %w", lErr)
	}
	defer func() { _ = lockTx.Rollback(ctx) }()
	if res, err = s.repo.Get(ctx, res.ID); err != nil {
		return nil, err
	}
	if res.State != StateConfirmed {
		return nil, fmt.Errorf("%w: modify requires CONFIRMED, got %s", ErrBadState, res.State)
	}
	if !newCheckOut.After(newCheckIn) {
		return nil, fmt.Errorf("%w: modify requires check_out after check_in", ErrBadState)
	}

	gw, rErr := s.router.Resolve(ctx, res.SourceRail, res.SupplierCode)
	if rErr != nil {
		return nil, rErr
	}

	// (1) Re-validate live availability + price for the NEW dates through the SAME
	// gateway.Prebook the Prebook path uses. Availability is respected here: an
	// unavailable new stay (SoldOut) fails WITHOUT any money movement. The reservation
	// persists the supplier property/room/rate refs as PropertyID/RoomTypeID/RatePlanID
	// (clients address direct offers that way).
	pre, pErr := gw.Prebook(ctx, gateway.PrebookRequest{
		Rail:                res.SourceRail,
		SupplierCode:        res.SupplierCode,
		SupplierPropertyRef: res.PropertyID,
		SupplierRoomTypeRef: res.RoomTypeID,
		SupplierRatePlanRef: res.RatePlanID,
		CheckIn:             newCheckIn,
		CheckOut:            newCheckOut,
		Rooms:               res.Rooms,
		Occupancy:           gateway.Occupancy{},
		Currency:            res.Currency,
	})
	if pErr != nil {
		return nil, fmt.Errorf("reservation: modify re-quote: %w", pErr)
	}
	if pre.SoldOut || pre.BookToken == "" {
		s.auditSafe(ctx, userID, "stays.modify_unavailable", map[string]any{"reservation_id": res.ID})
		return nil, fmt.Errorf("%w: new dates unavailable", ErrPrebookFailed)
	}

	// (2) Price the re-validated rate. A cross-currency re-price with no FX engine is
	// fail-closed here (never silent) — the pricing engine returns an explicit error.
	offer := gateway.PropertyOffer{
		Rail:         res.SourceRail,
		SupplierCode: res.SupplierCode,
		NetRateKobo:  pre.NetRateKobo,
		TaxKobo:      pre.TaxKobo,
		Currency:     pre.Currency,
	}
	bd, priceErr := s.pricing.Price(offer, "", 0)
	if priceErr != nil {
		return nil, fmt.Errorf("reservation: modify re-price: %w", priceErr)
	}

	newGross := bd.GrossKobo
	newCommission := bps(pre.NetRateKobo, s.directCommissionBps)
	if res.SourceRail != gateway.RailDirect {
		newCommission = 0 // Rail A keeps markup, not a commission split
	}
	// The platform share the re-priced booking should carry (Rail B commission,
	// Rail A markup — same columns settleConfirmed reads).
	newRevenueKobo := newCommission
	oldRevenueKobo := res.CommissionKobo
	if res.SourceRail != gateway.RailDirect {
		newRevenueKobo = bd.MarkupKobo
		oldRevenueKobo = res.MarkupKobo
	}
	delta := newGross - res.GrossAmountKobo

	// (3) Acknowledge the supplier-side modify (idempotent on the supplier ref).
	supplierRef := ""
	if res.SupplierRef != nil {
		supplierRef = *res.SupplierRef
	}
	if _, mErr := gw.Modify(ctx, gateway.ModifyRequest{
		Rail:           res.SourceRail,
		SupplierCode:   res.SupplierCode,
		SupplierRef:    supplierRef,
		NewCheckIn:     newCheckIn,
		NewCheckOut:    newCheckOut,
		IdempotencyKey: "stays:modify:" + res.ID,
	}); mErr != nil {
		return nil, fmt.Errorf("reservation: supplier modify: %w", mErr)
	}

	// (4) MONEY FIRST, then mutate the row. Money keys derive from the caller's
	// Idempotency-Key plus the computed delta, so a retried modify replays the
	// same legs while a retry whose re-quote moved derives fresh keys rather
	// than no-op'ing at the stale attempt-1 amount.
	switch {
	case delta > 0:
		// CHARGE the delta — HOLD then settle the split (same as Book's charge leg).
		chargeKey := fmt.Sprintf("stays:modify:charge:%s:%s:%d", res.ID, idempotencyKey, delta)
		sett, escErr := s.settlement.Escrow(ctx, userID, "stays:modify:"+res.ID, chargeKey, "stays", delta)
		if escErr != nil {
			// Fail-closed: no funds held → nothing mutated on the reservation.
			s.auditSafe(ctx, userID, "stays.modify_charge_failed", map[string]any{
				"reservation_id": res.ID, "delta_kobo": delta, "err": escErr.Error(),
			})
			return nil, fmt.Errorf("%w: modify charge: %w", ErrInsufficient, escErr)
		}
		if setErr := s.settleModifyDelta(ctx, res, sett.ID, newRevenueKobo, delta); setErr != nil {
			log.Printf("[stays] WARN: modify charge held but settle failed for reservation %s: %v", res.ID, setErr)
			// Cover exists (funds held); reconciliation completes the settle. Do not
			// unwind — the guest owes the delta and it is held.
		}
		if piErr := s.repo.RecordPaymentIntent(ctx, res.ID, string(res.PaymentMethod), "charged",
			"stays:modify:charge:"+res.ID, chargeKey, delta); piErr != nil {
			return nil, fmt.Errorf("reservation: modify charge intent record: %w", piErr)
		}

	case delta < 0:
		// REFUND abs(delta): each parked leg unwinds by its own delta, drawn from
		// provider_clearing/commission — not pooled escrow (settle drained it).
		refundKobo := -delta
		refundKey := fmt.Sprintf("stays:modify:refund:%s:%s:%d", res.ID, idempotencyKey, refundKobo)
		if pErr := s.refund.postModifyRefund(ctx, res, refundKobo, oldRevenueKobo, newRevenueKobo,
			"stays:modify:refund:"+res.ID, refundKey); pErr != nil {
			return nil, fmt.Errorf("reservation: modify refund (retryable): %w", pErr)
		}
		if piErr := s.repo.RecordPaymentIntent(ctx, res.ID, string(res.PaymentMethod), "refunded",
			"stays:modify:refund:"+res.ID, refundKey, refundKobo); piErr != nil {
			return nil, fmt.Errorf("reservation: modify refund intent record: %w", piErr)
		}
	}

	// (5) Persist the re-priced stay ONLY after the money movement succeeded.
	if err := s.repo.ApplyModify(ctx, res.ID, newCheckIn, newCheckOut, newGross, bd.TaxKobo,
		bd.NetRateKobo, bd.MarkupKobo, newCommission, res.Version); err != nil {
		// Money moved but the projection failed to persist — reconciliation picks this
		// up from the payment-intent. Surface the error; do not re-charge on retry (the
		// idempotency keys above make a retry a safe no-op).
		return nil, fmt.Errorf("reservation: modify persist: %w", err)
	}

	s.auditSafe(ctx, userID, "stays.modified", map[string]any{
		"reservation_id": res.ID, "old_gross_kobo": res.GrossAmountKobo,
		"new_gross_kobo": newGross, "delta_kobo": delta,
	})
	s.notifySafe(ctx, userID, "stays.modified", "Your booking dates have been updated.")
	return s.repo.Get(ctx, res.ID)
}

// settleModifyDelta settles a modify-charge escrow with the Book split shape,
// but each leg carries its DELTA only — the book-time settle already posted the
// old share. platform leg = max(0, newRevenue − oldRevenue); provider takes the
// remainder. A platform delta larger than the charged delta can't be expressed
// as non-negative legs — refuse rather than mis-split.
func (s *Service) settleModifyDelta(ctx context.Context, res *Reservation, settlementID string, newRevenueKobo, deltaKobo int64) error {
	if deltaKobo <= 0 {
		return nil
	}
	oldRevenueKobo := res.MarkupKobo
	if res.SourceRail == gateway.RailDirect {
		oldRevenueKobo = res.CommissionKobo
	}
	// Platform share shrank on a gross increase — provider takes the whole
	// delta (the shrink itself is unwound by the delta<0 refund path).
	revenueDelta := max(newRevenueKobo-oldRevenueKobo, 0)
	if revenueDelta > deltaKobo {
		return fmt.Errorf("reservation: modify delta split impossible — platform delta %d exceeds charged delta %d", revenueDelta, deltaKobo)
	}
	split := settlement.Split{
		ProviderID:     "stays-clearing:" + res.SupplierCode, // annotation only — see settleConfirmed
		ProviderPct:    1.0,
		ServiceFeeKobo: revenueDelta,
	}
	if err := split.Validate(); err != nil {
		return err
	}
	return s.settlement.SettleToStandingAccounts(ctx, settlementID, split,
		ledger.AccountProviderClearing, ledger.AccountCommission)
}

// SearchAdmin returns reservations across guests (admin; RBAC gated at the route).
func (s *Service) SearchAdmin(ctx context.Context, state, city string, limit, offset int) ([]Reservation, error) {
	return s.repo.SearchAdmin(ctx, state, city, limit, offset)
}

func (s *Service) auditSafe(ctx context.Context, userID, action string, detail map[string]any) {
	if s.audit != nil {
		s.audit.Audit(ctx, userID, action, detail)
	}
}

func (s *Service) notifySafe(ctx context.Context, userID, kind, message string) {
	if s.notify != nil {
		s.notify.Notify(ctx, userID, kind, message)
	}
}

func bps(amountKobo, b int64) int64 {
	if b <= 0 || amountKobo <= 0 {
		return 0
	}
	return (amountKobo*b + 5000) / 10000
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func orEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func orMethod(m, def gateway.PaymentMethod) gateway.PaymentMethod {
	if m == "" {
		return def
	}
	return m
}

// agent_support.go — repository helpers for the agent-assisted booking channel
// (internal/stays/agent). These are ADDITIVE to the reservation repository: the
// core self-service saga never touches the agent_* columns, and the agent channel
// reuses the SAME Book saga then tags the row here. No new money primitive.

// AgentReservationTag is the walk-in-customer + booking-agent metadata written onto
// a reservation booked through the agent channel.
type AgentReservationTag struct {
	AgentUserID     string
	CustomerName    string
	CustomerContact string
}

// TagAgentBooking stamps the agent_user_id + walk-in customer contact onto a
// reservation the agent booked. Called AFTER the standard Book saga confirms; it
// only annotates provenance and does NOT move money or change state. Idempotent:
// re-tagging with the same agent is a no-op-safe UPDATE.
func (r *Repository) TagAgentBooking(ctx context.Context, reservationID string, tag AgentReservationTag) error {
	_, err := r.db.Exec(ctx, `
		UPDATE public.stays_reservation
		SET agent_user_id = $2, customer_name = $3, customer_contact = $4, updated_at = now()
		WHERE id = $1`,
		reservationID, tag.AgentUserID, tag.CustomerName, tag.CustomerContact)
	if err != nil {
		return fmt.Errorf("reservation: tag agent booking: %w", err)
	}
	return nil
}

// ListByAgent returns reservations this agent booked, newest-first.
func (r *Repository) ListByAgent(ctx context.Context, agentUserID string, limit, offset int) ([]Reservation, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+resCols+` FROM public.stays_reservation
		WHERE agent_user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, agentUserID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reservation
	for rows.Next() {
		res, err := scanReservation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *res)
	}
	return out, rows.Err()
}

// AgentCommissionTotals is the aggregate commission an agent has earned across
// booked+settled reservations (CONFIRMED or terminally-completed, not released/void).
type AgentCommissionTotals struct {
	BookingsCount  int   `json:"bookings_count"`
	GrossSalesKobo int64 `json:"gross_sales_kobo"`
	CommissionKobo int64 `json:"commission_kobo"`
}

// SumAgentCommission sums the agent's commission over reservations that actually
// booked+settled (states where the escrow split posted the commission). Released /
// void / failed bookings contribute nothing (their commission never settled).
func (r *Repository) SumAgentCommission(ctx context.Context, agentUserID string) (AgentCommissionTotals, error) {
	var t AgentCommissionTotals
	// commission_kobo is the pre-computed DirectCommission split persisted at
	// prebook; only booked-and-settled states have posted it to AccountCommission.
	row := r.db.QueryRow(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(gross_amount_kobo), 0),
		       COALESCE(SUM(commission_kobo), 0)
		FROM public.stays_reservation
		WHERE agent_user_id = $1
		  AND state IN ('CONFIRMED','COMPLETED')`, agentUserID)
	if err := row.Scan(&t.BookingsCount, &t.GrossSalesKobo, &t.CommissionKobo); err != nil {
		return AgentCommissionTotals{}, err
	}
	return t, nil
}

// Reusable R2 presigner for stays booking vouchers (voucher_signer.go). Turns a
// stored voucher object ref into a short-lived presigned GET URL via the shared
// platform/r2 SigV4 presigner — R2 credentials are SERVER-SIDE ONLY, the client
// only ever sees the minted URL. Fail-closed: absent R2 env yields a clear
// "voucher storage not configured" error, never a broken/unsigned URL or raw ref.

// voucherPresignTTL bounds how long an issued voucher download URL is valid.
const voucherPresignTTL = 15 * time.Minute

// ErrVoucherStorageNotConfigured is returned by the signer when R2 creds are
// incomplete (fail-closed; never a fabricated URL).
var ErrVoucherStorageNotConfigured = errors.New("reservation: voucher storage not configured")

// NewR2VoucherSigner builds the voucher presigner from the R2 env vars
// (R2_ACCOUNT_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_REGION). It NEVER returns a nil signer + nil error: unconfigured R2 yields
// a func that returns ErrVoucherStorageNotConfigured, so wiring can be
// unconditional and the route fails closed. The error return is reserved for
// future hard-validation (always nil today).
func NewR2VoucherSigner() (func(ref string) (string, error), error) {
	presigner := r2.New(r2.Config{
		AccountEndpoint: os.Getenv("R2_ACCOUNT_ENDPOINT"),
		Bucket:          os.Getenv("R2_BUCKET"),
		AccessKeyID:     os.Getenv("R2_ACCESS_KEY_ID"),
		SecretAccessKey: os.Getenv("R2_SECRET_ACCESS_KEY"),
		Region:          os.Getenv("R2_REGION"),
	})
	return newVoucherSignerFromPresigner(presigner), nil
}

// NewR2VoucherSignerFromConfig is the config-injected variant used by the
// orchestrator, which already loads the R2 settings onto its Config struct (it
// does not re-read os.Getenv per module). Both variants produce the identical
// fail-closed signer.
func NewR2VoucherSignerFromConfig(accountEndpoint, bucket, accessKeyID, secretAccessKey, region string) func(ref string) (string, error) {
	return newVoucherSignerFromPresigner(r2.New(r2.Config{
		AccountEndpoint: accountEndpoint,
		Bucket:          bucket,
		AccessKeyID:     accessKeyID,
		SecretAccessKey: secretAccessKey,
		Region:          region,
	}))
}

// newVoucherSignerFromPresigner wraps a platform/r2 Presigner into the
// reservation signRef shape. It treats the stored ref as the R2 object key.
//   - If R2 is unconfigured → ErrVoucherStorageNotConfigured (fail-closed).
//   - If the stored ref is already an absolute URL (http/https) → returned
//     unchanged; some legacy/mock vouchers persist a full URL rather than a bare
//     object key, and re-signing an absolute URL would corrupt it.
//   - Otherwise → a presigned GET URL valid for voucherPresignTTL.
func newVoucherSignerFromPresigner(p *r2.Presigner) func(ref string) (string, error) {
	return func(ref string) (string, error) {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			return "", ErrVoucherStorageNotConfigured
		}
		// Legacy/mock full-URL vouchers are passed through unchanged.
		if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
			return ref, nil
		}
		if !p.Configured() {
			return "", ErrVoucherStorageNotConfigured
		}
		// The stored ref is the object key (server-controlled at book time).
		key := strings.TrimPrefix(ref, "/")
		url, err := p.PresignGet(key, voucherPresignTTL)
		if err != nil {
			// Never leak a broken/unsigned URL — surface the failure.
			return "", ErrVoucherStorageNotConfigured
		}
		return url, nil
	}
}

// State is the guarded booking lifecycle state (PRD §11). Transitions are enforced
// by canTransition; the saga drives them in one direction with optimistic locking.
type State string

const (
	StateSearching     State = "SEARCHING"
	StateOfferSelected State = "OFFER_SELECTED"
	StatePrebookOK     State = "PREBOOK_OK"
	StatePaymentHeld   State = "PAYMENT_HELD"
	StateBooking       State = "BOOKING"
	StateConfirmed     State = "CONFIRMED"
	StateCompleted     State = "COMPLETED"

	StateCancelledByGuest State = "CANCELLED_BY_GUEST"
	StateCancelledByHotel State = "CANCELLED_BY_HOTEL"
	StateNoShow           State = "NO_SHOW"

	StateBookFailed    State = "BOOK_FAILED"    // → release hold (no debit) → VOID
	StatePaymentFailed State = "PAYMENT_FAILED" // → VOID
	StatePrebookFailed State = "PREBOOK_FAILED" // price drift / sold out → re-quote | VOID
	StateVoid          State = "VOID"
)

// transitions encodes the legal forward edges of the state machine. Any edge not
// listed is rejected (fail-closed) by canTransition.
var transitions = fsm.Table[State]{
	StateSearching:     {StateOfferSelected: true, StateVoid: true},
	StateOfferSelected: {StatePrebookOK: true, StatePrebookFailed: true, StateVoid: true},
	StatePrebookOK:     {StatePaymentHeld: true, StatePaymentFailed: true, StateVoid: true},
	StatePaymentHeld:   {StateBooking: true, StatePaymentFailed: true},
	StateBooking:       {StateConfirmed: true, StateBookFailed: true},
	StateConfirmed: {
		StateCompleted:        true,
		StateCancelledByGuest: true,
		StateCancelledByHotel: true,
		StateNoShow:           true,
	},
	StateCompleted: {}, // terminal (REVIEWABLE is a derived view, not a state)

	StatePrebookFailed: {StateOfferSelected: true, StateVoid: true}, // re-quote | VOID
	StatePaymentFailed: {StateVoid: true},
	StateBookFailed:    {StateVoid: true},
}

// canTransition returns true if from→to is a legal edge.
func canTransition(from, to State) bool {
	return transitions.Can(from, to)
}

// InboundSources returns the states the stays FSM admits as sources of an
// inbound transition to target — used by the supplier-webhook sync so a stale
// or replayed event can't resurrect a terminal state (empty set = consumed no-op).
func InboundSources(target State) []string {
	out := []string{}
	for from := range transitions {
		if transitions.Can(from, target) {
			out = append(out, string(from))
		}
	}
	return out
}

// IsTerminal reports whether a state has no outbound saga transitions.
func (s State) IsTerminal() bool {
	return transitions.IsTerminal(s)
}

// Reservation is the durable booking projection. Money columns are kobo (minor
// units); state is the guarded lifecycle; version is the optimistic lock.
type Reservation struct {
	ID                 string                `json:"id"`
	GuestUserID        string                `json:"guest_user_id"`
	PropertyID         string                `json:"property_id"`
	RoomTypeID         string                `json:"room_type_id"`
	RatePlanID         string                `json:"rate_plan_id"`
	SourceRail         gateway.SourceRail    `json:"source_rail"`
	SupplierCode       string                `json:"supplier_code"`
	SupplierRef        *string               `json:"supplier_ref"` // NULL until confirmed
	State              State                 `json:"state"`
	CheckIn            time.Time             `json:"check_in"`
	CheckOut           time.Time             `json:"check_out"`
	Rooms              int                   `json:"rooms"`
	Occupancy          map[string]any        `json:"occupancy"`
	Currency           string                `json:"currency"`
	GrossAmountKobo    int64                 `json:"gross_amount_kobo"`
	TaxAmountKobo      int64                 `json:"tax_amount_kobo"`
	NetRateKobo        int64                 `json:"net_rate_kobo"`
	MarkupKobo         int64                 `json:"markup_kobo"`
	CommissionKobo     int64                 `json:"commission_kobo"`
	PaymentMethod      gateway.PaymentMethod `json:"payment_method"`
	CancellationPolicy map[string]any        `json:"cancellation_policy_snapshot"`
	IdempotencyKey     string                `json:"idempotency_key"`
	BookTokenRef       *string               `json:"book_token_ref"`
	VoucherRef         *string               `json:"voucher_ref"`
	CreatedAt          time.Time             `json:"created_at"`
	UpdatedAt          time.Time             `json:"updated_at"`
	Version            int                   `json:"version"`
}

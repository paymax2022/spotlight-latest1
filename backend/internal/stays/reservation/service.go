package reservation

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
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
//
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
		Currency:       orStr(in.Currency, "NGN"),
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
//
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
		return nil, fmt.Errorf("reservation: Idempotency-Key required for book")
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
		return res, fmt.Errorf("%w: %v", ErrInsufficient, err)
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

	// Record realized Spotlight profit into the central Commission & Profit registry.
	// This is the stays revenue-realization point (the CONFIRMED booking whose escrow
	// split just posted the platform cut to the ledger). Best-effort + idempotent: the
	// reservation id doubles as source ref + idempotency key, so replays / reconciliation
	// re-drives never double-count. gross = the full booking value the guest is charged
	// (res.GrossAmountKobo) — the same basis stays' own commission split is computed on.
	// A recorder failure is logged and swallowed — it must NEVER fail the booking or the
	// payout above (stays' own settle already posted the commission to the ledger; this
	// appends the immutable earning row only). Central config: Property/Hotel = 10%.
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
	platformPct := float64(revenueKobo) / float64(res.GrossAmountKobo)
	split := settlement.Split{
		ProviderID:  "stays-clearing:" + res.SupplierCode, // net-rate remittance counterparty
		ProviderPct: 1.0 - platformPct,
		PlatformPct: platformPct,
	}
	if err := split.Validate(); err != nil {
		return err
	}
	return s.settlement.Settle(ctx, settlementID, split)
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
		return res, fmt.Errorf("reservation: book failed AND auto-release failed: book=%v release=%v", cause, relErr)
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

// --- queries + lifecycle ops (object-level authZ) ---

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
		return "", fmt.Errorf("reservation: voucher not yet issued")
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

	// Refund per policy snapshot = reversing credit (escrow → user wallet).
	if canc.RefundKobo > 0 {
		userWallet, wErr := s.ledger.GetOrCreateUserWallet(ctx, userID)
		escrowAcc, eErr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
		if wErr == nil && eErr == nil {
			if pErr := s.ledger.PostReversal(ctx, userWallet.ID, escrowAcc.ID, canc.RefundKobo,
				"stays:refund:"+res.ID, cancelKey+":refund"); pErr != nil && !errors.Is(pErr, ledger.ErrDuplicate) {
				log.Printf("[stays] WARN: refund posting failed for reservation %s: %v", res.ID, pErr)
			}
		}
	}
	_ = s.repo.RecordCancellation(ctx, res.ID, reason, canc.RefundKobo, canc.PenaltyKobo, res.CancellationPolicy, "stays:refund:"+res.ID)

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
//
// Money legs (REUSE — no new ledger accounts):
//   - delta > 0 (CHARGE): settlement.Escrow(delta) → AccountEscrow with key
//     "stays:modify:charge:<id>:<seq>", then settleConfirmed → the same split the
//     Book path posts (commission → AccountPaymaxRevenue, net → provider clearing
//     wallet). Fail-closed: if the escrow debit fails (insufficient funds / limit),
//     NOTHING is mutated on the reservation.
//   - delta < 0 (REFUND): settlement/ledger reversing credit escrow → user wallet
//     for abs(delta) via ledger.PostReversal — the exact primitive Cancel uses for
//     a partial refund. NO net debit.
//   - delta == 0: no money movement.
//
// idempotencyKey is REQUIRED (the Idempotency-Key header). A retried modify with the
// same key returns the current reservation without re-charging (the payment-intent
// UNIQUE(idempotency_key) + ledger idempotency make the charge/refund replay-safe).
func (s *Service) Modify(ctx context.Context, userID, reservationID, idempotencyKey string, newCheckIn, newCheckOut time.Time) (*Reservation, error) {
	if idempotencyKey == "" {
		return nil, fmt.Errorf("reservation: Idempotency-Key required for modify")
	}
	res, err := s.Get(ctx, userID, reservationID)
	if err != nil {
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

	// (4) MONEY FIRST, then mutate the row. A stable per-modify sequence keys the
	// idempotency so a retried modify never double-charges/refunds.
	seq, seqErr := s.repo.NextModifySeq(ctx, res.ID)
	if seqErr != nil {
		return nil, fmt.Errorf("reservation: modify seq: %w", seqErr)
	}

	switch {
	case delta > 0:
		// CHARGE the delta — HOLD then settle the split (same as Book's charge leg).
		chargeKey := fmt.Sprintf("stays:modify:charge:%s:%d", res.ID, seq)
		sett, escErr := s.settlement.Escrow(ctx, userID, "stays:modify:"+res.ID, chargeKey, "stays", delta)
		if escErr != nil {
			// Fail-closed: no funds held → nothing mutated on the reservation.
			s.auditSafe(ctx, userID, "stays.modify_charge_failed", map[string]any{
				"reservation_id": res.ID, "delta_kobo": delta, "err": escErr.Error(),
			})
			return nil, fmt.Errorf("%w: modify charge: %v", ErrInsufficient, escErr)
		}
		if setErr := s.settleModifyDelta(ctx, res, sett.ID, newCommission, delta); setErr != nil {
			log.Printf("[stays] WARN: modify charge held but settle failed for reservation %s: %v", res.ID, setErr)
			// Cover exists (funds held); reconciliation completes the settle. Do not
			// unwind — the guest owes the delta and it is held.
		}
		_ = s.repo.RecordPaymentIntent(ctx, res.ID, string(res.PaymentMethod), "charged",
			"stays:modify:charge:"+res.ID, chargeKey, delta)

	case delta < 0:
		// REFUND abs(delta) — reversing credit escrow → user wallet (same primitive as
		// Cancel's partial refund). NO net debit.
		refundKobo := -delta
		refundKey := fmt.Sprintf("stays:modify:refund:%s:%d", res.ID, seq)
		userWallet, wErr := s.ledger.GetOrCreateUserWallet(ctx, userID)
		escrowAcc, eErr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
		if wErr != nil || eErr != nil {
			return nil, fmt.Errorf("reservation: modify refund accounts: %v/%v", wErr, eErr)
		}
		if pErr := s.ledger.PostReversal(ctx, userWallet.ID, escrowAcc.ID, refundKobo,
			"stays:modify:refund:"+res.ID, refundKey); pErr != nil && !errors.Is(pErr, ledger.ErrDuplicate) {
			return nil, fmt.Errorf("reservation: modify refund: %w", pErr)
		}
		_ = s.repo.RecordPaymentIntent(ctx, res.ID, string(res.PaymentMethod), "refunded",
			"stays:modify:refund:"+res.ID, refundKey, refundKobo)
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

// settleModifyDelta settles a modify-charge escrow using the same split shape as the
// Book path: the commission portion of the delta is Paymax revenue and the remainder
// is the net owed to the supplier (provider clearing). Reuses settlement.Settle — no
// new ledger accounts.
func (s *Service) settleModifyDelta(ctx context.Context, res *Reservation, settlementID string, commissionKobo, deltaKobo int64) error {
	revenueKobo := commissionKobo
	if res.SourceRail == gateway.RailBedbank {
		revenueKobo = 0 // Rail A markup is baked into the delta gross; keep parity with Book
	}
	if revenueKobo < 0 {
		revenueKobo = 0
	}
	if deltaKobo <= 0 {
		return nil
	}
	platformPct := float64(revenueKobo) / float64(deltaKobo)
	split := settlement.Split{
		ProviderID:  "stays-clearing:" + res.SupplierCode,
		ProviderPct: 1.0 - platformPct,
		PlatformPct: platformPct,
	}
	if err := split.Validate(); err != nil {
		return err
	}
	return s.settlement.Settle(ctx, settlementID, split)
}

// --- admin ---

// SearchAdmin returns reservations across guests (admin; RBAC gated at the route).
func (s *Service) SearchAdmin(ctx context.Context, state, city string, limit, offset int) ([]Reservation, error) {
	return s.repo.SearchAdmin(ctx, state, city, limit, offset)
}

// --- safe side-effects (never fail the saga) ---

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

// --- small helpers ---

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

func orStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
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

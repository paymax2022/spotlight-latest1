package top5events

// Paystack card / bank-transfer checkout for ticket orders (EVTB-D013).
//
// Shape follows the Food card rail (restaurant/paystackcheckout) and the
// Mobility card-direct engine's hardening (stale-claim takeover, fenced
// writes, currency check, reconciler), adapted to the one thing tickets have
// that a food order does not: finite inventory that must be HELD while the
// customer is on the Paystack page.
//
//	initiate  — one tx under the SAME tier FOR UPDATE lock as the wallet path
//	            (reserveSeatTx): N PENDING card orders (the hold, sold += N) +
//	            the intent row with the frozen amount and hold expiry. Then
//	            Paystack is initialised for exactly that server-computed amount
//	            under reference "evtorder-<Idempotency-Key>".
//	settle    — ONLY after a server-side VerifyPayment (driven by the signed
//	            shared webhook, the owner's status poll, or the sweep — never by
//	            the client redirect). Amount AND currency must equal the frozen
//	            order before anything moves. The intent is claimed
//	            (pending → processing, fenced) so exactly one worker settles;
//	            per order: DR provider_clearing / CR escrow (idempotent journal,
//	            the same escrow standing account wallet.Debit pays into), PENDING
//	            → PAID, then the shared finalizePurchase issues the ticket
//	            (uq_event_tickets_order ⇒ exactly once).
//	refuse    — amount/currency mismatch, a charge landing after the hold was
//	            released, or a cancelled event: the hold is released and the
//	            WHOLE collected amount is refunded at Paystack (never credited to
//	            a wallet, so the card rail can never mint spendable balance).
//	sweep     — ReconcileCardCheckouts: settles paid charges whose webhook never
//	            came, takes over stale 'processing' claims (process died after
//	            claim — the Food D-005 stranding), releases expired unpaid holds
//	            (verified unpaid first), and finishes refunds whose gateway call
//	            failed (lookup first, so a refund is never issued twice).
//
// No wallet is debited on this rail, so the wallet daily-debit tier gate does
// not apply (same contract as every card-direct rail — the money never sits in
// a Paymax balance). The per-checkout cap is MaxTicketsPerOrder.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/provider"
)

// CardReferencePrefix is the Paystack reference prefix of a ticket card
// checkout. The shared Paystack webhook routes charge.success events carrying
// it to CardWebhookConfirmer (webhooks.RegisterPrefixConfirmer). "-" not ":" —
// Paystack rejects ":" in a transaction reference.
const CardReferencePrefix = "evtorder-"

// cardCurrency is the only currency a ticket charge may settle in.
const cardCurrency = "NGN"

// Card intent statuses (event_card_intents.status).
const (
	CardStatusPending    = "pending"    // hold active, awaiting a verified charge
	CardStatusProcessing = "processing" // claimed by one settler (fenced; stale ⇒ reclaimable)
	CardStatusConfirmed  = "confirmed"  // orders PAID, escrow posted, tickets issued
	CardStatusExpired    = "expired"    // hold released, no charge
	CardStatusRefunding  = "refunding"  // charge cannot be honoured; gateway refund owed / in flight
	CardStatusRefunded   = "refunded"   // gateway accepted the refund
)

// ticket_orders.status values the card settle path asserts on.
const (
	orderStatusPending = "PENDING"
	orderStatusPaid    = "PAID"
)

const (
	keyKobo     = "kobo"
	keyQuantity = "quantity"
)

// cardKeyRE bounds what may become part of a Paystack reference and the
// /transaction/verify/<reference> path (Paystack: alphanumerics and - . =).
var cardKeyRE = regexp.MustCompile(`^[A-Za-z0-9._=-]{8,100}$`)

// gatewayInProgress are verify statuses meaning "the customer may still be
// paying" (bank transfer in flight) — an expired hold is kept a while longer.
var gatewayInProgress = []string{"ongoing", CardStatusPending, CardStatusProcessing, "queued"}

// inProgressHoldGrace bounds how long past expiry a hold is kept while the
// gateway still reports the charge in progress.
const inProgressHoldGrace = 24 * time.Hour

// CardGateway is the slice of the Paystack client this rail uses; the concrete
// *paystack.Client satisfies it as-is.
type CardGateway interface {
	InitializePayment(ctx context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error)
	VerifyPayment(ctx context.Context, reference string) (*provider.PaymentStatus, error)
	RefundPayment(ctx context.Context, reference string, amountKobo int64) (*provider.RefundResult, error)
	// LookupRefund returns the refund the gateway holds for reference, or
	// (nil, nil) when none — consulted before any refund RETRY.
	LookupRefund(ctx context.Context, reference string) (*provider.RefundResult, error)
}

// CardCheckoutOptions configures the card rail.
type CardCheckoutOptions struct {
	// InitiateEnabled gates NEW checkouts (FEATURE_EVENTS_CARD_CHECKOUT).
	// Confirmation, status and the sweep stay live whenever a gateway is
	// wired, so turning the flag off never strands a customer who paid.
	InitiateEnabled bool
	// HoldTTL is how long seats stay held unpaid (default 15m).
	HoldTTL time.Duration
	// StaleClaimAfter is how long a 'processing' claim is honoured before
	// another settler may take it over (default 2m).
	StaleClaimAfter time.Duration
	// CallbackHosts is the https host allowlist for a client callback_url;
	// empty ⇒ every client callback is dropped (Paystack dashboard default).
	CallbackHosts []string
}

type cardRail struct {
	gw   CardGateway
	opts CardCheckoutOptions
}

// EnableCardCheckout wires the Paystack card rail (composition root only).
func (s *Service) EnableCardCheckout(gw CardGateway, opts CardCheckoutOptions) {
	if gw == nil {
		return
	}
	if opts.HoldTTL <= 0 {
		opts.HoldTTL = 15 * time.Minute
	}
	if opts.StaleClaimAfter <= 0 {
		opts.StaleClaimAfter = 2 * time.Minute
	}
	s.card = &cardRail{gw: gw, opts: opts}
}

// CardCheckoutRequest is a card checkout for quantity seats of one tier.
type CardCheckoutRequest struct {
	EventID, TierID, Promo string
	Quantity               int
	IdempotencyKey         string
	Email                  string // billing email (resolved by the handler)
	CallbackURL            string // optional; allowlisted
}

// CardCheckout is what initiate returns. AmountKobo is for display only; it is
// never trusted back from the client.
type CardCheckout struct {
	Reference        string    `json:"reference"`
	AuthorizationURL string    `json:"authorizationUrl"`
	AccessCode       string    `json:"accessCode,omitempty"`
	AmountKobo       int64     `json:"amountKobo"`
	Currency         string    `json:"currency"`
	Quantity         int       `json:"quantity"`
	Status           string    `json:"status"`
	HoldExpiresAt    time.Time `json:"holdExpiresAt"`
}

// CardCheckoutResult is the outcome of a confirm / status read.
type CardCheckoutResult struct {
	Reference  string   `json:"reference"`
	Status     string   `json:"status"`
	AmountKobo int64    `json:"amountKobo"`
	Tickets    []Ticket `json:"tickets"`
}

// CardSweepStats counts what one ReconcileCardCheckouts pass did.
type CardSweepStats struct {
	Examined, Confirmed, Expired, Refunded, Skipped, Errors int
}

var (
	ErrCardCheckoutDisabled    = errors.New("events: card checkout is not available")
	ErrCardInvalidKey          = errors.New("events: Idempotency-Key must be 8-100 chars of A-Z a-z 0-9 . _ = -")
	ErrCardIdempotencyConflict = errors.New("events: Idempotency-Key already used for a different checkout")
	ErrCardNothingToCharge     = errors.New("events: nothing to charge — use the wallet checkout for free tickets")
	ErrCardUnknownReference    = errors.New("events: unknown card checkout reference")
	ErrCardChargeNotSuccessful = errors.New("events: charge not successful")
	ErrCardVerifyUnavailable   = errors.New("events: payment verification unavailable")
	ErrCardAmountMismatch      = errors.New("events: charged amount/currency does not match the order — refunded")
	ErrCardHoldExpired         = errors.New("events: seat hold expired before payment — refunded")
	ErrCardOrderVoid           = errors.New("events: order can no longer be fulfilled — refunded")
)

// cardIntent is the stored row (public.event_card_intents).
type cardIntent struct {
	reference, idemKey, buyerID, eventID, tierID, promo string
	quantity                                            int
	amountKobo                                          int64
	currency, status                                    string
	claimGen                                            int64
	claimedAt                                           *time.Time
	holdExpiresAt                                       time.Time
	authorizationURL, accessCode                        string
	collectedKobo                                       *int64
}

const cardIntentCols = `reference, idempotency_key, buyer_id::text, event_id::text, tier_id::text, promo, quantity,
	amount_kobo, currency, status, claim_gen, claimed_at, hold_expires_at,
	COALESCE(authorization_url,''), COALESCE(access_code,''), collected_kobo`

func scanCardIntent(row pgx.Row) (*cardIntent, error) {
	var r cardIntent
	if err := row.Scan(&r.reference, &r.idemKey, &r.buyerID, &r.eventID, &r.tierID, &r.promo, &r.quantity,
		&r.amountKobo, &r.currency, &r.status, &r.claimGen, &r.claimedAt, &r.holdExpiresAt,
		&r.authorizationURL, &r.accessCode, &r.collectedKobo); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Service) cardIntentByRef(ctx context.Context, reference string) (*cardIntent, error) {
	return scanCardIntent(s.db.QueryRow(ctx, `SELECT `+cardIntentCols+` FROM event_card_intents WHERE reference=$1`, reference))
}

func (r *cardIntent) checkout() *CardCheckout {
	return &CardCheckout{
		Reference: r.reference, AuthorizationURL: r.authorizationURL, AccessCode: r.accessCode,
		AmountKobo: r.amountKobo, Currency: r.currency, Quantity: r.quantity, Status: r.status,
		HoldExpiresAt: r.holdExpiresAt,
	}
}

// ---------- initiate ----------

// InitiateCardCheckout holds quantity seats and opens a Paystack checkout for
// exactly their server-computed total. Idempotent on req.IdempotencyKey: a
// replay by the same buyer for the same request returns the same reference and
// hold; any other reuse of the key is ErrCardIdempotencyConflict.
func (s *Service) InitiateCardCheckout(ctx context.Context, buyerID string, req CardCheckoutRequest) (*CardCheckout, error) {
	if s.card == nil || !s.card.opts.InitiateEnabled {
		return nil, ErrCardCheckoutDisabled
	}
	if buyerID == "" {
		return nil, ErrForbidden
	}
	if !cardKeyRE.MatchString(req.IdempotencyKey) {
		return nil, ErrCardInvalidKey
	}
	if req.Quantity < 1 || req.Quantity > MaxTicketsPerOrder {
		return nil, fmt.Errorf("%w: events: quantity must be between 1 and %d", ErrValidation, MaxTicketsPerOrder)
	}
	reference := CardReferencePrefix + req.IdempotencyKey

	if rec, err := s.cardIntentByRef(ctx, reference); err == nil {
		return s.replayCardCheckout(ctx, rec, buyerID, req)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("events: lookup card intent: %w", err)
	}

	ev, err := s.GetEvent(ctx, req.EventID)
	if err != nil {
		return nil, err
	}
	if ev.State != EventLive {
		return nil, fmt.Errorf("%w (state %s)", ErrNotPurchasable, ev.State)
	}

	rec, err := s.holdCardSeats(ctx, buyerID, reference, req)
	if dbutil.IsUniqueViolation(err) {
		// A concurrent initiate with the same key won the race (or the key
		// collides with a wallet order's key) — resolve as a replay.
		if existing, gerr := s.cardIntentByRef(ctx, reference); gerr == nil {
			return s.replayCardCheckout(ctx, existing, buyerID, req)
		}
		return nil, ErrCardIdempotencyConflict
	}
	if err != nil {
		return nil, err
	}
	s.log(buyerID, "events.card.hold", reference, map[string]any{
		keyEvent: req.EventID, keyTier: req.TierID, keyQuantity: req.Quantity, keyKobo: rec.amountKobo,
	})
	return s.initCardGateway(ctx, rec, req.Email, req.CallbackURL)
}

// holdCardSeats reserves the seats and records the intent in ONE transaction,
// so a hold never exists without its intent (and so its sweep) or vice versa.
func (s *Service) holdCardSeats(ctx context.Context, buyerID, reference string, req CardCheckoutRequest) (*cardIntent, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var total int64
	for i := range req.Quantity {
		_, payable, err := s.reserveSeatTx(ctx, tx, seatReservation{
			buyerID: buyerID, eventID: req.EventID, tierID: req.TierID, promo: req.Promo,
			idemKey: fmt.Sprintf("%s:%d", reference, i), rail: railCard, cardRef: reference,
		})
		if err != nil {
			return nil, err
		}
		total += payable
	}
	if total <= 0 {
		return nil, ErrCardNothingToCharge
	}
	rec, err := scanCardIntent(tx.QueryRow(ctx, `
		INSERT INTO event_card_intents
		  (reference, idempotency_key, buyer_id, event_id, tier_id, promo, quantity, amount_kobo, currency, status, hold_expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending', now() + make_interval(secs => $10))
		RETURNING `+cardIntentCols,
		reference, req.IdempotencyKey, buyerID, req.EventID, req.TierID, req.Promo, req.Quantity, total, cardCurrency,
		s.card.opts.HoldTTL.Seconds()))
	if err != nil {
		return nil, fmt.Errorf("events: insert card intent: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("events: commit card hold: %w", err)
	}
	return rec, nil
}

// replayCardCheckout answers a repeated initiate. Only the same buyer asking
// for the same thing gets the existing checkout back.
func (s *Service) replayCardCheckout(ctx context.Context, rec *cardIntent, buyerID string, req CardCheckoutRequest) (*CardCheckout, error) {
	if rec.buyerID != buyerID || rec.eventID != req.EventID || rec.tierID != req.TierID ||
		rec.quantity != req.Quantity || rec.promo != req.Promo {
		return nil, ErrCardIdempotencyConflict
	}
	if rec.status == CardStatusPending && rec.authorizationURL == "" {
		// The first attempt reserved the seats but never got a checkout URL
		// back from the gateway — retry the initialisation.
		return s.initCardGateway(ctx, rec, req.Email, req.CallbackURL)
	}
	return rec.checkout(), nil
}

func (s *Service) initCardGateway(ctx context.Context, rec *cardIntent, email, callbackURL string) (*CardCheckout, error) {
	resp, err := s.card.gw.InitializePayment(ctx, provider.InitializePaymentRequest{
		Email:          email,
		AmountKobo:     rec.amountKobo,
		Reference:      rec.reference,
		CallbackURL:    sanitizeCallbackURL(callbackURL, s.card.opts.CallbackHosts),
		IdempotencyKey: rec.idemKey,
	})
	if err != nil {
		// The hold stays (no charge can exist without a URL the customer never
		// received); a same-key retry re-initialises, the sweep releases it at
		// expiry.
		return nil, fmt.Errorf("events: initialise card payment: %w", err)
	}
	if resp.Reference != "" && resp.Reference != rec.reference {
		return nil, fmt.Errorf("events: gateway answered for reference %q, asked %q", resp.Reference, rec.reference)
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE event_card_intents SET authorization_url=$2, access_code=$3, updated_at=now() WHERE reference=$1`,
		rec.reference, resp.AuthorizationURL, resp.AccessCode); err != nil {
		return nil, fmt.Errorf("events: save card authorization: %w", err)
	}
	rec.authorizationURL, rec.accessCode = resp.AuthorizationURL, resp.AccessCode
	return rec.checkout(), nil
}

// sanitizeCallbackURL keeps a client callback only when it is https on an
// allowlisted host; anything else is dropped (an attacker-chosen redirect
// after the Paystack page is a phishing primitive).
func sanitizeCallbackURL(raw string, hosts []string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(hosts) == 0 {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil {
		return ""
	}
	if !slices.Contains(hosts, strings.ToLower(u.Hostname())) {
		return ""
	}
	return u.String()
}

// ---------- confirm ----------

// cardWebhookConfirmer adapts the rail to webhooks.PrefixConfirmer.
type cardWebhookConfirmer struct{ s *Service }

func (c cardWebhookConfirmer) OnChargeSuccess(ctx context.Context, reference, _ string) (any, error) {
	return c.s.ConfirmCardCharge(ctx, reference)
}

// CardWebhookConfirmer is what the composition root registers on the shared
// Paystack webhook for CardReferencePrefix. The webhook's own HMAC-SHA512
// check has already run; the charge is still re-verified server-side here.
func (s *Service) CardWebhookConfirmer() interface {
	OnChargeSuccess(ctx context.Context, reference, gatewayRef string) (any, error)
} {
	return cardWebhookConfirmer{s: s}
}

// ConfirmCardCharge settles a card checkout from a server-side verification of
// its charge. Safe to call any number of times, concurrently (webhook
// redeliveries, status polls, sweeps): exactly one caller settles.
func (s *Service) ConfirmCardCharge(ctx context.Context, reference string) (*CardCheckoutResult, error) {
	if s.card == nil {
		return nil, ErrCardCheckoutDisabled
	}
	rec, err := s.cardIntentByRef(ctx, reference)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCardUnknownReference
	}
	if err != nil {
		return nil, fmt.Errorf("events: lookup card intent: %w", err)
	}
	switch rec.status {
	case CardStatusConfirmed, CardStatusRefunded, CardStatusRefunding:
		// Terminal, or a refund the sweep owns — nothing to do here.
		return s.cardResult(ctx, rec)
	case CardStatusProcessing:
		if rec.claimedAt != nil && time.Since(*rec.claimedAt) < s.card.opts.StaleClaimAfter {
			return s.cardResult(ctx, rec) // a live settler owns it
		}
	}

	// Verify is a pure read — safe on every delivery, so it runs before the claim.
	st, err := s.card.gw.VerifyPayment(ctx, reference)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrCardVerifyUnavailable, err)
	}
	if st == nil || (st.Reference != "" && st.Reference != reference) {
		return nil, fmt.Errorf("%w: gateway answered for a different reference", ErrCardVerifyUnavailable)
	}
	if !strings.EqualFold(st.Status, "success") {
		return nil, ErrCardChargeNotSuccessful
	}
	if st.Currency == "" {
		// Unknown is never an implicit match (provider.PaymentStatus doc) — and
		// never grounds for a refund either. Leave it for a later verify.
		return nil, fmt.Errorf("%w: gateway did not report a currency", ErrCardVerifyUnavailable)
	}

	if rec.status == CardStatusExpired {
		// Paid on a stale checkout page after the hold was released: the seat
		// may already be someone else's. Refund, never ticket.
		if s.claimRefund(ctx, reference, CardStatusExpired, st.AmountKobo, "charge_after_hold_expired") {
			s.driveCardRefund(ctx, reference, st.AmountKobo)
			return nil, ErrCardHoldExpired
		}
		return s.currentCardResult(ctx, reference)
	}

	fence, claimed, err := s.claimCardIntent(ctx, reference)
	if err != nil {
		return nil, err
	}
	if !claimed {
		return s.currentCardResult(ctx, reference)
	}

	if !strings.EqualFold(st.Currency, rec.currency) || st.AmountKobo != rec.amountKobo {
		s.refuseCardCharge(ctx, rec, fence, st.AmountKobo, fmt.Sprintf("mismatch: collected %d %s, order %d %s", st.AmountKobo, st.Currency, rec.amountKobo, rec.currency))
		return nil, ErrCardAmountMismatch
	}
	ev, err := s.GetEvent(ctx, rec.eventID)
	if err != nil {
		return nil, err // claim left to go stale; a later attempt retries
	}
	if ev.State == EventCancelled {
		s.refuseCardCharge(ctx, rec, fence, st.AmountKobo, "event_cancelled")
		return nil, ErrCardOrderVoid
	}

	if err := s.settleCardOrders(ctx, rec); err != nil {
		if errors.Is(err, ErrCardOrderVoid) {
			s.refuseCardCharge(ctx, rec, fence, st.AmountKobo, err.Error())
			return nil, err
		}
		// Transient: the claim goes stale and the next delivery / sweep resumes
		// from the idempotent steps already done.
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `
		UPDATE event_card_intents SET status='confirmed', confirmed_at=now(), collected_kobo=$3, updated_at=now()
		WHERE reference=$1 AND status='processing' AND claim_gen=$2`, reference, fence, st.AmountKobo); err != nil {
		log.Printf("[top5events] card %s settled but mark confirmed failed: %v", reference, err)
	}
	s.log(rec.buyerID, "events.card.confirmed", reference, map[string]any{
		keyEvent: rec.eventID, keyTier: rec.tierID, keyQuantity: rec.quantity, keyKobo: rec.amountKobo, "channel": st.Channel,
	})
	return s.currentCardResult(ctx, reference)
}

// claimCardIntent atomically moves pending (or a stale processing claim) to
// processing under a new fence. Exactly one concurrent caller wins.
func (s *Service) claimCardIntent(ctx context.Context, reference string) (int64, bool, error) {
	var fence int64
	err := s.db.QueryRow(ctx, `
		UPDATE event_card_intents
		SET status='processing', claim_gen=claim_gen+1, claimed_at=now(), updated_at=now()
		WHERE reference=$1 AND (status='pending'
		      OR (status='processing' AND claimed_at < now() - make_interval(secs => $2)))
		RETURNING claim_gen`, reference, s.card.opts.StaleClaimAfter.Seconds()).Scan(&fence)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("events: claim card intent: %w", err)
	}
	return fence, true, nil
}

// cardOrder is one held seat of a card checkout.
type cardOrder struct {
	id, tierID, idemKey, status string
	payable                     int64
}

func (s *Service) cardOrders(ctx context.Context, reference string) ([]cardOrder, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, COALESCE(tier_id::text,''), idempotency_key, status, total_kobo
		FROM event_orders WHERE card_reference=$1 AND payment_rail='card' ORDER BY idempotency_key`, reference)
	if err != nil {
		return nil, fmt.Errorf("events: list card orders: %w", err)
	}
	defer rows.Close()
	var out []cardOrder
	for rows.Next() {
		var o cardOrder
		if err := rows.Scan(&o.id, &o.tierID, &o.idemKey, &o.status, &o.payable); err != nil {
			return nil, fmt.Errorf("events: scan card order: %w", err)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// settleCardOrders moves the verified money into escrow and issues the
// tickets, order by order. Every step is idempotent, so a resumed settle (stale
// claim takeover after a crash) converges on one posting and one ticket each.
//
//nolint:gocognit // settle is one linear money-path sequence inside the claim fence
func (s *Service) settleCardOrders(ctx context.Context, rec *cardIntent) error {
	orders, err := s.cardOrders(ctx, rec.reference)
	if err != nil {
		return err
	}
	var sum int64
	for _, o := range orders {
		if o.status != orderStatusPending && o.status != orderStatusPaid {
			return fmt.Errorf("%w: order %s is %s", ErrCardOrderVoid, o.id, o.status)
		}
		sum += o.payable
	}
	if len(orders) != rec.quantity || sum != rec.amountKobo {
		return fmt.Errorf("%w: held orders (%d, %d kobo) do not match the intent (%d, %d kobo)",
			ErrCardOrderVoid, len(orders), sum, rec.quantity, rec.amountKobo)
	}

	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	clearingAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	for _, o := range orders {
		if o.status == orderStatusPending && o.payable > 0 {
			// The gateway collected the money into the provider clearing account;
			// move this seat's share into the SAME escrow the wallet rail debits
			// into, so organiser settlement treats both rails identically.
			key := "evtcard:" + o.id + ":escrow"
			perr := s.led.PostJournal(ctx, ledger.JournalEntry{
				Reference:       "ticket:" + o.id,
				IdempotencyKey:  key,
				AmountKobo:      o.payable,
				DebitAccountID:  clearingAcc.ID,
				CreditAccountID: escrowAcc.ID,
				Description:     "Event ticket card payment " + rec.reference + " → escrow",
			})
			if !alreadyApplied(perr) {
				return fmt.Errorf("events: card escrow posting: %w", perr)
			}
			if perr != nil {
				// Duplicate: confirm from the ledger of record that it really posted
				// (a Redis fast-path dedup alone is not proof).
				posted, cerr := s.led.Posted(ctx, key)
				if cerr != nil {
					return fmt.Errorf("events: card escrow posted-check: %w", cerr)
				}
				if !posted {
					return fmt.Errorf("events: card escrow posting deduped but not in ledger (%s)", key)
				}
			}
		}
		if o.status == orderStatusPending {
			if _, err := s.db.Exec(ctx, `UPDATE event_orders SET status='PAID' WHERE id=$1 AND status='PENDING'`, o.id); err != nil {
				return fmt.Errorf("events: mark card order paid: %w", err)
			}
		}
		// Shared ticket tail (PAID ⇒ no wallet debit; ticket insert is
		// idempotent on uq_event_tickets_order; commission recorded once).
		if _, err := s.finalizePurchase(ctx, pendingOrder{
			id: o.id, eventID: rec.eventID, buyerID: rec.buyerID, tierID: o.tierID,
			idemKey: o.idemKey, payable: o.payable, status: orderStatusPaid, rail: railCard,
		}); err != nil {
			return err
		}
	}
	return nil
}

// refuseCardCharge releases the hold and refunds the whole collected amount —
// for a charge that cannot be honoured (amount/currency mismatch, event
// cancelled, hold no longer intact). Fenced: only the current claimant acts.
func (s *Service) refuseCardCharge(ctx context.Context, rec *cardIntent, fence, collectedKobo int64, reason string) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		log.Printf("[top5events] card %s refuse: begin: %v", rec.reference, err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `
		UPDATE event_card_intents SET status='refunding', collected_kobo=$3, failure_reason=$4, updated_at=now()
		WHERE reference=$1 AND status='processing' AND claim_gen=$2`, rec.reference, fence, collectedKobo, reason)
	if err != nil || tag.RowsAffected() == 0 {
		log.Printf("[top5events] card %s refuse: fence lost or update failed: %v", rec.reference, err)
		return
	}
	if err := releaseCardOrdersTx(ctx, tx, rec.reference); err != nil {
		log.Printf("[top5events] card %s refuse: release hold: %v", rec.reference, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		log.Printf("[top5events] card %s refuse: commit: %v", rec.reference, err)
		return
	}
	s.log(rec.buyerID, "events.card.refused", rec.reference, map[string]any{
		keyReason: reason, "collected_kobo": collectedKobo, "order_kobo": rec.amountKobo,
	})
	s.driveCardRefund(ctx, rec.reference, collectedKobo)
}

// claimRefund moves an intent from `from` straight to refunding (a charge on
// an already-released hold). Exactly one caller wins.
func (s *Service) claimRefund(ctx context.Context, reference, from string, collectedKobo int64, reason string) bool {
	tag, err := s.db.Exec(ctx, `
		UPDATE event_card_intents SET status='refunding', collected_kobo=$3, failure_reason=$4,
		       claim_gen=claim_gen+1, claimed_at=now(), updated_at=now()
		WHERE reference=$1 AND status=$2`, reference, from, collectedKobo, reason)
	if err != nil {
		log.Printf("[top5events] card %s claim refund: %v", reference, err)
		return false
	}
	return tag.RowsAffected() > 0
}

// driveCardRefund asks the gateway to refund and records the outcome. A
// failure leaves the intent 'refunding' for the sweep (which looks the refund
// up before retrying).
func (s *Service) driveCardRefund(ctx context.Context, reference string, amountKobo int64) bool {
	if amountKobo <= 0 {
		s.markCardRefunded(ctx, reference, "")
		return true
	}
	res, err := s.card.gw.RefundPayment(ctx, reference, amountKobo)
	if err != nil || res == nil || !provider.RefundAccepted(res.Status) {
		log.Printf("[top5events] card %s REFUND NOT ACCEPTED (amount=%d): res=%+v err=%v — sweep will retry", reference, amountKobo, res, err)
		return false
	}
	ref := res.ID
	if ref == "" {
		ref = res.Reference
	}
	s.markCardRefunded(ctx, reference, ref)
	return true
}

func (s *Service) markCardRefunded(ctx context.Context, reference, refundRef string) {
	if _, err := s.db.Exec(ctx, `
		UPDATE event_card_intents SET status='refunded', refund_reference=NULLIF($2,''), updated_at=now()
		WHERE reference=$1 AND status='refunding'`, reference, refundRef); err != nil {
		log.Printf("[top5events] card %s mark refunded: %v", reference, err)
		return
	}
	s.log("", "events.card.refunded", reference, map[string]any{"refund_reference": refundRef})
}

// releaseCardOrdersTx releases every still-PENDING held seat of a card
// checkout: order EXPIRED, sold-1, promo use given back. Never touches a PAID
// order. The caller holds the intent row (status already moved off pending).
func releaseCardOrdersTx(ctx context.Context, tx pgx.Tx, reference string) error {
	rows, err := tx.Query(ctx, `SELECT id::text, COALESCE(tier_id::text,'') FROM event_orders
		WHERE card_reference=$1 AND payment_rail='card' AND status='PENDING' ORDER BY id FOR UPDATE`, reference)
	if err != nil {
		return err
	}
	type held struct{ id, tierID string }
	var hs []held
	for rows.Next() {
		var h held
		if err := rows.Scan(&h.id, &h.tierID); err != nil {
			rows.Close()
			return err
		}
		hs = append(hs, h)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, h := range hs {
		if _, err := tx.Exec(ctx, `UPDATE event_orders SET status='EXPIRED' WHERE id=$1 AND status='PENDING'`, h.id); err != nil {
			return err
		}
		if h.tierID != "" {
			if _, err := tx.Exec(ctx, `UPDATE event_ticket_tiers SET sold=sold-1 WHERE id=$1 AND sold>0`, h.tierID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE event_promo_codes p SET used=p.used-1
			FROM event_promo_redemptions r WHERE r.order_id=$1 AND r.promo_id=p.id AND p.used>0`, h.id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM event_promo_redemptions WHERE order_id=$1`, h.id); err != nil {
			return err
		}
	}
	return nil
}

// expireCardHold releases an unpaid hold (pending → expired). The intent row
// lock serialises it against the settle claim: whichever commits first wins.
func (s *Service) expireCardHold(ctx context.Context, rec *cardIntent) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM event_card_intents WHERE reference=$1 FOR UPDATE`, rec.reference).Scan(&status); err != nil {
		return false, err
	}
	if status != CardStatusPending {
		return false, nil
	}
	if _, err := tx.Exec(ctx, `UPDATE event_card_intents SET status='expired', updated_at=now() WHERE reference=$1`, rec.reference); err != nil {
		return false, err
	}
	if err := releaseCardOrdersTx(ctx, tx, rec.reference); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	s.log(rec.buyerID, "events.card.hold_expired", rec.reference, map[string]any{keyEvent: rec.eventID, keyQuantity: rec.quantity})
	return true, nil
}

// ---------- reads ----------

func (s *Service) currentCardResult(ctx context.Context, reference string) (*CardCheckoutResult, error) {
	rec, err := s.cardIntentByRef(ctx, reference)
	if err != nil {
		return nil, fmt.Errorf("events: reread card intent: %w", err)
	}
	return s.cardResult(ctx, rec)
}

func (s *Service) cardResult(ctx context.Context, rec *cardIntent) (*CardCheckoutResult, error) {
	out := &CardCheckoutResult{Reference: rec.reference, Status: rec.status, AmountKobo: rec.amountKobo, Tickets: []Ticket{}}
	if rec.status != CardStatusConfirmed {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT t.id, t.event_id, t.tier_id, t.order_id, t.owner_id, t.state, COALESCE(t.credential_id::text,''), t.price_paid_kobo, t.created_at
		FROM event_tickets t JOIN event_orders o ON o.id = t.order_id
		WHERE o.card_reference=$1 ORDER BY o.idempotency_key`, rec.reference)
	if err != nil {
		return nil, fmt.Errorf("events: card tickets: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var t Ticket
		var state string
		if err := rows.Scan(&t.ID, &t.EventID, &t.TierID, &t.OrderID, &t.OwnerID, &state, &t.CredentialID, &t.PricePaidKobo, &t.CreatedAt); err != nil {
			return nil, fmt.Errorf("events: scan card ticket: %w", err)
		}
		t.State = TicketState(state)
		out.Tickets = append(out.Tickets, t)
	}
	return out, rows.Err()
}

// CardCheckoutStatus is the buyer's status poll. A reference that is not the
// caller's reads as unknown (references are not secrets). A still-open intent
// is re-verified server-side (the self-heal for environments Paystack cannot
// webhook); a refused charge reports its refund status rather than an error.
func (s *Service) CardCheckoutStatus(ctx context.Context, buyerID, reference string) (*CardCheckoutResult, error) {
	if s.card == nil {
		return nil, ErrCardCheckoutDisabled
	}
	rec, err := s.cardIntentByRef(ctx, reference)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && rec.buyerID != buyerID) {
		return nil, ErrCardUnknownReference
	}
	if err != nil {
		return nil, fmt.Errorf("events: lookup card intent: %w", err)
	}
	if rec.status != CardStatusPending && rec.status != CardStatusProcessing && rec.status != CardStatusExpired {
		return s.cardResult(ctx, rec)
	}
	res, err := s.ConfirmCardCharge(ctx, reference)
	if err == nil {
		return res, nil
	}
	switch {
	case errors.Is(err, ErrCardChargeNotSuccessful), errors.Is(err, ErrCardVerifyUnavailable),
		errors.Is(err, ErrCardAmountMismatch), errors.Is(err, ErrCardHoldExpired), errors.Is(err, ErrCardOrderVoid):
		return s.currentCardResult(ctx, reference)
	}
	return nil, err
}

// ---------- sweep ----------

const cardSweepBatch = 200

// ReconcileCardCheckouts drives every open card checkout toward a terminal
// state. minAge keeps it off intents the live webhook/poll is still handling.
// Multi-instance safe: every action goes through the same claim / row-lock
// gated, idempotent paths as the live flow.
func (s *Service) ReconcileCardCheckouts(ctx context.Context, minAge time.Duration) (CardSweepStats, error) {
	var st CardSweepStats
	if s.card == nil {
		return st, nil
	}
	recs, err := s.listCardIntents(ctx, `
		(status='pending' AND updated_at < now() - make_interval(secs => $1))
		OR (status='processing' AND claimed_at < now() - make_interval(secs => $2))
		OR (status='refunding' AND updated_at < now() - make_interval(secs => $1))`,
		minAge.Seconds(), s.card.opts.StaleClaimAfter.Seconds())
	if err != nil {
		return st, err
	}
	for _, rec := range recs {
		st.Examined++
		switch rec.status {
		case CardStatusPending, CardStatusProcessing:
			s.sweepOpenCard(ctx, rec, &st)
		case CardStatusRefunding:
			if s.retryCardRefund(ctx, rec, minAge) {
				st.Refunded++
			} else {
				st.Skipped++
			}
		}
	}
	return st, nil
}

func (s *Service) listCardIntents(ctx context.Context, where string, args ...any) ([]*cardIntent, error) {
	rows, err := s.db.Query(ctx, `SELECT `+cardIntentCols+` FROM event_card_intents WHERE `+where+
		fmt.Sprintf(` ORDER BY created_at LIMIT %d`, cardSweepBatch), args...)
	if err != nil {
		return nil, fmt.Errorf("events: list card intents: %w", err)
	}
	defer rows.Close()
	var out []*cardIntent
	for rows.Next() {
		rec, err := scanCardIntent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// sweepOpenCard settles a paid open intent, or releases an expired unpaid
// hold — only once the gateway has said the charge did not succeed.
func (s *Service) sweepOpenCard(ctx context.Context, rec *cardIntent, st *CardSweepStats) {
	res, err := s.ConfirmCardCharge(ctx, rec.reference)
	switch {
	case err == nil && res != nil && res.Status == CardStatusConfirmed:
		st.Confirmed++
		return
	case err == nil:
		st.Skipped++
		return
	case errors.Is(err, ErrCardAmountMismatch), errors.Is(err, ErrCardOrderVoid), errors.Is(err, ErrCardHoldExpired):
		st.Refunded++ // refused + refund driven inside the confirm
		return
	case errors.Is(err, ErrCardChargeNotSuccessful):
		// fall through to the expiry decision
	case errors.Is(err, ErrCardVerifyUnavailable):
		// Never release on an unknown outcome — unless no checkout URL was ever
		// handed out, in which case no charge can exist.
		if rec.status == CardStatusPending && rec.authorizationURL == "" && time.Now().After(rec.holdExpiresAt) {
			s.sweepExpire(ctx, rec, st)
			return
		}
		st.Skipped++
		return
	default:
		st.Errors++
		log.Printf("[top5events] card sweep confirm %s: %v", rec.reference, err)
		return
	}
	if rec.status != CardStatusPending || time.Now().Before(rec.holdExpiresAt) {
		st.Skipped++
		return
	}
	if gst, verr := s.card.gw.VerifyPayment(ctx, rec.reference); verr == nil && gst != nil &&
		slices.Contains(gatewayInProgress, strings.ToLower(gst.Status)) &&
		time.Now().Before(rec.holdExpiresAt.Add(inProgressHoldGrace)) {
		st.Skipped++ // a bank transfer may still be landing — keep the seat a while
		return
	}
	s.sweepExpire(ctx, rec, st)
}

func (s *Service) sweepExpire(ctx context.Context, rec *cardIntent, st *CardSweepStats) {
	ok, err := s.expireCardHold(ctx, rec)
	switch {
	case err != nil:
		st.Errors++
		log.Printf("[top5events] card sweep expire %s: %v", rec.reference, err)
	case ok:
		st.Expired++
	default:
		st.Skipped++
	}
}

// retryCardRefund finishes a refund whose gateway call failed. It claims the
// row first (one sweeper per attempt) and looks the refund up before asking
// again, so a refund that did go through is never issued twice.
func (s *Service) retryCardRefund(ctx context.Context, rec *cardIntent, minAge time.Duration) bool {
	tag, err := s.db.Exec(ctx, `
		UPDATE event_card_intents SET claim_gen=claim_gen+1, claimed_at=now(), updated_at=now()
		WHERE reference=$1 AND status='refunding' AND claim_gen=$2 AND updated_at < now() - make_interval(secs => $3)`,
		rec.reference, rec.claimGen, minAge.Seconds())
	if err != nil || tag.RowsAffected() == 0 {
		return false
	}
	amount := rec.amountKobo
	if rec.collectedKobo != nil {
		amount = *rec.collectedKobo
	}
	existing, err := s.card.gw.LookupRefund(ctx, rec.reference)
	if err != nil {
		log.Printf("[top5events] card %s refund lookup: %v — retry next sweep", rec.reference, err)
		return false
	}
	if existing != nil && provider.RefundAccepted(existing.Status) {
		ref := existing.ID
		if ref == "" {
			ref = existing.Reference
		}
		s.markCardRefunded(ctx, rec.reference, ref)
		return true
	}
	return s.driveCardRefund(ctx, rec.reference, amount)
}

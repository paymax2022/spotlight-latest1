package top5events

// Events-commerce refunds: the buyer-protection half of the money spine.
//
// Cancellation already refunds every ticket of a dead event (manage.go's
// refundCancelledEvent). This is the other case: one buyer, one seat, a change of
// plans. The two paths deliberately share an implementation shape so the ledger
// cannot disagree about what a refund looks like:
//
//	REQUESTED -> APPROVED -> PROCESSING -> REFUNDED
//	                            -> FAILED      (explicit retry, same keys)
//	REQUESTED -> REJECTED
//
// Money moves escrow -> the payer's wallet, and the retained platform fee moves
// escrow -> platform revenue — the same two legs a cancellation makes, and the
// reason a card-rail buyer's refund also lands in the app wallet: the module has no
// gateway refund on a settled charge, and inventing one here would break the
// escrow balance the settlement engine reads. A buyer who wants the money back on
// their card opens a support case (kind REFUND); that is the documented escalation,
// not a silent substitution.
//
// Exactly-once rests on three things, in this order:
//   - ledger idempotency keys derived from the refund id, never the caller's header,
//     so a retry, a double click and the reconciler all converge on one posting;
//   - a partial unique index (uq_event_refunds_ticket_live) that lets at most one
//     live refund exist per ticket, so a second request cannot queue a second debit;
//   - the ticket's own state flip as the guard on releasing inventory, so a seat is
//     freed exactly once even if everything after it is re-driven.
//
// These tables only exist after migration 20271400000000, so nothing here is flag-
// branched: the routes that reach it mount only under FEATURE_EVENTS_COMMERCIAL.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/finance/ledger"
)

var (
	ErrNotRefundable   = errors.New("events: this ticket is not refundable")
	ErrRefundUsed      = errors.New("events: the ticket was already used for entry")
	ErrRefundExists    = errors.New("events: a refund has already been requested for this ticket")
	ErrRefundDecided   = errors.New("events: this refund has already been decided")
	ErrRefundWindow    = errors.New("events: the refund window for this event has closed")
	ErrRefundAutomatic = errors.New("events: the event was cancelled, so its tickets are refunded automatically")
)

// Refund states (event_refunds.status CHECK).
const (
	RefundRequested  = "REQUESTED"
	RefundApproved   = "APPROVED"
	RefundRejected   = "REJECTED"
	RefundProcessing = "PROCESSING"
	RefundRefunded   = "REFUNDED"
	RefundFailed     = "FAILED"
)

// Refund is one refund request and its decision trail, with enough joined context
// for a queue row to be decided without a second read.
type Refund struct {
	ID         string    `json:"id"`
	EventID    string    `json:"event_id"`
	OrderID    string    `json:"order_id"`
	TicketID   string    `json:"ticket_id"`
	BuyerID    string    `json:"buyer_id"`
	AmountKobo int64     `json:"amount_kobo"`
	FeeKobo    int64     `json:"fee_kobo"`
	RefundKobo int64     `json:"refund_kobo"`
	Reason     string    `json:"reason,omitempty"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`

	DecidedBy      string     `json:"decided_by,omitempty"`
	DecidedAt      *time.Time `json:"decided_at,omitempty"`
	DecisionNote   string     `json:"decision_note,omitempty"`
	FailureReason  string     `json:"failure_reason,omitempty"`
	IdempotencyKey string     `json:"idempotency_key,omitempty"`

	// Queue display fields (never trusted as authority).
	EventTitle   string `json:"event_title,omitempty"`
	EventState   string `json:"event_state,omitempty"`
	TierName     string `json:"tier_name,omitempty"`
	AttendeeName string `json:"attendee_name,omitempty"`
	BuyerName    string `json:"buyer_name,omitempty"`
	BookingRef   string `json:"booking_ref,omitempty"`
}

// refundSelect is the queue/detail projection. The fee/refund split is stored on
// the row (not recomputed per read) because the platform fee may change between
// the request and the payout, and a buyer must be paid what they were told.
const refundSelect = `
	SELECT r.id, r.event_id, r.order_id, r.ticket_id, r.buyer_id, r.amount_kobo, r.fee_kobo, r.refund_kobo,
	       r.reason, r.status, r.created_at,
	       COALESCE(r.decided_by::text,''), r.decided_at, r.decision_note, r.failure_reason, r.idempotency_key,
	       e.title, e.state, COALESCE(tr.name,''), COALESCE(t.attendee_name,''),
	       COALESCE(up.full_name,''), COALESCE(o.booking_ref,'')
	  FROM event_refunds r
	  JOIN events e      ON e.id = r.event_id
	  JOIN event_orders o ON o.id = r.order_id
	  JOIN event_tickets t ON t.id = r.ticket_id
	  LEFT JOIN event_ticket_tiers tr ON tr.id = t.tier_id
	  LEFT JOIN user_profiles up ON up.id = r.buyer_id`

func scanRefund(row rowScanner) (*Refund, error) {
	var r Refund
	if err := row.Scan(&r.ID, &r.EventID, &r.OrderID, &r.TicketID, &r.BuyerID, &r.AmountKobo, &r.FeeKobo,
		&r.RefundKobo, &r.Reason, &r.Status, &r.CreatedAt, &r.DecidedBy, &r.DecidedAt, &r.DecisionNote,
		&r.FailureReason, &r.IdempotencyKey, &r.EventTitle, &r.EventState, &r.TierName, &r.AttendeeName,
		&r.BuyerName, &r.BookingRef); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Service) refundByID(ctx context.Context, id string) (*Refund, error) {
	r, err := scanRefund(s.db.QueryRow(ctx, refundSelect+" WHERE r.id = $1", id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("events: refund lookup: %w", err)
	}
	return r, nil
}

// splitRefund is the refund arithmetic: what the buyer gets back, and what the
// platform keeps. Integer basis points, and the two halves always re-add to the
// amount (UAT EVT-160: a receipt and its refund must reconcile to the kobo).
// Shared with cancelRefundOneTicket so the two paths cannot drift apart.
func splitRefund(amountKobo int64, feeBps int) (refund, fee int64) {
	fee = amountKobo * int64(feeBps) / 10000
	return amountKobo - fee, fee
}

// refundWithinWindow reports whether a refund requested at `now` is still inside the
// organiser's cutoff (refund_cutoff_hours before the start). A zero cutoff means
// "no time limit"; a negative event start (already begun) fails closed.
func refundWithinWindow(startsAt time.Time, cutoffHours int, now time.Time) bool {
	if cutoffHours <= 0 {
		return true
	}
	return !now.After(startsAt.Add(-time.Duration(cutoffHours) * time.Hour))
}

// refundCandidate is the authoritative read a request is checked against. Nothing on
// this list may come from the request body.
type refundCandidate struct {
	ticketID, eventID, orderID, buyerID, ticketState, orderStatus string
	credentialID                                                  *string
	pricePaidKobo                                                 int64
	eventTitle                                                    string
	eventState                                                    string
	startsAt                                                      time.Time
	cutoffHours, feeBps                                           int
	organiserID                                                   string
}

func (s *Service) loadRefundCandidate(ctx context.Context, ticketID string) (*refundCandidate, error) {
	c := `
		SELECT t.id, t.event_id, t.order_id, COALESCE(o.buyer_id::text,''), t.state, o.status,
		       t.price_paid_kobo, t.credential_id::text, e.title, e.state, e.starts_at,
		       e.refund_cutoff_hours, e.fee_bps, e.organiser_id
		  FROM event_tickets t
		  JOIN event_orders o ON o.id = t.order_id
		  JOIN events e       ON e.id = t.event_id
		 WHERE t.id = $1`
	var (
		r      refundCandidate
		credID *string
		buyer  string
		err    error
	)
	err = s.db.QueryRow(ctx, c, ticketID).Scan(&r.ticketID, &r.eventID, &r.orderID, &buyer, &r.ticketState,
		&r.orderStatus, &r.pricePaidKobo, &credID, &r.eventTitle, &r.eventState, &r.startsAt,
		&r.cutoffHours, &r.feeBps, &r.organiserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("events: refund candidate: %w", err)
	}
	r.buyerID, r.credentialID = buyer, credID
	return &r, nil
}

// RequestRefund files a refund request for one seat. The caller must be the payer
// (money returns to the buyer, not to whoever currently holds the ticket — a gift
// recipient cannot convert someone else's purchase into their own wallet balance),
// the seat must be un-entered and paid for, the event must not be cancelled (that
// path already refunds automatically), and the organiser's cutoff must not have
// passed.
//
// The returned Refund carries the exact split the buyer will receive if it is
// approved, so the app can show the number before the money moves.
func (s *Service) RequestRefund(ctx context.Context, callerID, ticketID, reason, idemKey string) (*Refund, error) {
	if callerID == "" || ticketID == "" {
		return nil, ErrValidation
	}
	c, err := s.loadRefundCandidate(ctx, ticketID)
	if err != nil {
		return nil, err
	}
	switch {
	case c.buyerID != callerID:
		return nil, ErrForbidden
	case c.pricePaidKobo <= 0:
		return nil, ErrNotRefundable // a comp carries no money to return
	case c.orderStatus != "PAID":
		return nil, ErrNotRefundable
	case c.ticketState == string(TicketRefunded):
		return nil, ErrRefundExists
	case c.ticketState == string(TicketUsed):
		return nil, ErrRefundUsed
	case c.ticketState != string(TicketIssued) && c.ticketState != string(TicketTransferred):
		return nil, ErrNotRefundable
	case EventState(c.eventState) == EventCancelled:
		return nil, ErrRefundAutomatic
	}
	if !refundWithinWindow(c.startsAt, c.cutoffHours, time.Now()) {
		return nil, ErrRefundWindow
	}

	refund, fee := splitRefund(c.pricePaidKobo, c.feeBps)
	if refund < 0 || fee < 0 || refund+fee != c.pricePaidKobo {
		return nil, fmt.Errorf("events: inconsistent refund split (amount=%d fee=%d refund=%d)", c.pricePaidKobo, fee, refund)
	}

	id := uuid.New().String()
	_, err = s.db.Exec(ctx,
		`INSERT INTO event_refunds (id, event_id, order_id, ticket_id, buyer_id, requested_by,
		                           amount_kobo, fee_kobo, refund_kobo, reason, status, idempotency_key)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'REQUESTED',$11)`,
		id, c.eventID, c.orderID, c.ticketID, c.buyerID, callerID,
		c.pricePaidKobo, fee, refund, clampTrim(reason, 500), clampTrim(idemKey, 200))
	if err != nil {
		// 23505 is uq_event_refunds_ticket_live: a live request already exists, and a
		// second one must not be able to queue a second debit.
		if isUniqueViolation(err) {
			return nil, ErrRefundExists
		}
		return nil, fmt.Errorf("events: request refund: %w", err)
	}

	out, err := s.refundByID(ctx, id)
	if err != nil {
		return nil, err
	}
	s.log(callerID, "events.refund.request", id, map[string]any{
		"event": c.eventID, "ticket": c.ticketID, "amount": c.pricePaidKobo, "refund": refund, "fee": fee,
	})
	s.notify(ctx, callerID, NotifyRefundRequested, "Refund requested",
		out.EventTitle+": we will tell you as soon as the organiser decides.", out.EventID, out.OrderID, id)
	return out, nil
}

// DecideRefund approves or rejects a pending request. Organiser-side callers must
// manage the event (authorizeManage); admin-side callers are already RBAC-gated on
// events.refund, so allowAdmin lets them through without an ownership test.
//
// A decision is only possible on REQUESTED. Deciding twice is refused rather than
// silently replayed: the first decision is what the buyer was told.
func (s *Service) DecideRefund(ctx context.Context, actorID, refundID string, approve bool, note string, allowAdmin bool) (*Refund, error) {
	r, err := s.refundByID(ctx, refundID)
	if err != nil {
		return nil, err
	}
	if err := s.assertRefundDecider(ctx, r, actorID, allowAdmin); err != nil {
		return nil, err
	}
	if r.Status != RefundRequested {
		return nil, ErrRefundDecided
	}
	to := RefundRejected
	if approve {
		to = RefundApproved
	}
	// Guarded on the status just read: a concurrent decision changes it, this
	// matches zero rows, and the caller learns the outcome was already settled.
	tag, err := s.db.Exec(ctx,
		`UPDATE event_refunds
		    SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4, updated_at=now()
		  WHERE id=$1 AND status='REQUESTED'`,
		refundID, to, actorID, clampTrim(note, 500))
	if err != nil {
		return nil, fmt.Errorf("events: decide refund: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrRefundDecided
	}
	s.log(actorID, "events.refund.decide", refundID, map[string]any{"decision": to, "note": clampTrim(note, 500)})

	out, err := s.refundByID(ctx, refundID)
	if err != nil {
		return nil, err
	}
	if approve {
		s.notify(ctx, r.BuyerID, NotifyRefundApproved, "Refund approved",
			out.EventTitle+": the money is on its way to your wallet.", out.EventID, out.OrderID, refundID)
	} else {
		s.notify(ctx, r.BuyerID, NotifyRefundRejected, "Refund declined",
			refundDeclinedBody(out), out.EventID, out.OrderID, refundID)
	}
	return out, nil
}

func refundDeclinedBody(r *Refund) string {
	if r.DecisionNote != "" {
		return r.EventTitle + ": " + r.DecisionNote
	}
	return r.EventTitle + ": the organiser declined this refund."
}

// ExecuteRefund pays an approved refund. It is separate from the decision so a
// failure is visible and retryable instead of leaving a half-decided row.
//
// Crash-safe ordering, identical to a cancellation refund: post the money legs
// first (both idempotent on the refund id), revoke the pass, flip the ticket — and
// release the seat only if that flip is the one that changed it — then mark the
// order and finally the refund row. The row's REFUNDED status is the "done" marker
// every retry selects on.
func (s *Service) ExecuteRefund(ctx context.Context, actorID, refundID string, allowAdmin bool) (*Refund, error) {
	r, err := s.refundByID(ctx, refundID)
	if err != nil {
		return nil, err
	}
	if err := s.assertRefundDecider(ctx, r, actorID, allowAdmin); err != nil {
		return nil, err
	}
	switch r.Status {
	case RefundRefunded:
		return r, nil // already done: replay is a no-op, not an error
	case RefundRequested:
		return nil, fmt.Errorf("%w: events: approve the refund before paying it", ErrValidation)
	case RefundRejected:
		return nil, ErrNotRefundable
	}
	if r.AmountKobo <= 0 {
		return nil, ErrNotRefundable
	}

	if _, err := s.db.Exec(ctx,
		`UPDATE event_refunds SET status='PROCESSING', updated_at=now() WHERE id=$1 AND status IN ('APPROVED','FAILED')`,
		refundID); err != nil {
		return nil, fmt.Errorf("events: mark refund processing: %w", err)
	}

	if err := s.postRefundMoney(ctx, r); err != nil {
		s.failRefund(ctx, refundID, err)
		return nil, err
	}
	if err := s.revokeTicketCredential(ctx, r.TicketID); err != nil {
		// The money is already posted and deduped, so a failure here must not mark the
		// refund FAILED: retrying re-runs the postings as no-ops and comes back for the
		// credential. Leaving a live pass on a paid-out seat is the thing to avoid.
		s.failRefund(ctx, refundID, err)
		return nil, err
	}

	tag, err := s.db.Exec(ctx, `UPDATE event_tickets SET state='REFUNDED' WHERE id=$1 AND state <> 'REFUNDED'`, r.TicketID)
	if err != nil {
		s.failRefund(ctx, refundID, err)
		return nil, fmt.Errorf("events: mark ticket refunded: %w", err)
	}
	if tag.RowsAffected() == 1 {
		// Free the seat for the next buyer. Exactly once, because this block only runs
		// for the flip that actually moved the ticket.
		if _, err := s.db.Exec(ctx,
			`UPDATE event_ticket_tiers SET sold = GREATEST(sold - 1, 0)
			  WHERE id = (SELECT tier_id FROM event_tickets WHERE id=$1) AND sold > 0`, r.TicketID); err != nil {
			return nil, fmt.Errorf("events: release refunded seat: %w", err)
		}
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE event_orders SET status='REFUNDED', refunded_kobo=$2 WHERE id=$1`,
		r.OrderID, r.AmountKobo); err != nil {
		return nil, fmt.Errorf("events: mark order refunded: %w", err)
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE event_refunds SET status='REFUNDED', failure_reason='', updated_at=now() WHERE id=$1`, refundID); err != nil {
		return nil, fmt.Errorf("events: mark refund done: %w", err)
	}

	s.log(actorID, "events.refund.execute", refundID, map[string]any{"ticket": r.TicketID, "paid": r.RefundKobo})
	out, err := s.refundByID(ctx, refundID)
	if err != nil {
		return nil, err
	}
	s.notify(ctx, r.BuyerID, NotifyRefundDone, "Refund completed",
		fmt.Sprintf("%s: %d kobo returned to your wallet.", out.EventTitle, out.RefundKobo), out.EventID, out.OrderID, refundID)
	return out, nil
}

// postRefundMoney moves escrow -> the payer's wallet (the refund) and escrow ->
// platform revenue (the retained fee). Both legs are keyed on the refund id.
func (s *Service) postRefundMoney(ctx context.Context, r *Refund) error {
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	if r.RefundKobo > 0 {
		if err := s.led.Credit(ctx, r.BuyerID, "evt-refund:"+r.ID, "evt-refund:"+r.ID+":refund", escrowAcc.ID, r.RefundKobo); !alreadyApplied(err) {
			return fmt.Errorf("events: refund credit: %w", err)
		}
	}
	if r.FeeKobo > 0 {
		revAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if err != nil {
			return err
		}
		if err := s.led.PostJournal(ctx, ledger.JournalEntry{
			Reference: "evt-refund-fee:" + r.ID, IdempotencyKey: "evt-refund:" + r.ID + ":fee",
			AmountKobo: r.FeeKobo, DebitAccountID: escrowAcc.ID, CreditAccountID: revAcc.ID,
		}); !alreadyApplied(err) {
			return fmt.Errorf("events: refund fee posting: %w", err)
		}
	}
	return nil
}

// revokeTicketCredential makes a paid-out seat's pass dead. A missing or already
// terminal credential is fine (that is the state a retry lands in); anything else is
// an error, because a refund that leaves a scannable pass behind is a double-spend.
func (s *Service) revokeTicketCredential(ctx context.Context, ticketID string) error {
	var credID string
	err := s.db.QueryRow(ctx,
		`SELECT COALESCE(credential_id::text,'') FROM event_tickets WHERE id=$1`, ticketID).Scan(&credID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("events: refund credential lookup: %w", err)
	}
	if credID == "" {
		return nil
	}
	var state string
	err = s.db.QueryRow(ctx, `SELECT state FROM credentials WHERE id=$1`, credID).Scan(&state)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil
	case err != nil:
		return fmt.Errorf("events: refund credential state: %w", err)
	case state == "ACTIVE":
		if err := s.cred.Revoke(ctx, credID); err != nil {
			return fmt.Errorf("events: revoke refunded credential: %w", err)
		}
	}
	return nil
}

// failRefund records a payout failure so the queue shows it and an operator can
// retry. Best-effort on purpose: the caller already has the real error.
func (s *Service) failRefund(ctx context.Context, refundID string, cause error) {
	if _, err := s.db.Exec(ctx,
		`UPDATE event_refunds SET status='FAILED', failure_reason=$2, updated_at=now() WHERE id=$1 AND status IN ('APPROVED','PROCESSING')`,
		refundID, clampTrim(cause.Error(), 500)); err != nil {
		s.log("", "events.refund.fail_record_failed", refundID, map[string]any{"error": err.Error()})
	}
}

// assertRefundDecider: object-level authZ for the organiser path, and a pass-through
// for a caller whose route is already RBAC-gated.
func (s *Service) assertRefundDecider(ctx context.Context, r *Refund, actorID string, allowAdmin bool) error {
	if allowAdmin {
		// The route is already RBAC-gated on events.refund, and the reconciler drives
		// payouts with no interactive caller at all.
		return nil
	}
	if actorID == "" {
		return ErrValidation
	}
	if r.EventState == string(EventCancelled) {
		return ErrRefundAutomatic
	}
	_, err := s.authorizeManage(ctx, actorID, r.EventID)
	return err
}

// ListMyRefunds is the buyer's own refund history.
func (s *Service) ListMyRefunds(ctx context.Context, buyerID string) ([]Refund, error) {
	if buyerID == "" {
		return nil, ErrValidation
	}
	return s.listRefunds(ctx, ` WHERE r.buyer_id = $1 ORDER BY r.created_at DESC LIMIT 100`, buyerID)
}

// ListRefundsForEvent is an organiser's queue for one of their events.
func (s *Service) ListRefundsForEvent(ctx context.Context, callerID, eventID, status string) ([]Refund, error) {
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		return nil, err
	}
	where := " WHERE r.event_id = $1"
	args := []any{eventID}
	if st := refundStatusParam(status); st != "" {
		args = append(args, st)
		where += fmt.Sprintf(" AND r.status = $%d", len(args))
	}
	return s.listRefunds(ctx, where+" ORDER BY r.created_at DESC LIMIT 200", args...)
}

// AdminListRefunds is the platform queue: every event, oldest first, by status.
func (s *Service) AdminListRefunds(ctx context.Context, status, eventID, q string, limit, offset int) ([]Refund, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	where := " WHERE true"
	args := []any{}
	if st := refundStatusParam(status); st != "" {
		args = append(args, st)
		where += fmt.Sprintf(" AND r.status = $%d", len(args))
	}
	if eventID != "" {
		args = append(args, eventID)
		where += fmt.Sprintf(" AND r.event_id = $%d", len(args))
	}
	if term := clampTrim(q, 100); term != "" {
		args = append(args, "%"+term+"%")
		n := fmt.Sprintf("$%d", len(args))
		where += fmt.Sprintf(" AND (e.title ILIKE %[1]s OR r.reason ILIKE %[1]s OR o.booking_ref ILIKE %[1]s OR up.full_name ILIKE %[1]s)", n)
	}
	return s.listRefunds(ctx, where+" ORDER BY r.created_at ASC, r.id ASC LIMIT $"+fmt.Sprint(len(args)+1)+
		" OFFSET $"+fmt.Sprint(len(args)+2), append(args, limit, offset)...)
}

// refundStatusParam validates the status filter. An unknown value filters nothing
// rather than becoming a silent "show me everything" or an injected fragment.
func refundStatusParam(status string) string {
	st := strings.ToUpper(strings.TrimSpace(status))
	switch st {
	case RefundRequested, RefundApproved, RefundProcessing, RefundRefunded, RefundFailed, RefundRejected:
		return st
	}
	return ""
}

func (s *Service) listRefunds(ctx context.Context, tail string, args ...any) ([]Refund, error) {
	rows, err := s.db.Query(ctx, refundSelect+tail, args...)
	if err != nil {
		return nil, fmt.Errorf("events: list refunds: %w", err)
	}
	defer rows.Close()

	out := []Refund{}
	for rows.Next() {
		r, err := scanRefund(rows)
		if err != nil {
			return nil, fmt.Errorf("events: refund scan: %w", err)
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// RefundQueueStats sizes the admin and organiser queues so a badge and an SLA view
// can be built without paging the whole list.
type RefundQueueStats struct {
	Requested  int `json:"requested"`
	Processing int `json:"processing"`
	Failed     int `json:"failed"`
	Refunded   int `json:"refunded"`
	Rejected   int `json:"rejected"`
}

// GetRefundQueueStats counts live queue depth across every event (admin).
func (s *Service) GetRefundQueueStats(ctx context.Context) (*RefundQueueStats, error) {
	var st RefundQueueStats
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status='REQUESTED'),
		       COUNT(*) FILTER (WHERE status='PROCESSING'),
		       COUNT(*) FILTER (WHERE status='FAILED'),
		       COUNT(*) FILTER (WHERE status='REFUNDED'),
		       COUNT(*) FILTER (WHERE status='REJECTED')
		  FROM event_refunds`).Scan(&st.Requested, &st.Processing, &st.Failed, &st.Refunded, &st.Rejected)
	if err != nil {
		return nil, fmt.Errorf("events: refund queue stats: %w", err)
	}
	return &st, nil
}

// ReconcileRefunds re-drives payouts for approved-but-unpaid refunds (a crash or a
// gateway/ledger blip between the decision and the posting). Same refund-id keys,
// so an overlap with a manual retry cannot double-pay.
func (s *Service) ReconcileRefunds(ctx context.Context) (int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id FROM event_refunds
		 WHERE status IN ('APPROVED','PROCESSING')
		 ORDER BY random() LIMIT 50`)
	if err != nil {
		return 0, fmt.Errorf("events: list refunds to drive: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("events: list refunds to drive: %w", err)
	}
	var errs []error
	done := 0
	for _, id := range ids {
		// The reconciler is not an organiser, so it drives with the platform's
		// authority — the same allowance the admin queue uses.
		if _, err := s.ExecuteRefund(ctx, "", id, true); err != nil {
			errs = append(errs, fmt.Errorf("refund %s: %w", id, err))
			continue
		}
		done++
	}
	return done, errors.Join(errs...)
}

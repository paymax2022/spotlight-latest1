package transport

// Wallet bus path: refund truth, deferred settlement, schedule cancel and the
// lifecycle sweeper. See ADR-PRTBD-bus-wallet-fixes.
//
// The invariant this file exists to protect: a ticket is only ever marked
// payment_status='refunded' / refund_status='refunded' AFTER settlement.Refund
// has actually credited the rider's wallet. Everything else is reported
// honestly as pending / failed / manual_required.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"spotlight/backend/internal/finance/settlement"
)

// Boarding / lifecycle windows.
const (
	busBoardingOpenBefore = 3 * time.Hour    // QR scans accepted from this long before departure
	busBoardingCloseGrace = 30 * time.Minute // ...until the schedule end (arrival estimate) + this
	busDefaultTripLength  = 24 * time.Hour   // schedule "end" when no arrival_estimate was published
	busMinCutoffMinutes   = 60
	busMaxCutoffMinutes   = 1440
)

// systemActorID is the audit actor for worker-initiated transitions (transport_audit_log.admin_id is a
// NOT NULL uuid, so a non-uuid label would silently drop the audit row).
const systemActorID = "00000000-0000-0000-0000-000000000000"

// Refund statuses reported to clients and stored on bus_tickets.refund_status.
const (
	RefundNone           = "none"
	RefundPending        = "pending"
	RefundRefunded       = "refunded"
	RefundFailed         = "failed"
	RefundManualRequired = "manual_required"
)

// Error codes introduced by the bus fixes.
const (
	CodeSeatTaken             = "SEAT_TAKEN"
	CodeCancelWindowClosed    = "CANCEL_WINDOW_CLOSED"
	CodeRefundRequiresSupport = "REFUND_REQUIRES_SUPPORT"
	CodeKeyConflict           = "IDEMPOTENCY_KEY_CONFLICT"
	CodeBookingClosed         = "BOOKING_CLOSED"
	CodeProviderUnavailable   = "PROVIDER_UNAVAILABLE"
)

// BusConfig tunes the wallet bus path. Zero value is NOT valid - use
// DefaultBusConfig / NewBusConfig.
type BusConfig struct {
	// DeferredSettlement keeps the fare escrowed (refundable) until departure +
	// SettleGrace. Off = legacy settle-on-issue.
	DeferredSettlement bool
	SettleGrace        time.Duration
	// CancelCutoffMin is the default self-service cancel cutoff (minutes before
	// departure) for schedules that do not set their own; bounded 60-1440.
	CancelCutoffMin int
	// MinBookingLead is how close to departure a booking is still accepted.
	MinBookingLead time.Duration
}

// DefaultBusConfig is flag-off legacy behaviour with the documented defaults.
func DefaultBusConfig() BusConfig {
	return BusConfig{SettleGrace: 30 * time.Minute, CancelCutoffMin: 120, MinBookingLead: 15 * time.Minute}
}

// NewBusConfig builds a config from raw env values; non-positive values fall back
// to the defaults and the cutoff is clamped to [60, 1440].
func NewBusConfig(deferred bool, graceMin, cutoffMin, leadMin int) BusConfig {
	c := DefaultBusConfig()
	c.DeferredSettlement = deferred
	if graceMin > 0 {
		c.SettleGrace = time.Duration(graceMin) * time.Minute
	}
	if cutoffMin > 0 {
		c.CancelCutoffMin = ClampCutoffMinutes(cutoffMin)
	}
	if leadMin > 0 {
		c.MinBookingLead = time.Duration(leadMin) * time.Minute
	}
	return c
}

// ClampCutoffMinutes bounds a cutoff to the allowed [60, 1440] minutes.
func ClampCutoffMinutes(m int) int {
	return min(max(m, busMinCutoffMinutes), busMaxCutoffMinutes)
}

// WithBusConfig injects the wallet-bus configuration (app wiring / scheduler).
func (s *Service) WithBusConfig(c BusConfig) *Service {
	d := DefaultBusConfig()
	if c.SettleGrace <= 0 {
		c.SettleGrace = d.SettleGrace
	}
	if c.CancelCutoffMin <= 0 {
		c.CancelCutoffMin = d.CancelCutoffMin
	}
	c.CancelCutoffMin = ClampCutoffMinutes(c.CancelCutoffMin)
	if c.MinBookingLead <= 0 {
		c.MinBookingLead = d.MinBookingLead
	}
	s.bus = c
	return s
}

// busTicketNS namespaces deterministic bus ticket ids (like externalParcelID).
var busTicketNS = uuid.MustParse("5b0c4a3e-9d1f-4c6a-8e57-2f3b7a1d9c04")

// busTicketIDForKey derives the ticket id from (user, idempotency key) so a retry
// of the same booking always targets the same ticket / escrow reference.
func busTicketIDForKey(userID, idempotencyKey string) string {
	return uuid.NewSHA1(busTicketNS, []byte(userID+"|"+idempotencyKey)).String()
}

type ticketInsertErr int

const (
	ticketInsertOther ticketInsertErr = iota
	ticketInsertSeatTaken
	ticketInsertDuplicate // same idempotency key / ticket id already inserted
)

// classifyBusTicketInsertErr maps a bus_tickets INSERT error. ONLY a unique
// violation on the seat key is a SEAT_TAKEN; a duplicate key/id is a concurrent
// replay; anything else is an unexpected failure that must NOT be reported as a
// seat conflict.
func classifyBusTicketInsertErr(err error) ticketInsertErr {
	var pg *pgconn.PgError
	if !errors.As(err, &pg) || pg.Code != "23505" {
		return ticketInsertOther
	}
	switch pg.ConstraintName {
	case "bus_tickets_schedule_seat_active_uidx", "bus_tickets_schedule_id_seat_number_key":
		return ticketInsertSeatTaken
	case "bus_tickets_idempotency_key_key", "bus_tickets_pkey":
		return ticketInsertDuplicate
	}
	return ticketInsertOther
}

// busBoardingWindow is the interval in which a QR scan is accepted.
func busBoardingWindow(departure time.Time, arrival *time.Time) (open, closes time.Time) {
	end := departure.Add(busDefaultTripLength)
	if arrival != nil && arrival.After(departure) {
		end = *arrival
	}
	return departure.Add(-busBoardingOpenBefore), end.Add(busBoardingCloseGrace)
}

// validateCancelCutoff rejects an out-of-bounds per-schedule cutoff (nil = default).
func validateCancelCutoff(c *int) error {
	if c != nil && (*c < busMinCutoffMinutes || *c > busMaxCutoffMinutes) {
		return codedErr(http.StatusBadRequest, "INVALID_CUTOFF",
			fmt.Sprintf("cancel_cutoff_minutes must be between %d and %d", busMinCutoffMinutes, busMaxCutoffMinutes))
	}
	return nil
}

func formatNaira(kobo int64) string {
	return fmt.Sprintf("₦%d.%02d", kobo/100, kobo%100)
}

// ─── ticket row + cancel decision ────────────────────────────────────────────

type busTicketRow struct {
	ID, UserID, ScheduleID                string
	Status, BoardStatus, PaymentStatus    string
	RefundStatus, SettleMode, PayoutState string
	SettlementID                          *string
	SettlementStatus                      *string
	CutoffMin                             *int
	FareKobo                              int64
	Departure                             time.Time
	SchedStatus                           string
	SeatNumber                            int
	PassengerName, QRCode                 string
	PassengerPhone                        *string
	CreatedAt                             time.Time
	Arrival                               *time.Time
	OriginTerminal, DestTerminal          string
	OperatorName                          string
}

const busTicketSelect = `
	SELECT t.id, t.user_id, t.schedule_id, t.status, t.boarding_status, t.payment_status,
	       t.refund_status, t.settle_mode, t.payout_state, t.settlement_id::text, st.status,
	       t.cancel_cutoff_minutes, t.fare_kobo, s.departure_time, s.status,
	       t.seat_number, t.passenger_name, t.qr_code, t.passenger_phone, t.created_at, s.arrival_estimate,
	       COALESCE(r.from_city, r.origin_terminal), COALESCE(r.to_city, r.dest_terminal), COALESCE(p.business_name, '')
	FROM bus_tickets t
	JOIN bus_schedules s ON s.id = t.schedule_id
	JOIN bus_routes r ON r.id = s.route_id
	LEFT JOIN bus_providers p ON p.id = r.provider_id
	LEFT JOIN settlements st ON st.id = t.settlement_id`

func scanBusTicketRow(row pgx.Row) (*busTicketRow, error) {
	var t busTicketRow
	if err := row.Scan(&t.ID, &t.UserID, &t.ScheduleID, &t.Status, &t.BoardStatus, &t.PaymentStatus,
		&t.RefundStatus, &t.SettleMode, &t.PayoutState, &t.SettlementID, &t.SettlementStatus,
		&t.CutoffMin, &t.FareKobo, &t.Departure, &t.SchedStatus,
		&t.SeatNumber, &t.PassengerName, &t.QRCode, &t.PassengerPhone, &t.CreatedAt, &t.Arrival,
		&t.OriginTerminal, &t.DestTerminal, &t.OperatorName); err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Service) loadBusTicket(ctx context.Context, id string) (*busTicketRow, error) {
	t, err := scanBusTicketRow(s.db.QueryRow(ctx, busTicketSelect+` WHERE t.id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "ticket not found")
	}
	return t, err
}

type cancelVerdict int

const (
	verdictReject    cancelVerdict = iota
	verdictProceed                 // claim the ticket, then refund
	verdictResume                  // already cancelled; finish the refund
	verdictAlreadyOK               // terminal: nothing to do (refunded / manual_required)
)

// cancelDeadline is the last instant a self-service cancel is accepted: departure
// minus the frozen cutoff for deferred tickets, departure itself otherwise.
func (t *busTicketRow) cancelDeadline() time.Time {
	if t.SettleMode == "deferred" && t.CutoffMin != nil {
		return t.Departure.Add(-time.Duration(*t.CutoffMin) * time.Minute)
	}
	return t.Departure
}

// decideBusCancel is the pure cancel policy (no I/O) so it is exhaustively
// unit-testable. byUser enforces the departure + cutoff rules; operator-driven
// cancels (schedule cancel) skip them.
func decideBusCancel(t *busTicketRow, now time.Time, byUser bool) (cancelVerdict, *CodedError) {
	if t.Status == "cancelled" || t.Status == "refunded" {
		switch t.RefundStatus {
		case RefundRefunded, RefundManualRequired:
			return verdictAlreadyOK, nil
		case RefundPending, RefundFailed:
			return verdictResume, nil
		}
		// Legacy rows cancelled by the old code: status flipped but no money moved.
		return verdictReject, codedErr(http.StatusConflict, CodeInvalidState,
			"this ticket was already cancelled; if you were not refunded please contact support")
	}
	if t.Status == "completed" || (byUser && (t.Status == "boarded" || t.BoardStatus != "issued")) {
		return verdictReject, codedErr(http.StatusConflict, CodeInvalidState, "ticket cannot be cancelled")
	}
	if byUser && !now.Before(t.Departure) {
		return verdictReject, codedErr(http.StatusConflict, CodeInvalidState, "the departure time has passed; this ticket can no longer be cancelled")
	}
	if t.SettlementID == nil || t.SettlementStatus == nil {
		return verdictReject, codedErr(http.StatusConflict, CodeRefundRequiresSupport,
			"this ticket has no refundable payment on record; please contact support")
	}
	switch *t.SettlementStatus {
	case string(settlement.StatusRefunded):
		return verdictResume, nil // money already moved; finish the bookkeeping
	case string(settlement.StatusEscrowed):
		if t.PayoutState == "releasing" {
			return verdictReject, codedErr(http.StatusConflict, CodeInvalidState, "the payout for this ticket is being processed; please try again shortly")
		}
		if byUser && t.SettleMode == "deferred" && now.After(t.cancelDeadline()) {
			mins := 0
			if t.CutoffMin != nil {
				mins = *t.CutoffMin
			}
			return verdictReject, codedErr(http.StatusConflict, CodeCancelWindowClosed,
				fmt.Sprintf("cancellation closed %d minutes before departure; this ticket can no longer be cancelled", mins))
		}
		return verdictProceed, nil
	case string(settlement.StatusSettled), string(settlement.StatusReleasing):
		return verdictReject, codedErr(http.StatusConflict, CodeRefundRequiresSupport,
			"this fare has already been paid out to the operator and cannot be refunded automatically; please contact support")
	default:
		return verdictReject, codedErr(http.StatusConflict, CodeInvalidState, "ticket cannot be cancelled while its payment is "+*t.SettlementStatus)
	}
}

// BusCancelResult is the truthful outcome of a cancel (also used by event bookings).
type BusCancelResult struct {
	Status       string `json:"status"`
	RefundStatus string `json:"refund_status"`
	RefundedKobo int64  `json:"refunded_kobo"`
	Message      string `json:"message"`
}

// HTTPStatus is 200 only when money actually returned (or nothing was owed);
// 202 while a refund is still pending/failed.
func (r *BusCancelResult) HTTPStatus() int {
	if r.RefundStatus == RefundPending || r.RefundStatus == RefundFailed {
		return http.StatusAccepted
	}
	return http.StatusOK
}

func cancelResult(refundStatus string, fare int64) *BusCancelResult {
	r := &BusCancelResult{Status: "cancelled", RefundStatus: refundStatus}
	switch refundStatus {
	case RefundRefunded:
		r.RefundedKobo = fare
		r.Message = fmt.Sprintf("Ticket cancelled. %s has been returned to your wallet.", formatNaira(fare))
	case RefundPending, RefundFailed:
		r.Message = "Ticket cancelled. Your refund has not been returned yet; we are retrying it automatically."
	case RefundManualRequired:
		r.Message = "Ticket cancelled. Your fare was already paid out to the operator, so support will refund you manually."
	default:
		r.Message = "Ticket cancelled."
	}
	return r
}

// CancelBusTicket cancels a ticket for its owner and refunds the wallet when -
// and only when - the fare is still in escrow.
func (s *Service) CancelBusTicket(ctx context.Context, id, userID, reason string) (*BusCancelResult, error) {
	t, err := s.loadBusTicket(ctx, id)
	if err != nil {
		return nil, err
	}
	if t.UserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your ticket")
	}
	return s.cancelBusTicketCore(ctx, t, userID, reason, true)
}

// cancelBusTicketCore runs the cancel state machine: decide -> CAS-claim the
// ticket -> settlement.Refund -> finalize. byUser=false is the operator path
// (schedule cancel / sweepers): no departure/cutoff rules, and an already-paid-out
// (or disputed) ticket is recorded as manual_required instead of being rejected.
func (s *Service) cancelBusTicketCore(ctx context.Context, t *busTicketRow, actorID, reason string, byUser bool) (*BusCancelResult, error) {
	verdict, cerr := decideBusCancel(t, time.Now(), byUser)
	if cerr != nil {
		disputed := t.SettlementStatus != nil && *t.SettlementStatus == string(settlement.StatusDisputed)
		if !byUser && (cerr.Code == CodeRefundRequiresSupport || disputed) {
			return s.markManualRefund(ctx, t, actorID, reason)
		}
		return nil, cerr
	}
	if verdict == verdictAlreadyOK {
		return cancelResult(t.RefundStatus, t.FareKobo), nil
	}
	// Claim the ticket (invalidates the QR, frees the seat) whenever it is still
	// ACTIVE - including the case where the settlement was already refunded
	// out-of-band (Resume on a live ticket): the ticket must never stay valid
	// while we report a refund.
	if t.Status != "cancelled" && t.Status != "refunded" {
		claimSQL := `UPDATE bus_tickets
			SET status='cancelled', refund_status='pending', cancel_reason=$2, cancelled_at=NOW()
			WHERE id=$1 AND status IN ('booked','issued') AND boarding_status='issued'
			  AND payout_state IN ('held','released')`
		if !byUser {
			claimSQL = `UPDATE bus_tickets
				SET status='cancelled', refund_status='pending', cancel_reason=$2, cancelled_at=NOW()
				WHERE id=$1 AND status NOT IN ('cancelled','refunded','completed')
				  AND payout_state IN ('held','released')`
		}
		tag, err := s.db.Exec(ctx, claimSQL, t.ID, reason)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			return nil, codedErr(http.StatusConflict, CodeInvalidState, "the ticket changed state while cancelling; please check it and try again")
		}
	}
	return s.refundCancelledBusTicket(ctx, t, actorID, reason)
}

// storedRefundResult re-reads the persisted refund_status after a conditional
// UPDATE matched no row, so the API reports what is actually stored.
func (s *Service) storedRefundResult(ctx context.Context, t *busTicketRow) *BusCancelResult {
	var rs string
	if err := s.db.QueryRow(ctx, `SELECT refund_status FROM bus_tickets WHERE id=$1`, t.ID).Scan(&rs); err != nil || rs == RefundNone {
		return cancelResult(RefundPending, t.FareKobo) // unknown: never claim money moved
	}
	return cancelResult(rs, t.FareKobo)
}

// refundCancelledBusTicket posts the wallet refund for an already-claimed
// (status='cancelled') ticket and records the TRUE outcome.
func (s *Service) refundCancelledBusTicket(ctx context.Context, t *busTicketRow, actorID, reason string) (*BusCancelResult, error) {
	if t.SettlementID == nil {
		return nil, codedErr(http.StatusConflict, CodeRefundRequiresSupport, "no refundable payment on record; please contact support")
	}
	if refundErr := s.settlement.Refund(ctx, *t.SettlementID, "bus_cancelled:"+reason); refundErr != nil {
		switch st := s.settlementStatus(ctx, *t.SettlementID); st {
		case string(settlement.StatusRefunded):
			// money already moved elsewhere: fall through to finalize the bookkeeping
		case string(settlement.StatusSettled), string(settlement.StatusReleasing), string(settlement.StatusDisputed):
			// The fare cannot come back through the wallet path: park for ops, never
			// 'failed' + endless retry.
			log.Printf("[transport] ALERT bus refund impossible ticket=%s settlement=%s status=%s: manual refund required", t.ID, *t.SettlementID, st)
			return s.markManualRefund(ctx, t, actorID, reason)
		default:
			// Money did NOT move. Say so, and leave it to the retry sweeper / a re-call.
			log.Printf("[transport] bus refund FAILED ticket=%s settlement=%s: %v", t.ID, *t.SettlementID, refundErr)
			if tag, err := s.db.Exec(ctx, `UPDATE bus_tickets SET refund_status='failed' WHERE id=$1 AND refund_status IN ('pending','failed')`, t.ID); err == nil && tag.RowsAffected() == 0 {
				return s.storedRefundResult(ctx, t), nil
			}
			s.recordModeEvent(ctx, actorID, "bus.cancel_refund_failed", "bus_ticket", t.ID, "cancelled", "cancelled",
				map[string]any{"reason": reason, "refund_status": RefundFailed})
			return cancelResult(RefundFailed, t.FareKobo), nil
		}
	}
	// The wallet credit is posted: ONLY NOW is the ticket marked refunded.
	tag, err := s.db.Exec(ctx, `
		UPDATE bus_tickets SET payment_status='refunded', refund_status='refunded', refunded_at=NOW()
		WHERE id=$1 AND status='cancelled' AND refund_status IN ('pending','failed')`, t.ID)
	if err != nil {
		// Refund posted but bookkeeping failed: stay 'pending' (the sweeper resumes
		// via the settlement='refunded' branch) - never claim more or less than we know.
		log.Printf("[transport] bus refund posted but ticket finalize failed ticket=%s: %v", t.ID, err)
		return cancelResult(RefundPending, t.FareKobo), nil
	}
	if tag.RowsAffected() == 0 {
		return s.storedRefundResult(ctx, t), nil
	}
	s.recordModeEvent(ctx, actorID, "bus.cancelled", "bus_ticket", t.ID, t.Status, "cancelled",
		map[string]any{"reason": reason, "refund_status": RefundRefunded, "refunded_kobo": t.FareKobo})
	return cancelResult(RefundRefunded, t.FareKobo), nil
}

// markManualRefund cancels a ticket whose fare was already paid out (or is
// disputed): it is NOT refunded, and says so. Idempotent: an already
// manual_required / refunded ticket is left alone (no repeat audit).
func (s *Service) markManualRefund(ctx context.Context, t *busTicketRow, actorID, reason string) (*BusCancelResult, error) {
	tag, err := s.db.Exec(ctx, `
		UPDATE bus_tickets SET status='cancelled', refund_status='manual_required', cancel_reason=$2,
		       cancelled_at=COALESCE(cancelled_at, NOW())
		WHERE id=$1 AND status NOT IN ('refunded','completed') AND refund_status NOT IN ('refunded','manual_required')`, t.ID, reason)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return s.storedRefundResult(ctx, t), nil
	}
	s.recordModeEvent(ctx, actorID, "bus.cancelled_manual_refund_required", "bus_ticket", t.ID, t.Status, "cancelled",
		map[string]any{"reason": reason, "refund_status": RefundManualRequired, "fare_kobo": t.FareKobo})
	return cancelResult(RefundManualRequired, t.FareKobo), nil
}

// settlementStatus reads a settlement's status ("" when unreadable).
func (s *Service) settlementStatus(ctx context.Context, settlementID string) string {
	var st string
	if err := s.db.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, settlementID).Scan(&st); err != nil {
		return ""
	}
	return st
}

// ─── settlement (immediate + deferred) ───────────────────────────────────────

// settleBusTicket pays the provider from the escrowed fare using the split and
// recipient FROZEN on the ticket at booking time (never re-reading
// transport_commission_config). It CAS-claims payout_state held->releasing first,
// which is what makes it mutually exclusive with cancel (cancel claims on
// payout_state IN ('held','released') and rejects 'releasing'). Returns
// (settled, err); (false, nil) means the ticket is not eligible (cancelled,
// already released, ...).
func (s *Service) settleBusTicket(ctx context.Context, ticketID string) (bool, error) {
	var settID, settleUser *string
	var userID string
	var provPct, platPct *float64
	var fare int64
	var claimedAt time.Time
	// Claim 'held' only; a 'releasing' claim is re-claimable only when STALE (the
	// previous settler died). A fresh claim is never stolen, so two settlers cannot
	// overlap. A ticket on a cancelled schedule is never paid out.
	err := s.db.QueryRow(ctx, `
		UPDATE bus_tickets SET payout_state='releasing', payout_claimed_at=NOW()
		WHERE id=$1 AND status NOT IN ('cancelled','refunded')
		  AND ( payout_state='held'
		     OR (payout_state='releasing' AND (payout_claimed_at IS NULL OR payout_claimed_at < NOW() - INTERVAL '5 minutes')) )
		  AND NOT EXISTS (SELECT 1 FROM bus_schedules sc WHERE sc.id = bus_tickets.schedule_id AND sc.status='cancelled')
		RETURNING settlement_id::text, settle_user_id::text, provider_pct, platform_pct, user_id::text, fare_kobo, payout_claimed_at`, ticketID).
		Scan(&settID, &settleUser, &provPct, &platPct, &userID, &fare, &claimedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// Give the claim back only if it is still OURS and the money has not moved.
	revert := func() {
		_, _ = s.db.Exec(ctx, `
			UPDATE bus_tickets SET payout_state='held', payout_claimed_at=NULL
			WHERE id=$1 AND payout_state='releasing' AND payout_claimed_at=$2
			  AND EXISTS (SELECT 1 FROM settlements st WHERE st.id = bus_tickets.settlement_id AND st.status='escrowed')`, ticketID, claimedAt)
	}
	if settID == nil || settleUser == nil || provPct == nil || platPct == nil {
		revert()
		return false, fmt.Errorf("transport: bus ticket %s has no frozen settlement terms; refusing to settle (fail closed)", ticketID)
	}
	split := settlement.Split{ProviderID: *settleUser, ProviderPct: *provPct, PlatformPct: *platPct}
	if err := s.settlement.Settle(ctx, *settID, split); err != nil && s.settlementStatus(ctx, *settID) != string(settlement.StatusSettled) {
		revert()
		return false, fmt.Errorf("transport: settle bus ticket: %w", err)
	}
	if _, err := s.db.Exec(ctx, `UPDATE bus_tickets SET payout_state='released', settled_at=NOW() WHERE id=$1`, ticketID); err != nil {
		return true, fmt.Errorf("transport: bus ticket settled but payout_state flip failed (sweeper will reconcile): %w", err)
	}
	// Realized Spotlight profit is recorded ONLY once the fare has actually been
	// paid out, with the platform cut taken from the FROZEN split (the exact kobo the
	// settlement legs moved), never from live config. Best-effort + idempotent.
	platformKobo := int64(0)
	if legs, lerr := settlement.ComputeLegs(fare, split); lerr == nil {
		platformKobo = legs.PlatformKobo
	}
	booker := userID
	s.recordCommissionExactSafe(ctx, "Lifestyle", "Bus Booking", "", fare, platformKobo, ticketID, &booker)
	s.recordModeEvent(ctx, *settleUser, "bus.settled", "bus_ticket", ticketID, "held", "released",
		map[string]any{"settlement_id": *settID, "fare_kobo": fare, "platform_kobo": platformKobo})
	return true, nil
}

// SettleDueBusTickets releases deferred tickets whose departure + grace has
// passed (and heals immediate-mode tickets whose settle failed at booking).
func (s *Service) SettleDueBusTickets(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(ctx, `
		SELECT t.id::text FROM bus_tickets t JOIN bus_schedules s ON s.id = t.schedule_id
		WHERE t.payout_state IN ('held','releasing') AND t.status NOT IN ('cancelled','refunded')
		  AND s.status <> 'cancelled'
		  AND ( (t.settle_mode='deferred' AND s.departure_time + make_interval(secs => $1) <= NOW())
		     OR (t.settle_mode='immediate' AND t.created_at < NOW() - INTERVAL '10 minutes') )
		ORDER BY s.departure_time LIMIT $2`, s.bus.SettleGrace.Seconds(), limit)
	if err != nil {
		return 0, err
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
	n := 0
	for _, id := range ids {
		ok, err := s.settleBusTicket(ctx, id)
		if err != nil {
			log.Printf("[transport] bus settle sweep ticket=%s: %v", id, err)
			continue
		}
		if ok {
			n++
		}
	}
	return n, nil
}

// RetryOpenBusRefunds resumes cancelled tickets whose refund is pending/failed.
func (s *Service) RetryOpenBusRefunds(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(ctx, `
		SELECT id::text, user_id::text FROM bus_tickets
		WHERE status='cancelled' AND refund_status IN ('pending','failed')
		  AND cancelled_at < NOW() - INTERVAL '1 minute'
		ORDER BY cancelled_at LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	type pair struct{ id, user string }
	var ps []pair
	for rows.Next() {
		var p pair
		if err := rows.Scan(&p.id, &p.user); err != nil {
			rows.Close()
			return 0, err
		}
		ps = append(ps, p)
	}
	rows.Close()
	n := 0
	for _, p := range ps {
		t, err := s.loadBusTicket(ctx, p.id)
		if err != nil {
			continue
		}
		res, err := s.cancelBusTicketCore(ctx, t, systemActorID, "refund_retry", false)
		if err != nil {
			log.Printf("[transport] bus refund retry ticket=%s: %v", p.id, err)
			continue
		}
		if res.RefundStatus == RefundRefunded {
			n++
		}
	}
	return n, nil
}

// LifecycleCounts reports what AdvanceBusLifecycle changed.
type LifecycleCounts struct{ Departed, Completed, TicketsCompleted, NoShow int64 }

// AdvanceBusLifecycle writes the states nothing wrote before: schedule
// scheduled|boarding -> departed -> completed (end + grace), boarded tickets ->
// completed, never-boarded tickets -> boarding_status 'no_show' (once the
// boarding window has closed). Plain conditional UPDATEs: idempotent.
func (s *Service) AdvanceBusLifecycle(ctx context.Context) (LifecycleCounts, error) {
	var c LifecycleCounts
	graceSecs := busBoardingCloseGrace.Seconds()
	tripSecs := busDefaultTripLength.Seconds()
	steps := []struct {
		dst *int64
		sql string
		arg []any
	}{
		{&c.Departed, `UPDATE bus_schedules SET status='departed'
			WHERE status IN ('scheduled','boarding') AND departure_time <= NOW()`, nil},
		{&c.Completed, `UPDATE bus_schedules SET status='completed'
			WHERE status='departed'
			  AND (CASE WHEN arrival_estimate > departure_time THEN arrival_estimate ELSE departure_time + make_interval(secs => $2) END) + make_interval(secs => $1) <= NOW()`,
			[]any{graceSecs, tripSecs}},
		{&c.TicketsCompleted, `UPDATE bus_tickets SET status='completed'
			WHERE status='boarded' AND boarding_status='boarded'
			  AND schedule_id IN (SELECT id FROM bus_schedules WHERE status='completed')`, nil},
		{&c.NoShow, `UPDATE bus_tickets SET boarding_status='no_show'
			WHERE boarding_status='issued' AND status IN ('booked','issued')
			  AND schedule_id IN (SELECT id FROM bus_schedules WHERE status='completed')`, nil},
	}
	for _, st := range steps {
		tag, err := s.db.Exec(ctx, st.sql, st.arg...)
		if err != nil {
			return c, err
		}
		*st.dst = tag.RowsAffected()
	}
	return c, nil
}

// CancelTicketsOnCancelledSchedules finishes what a schedule cancel started: any
// ACTIVE ticket whose schedule is cancelled (e.g. it was booked in a race, or an
// earlier cancel run was interrupted) is cancelled + refunded through the same CAS
// machine (operator path). Paid-out tickets become manual_required.
func (s *Service) CancelTicketsOnCancelledSchedules(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(ctx, `
		SELECT t.id::text FROM bus_tickets t JOIN bus_schedules s ON s.id = t.schedule_id
		WHERE s.status='cancelled' AND t.status NOT IN ('cancelled','refunded','completed')
		ORDER BY t.created_at LIMIT $1`, limit)
	if err != nil {
		return 0, err
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
	n := 0
	for _, id := range ids {
		t, err := s.loadBusTicket(ctx, id)
		if err != nil {
			continue
		}
		if _, err := s.cancelBusTicketCore(ctx, t, systemActorID, "schedule_cancelled_sweep", false); err != nil {
			log.Printf("[transport] cancelled-schedule sweep ticket=%s: %v", id, err)
			continue
		}
		n++
	}
	return n, nil
}

// ReverseOrphanBusEscrows refunds wallet escrows made for a bus booking that never
// produced a ticket (a crash between Escrow and the ticket insert). Only rows older
// than 10 minutes with NO ticket pointing at them are touched.
func (s *Service) ReverseOrphanBusEscrows(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(ctx, `
		SELECT st.id::text FROM settlements st
		WHERE st.module_type='transport' AND st.reference LIKE 'bus:%' AND st.status='escrowed'
		  AND st.funding_source='wallet' AND st.escrowed_at < NOW() - INTERVAL '10 minutes'
		  AND NOT EXISTS (SELECT 1 FROM bus_tickets t WHERE t.settlement_id = st.id)
		ORDER BY st.escrowed_at LIMIT $1`, limit)
	if err != nil {
		return 0, err
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
	n := 0
	for _, id := range ids {
		if err := s.settlement.Refund(ctx, id, "bus_orphan_escrow"); err != nil {
			log.Printf("[transport] orphan bus escrow reversal settlement=%s: %v", id, err)
			continue
		}
		s.recordModeEvent(ctx, systemActorID, "bus.orphan_escrow_reversed", "settlement", id, "escrowed", "refunded", nil)
		n++
	}
	return n, nil
}

// RunBusSweep is the worker entry point. Always on (no flag): bus + event refund
// retries, finishing cancelled schedules, reversing orphan escrows, and settling due
// deferred tickets (settlement is safe regardless of this process's flag - the flag
// only controls whether NEW tickets are deferred, so a worker whose flag differs
// from the API's still drains what the API created). lifecycle=true additionally
// advances schedule/ticket states. The first error is returned.
func (s *Service) RunBusSweep(ctx context.Context, lifecycle bool) (settled, refunded int, lc LifecycleCounts, err error) {
	if !s.bus.DeferredSettlement {
		var held int
		if qerr := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM bus_tickets WHERE settle_mode='deferred' AND payout_state IN ('held','releasing') AND status NOT IN ('cancelled','refunded')`).Scan(&held); qerr == nil && held > 0 {
			log.Printf("[transport] FLAG MISMATCH: this worker has FEATURE_TRANSPORT_BUS_DEFERRED_SETTLEMENT off but %d deferred bus ticket(s) are awaiting payout - the API has it on; align the flag. Draining them anyway.", held)
		}
	}
	if refunded, err = s.RetryOpenBusRefunds(ctx, 100); err != nil {
		return
	}
	if _, err = s.RetryOpenEventRefunds(ctx, 100); err != nil {
		return
	}
	if _, err = s.CancelTicketsOnCancelledSchedules(ctx, 100); err != nil {
		return
	}
	if _, err = s.ReverseOrphanBusEscrows(ctx, 100); err != nil {
		return
	}
	if settled, err = s.SettleDueBusTickets(ctx, 100); err != nil {
		return
	}
	if lifecycle {
		lc, err = s.AdvanceBusLifecycle(ctx)
	}
	return
}

// ─── schedule cancel ─────────────────────────────────────────────────────────

// BusScheduleCancelResult summarises a schedule cancel.
type BusScheduleCancelResult struct {
	ScheduleID     string `json:"schedule_id"`
	Status         string `json:"status"`
	TicketsTotal   int    `json:"tickets_total"`
	Refunded       int    `json:"refunded"`
	Pending        int    `json:"pending"`
	Failed         int    `json:"failed"`
	ManualRequired int    `json:"manual_required"`
	Complete       bool   `json:"complete"`
}

// CancelProviderSchedule cancels one of the caller's own schedules.
func (s *Service) CancelProviderSchedule(ctx context.Context, userID, scheduleID, reason string) (*BusScheduleCancelResult, error) {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	var owner *string
	if err := s.db.QueryRow(ctx, `
		SELECT r.provider_id::text FROM bus_schedules s JOIN bus_routes r ON r.id = s.route_id WHERE s.id=$1`, scheduleID).
		Scan(&owner); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "schedule not found")
	}
	if owner == nil || *owner != providerID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your schedule")
	}
	// A provider can only cancel BEFORE departure (force=false).
	return s.cancelBusSchedule(ctx, userID, scheduleID, reason, false)
}

// CancelBusSchedule is the admin entry point (RBAC enforced at the route).
// force=true lets an admin cancel a schedule whose departure time has passed but which
// the lifecycle sweeper has not yet marked departed (audited).
func (a *AdminService) CancelBusSchedule(ctx context.Context, adminID, scheduleID, reason string, force bool) (*BusScheduleCancelResult, error) {
	return a.svc.cancelBusSchedule(ctx, adminID, scheduleID, reason, force)
}

// cancelBusSchedule marks the schedule cancelled, then refunds every active ticket
// through the same CAS-claimed state machine as a user cancel. Idempotent and
// RESUMABLE: re-calling only processes tickets that are not finished.
func (s *Service) cancelBusSchedule(ctx context.Context, actorID, scheduleID, reason string, force bool) (*BusScheduleCancelResult, error) {
	var status string
	var departure time.Time
	if err := s.db.QueryRow(ctx, `SELECT status, departure_time FROM bus_schedules WHERE id=$1`, scheduleID).Scan(&status, &departure); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "schedule not found")
	}
	if status == "departed" || status == "completed" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "the schedule has already departed and cannot be cancelled")
	}
	if status != "cancelled" {
		if !force && !departure.After(time.Now()) {
			return nil, codedErr(http.StatusConflict, CodeInvalidState, "the departure time has passed; this schedule can no longer be cancelled")
		}
		// The status flip takes the schedule row lock; BookBusTicket inserts under
		// FOR SHARE on the same row, so no booking can slip in after this commits.
		tag, err := s.db.Exec(ctx, `UPDATE bus_schedules SET status='cancelled' WHERE id=$1 AND status IN ('scheduled','boarding')`, scheduleID)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			// Lost a race (e.g. the sweeper marked it departed). Only carry on if it is
			// now cancelled; otherwise abort without touching any ticket.
			var now string
			if err := s.db.QueryRow(ctx, `SELECT status FROM bus_schedules WHERE id=$1`, scheduleID).Scan(&now); err != nil || now != "cancelled" {
				return nil, codedErr(http.StatusConflict, CodeInvalidState, "the schedule changed state and can no longer be cancelled")
			}
		} else {
			s.recordModeEvent(ctx, actorID, "bus.schedule.cancelled", "bus_schedule", scheduleID, status, "cancelled",
				map[string]any{"reason": reason, "force": force})
		}
	}
	rows, err := s.db.Query(ctx, `
		SELECT id::text FROM bus_tickets
		WHERE schedule_id=$1
		  AND ( status NOT IN ('cancelled','refunded','completed')
		     OR (status='cancelled' AND refund_status IN ('pending','failed')) )
		ORDER BY seat_number`, scheduleID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()

	for _, id := range ids {
		t, err := s.loadBusTicket(ctx, id)
		if err == nil {
			_, err = s.cancelBusTicketCore(ctx, t, actorID, "schedule_cancelled:"+reason, false)
		}
		if err != nil {
			log.Printf("[transport] schedule cancel ticket=%s: %v", id, err)
		}
	}
	// Report the TRUE persisted state (not just this run's tally) so a resumed or
	// repeated call returns the same honest summary.
	res := &BusScheduleCancelResult{ScheduleID: scheduleID, Status: "cancelled"}
	srows, err := s.db.Query(ctx, `
		SELECT CASE WHEN status IN ('cancelled','refunded') THEN refund_status ELSE 'active' END, COUNT(*)
		FROM bus_tickets WHERE schedule_id=$1 AND status <> 'completed' GROUP BY 1`, scheduleID)
	if err != nil {
		return nil, err
	}
	defer srows.Close()
	for srows.Next() {
		var k string
		var n int
		if err := srows.Scan(&k, &n); err != nil {
			return nil, err
		}
		res.TicketsTotal += n
		switch k {
		case RefundRefunded:
			res.Refunded += n
		case RefundManualRequired:
			res.ManualRequired += n
		case RefundPending, "active":
			res.Pending += n
		case RefundFailed:
			res.Failed += n
		}
	}
	res.Complete = res.Pending == 0 && res.Failed == 0
	return res, srows.Err()
}

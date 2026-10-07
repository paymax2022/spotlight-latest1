package transport

// Shared foundation for CARD-DIRECT (Paystack-funded, no wallet, no KYC-tier
// gate) bookings of every non-ride Mobility service. See
// docs/adr/ADR-PRTBD-mobility-card-direct.md.
//
// Rides keep their own, older seam (SetExternalRefunder + payment_method =
// "paystack"). Every other service uses the pieces here:
//
//   - SetDomainExternalRefunder / refundSettlement: ONE refund choke point.
//     Whether a settlement is wallet- or card-funded is read from
//     settlements.funding_source (written by Escrow / EscrowExternal), so no
//     per-entity "payment_method" column or migration is needed and a refund
//     can never pick the wrong rail: card-funded money is NEVER credited into
//     a wallet (that would give a Tier-0 user spendable balance funded by an
//     external charge), and wallet-funded money is never sent to the gateway.
//   - NewCodedError: lets the paystackcheckout package return the same
//     machine-readable errors transport does.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// reservedIdempotencyPrefixes are the namespaces the card-direct engine and the
// existing Paystack checkouts own: a card-direct settlement / parcel is keyed by
// the FULL Paystack reference ("parcelorder:<key>"), so a wallet booking whose
// own key starts with one could collide with — or be mistaken for — someone's
// card-funded booking (Find, Escrow idempotency and EscrowExternal replay all
// resolve by that key). Includes the reserved prefixes of the not-yet-built
// services (docs/adr/ADR-PRTBD-mobility-card-direct.md).
var reservedIdempotencyPrefixes = []string{
	"parcelorder:", "rideorder:", "foodorder:", "duespay:", "feespay:",
	"towingorder:", "moversorder:", "carhireorder:", "busorder:", "eventorder:",
}

// IsReservedIdempotencyKey reports whether a WALLET-path idempotency key lies in
// a namespace the card-direct engine (or another Paystack checkout) owns.
// Case-insensitive.
func IsReservedIdempotencyKey(key string) bool {
	k := strings.ToLower(strings.TrimSpace(key))
	for _, p := range reservedIdempotencyPrefixes {
		if strings.HasPrefix(k, p) {
			return true
		}
	}
	return false
}

// NewCodedError builds a *CodedError for adapters outside this package.
func NewCodedError(status int, code, msg string) *CodedError { return codedErr(status, code, msg) }

// ErrNoExternalRefunder means a card-funded settlement needs refunding but no
// refunder is wired for its domain (flag off / mis-wired). It FAILS CLOSED —
// the money stays escrowed and the caller logs for manual reconciliation —
// rather than falling back to a wallet credit.
var ErrNoExternalRefunder = errors.New("transport: no external refunder wired for domain")

// SetDomainExternalRefunder registers the card-direct refunder for one
// non-ride domain. Wiring-time only (not safe for concurrent use with
// refunds). nil is ignored.
func (s *Service) SetDomainExternalRefunder(domain string, r ExternalRefunder) {
	if r == nil || domain == "" {
		return
	}
	if s.domainRefunders == nil {
		s.domainRefunders = map[string]ExternalRefunder{}
	}
	s.domainRefunders[domain] = r
}

// settlementFundedExternally reports whether settlementID was funded by an
// external rail (EscrowExternal). Any lookup failure is returned, never
// guessed: callers must not pick a refund rail on a guess.
func (s *Service) settlementFundedExternally(ctx context.Context, settlementID string) (bool, error) {
	var funding string
	if err := s.db.QueryRow(ctx, `SELECT funding_source FROM settlements WHERE id=$1`, settlementID).Scan(&funding); err != nil {
		return false, fmt.Errorf("transport: resolve settlement funding source: %w", err)
	}
	return funding == "external", nil
}

// refundSettlement is the single refund path for every non-ride service. It
// picks the rail from the settlement itself:
//
//	funding_source = 'external' → the domain's ExternalRefunder (gateway
//	                              reversal + settlement.RefundExternal)
//	otherwise                   → settlement.Refund (wallet credit)
//
// entityID is the booked entity's id (parcel id, …) — the refunder uses it to
// find the Paystack reference. Returns the error so callers can decide;
// wallet-path callers historically ignored it and may continue to.
func (s *Service) refundSettlement(ctx context.Context, domain, entityID, settlementID, reason string) error {
	external, err := s.settlementFundedExternally(ctx, settlementID)
	if err != nil {
		return err
	}
	if !external {
		return s.settlement.Refund(ctx, settlementID, reason)
	}
	r := s.domainRefunders[domain]
	if r == nil {
		log.Printf("[transport] cannot refund card-funded settlement=%s %s=%s (reason=%s): no external refunder wired — needs manual reconciliation", settlementID, domain, entityID, reason)
		return fmt.Errorf("%w: %s", ErrNoExternalRefunder, domain)
	}
	return r.RefundExternalSettlement(ctx, entityID, settlementID, reason)
}

// Refund-domain names: the SINGLE definition of the strings the cancel paths
// file refunds under (refundSettlement's `domain`) AND the card-direct engine
// registers its refunder under (each adapter's Name()). A mismatch would make
// cancel fail closed with "no refunder wired" — or worse, hand a refund to the
// wrong adapter — so paystackcheckout and internal/app pin them equal.
const (
	RefundDomainParcel = "parcel"
	RefundDomainTowing = "towing"
	RefundDomainMovers = "movers"
)

// refund_status values reported by the cancel endpoints. The honest answer to
// "is my money back?":
//
//	none      no escrow existed for this booking
//	refunded  the refund completed (card: the gateway accepted it; wallet: credited)
//	pending   the booking IS cancelled but the CARD refund has not completed; it
//	          is retried by re-POSTing cancel and by the reconciliation sweep
//	failed    a WALLET refund failed after the cancel (historical best-effort
//	          path; needs manual reconciliation — nothing retries it)
const (
	RefundStatusNone     = "none"
	RefundStatusRefunded = "refunded"
	RefundStatusPending  = "pending"
	RefundStatusFailed   = "failed"
)

// CancelResult is what the cancel endpoints report beyond "the status flipped".
type CancelResult struct {
	RefundStatus string `json:"refund_status"`
}

// maxCancelReasonRunes bounds a customer-supplied cancel reason before it is
// carried into settlement/ledger refund descriptions (L-b).
const maxCancelReasonRunes = 200

// capCancelReason strips control characters and caps the reason at
// maxCancelReasonRunes RUNES (never splitting a multi-byte character).
func capCancelReason(r string) string {
	r = strings.TrimSpace(strings.Map(func(c rune) rune {
		if unicode.IsControl(c) {
			return -1
		}
		return c
	}, r))
	if utf8.RuneCountInString(r) > maxCancelReasonRunes {
		r = string([]rune(r)[:maxCancelReasonRunes])
	}
	return r
}

// requireRefundRail is the cancel PRE-FLIGHT: it runs BEFORE the booking's
// status flips. A card-funded settlement whose domain has no refunder wired
// cannot be refunded, so the cancel is refused up front (503) instead of
// flipping the booking to 'cancelled' and answering success while the customer's
// money stays escrowed (M2). Wallet-funded settlements need no wiring.
// A funding-source lookup failure also refuses: the rail must never be guessed.
func (s *Service) requireRefundRail(ctx context.Context, domain string, settlementID *string) (external bool, err error) {
	if settlementID == nil {
		return false, nil
	}
	external, err = s.settlementFundedExternally(ctx, *settlementID)
	if err != nil {
		return false, err
	}
	if external && s.domainRefunders[domain] == nil {
		log.Printf("[transport] cancel refused: card-funded settlement=%s (%s) but no external refunder is wired — nothing was changed", *settlementID, domain)
		return true, codedErr(http.StatusServiceUnavailable, "refund_unavailable",
			"Card refunds are temporarily unavailable, so this booking was not cancelled. Please try again shortly.")
	}
	return external, nil
}

// refundStatusFor maps the outcome of refundSettlement onto refund_status.
func refundStatusFor(rerr error, external bool) string {
	switch {
	case rerr == nil:
		return RefundStatusRefunded
	case external:
		return RefundStatusPending
	default:
		return RefundStatusFailed
	}
}

// finishCancelledRefund is the idempotent re-cancel of an ALREADY-cancelled
// booking. handled=false means "not a card-funded booking": the caller answers
// its plain 409. Otherwise it completes a refund that failed after the status
// flip. A DISPUTED external settlement is refundable exactly like an escrowed
// one (L-c).
func (s *Service) finishCancelledRefund(ctx context.Context, domain, entityID string, settlementID *string, reason string) (res *CancelResult, handled bool, err error) {
	if settlementID == nil {
		return nil, false, nil
	}
	ext, eerr := s.settlementFundedExternally(ctx, *settlementID)
	if eerr != nil || !ext {
		return nil, false, nil
	}
	var st string
	if qerr := s.db.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, *settlementID).Scan(&st); qerr != nil {
		return nil, true, qerr
	}
	switch st {
	case "escrowed", "disputed":
		if _, rerr := s.requireRefundRail(ctx, domain, settlementID); rerr != nil {
			return nil, true, rerr
		}
		if rerr := s.refundSettlement(ctx, domain, entityID, *settlementID, reason); rerr != nil {
			return nil, true, rerr
		}
		return &CancelResult{RefundStatus: RefundStatusRefunded}, true, nil
	case "refunded":
		return &CancelResult{RefundStatus: RefundStatusRefunded}, true, nil
	default:
		return &CancelResult{RefundStatus: RefundStatusNone}, true, nil
	}
}

// CancelSweepResult is what one SweepCancelledCardRefunds pass did.
type CancelSweepResult struct{ Completed, Failed int }

// SweepCancelledCardRefunds drives the card refund of every CANCELLED booking
// of `domain` whose external settlement is still escrowed/disputed — the state a
// cancel leaves behind when the gateway refund failed (or no refunder was wired)
// after the status flip and the customer never re-POSTed. It uses the same
// refundSettlement choke point a re-POST uses (gateway first, ledger second,
// resumable), so it can never double-refund. minAge keeps it clear of a cancel
// that is still in flight. Wallet-funded bookings are never touched.
func (s *Service) SweepCancelledCardRefunds(ctx context.Context, domain string, minAge time.Duration, limit int) (CancelSweepResult, error) {
	var q string
	switch domain {
	case RefundDomainParcel:
		q = `SELECT e.id, e.settlement_id FROM parcels e JOIN settlements st ON st.id = e.settlement_id
		      WHERE e.status='cancelled' AND st.funding_source='external' AND st.status IN ('escrowed','disputed')
		        AND e.updated_at < now() - make_interval(secs => $1) ORDER BY e.updated_at LIMIT $2`
	case RefundDomainTowing:
		q = `SELECT e.id, e.settlement_id FROM towing_jobs e JOIN settlements st ON st.id = e.settlement_id
		      WHERE e.status='cancelled' AND st.funding_source='external' AND st.status IN ('escrowed','disputed')
		        AND e.updated_at < now() - make_interval(secs => $1) ORDER BY e.updated_at LIMIT $2`
	case RefundDomainMovers:
		q = `SELECT e.id, e.settlement_id FROM mover_jobs e JOIN settlements st ON st.id = e.settlement_id
		      WHERE e.status='cancelled' AND st.funding_source='external' AND st.status IN ('escrowed','disputed')
		        AND e.updated_at < now() - make_interval(secs => $1) ORDER BY e.updated_at LIMIT $2`
	default:
		return CancelSweepResult{}, fmt.Errorf("transport: no cancelled-refund sweep for domain %q", domain)
	}
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(ctx, q, minAge.Seconds(), limit)
	if err != nil {
		return CancelSweepResult{}, err
	}
	type job struct{ id, settlementID string }
	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.id, &j.settlementID); err != nil {
			rows.Close()
			return CancelSweepResult{}, err
		}
		jobs = append(jobs, j)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return CancelSweepResult{}, err
	}
	var out CancelSweepResult
	for _, j := range jobs {
		if rerr := s.refundSettlement(ctx, domain, j.id, j.settlementID, domain+"_cancelled_sweep"); rerr != nil {
			out.Failed++
			log.Printf("[transport] cancelled-refund sweep: %s %s settlement=%s: %v", domain, j.id, j.settlementID, rerr)
			continue
		}
		if domain == RefundDomainMovers {
			_, _ = s.db.Exec(ctx, `UPDATE mover_jobs SET escrow_status='refunded', updated_at=NOW() WHERE id=$1 AND escrow_status='funded'`, j.id)
		}
		out.Completed++
	}
	return out, nil
}

// HasDomainExternalRefunder reports whether a card-direct refunder is wired for
// domain (wiring tests).
func (s *Service) HasDomainExternalRefunder(domain string) bool {
	return s.domainRefunders[domain] != nil
}

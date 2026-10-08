package paystackcheckout

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"spotlight/backend/internal/transport"
)

// Movers card-direct — charged at BID ACCEPTANCE.
//
// Lifecycle (why this is safe): a move has no price at request time — the price
// is the bid the customer accepts. So the charge happens exactly when a bid is
// accepted: the amount is that bid read SERVER-side (never client-supplied), the
// request carries only (job_id, bid_id), and at confirm time Book re-reads the
// job and the bid and refuses unless the job still belongs to the payer and is
// open, and the bid is still 'submitted' with the same provider and amount that
// were frozen at initiate. A refusal surfaces as a failed Book ⇒ the engine's
// Find proves no acceptance exists ⇒ the charge is REFUNDED at the gateway. The
// only later money events are cancel (full refund through the funding rail) and
// completion (escrow released to the provider) — both source-agnostic.
//
// Do NOT charge at quote-request time: nothing is priced yet.

// MoversDomainName is the stable domain id: intents.domain and the
// SetDomainExternalRefunder key. transport.CancelMover files refunds under the
// same string.
const MoversDomainName = "movers"

// MoversReferencePrefix: "moversorder:" + Idempotency-Key.
const MoversReferencePrefix = "moversorder:"

// MoverAcceptor is the slice of transport.Service the movers adapter uses.
type MoverAcceptor interface {
	// QuoteMoverAcceptance returns the accepted bid's amount (server read) and
	// the frozen bid identity; it refuses a job/bid that cannot be accepted.
	QuoteMoverAcceptance(ctx context.Context, userID string, req transport.MoverAcceptRequest) (int64, json.RawMessage, error)
	FindMoverAcceptanceByIdempotencyKey(ctx context.Context, userID, idempotencyKey string) (string, bool, error)
	AcceptMoverBidPaystackFunded(ctx context.Context, userID string, req transport.MoverAcceptRequest, idempotencyKey string, verifiedAmountKobo int64, pricing json.RawMessage) (string, error)
}

// MoversDomain adapts transport mover bid acceptance to Domain.
type MoversDomain struct{ movers MoverAcceptor }

func NewMoversDomain(m MoverAcceptor) *MoversDomain { return &MoversDomain{movers: m} }

func (MoversDomain) Name() string            { return MoversDomainName }
func (MoversDomain) ReferencePrefix() string { return MoversReferencePrefix }
func (MoversDomain) RoutePrefix() string     { return "/movers/paystack" }
func (MoversDomain) EntityIDKey() string     { return "moveId" }

func decodeMoverAccept(raw json.RawMessage) (transport.MoverAcceptRequest, error) {
	var req transport.MoverAcceptRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return req, transport.NewCodedError(http.StatusBadRequest, "invalid_input", "invalid mover request")
	}
	if req.JobID == "" || req.BidID == "" {
		return req, transport.NewCodedError(http.StatusBadRequest, "invalid_input", "job_id and bid_id are required")
	}
	return req, nil
}

func (d MoversDomain) Quote(ctx context.Context, payerID string, raw json.RawMessage) (Quoted, error) {
	req, err := decodeMoverAccept(raw)
	if err != nil {
		return Quoted{}, err
	}
	amt, pricing, err := d.movers.QuoteMoverAcceptance(ctx, payerID, req)
	return Quoted{AmountKobo: amt, Pricing: pricing}, err
}

func (d MoversDomain) Find(ctx context.Context, payerID, idemKey string) (string, bool, error) {
	return d.movers.FindMoverAcceptanceByIdempotencyKey(ctx, payerID, idemKey)
}

func (d MoversDomain) Book(ctx context.Context, payerID string, raw json.RawMessage, pricing json.RawMessage, idemKey string, verifiedAmountKobo int64) (string, error) {
	req, err := decodeMoverAccept(raw)
	if err != nil {
		return "", err
	}
	return d.movers.AcceptMoverBidPaystackFunded(ctx, payerID, req, idemKey, verifiedAmountKobo, pricing)
}

// SweepCancelledRefunds implements CancelledRefundSweeper (M2): it drives the
// card refund of cancelled bookings whose settlement is still escrowed. The
// booker is asked through an optional interface so adapters over a narrower fake
// simply have nothing to sweep.
func (d MoversDomain) SweepCancelledRefunds(ctx context.Context, minAge time.Duration, limit int) (CancelSweepResult, error) {
	sw, ok := d.movers.(cancelledRefundSweepBooker)
	if !ok {
		return CancelSweepResult{}, nil
	}
	res, err := sw.SweepCancelledCardRefunds(ctx, transport.RefundDomainMovers, minAge, limit)
	return CancelSweepResult{Completed: res.Completed, Failed: res.Failed}, err
}

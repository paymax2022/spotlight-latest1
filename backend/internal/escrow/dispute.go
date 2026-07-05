package escrow

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Phase-3 dispute extension. ADDITIVE to the P1 escrow core: it reuses the existing
// Hold/Release/Refund money legs and the guarded state machine (which already
// tolerates DISPUTED). A dispute drives HELD → DISPUTED → (RELEASED | REFUNDED):
//
//   - RaiseDispute flips an active HELD hold to DISPUTED and records buyer/seller
//     evidence. No money moves on raise (NL-6: funds stay held).
//   - Arbitrate resolves a DISPUTED hold with a separation-of-duties guard (the
//     arbiter may not be the payer or payee) then performs the matching ledger leg
//     via the existing resolve() path (RELEASED → payee, REFUNDED → payer).
//
// Every transition + arbitration decision is audited (NL-12).

// DisputeDecision is the arbiter's ruling.
type DisputeDecision string

const (
	DecisionRelease DisputeDecision = "RELEASE" // funds go to the payee/seller
	DecisionRefund  DisputeDecision = "REFUND"  // funds return to the payer/buyer
)

// Dispute is the case record attached to a HELD hold once contested.
type Dispute struct {
	ID         string     `json:"id"`
	EscrowID   string     `json:"escrow_id"`
	RaisedBy   string     `json:"raised_by"` // FK auth.users(id)
	State      string     `json:"state"`     // OPEN | RESOLVED
	Decision   *string    `json:"decision,omitempty"`
	ArbiterID  *string    `json:"arbiter_id,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
}

// RaiseDispute contests a HELD hold. raisedBy must be the payer or the payee
// (object-level authZ); a third party cannot dispute someone else's escrow. The
// guarded transition HELD → DISPUTED rejects an already-resolved/disputed hold.
func (s *Service) RaiseDispute(ctx context.Context, escrowID, raisedBy, evidence string) (*Dispute, error) {
	if escrowID == "" || raisedBy == "" {
		return nil, fmt.Errorf("escrow: escrowID and raisedBy required")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("escrow: dispute begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var payerID string
	var payeeID *string
	var state string
	const sel = `SELECT payer_id, payee_id, state FROM escrow_holds WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, sel, escrowID).Scan(&payerID, &payeeID, &state); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("escrow: hold not found")
		}
		return nil, fmt.Errorf("escrow: load hold for dispute: %w", err)
	}

	// Object-level authZ: only a party to the escrow may dispute it.
	if raisedBy != payerID && (payeeID == nil || raisedBy != *payeeID) {
		return nil, ErrDisputeNotParty
	}

	from := State(state)
	if !canTransition(from, StateDisputed) {
		return nil, fmt.Errorf("escrow: cannot dispute hold in state %s", from)
	}

	if _, err := tx.Exec(ctx, `UPDATE escrow_holds SET state='DISPUTED' WHERE id=$1`, escrowID); err != nil {
		return nil, fmt.Errorf("escrow: set disputed: %w", err)
	}

	d := &Dispute{
		ID:        uuid.New().String(),
		EscrowID:  escrowID,
		RaisedBy:  raisedBy,
		State:     "OPEN",
		CreatedAt: time.Now(),
	}
	const insD = `INSERT INTO escrow_disputes (id, escrow_id, raised_by, state, created_at)
	              VALUES ($1,$2,$3,'OPEN',$4)`
	if _, err := tx.Exec(ctx, insD, d.ID, d.EscrowID, d.RaisedBy, d.CreatedAt); err != nil {
		return nil, fmt.Errorf("escrow: insert dispute: %w", err)
	}
	if evidence != "" {
		const insE = `INSERT INTO escrow_dispute_evidence (id, dispute_id, submitted_by, body, created_at)
		              VALUES ($1,$2,$3,$4,now())`
		if _, err := tx.Exec(ctx, insE, uuid.New().String(), d.ID, raisedBy, evidence); err != nil {
			return nil, fmt.Errorf("escrow: insert evidence: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("escrow: commit dispute: %w", err)
	}

	if s.audit != nil {
		s.audit.LogAction(raisedBy, "", "escrow.dispute.raise", "escrow", "escrow_dispute", d.ID,
			map[string]any{"state": string(from)}, map[string]any{"state": "DISPUTED"}, "", "", "warning")
	}
	return d, nil
}

// AddEvidence appends evidence to an OPEN dispute. Only a party to the underlying
// hold may submit (object-level authZ).
func (s *Service) AddEvidence(ctx context.Context, escrowID, submittedBy, body string) error {
	if body == "" {
		return fmt.Errorf("escrow: evidence body required")
	}
	var payerID string
	var payeeID *string
	if err := s.db.QueryRow(ctx, `SELECT payer_id, payee_id FROM escrow_holds WHERE id=$1`, escrowID).Scan(&payerID, &payeeID); err != nil {
		return fmt.Errorf("escrow: load hold: %w", err)
	}
	if submittedBy != payerID && (payeeID == nil || submittedBy != *payeeID) {
		return ErrDisputeNotParty
	}
	var disputeID string
	if err := s.db.QueryRow(ctx, `SELECT id FROM escrow_disputes WHERE escrow_id=$1 AND state='OPEN' ORDER BY created_at DESC LIMIT 1`, escrowID).Scan(&disputeID); err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("escrow: no open dispute for hold")
		}
		return err
	}
	const ins = `INSERT INTO escrow_dispute_evidence (id, dispute_id, submitted_by, body, created_at) VALUES ($1,$2,$3,$4,now())`
	_, err := s.db.Exec(ctx, ins, uuid.New().String(), disputeID, submittedBy, body)
	return err
}

// Arbitrate resolves a DISPUTED hold. The arbiter authority is enforced at the route
// layer (RBAC creators.dispute.arbitrate / p2p.dispute.arbitrate); here we enforce
// SEPARATION OF DUTIES: the arbiter may NOT be the payer or payee. On RELEASE the
// payee is credited; on REFUND the payer is refunded — both via the existing,
// idempotent resolve() ledger path (NL-8/NL-9). The decision is audited (NL-12).
func (s *Service) Arbitrate(ctx context.Context, escrowID string, decision DisputeDecision, arbiterID string) error {
	if arbiterID == "" {
		return fmt.Errorf("escrow: arbiter required")
	}
	if decision != DecisionRelease && decision != DecisionRefund {
		return fmt.Errorf("escrow: invalid decision %q", decision)
	}

	// Load the hold to enforce separation of duties + capture the payee for release.
	var payerID string
	var payeeID *string
	var state string
	if err := s.db.QueryRow(ctx, `SELECT payer_id, payee_id, state FROM escrow_holds WHERE id=$1`, escrowID).Scan(&payerID, &payeeID, &state); err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("escrow: hold not found")
		}
		return fmt.Errorf("escrow: load hold for arbitration: %w", err)
	}
	if State(state) != StateDisputed {
		return fmt.Errorf("escrow: hold not in DISPUTED state (%s)", state)
	}
	// Separation of duties (NL-12): an arbiter cannot rule on their own escrow.
	if arbiterID == payerID || (payeeID != nil && arbiterID == *payeeID) {
		return ErrArbiterConflict
	}

	switch decision {
	case DecisionRelease:
		if payeeID == nil || *payeeID == "" {
			return fmt.Errorf("escrow: cannot release — no payee on hold")
		}
		if err := s.Release(ctx, escrowID, *payeeID); err != nil {
			return err
		}
	case DecisionRefund:
		if err := s.Refund(ctx, escrowID); err != nil {
			return err
		}
	}

	now := time.Now()
	dec := string(decision)
	const upd = `UPDATE escrow_disputes SET state='RESOLVED', decision=$2, arbiter_id=$3, resolved_at=$4
	             WHERE escrow_id=$1 AND state='OPEN'`
	if _, err := s.db.Exec(ctx, upd, escrowID, dec, arbiterID, now); err != nil {
		return fmt.Errorf("escrow: resolve dispute: %w", err)
	}

	if s.audit != nil {
		s.audit.LogAction(arbiterID, payerID, "escrow.dispute.arbitrate", "escrow", "escrow_dispute", escrowID,
			map[string]any{"state": "DISPUTED"},
			map[string]any{"state": "RESOLVED", "decision": dec},
			"", "", "warning")
	}
	return nil
}

// GetDispute returns the latest dispute for a hold (callers/RLS enforce scoping).
func (s *Service) GetDispute(ctx context.Context, escrowID string) (*Dispute, error) {
	const q = `SELECT id, escrow_id, raised_by, state, decision, arbiter_id, created_at, resolved_at
	           FROM escrow_disputes WHERE escrow_id=$1 ORDER BY created_at DESC LIMIT 1`
	var d Dispute
	if err := s.db.QueryRow(ctx, q, escrowID).Scan(
		&d.ID, &d.EscrowID, &d.RaisedBy, &d.State, &d.Decision, &d.ArbiterID, &d.CreatedAt, &d.ResolvedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("escrow: no dispute for hold")
		}
		return nil, err
	}
	return &d, nil
}

// Sentinel errors.
var (
	ErrDisputeNotParty = fmt.Errorf("escrow: only a party to the escrow may dispute it")
	ErrArbiterConflict = fmt.Errorf("escrow: arbiter cannot be a party to the escrow (separation of duties)")
)

package top5events

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/credential"
)

// Kinds stamped on event_orders / event_tickets by comp issuance.
const (
	OrderKindComp  = "COMP"
	TicketKindComp = "COMP"
)

// IssueComp issues zero-value guest (comp) tickets to the given recipient handles.
// Owner or MANAGER only.
//
// A comp moves NO money: it is an order (total_kobo=0, kind=COMP, status=PAID) +
// a gate credential + an ISSUED ticket (price_paid_kobo=0, kind=COMP). There is
// deliberately no wallet debit, no ledger posting and no commission record here.
//
// invite_only tiers are allowed (that is the point of a comp). Capacity is still
// enforced under the tier row lock; the whole batch is one transaction, so a
// sold-out batch issues nothing. Idempotent: each recipient's order carries the
// key idemKey+":"+recipientID, so a replay returns the already-issued tickets
// without minting a second credential or bumping sold again.
func (s *Service) IssueComp(ctx context.Context, callerID, eventID, tierID string, recipientHandles []string, note, idemKey string) ([]Ticket, error) {
	if idemKey == "" {
		return nil, errors.New("events: idempotency key required")
	}
	if len(recipientHandles) == 0 {
		return nil, errors.New("events: at least one recipient required")
	}
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		return nil, err
	}

	// Resolve handles -> user ids (deduped, order-preserving).
	var recipients []string
	seen := map[string]bool{}
	for _, h := range recipientHandles {
		uid, err := s.tags.Resolve(ctx, h)
		if err != nil {
			return nil, fmt.Errorf("events: resolve recipient: %w", err)
		}
		if !seen[uid] {
			seen[uid] = true
			recipients = append(recipients, uid)
		}
	}

	ev, err := s.GetEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}

	// Terminal states are closed to issuance (pre-go-live comps stay allowed).
	// ErrNotPurchasable maps to 409 in handler_lifecycle.go. Checked before any
	// order/credential/ticket is created.
	if ev.State == EventClosed || ev.State == EventCancelled {
		return nil, fmt.Errorf("%w (state %s)", ErrNotPurchasable, ev.State)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var capacity, sold int
	if err := tx.QueryRow(ctx, `SELECT capacity, sold FROM event_ticket_tiers WHERE id=$1 AND event_id=$2 FOR UPDATE`, tierID, eventID).Scan(&capacity, &sold); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("events: lock tier: %w", err)
	}

	// Replay detection (under the tier lock, so concurrent replays serialize):
	// recipients whose comp order already exists are returned as-is.
	existing := map[string]string{} // recipientID -> ticket id
	var fresh []string
	for _, uid := range recipients {
		var tid string
		err := tx.QueryRow(ctx,
			`SELECT t.id FROM event_orders o JOIN event_tickets t ON t.order_id=o.id WHERE o.idempotency_key=$1`,
			idemKey+":"+uid).Scan(&tid)
		switch {
		case err == nil:
			existing[uid] = tid
		case errors.Is(err, pgx.ErrNoRows):
			fresh = append(fresh, uid)
		default:
			return nil, fmt.Errorf("events: comp replay lookup: %w", err)
		}
	}

	if capacity > 0 && sold+len(fresh) > capacity {
		return nil, ErrSoldOut
	}

	var issuedCreds []string // revoked best-effort if the batch fails to commit
	rollbackCreds := func() {
		for _, c := range issuedCreds {
			_ = s.cred.Revoke(ctx, c)
		}
	}
	for _, uid := range fresh {
		orderID := uuid.New().String()
		tag, err := tx.Exec(ctx,
			`INSERT INTO event_orders (id, event_id, buyer_id, tier_id, total_kobo, status, idempotency_key, kind)
			 VALUES ($1,$2,$3,$4,0,'PAID',$5,'COMP') ON CONFLICT (idempotency_key) DO NOTHING`,
			orderID, eventID, uid, tierID, idemKey+":"+uid)
		if err != nil {
			rollbackCreds()
			return nil, fmt.Errorf("events: insert comp order: %w", err)
		}
		if tag.RowsAffected() == 0 {
			continue // lost a race to a concurrent identical issue; nothing to mint
		}
		cred, err := s.cred.Issue(ctx, uid, credential.KindEventTicket, credential.Policy{
			SingleUse:    true,
			AllowReentry: false,
			RotateTTL:    30 * time.Second,
			ValidFrom:    ev.StartsAt.Add(-6 * time.Hour),
			ValidTo:      ev.EndsAt,
		})
		if err != nil {
			rollbackCreds()
			return nil, fmt.Errorf("events: issue credential: %w", err)
		}
		issuedCreds = append(issuedCreds, cred.ID)
		ticketID := uuid.New().String()
		if _, err := tx.Exec(ctx,
			`INSERT INTO event_tickets (id, event_id, tier_id, order_id, owner_id, state, credential_id, price_paid_kobo, kind, issued_by, comp_note)
			 VALUES ($1,$2,$3,$4,$5,'ISSUED',$6,0,'COMP',$7,$8)`,
			ticketID, eventID, tierID, orderID, uid, cred.ID, callerID, nullIfEmpty(note)); err != nil {
			rollbackCreds()
			return nil, fmt.Errorf("events: insert comp ticket: %w", err)
		}
		existing[uid] = ticketID
		if _, err := tx.Exec(ctx, `UPDATE event_ticket_tiers SET sold=sold+1 WHERE id=$1`, tierID); err != nil {
			rollbackCreds()
			return nil, fmt.Errorf("events: bump sold: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		rollbackCreds()
		return nil, fmt.Errorf("events: commit comps: %w", err)
	}

	out := make([]Ticket, 0, len(recipients))
	for _, uid := range recipients {
		tid, ok := existing[uid]
		if !ok {
			continue
		}
		t, err := s.getTicket(ctx, tid)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	if len(fresh) > 0 {
		s.log(callerID, "events.comp", eventID, map[string]any{"tier": tierID, "count": len(fresh)})
	}
	return out, nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

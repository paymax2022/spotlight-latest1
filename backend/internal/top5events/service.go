package top5events

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/credential"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
)

// Auditor mirrors services.AuditService (NL-12); nil-safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Service is the Event Ticketing + cashless Event Wallet core. It owns NO bespoke
// money primitive: ticket checkout uses wallet.Debit; the cashless wallet is a
// closed-loop sub-balance backed by the shared escrow standing account; vendor
// settlement runs through finance/settlement payouts; gate entry uses the shared
// credential rotating-QR. KYC gates organiser/vendor payouts (NL-10).
type Service struct {
	db    *pgxpool.Pool
	led   *ledger.Service
	wal   *wallet.Service
	sett  *settlement.Service
	tiers *tiers.Service
	cred  *credential.Service
	tags  *cashtag.Service
	audit Auditor
}

func NewService(db *pgxpool.Pool, led *ledger.Service, wal *wallet.Service, sett *settlement.Service, tiersSvc *tiers.Service, cred *credential.Service, tags *cashtag.Service, audit Auditor) *Service {
	return &Service{db: db, led: led, wal: wal, sett: sett, tiers: tiersSvc, cred: cred, tags: tags, audit: audit}
}

// ---------- Event CMS + approval workflow ----------

// CreateEvent drafts a new event owned by organiserID (organiser capability).
func (s *Service) CreateEvent(ctx context.Context, organiserID string, e Event) (*Event, error) {
	if organiserID == "" {
		return nil, fmt.Errorf("events: organiser required")
	}
	e.ID = uuid.New().String()
	e.OrganiserID = organiserID
	e.State = EventDraft
	e.CreatedAt = time.Now()
	const ins = `
		INSERT INTO events (id, organiser_id, title, description, venue, state, category, starts_at, ends_at, fee_bps)
		VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9)`
	if _, err := s.db.Exec(ctx, ins, e.ID, e.OrganiserID, e.Title, e.Description, e.Venue, e.Category, e.StartsAt, e.EndsAt, e.FeeBps); err != nil {
		return nil, fmt.Errorf("events: insert: %w", err)
	}
	s.log(organiserID, "events.create", e.ID, map[string]any{"title": e.Title})
	return &e, nil
}

// Submit moves DRAFT -> SUBMITTED (organiser action; object-level authZ).
func (s *Service) Submit(ctx context.Context, organiserID, eventID string) error {
	return s.transition(ctx, eventID, EventDraft, EventSubmitted, &organiserID, "events.submit")
}

// Approve moves SUBMITTED -> APPROVED (admin RBAC events.approve).
func (s *Service) Approve(ctx context.Context, adminID, eventID string) error {
	return s.transition(ctx, eventID, EventSubmitted, EventApproved, nil, "events.approve")
}

// GoLive moves APPROVED -> LIVE (organiser; sales open).
func (s *Service) GoLive(ctx context.Context, organiserID, eventID string) error {
	return s.transition(ctx, eventID, EventApproved, EventLive, &organiserID, "events.golive")
}

// Suspend moves any non-terminal state -> SUSPENDED (admin RBAC events.suspend).
func (s *Service) Suspend(ctx context.Context, adminID, eventID string) error {
	const q = `UPDATE events SET state='SUSPENDED' WHERE id=$1 AND state IN ('DRAFT','SUBMITTED','APPROVED','LIVE')`
	ct, err := s.db.Exec(ctx, q, eventID)
	if err != nil {
		return fmt.Errorf("events: suspend: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("events: not suspendable (missing or terminal)")
	}
	s.log(adminID, "events.suspend", eventID, nil)
	return nil
}

// Close moves LIVE -> CLOSED and triggers residual refunds for all event wallets.
func (s *Service) Close(ctx context.Context, organiserID, eventID string) error {
	if err := s.transition(ctx, eventID, EventLive, EventClosed, &organiserID, "events.close"); err != nil {
		return err
	}
	// Best-effort close of every event wallet (residual -> main wallet, NL-3).
	_, _ = s.CloseAllWallets(ctx, eventID)
	return nil
}

// transition performs a guarded state change. When ownerCheck is non-nil the row's
// organiser_id must match (object-level authZ); admin paths pass nil.
func (s *Service) transition(ctx context.Context, eventID string, from, to EventState, ownerCheck *string, action string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("events: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var organiser, state string
	if err := tx.QueryRow(ctx, `SELECT organiser_id, state FROM events WHERE id=$1 FOR UPDATE`, eventID).Scan(&organiser, &state); err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("events: not found")
		}
		return fmt.Errorf("events: fetch: %w", err)
	}
	if ownerCheck != nil && organiser != *ownerCheck {
		return ErrForbidden
	}
	if EventState(state) != from {
		return fmt.Errorf("events: illegal transition %s -> %s", state, to)
	}
	if _, err := tx.Exec(ctx, `UPDATE events SET state=$2 WHERE id=$1`, eventID, string(to)); err != nil {
		return fmt.Errorf("events: update state: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("events: commit: %w", err)
	}
	actor := organiser
	if ownerCheck != nil {
		actor = *ownerCheck
	}
	s.log(actor, action, eventID, map[string]any{"from": state, "to": string(to)})
	return nil
}

// GetEvent returns an event by id (public read).
func (s *Service) GetEvent(ctx context.Context, eventID string) (*Event, error) {
	const q = `SELECT id, organiser_id, title, description, venue, state, COALESCE(category,''), starts_at, ends_at, fee_bps, created_at FROM events WHERE id=$1`
	var e Event
	var state string
	if err := s.db.QueryRow(ctx, q, eventID).Scan(
		&e.ID, &e.OrganiserID, &e.Title, &e.Description, &e.Venue, &state, &e.Category, &e.StartsAt, &e.EndsAt, &e.FeeBps, &e.CreatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	e.State = EventState(state)
	return &e, nil
}

// publiclyVisibleStates are the states a non-owner/non-admin caller may browse
// in the discovery feed.
var publiclyVisibleStates = []string{string(EventLive), string(EventApproved), string(EventClosed)}

// ListEvents is the discovery/list feed backing GET /api/finance/events. Filter
// by category and/or state; anonymous or non-organiser callers only ever see
// publiclyVisibleStates (state filter, if given, is intersected with that set
// unless the caller is browsing their own organiser_id — kept simple here since
// the handler has no separate "mine" flag: an explicit state filter from a caller
// is honoured only when it is itself one of the public states, otherwise it is
// ignored and the public default set is used). Pagination via limit/offset.
func (s *Service) ListEvents(ctx context.Context, callerID string, filter EventListFilter) ([]EventSummary, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}

	// Build a safe, parameterised WHERE clause.
	args := []any{}
	where := "WHERE 1=1"

	if filter.Category != "" {
		args = append(args, filter.Category)
		where += fmt.Sprintf(" AND e.category = $%d", len(args))
	}

	requestedState := filter.State
	isPublicState := false
	for _, st := range publiclyVisibleStates {
		if requestedState == st {
			isPublicState = true
			break
		}
	}

	if callerID != "" {
		// Organiser/admin-ish caller: own events at any state, PLUS public states
		// for everyone else's events.
		if requestedState != "" && isPublicState {
			args = append(args, requestedState)
			where += fmt.Sprintf(" AND e.state = $%d", len(args))
		} else if requestedState != "" && !isPublicState {
			// Caller asked for a non-public state (e.g. DRAFT/SUBMITTED/SUSPENDED):
			// only honour it for their own events.
			args = append(args, requestedState, callerID)
			where += fmt.Sprintf(" AND e.state = $%d AND e.organiser_id = $%d", len(args)-1, len(args))
		} else {
			args = append(args, callerID)
			ph := len(args)
			stateList := "'" + publiclyVisibleStates[0] + "','" + publiclyVisibleStates[1] + "','" + publiclyVisibleStates[2] + "'"
			where += fmt.Sprintf(" AND (e.state IN (%s) OR e.organiser_id = $%d)", stateList, ph)
		}
	} else {
		// Anonymous: public states only, honouring a requested public state.
		if requestedState != "" && isPublicState {
			args = append(args, requestedState)
			where += fmt.Sprintf(" AND e.state = $%d", len(args))
		} else {
			stateList := "'" + publiclyVisibleStates[0] + "','" + publiclyVisibleStates[1] + "','" + publiclyVisibleStates[2] + "'"
			where += fmt.Sprintf(" AND e.state IN (%s)", stateList)
		}
	}

	args = append(args, limit, offset)
	limitPH := len(args) - 1
	offsetPH := len(args)

	q := fmt.Sprintf(`
		SELECT e.id, e.title, e.venue, e.state, COALESCE(e.category,''), e.starts_at, e.ends_at,
		       COALESCE((SELECT MIN(t.price_kobo) FROM event_ticket_tiers t WHERE t.event_id = e.id AND t.active = true), 0) AS min_price_kobo,
		       COALESCE((SELECT bool_and(t.capacity > 0 AND t.sold >= t.capacity) FROM event_ticket_tiers t WHERE t.event_id = e.id AND t.active = true), false) AS sold_out
		FROM events e
		%s
		ORDER BY e.starts_at ASC
		LIMIT $%d OFFSET $%d`, where, limitPH, offsetPH)

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("events: list: %w", err)
	}
	defer rows.Close()

	out := []EventSummary{}
	for rows.Next() {
		var sum EventSummary
		var state string
		if err := rows.Scan(&sum.ID, &sum.Title, &sum.Venue, &state, &sum.Category, &sum.StartsAt, &sum.EndsAt, &sum.MinPriceKobo, &sum.SoldOut); err != nil {
			return nil, fmt.Errorf("events: list scan: %w", err)
		}
		sum.State = EventState(state)
		out = append(out, sum)
	}
	return out, rows.Err()
}

// ---------- Ticket inventory + tiers + promo codes ----------

// AddTier creates an inventory tier (organiser-only).
func (s *Service) AddTier(ctx context.Context, organiserID, eventID string, t TicketTier) (*TicketTier, error) {
	if err := s.assertOwner(ctx, eventID, organiserID); err != nil {
		return nil, err
	}
	if t.PriceKobo < 0 || t.Capacity < 0 {
		return nil, fmt.Errorf("events: tier price/capacity must be non-negative")
	}
	t.ID = uuid.New().String()
	t.EventID = eventID
	t.Active = true
	const ins = `INSERT INTO event_ticket_tiers (id, event_id, name, price_kobo, capacity, active) VALUES ($1,$2,$3,$4,$5,true)`
	if _, err := s.db.Exec(ctx, ins, t.ID, t.EventID, t.Name, t.PriceKobo, t.Capacity); err != nil {
		return nil, fmt.Errorf("events: insert tier: %w", err)
	}
	return &t, nil
}

// AddPromo creates a versioned promo code (organiser-only). A re-add of the same
// code supersedes by version (config-driven, history preserved).
func (s *Service) AddPromo(ctx context.Context, organiserID, eventID string, p PromoCode) (*PromoCode, error) {
	if err := s.assertOwner(ctx, eventID, organiserID); err != nil {
		return nil, err
	}
	if p.PercentOff < 0 || p.PercentOff > 100 {
		return nil, fmt.Errorf("events: percent_off out of range")
	}
	var maxVer int
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(MAX(version),0) FROM event_promo_codes WHERE event_id=$1 AND code=$2`, eventID, p.Code).Scan(&maxVer)
	p.ID = uuid.New().String()
	p.EventID = eventID
	p.Version = maxVer + 1
	p.Active = true
	// Deactivate prior versions of this code.
	_, _ = s.db.Exec(ctx, `UPDATE event_promo_codes SET active=false WHERE event_id=$1 AND code=$2`, eventID, p.Code)
	const ins = `INSERT INTO event_promo_codes (id, event_id, code, version, percent_off, max_uses, active) VALUES ($1,$2,$3,$4,$5,$6,true)`
	if _, err := s.db.Exec(ctx, ins, p.ID, p.EventID, p.Code, p.Version, p.PercentOff, p.MaxUses); err != nil {
		return nil, fmt.Errorf("events: insert promo: %w", err)
	}
	return &p, nil
}

// ---------- Order + issuance via credential ----------

// Purchase buys one ticket of a tier for buyerID, optionally applying a promo code.
// Money path: wallet.Debit (tier-limit enforced fail-closed) into the platform
// escrow account; idempotent on idemKey (NL-9). On success it issues a credential
// (rotating-QR gate entry) and an ISSUED ticket bound to it.
func (s *Service) Purchase(ctx context.Context, buyerID, eventID, tierID, promo, idemKey string) (*Ticket, error) {
	if buyerID == "" || idemKey == "" {
		return nil, fmt.Errorf("events: buyer and idempotency key required")
	}

	// Idempotent replay / crash-resume: if an order already exists for this key,
	// continue from wherever the previous attempt stopped rather than re-reserving
	// (a naive retry would collide on uq_event_orders_idem and never finish paying).
	if o, err := s.orderByIdem(ctx, idemKey); err == nil {
		return s.finalizePurchase(ctx, o)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("events: lookup order: %w", err)
	}

	ev, err := s.GetEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}
	if ev.State != EventLive {
		return nil, fmt.Errorf("events: event not on sale (state %s)", ev.State)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the tier row and check capacity.
	var price int64
	var capacity, sold int
	var active bool
	if err := tx.QueryRow(ctx, `SELECT price_kobo, capacity, sold, active FROM event_ticket_tiers WHERE id=$1 AND event_id=$2 FOR UPDATE`, tierID, eventID).Scan(&price, &capacity, &sold, &active); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("events: tier not found")
		}
		return nil, fmt.Errorf("events: lock tier: %w", err)
	}
	if !active {
		return nil, fmt.Errorf("events: tier inactive")
	}
	if capacity > 0 && sold >= capacity {
		return nil, ErrSoldOut
	}

	// Apply promo (versioned, max-uses guarded).
	payable := price
	if promo != "" {
		var pid string
		var pct, maxUses, used int
		if err := tx.QueryRow(ctx, `SELECT id, percent_off, max_uses, used FROM event_promo_codes WHERE event_id=$1 AND code=$2 AND active=true FOR UPDATE`, eventID, promo).Scan(&pid, &pct, &maxUses, &used); err == nil {
			if maxUses == 0 || used < maxUses {
				payable = price - (price*int64(pct))/100
				_, _ = tx.Exec(ctx, `UPDATE event_promo_codes SET used=used+1 WHERE id=$1`, pid)
			}
		}
	}

	// Reserve inventory before money moves (a debit can never outrun capacity) and
	// record the order as PENDING — the money has NOT been taken yet. The commit
	// makes only the reservation durable; the debit + PAID flip run in
	// finalizePurchase. If we crash after this commit, the order is a resumable
	// PENDING (not a paid-looking free ticket), recoverable by a same-idemKey retry
	// or ReconcilePendingOrders.
	if _, err := tx.Exec(ctx, `UPDATE event_ticket_tiers SET sold=sold+1 WHERE id=$1`, tierID); err != nil {
		return nil, fmt.Errorf("events: reserve inventory: %w", err)
	}
	orderID := uuid.New().String()
	const insOrder = `INSERT INTO event_orders (id, event_id, buyer_id, tier_id, total_kobo, status, idempotency_key) VALUES ($1,$2,$3,$4,$5,'PENDING',$6)`
	if _, err := tx.Exec(ctx, insOrder, orderID, eventID, buyerID, tierID, payable, idemKey); err != nil {
		return nil, fmt.Errorf("events: insert order: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("events: commit reservation: %w", err)
	}

	return s.finalizePurchase(ctx, pendingOrder{
		id: orderID, eventID: eventID, buyerID: buyerID, tierID: tierID,
		idemKey: idemKey, payable: payable, status: "PENDING",
	})
}

// pendingOrder is the resumable state of a checkout between reservation and ticket
// issuance — the row shape finalizePurchase drives to a terminal PAID/EXPIRED.
type pendingOrder struct {
	id, eventID, buyerID, tierID, idemKey, status string
	payable                                       int64
}

// orderByIdem loads the existing order for an idempotency key (pgx.ErrNoRows if none).
func (s *Service) orderByIdem(ctx context.Context, idemKey string) (pendingOrder, error) {
	o := pendingOrder{idemKey: idemKey}
	err := s.db.QueryRow(ctx,
		`SELECT id, event_id, buyer_id, COALESCE(tier_id::text,''), total_kobo, status FROM event_orders WHERE idempotency_key=$1`, idemKey).
		Scan(&o.id, &o.eventID, &o.buyerID, &o.tierID, &o.payable, &o.status)
	return o, err
}

// finalizePurchase runs the debit → PAID → ticket tail of a checkout. It is safe to
// call repeatedly for the same order (crash-resume / idempotent replay / sweep):
//   - EXPIRED/REFUNDED  → the checkout terminally failed; surface it.
//   - PENDING           → debit (idempotent on idemKey:ticket, so a resume dedups
//     rather than double-charging), flip PAID, then issue the ticket.
//   - PAID              → the money already moved; SKIP the debit and PAID flip but
//     still run ticket issuance — a crash can land after the PAID flip but before
//     the ticket insert, so a resumed PAID order may still be missing its ticket.
//
// Ticket issuance is idempotent (uq_event_tickets_order), and a debit refused for
// insufficient funds on a still-PENDING order expires it and releases the seat.
func (s *Service) finalizePurchase(ctx context.Context, o pendingOrder) (*Ticket, error) {
	// Terminal states only. PAID is intentionally NOT terminal here — see above.
	switch o.status {
	case "EXPIRED":
		return nil, fmt.Errorf("events: order expired (payment not completed)")
	case "REFUNDED":
		return nil, fmt.Errorf("events: order was refunded")
	}

	ev, err := s.GetEvent(ctx, o.eventID)
	if err != nil {
		return nil, err
	}

	// Money leg: debit the buyer's main wallet into escrow — ONLY while still
	// PENDING (a resumed PAID order already moved the money; skip to ticketing).
	// Idempotent on idemKey:ticket — a resume after a crash mid-debit dedups (money
	// already moved) instead of charging twice.
	if o.status == "PENDING" && o.payable > 0 {
		escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
		if err != nil {
			return nil, err
		}
		if err := s.wal.Debit(ctx, o.buyerID, "ticket:"+o.id, o.idemKey+":ticket", escrowAcc.ID, o.payable); !alreadyApplied(err) {
			// The debit didn't cleanly succeed/dedup. This is ambiguous on a RESUME:
			// wallet.Debit checks balance BEFORE the ON CONFLICT dedup, so replaying an
			// already-applied debit can surface ErrInsufficientFunds (the prior debit
			// drained the balance) rather than a duplicate — unless Redis happened to
			// catch it. So we must NOT trust the error type; consult the ledger of
			// record. Only expire (release the seat) when the debit DEFINITIVELY never
			// posted; otherwise the money is already in escrow and we finalize as PAID.
			posted, perr := s.led.Posted(ctx, o.idemKey+":ticket")
			if perr != nil {
				return nil, fmt.Errorf("events: ticket debit (%v) + posted-check: %w", err, perr)
			}
			if !posted {
				s.expireOrder(ctx, o.id, o.tierID)
				return nil, fmt.Errorf("events: ticket debit: %w", err)
			}
			// posted == true → money already moved; fall through to mark PAID + ticket.
		}
	}

	// Money is durably in escrow — advance PENDING → PAID (skipped for an already-
	// PAID resume; the WHERE guard also makes a concurrent flip a no-op).
	if o.status == "PENDING" {
		if _, err := s.db.Exec(ctx, `UPDATE event_orders SET status='PAID' WHERE id=$1 AND status='PENDING'`, o.id); err != nil {
			return nil, fmt.Errorf("events: mark order paid: %w", err)
		}
	}

	// Issue the gate credential + ticket, idempotently: if a prior attempt already
	// persisted the ticket, return it rather than minting a second credential. This
	// also recovers a PAID order whose ticket insert never ran before a crash.
	if t, err := s.ticketByOrder(ctx, o.id); err == nil {
		return t, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	cred, err := s.cred.Issue(ctx, o.buyerID, credential.KindEventTicket, credential.Policy{
		SingleUse:    true,
		AllowReentry: false,
		RotateTTL:    30 * time.Second,
		ValidFrom:    ev.StartsAt.Add(-6 * time.Hour),
		ValidTo:      ev.EndsAt,
	})
	if err != nil {
		return nil, fmt.Errorf("events: issue credential: %w", err)
	}
	const insTicket = `INSERT INTO event_tickets (id, event_id, tier_id, order_id, owner_id, state, credential_id, price_paid_kobo) VALUES ($1,$2,$3,$4,$5,'ISSUED',$6,$7) ON CONFLICT (order_id) DO NOTHING`
	if _, err := s.db.Exec(ctx, insTicket, uuid.New().String(), o.eventID, o.tierID, o.id, o.buyerID, cred.ID, o.payable); err != nil {
		return nil, fmt.Errorf("events: insert ticket: %w", err)
	}
	s.log(o.buyerID, "events.purchase", o.id, map[string]any{"event": o.eventID, "tier": o.tierID, "kobo": o.payable})
	// Return the persisted ticket (handles the ON CONFLICT-skipped race where a
	// concurrent resume issued it first).
	return s.ticketByOrder(ctx, o.id)
}

// ticketByOrder returns the single ticket for an order (pgx.ErrNoRows if none yet).
func (s *Service) ticketByOrder(ctx context.Context, orderID string) (*Ticket, error) {
	const q = `SELECT id, event_id, tier_id, order_id, owner_id, state, COALESCE(credential_id::text,''), price_paid_kobo, created_at FROM event_tickets WHERE order_id=$1`
	var t Ticket
	var state string
	if err := s.db.QueryRow(ctx, q, orderID).Scan(&t.ID, &t.EventID, &t.TierID, &t.OrderID, &t.OwnerID, &state, &t.CredentialID, &t.PricePaidKobo, &t.CreatedAt); err != nil {
		return nil, err
	}
	t.State = TicketState(state)
	return &t, nil
}

// expireOrder releases a reserved seat and marks a never-paid order EXPIRED. The
// PENDING guard under a row lock guarantees we never release a seat for an order
// that a concurrent finalize has already advanced to PAID.
func (s *Service) expireOrder(ctx context.Context, orderID, tierID string) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM event_orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&status); err != nil {
		return
	}
	if status != "PENDING" {
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE event_orders SET status='EXPIRED' WHERE id=$1`, orderID); err != nil {
		return
	}
	if tierID != "" {
		if _, err := tx.Exec(ctx, `UPDATE event_ticket_tiers SET sold=sold-1 WHERE id=$1 AND sold>0`, tierID); err != nil {
			return
		}
	}
	_ = tx.Commit(ctx)
}

// ReconcilePendingOrders finalizes or expires checkouts left PENDING by a crash
// between reservation and payment. For each PENDING order older than olderThan it
// re-runs finalizePurchase: a buyer with funds is charged + ticketed (idempotent);
// one without has the order EXPIRED and the seat released. Driven periodically by
// StartPendingOrderReconciler (reconciler.go). Returns (finalized, sweptToTerminalOrError).
func (s *Service) ReconcilePendingOrders(ctx context.Context, olderThan time.Duration) (int, int, error) {
	cutoff := time.Now().Add(-olderThan)
	rows, err := s.db.Query(ctx,
		`SELECT id, event_id, buyer_id, COALESCE(tier_id::text,''), total_kobo, idempotency_key FROM event_orders WHERE status='PENDING' AND created_at < $1`, cutoff)
	if err != nil {
		return 0, 0, err
	}
	var pend []pendingOrder
	for rows.Next() {
		o := pendingOrder{status: "PENDING"}
		if rows.Scan(&o.id, &o.eventID, &o.buyerID, &o.tierID, &o.payable, &o.idemKey) == nil {
			pend = append(pend, o)
		}
	}
	rows.Close()

	finalized, swept := 0, 0
	for _, o := range pend {
		if _, err := s.finalizePurchase(ctx, o); err == nil {
			finalized++
		} else {
			swept++ // expired on refused debit, or a transient error to retry next sweep
		}
	}
	return finalized, swept, nil
}

// GiftTicket transfers an ISSUED ticket to the user behind a cashtag handle. Reuses
// the shared cashtag directory to resolve the recipient. Object-level authZ: only
// the current owner can gift. A fresh credential is issued to the recipient and the
// old one revoked, so the giver's QR cannot still open the gate.
func (s *Service) GiftTicket(ctx context.Context, ownerID, ticketID, recipientHandle string) (*Ticket, error) {
	recipientID, err := s.tags.Resolve(ctx, recipientHandle)
	if err != nil {
		return nil, fmt.Errorf("events: resolve recipient: %w", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var owner, state, eventID, oldCred string
	if err := tx.QueryRow(ctx, `SELECT owner_id, state, event_id, credential_id FROM event_tickets WHERE id=$1 FOR UPDATE`, ticketID).Scan(&owner, &state, &eventID, &oldCred); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if owner != ownerID {
		return nil, ErrForbidden
	}
	if TicketState(state) != TicketIssued {
		return nil, fmt.Errorf("events: only ISSUED tickets can be gifted (state %s)", state)
	}

	ev, err := s.GetEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}
	newCred, err := s.cred.Issue(ctx, recipientID, credential.KindEventTicket, credential.Policy{
		SingleUse: true, RotateTTL: 30 * time.Second, ValidFrom: ev.StartsAt.Add(-6 * time.Hour), ValidTo: ev.EndsAt,
	})
	if err != nil {
		return nil, fmt.Errorf("events: reissue credential: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE event_tickets SET owner_id=$2, credential_id=$3, state='TRANSFERRED' WHERE id=$1`, ticketID, recipientID, newCred.ID); err != nil {
		return nil, fmt.Errorf("events: transfer ticket: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("events: commit transfer: %w", err)
	}
	_ = s.cred.Revoke(ctx, oldCred) // invalidate the giver's old QR
	s.log(ownerID, "events.gift", ticketID, map[string]any{"to": recipientID})
	return s.getTicket(ctx, ticketID)
}

// ScanTicket validates a presented gate token (steward action). Single-use is
// enforced inside the credential core; on accept the ticket flips to USED.
func (s *Service) ScanTicket(ctx context.Context, tok credential.Token, gate credential.Gate) (*credential.Result, error) {
	res, err := s.cred.Validate(ctx, tok, gate)
	if err != nil {
		return nil, err
	}
	if res.OK {
		_, _ = s.db.Exec(ctx, `UPDATE event_tickets SET state='USED' WHERE credential_id=$1 AND state IN ('ISSUED','TRANSFERRED')`, res.CredentialID)
	}
	return res, nil
}

// MyTickets lists the caller's tickets.
func (s *Service) MyTickets(ctx context.Context, userID string) ([]Ticket, error) {
	const q = `SELECT id, event_id, tier_id, order_id, owner_id, state, credential_id, price_paid_kobo, created_at FROM event_tickets WHERE owner_id=$1 ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Ticket
	for rows.Next() {
		var t Ticket
		var state string
		if err := rows.Scan(&t.ID, &t.EventID, &t.TierID, &t.OrderID, &t.OwnerID, &state, &t.CredentialID, &t.PricePaidKobo, &t.CreatedAt); err != nil {
			return nil, err
		}
		t.State = TicketState(state)
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) getTicket(ctx context.Context, id string) (*Ticket, error) {
	const q = `SELECT id, event_id, tier_id, order_id, owner_id, state, credential_id, price_paid_kobo, created_at FROM event_tickets WHERE id=$1`
	var t Ticket
	var state string
	if err := s.db.QueryRow(ctx, q, id).Scan(&t.ID, &t.EventID, &t.TierID, &t.OrderID, &t.OwnerID, &state, &t.CredentialID, &t.PricePaidKobo, &t.CreatedAt); err != nil {
		return nil, err
	}
	t.State = TicketState(state)
	return &t, nil
}

// ---------- Cashless Event Wallet (closed-loop sub-balance, NL-3) ----------

// OpenWallet creates an attendee event-wallet (state OPEN).
func (s *Service) OpenWallet(ctx context.Context, ownerID, eventID string) (*EventWallet, error) {
	w := &EventWallet{ID: uuid.New().String(), EventID: eventID, OwnerID: ownerID, State: WalletOpen, CreatedAt: time.Now()}
	const ins = `INSERT INTO event_wallets (id, event_id, owner_id, state) VALUES ($1,$2,$3,'OPEN')
	             ON CONFLICT (event_id, owner_id) DO NOTHING`
	ct, err := s.db.Exec(ctx, ins, w.ID, w.EventID, w.OwnerID)
	if err != nil {
		return nil, fmt.Errorf("events: open wallet: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return s.walletFor(ctx, eventID, ownerID)
	}
	return w, nil
}

// TopUp adds float to an event-wallet. CLOSED-LOOP (NL-3): the "wallet" source
// debits the attendee's MAIN Paymax wallet into the shared escrow standing account
// (the event float), then credits the sub-balance ledger. agent/card sources clear
// externally and only credit the sub-balance. Idempotent on idemKey (NL-9).
func (s *Service) TopUp(ctx context.Context, ownerID, walletID string, amountKobo int64, source TopUpSource, idemKey string) (*EventWallet, error) {
	if amountKobo <= 0 {
		return nil, fmt.Errorf("events: top-up must be positive kobo")
	}
	w, err := s.loadWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	if w.OwnerID != ownerID {
		return nil, ErrForbidden
	}
	if w.State == WalletClosed {
		return nil, fmt.Errorf("events: wallet closed")
	}

	// Closed-loop funding from the main wallet into the event float (escrow).
	if source == TopUpWallet {
		escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
		if err != nil {
			return nil, err
		}
		if err := s.wal.Debit(ctx, ownerID, "evt-topup:"+walletID, idemKey+":topup", escrowAcc.ID, amountKobo); err != nil {
			return nil, fmt.Errorf("events: topup debit: %w", err)
		}
	}
	if err := s.appendWalletEntry(ctx, walletID, "TOPUP", amountKobo, "topup:"+string(source), idemKey+":evt-topup"); err != nil {
		return nil, err
	}
	_, _ = s.db.Exec(ctx, `UPDATE event_wallets SET state='SPENDING' WHERE id=$1 AND state='OPEN'`, walletID)
	s.log(ownerID, "events.wallet.topup", walletID, map[string]any{"kobo": amountKobo, "source": string(source)})
	return s.loadWallet(ctx, walletID)
}

// TapCharge moves float from an attendee event-wallet to a vendor's float ledger
// (POS-lite tap-charge). It is a pure sub-balance move (CHARGE on the attendee
// wallet, credit on the vendor float) — no money leaves the closed loop here; the
// vendor is paid out net of fees at settlement. Idempotent on idemKey (NL-9).
func (s *Service) TapCharge(ctx context.Context, vendorID, walletID string, amountKobo int64, idemKey string) (*VendorCharge, error) {
	if amountKobo <= 0 {
		return nil, fmt.Errorf("events: charge must be positive kobo")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Idempotency: a replayed tap returns the existing charge.
	var existing string
	if err := tx.QueryRow(ctx, `SELECT id FROM vendor_charges WHERE idempotency_key=$1`, idemKey).Scan(&existing); err == nil {
		return s.chargeByID(ctx, existing)
	}

	// Lock the wallet's balance projection and check funds.
	var state string
	if err := tx.QueryRow(ctx, `SELECT state FROM event_wallets WHERE id=$1 FOR UPDATE`, walletID).Scan(&state); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("events: wallet not found")
		}
		return nil, err
	}
	if EventWalletState(state) == WalletClosed {
		return nil, fmt.Errorf("events: wallet closed")
	}
	bal, err := s.walletBalanceTx(ctx, tx, walletID)
	if err != nil {
		return nil, err
	}
	if bal < amountKobo {
		return nil, ErrInsufficientFloat
	}

	chargeID := uuid.New().String()
	// Attendee sub-balance: CHARGE (debit direction).
	if _, err := tx.Exec(ctx, `INSERT INTO event_wallet_ledger (id, wallet_id, type, amount_kobo, reference, idempotency_key) VALUES ($1,$2,'CHARGE',$3,$4,$5)`,
		uuid.New().String(), walletID, amountKobo, "tap:"+chargeID, idemKey+":charge"); err != nil {
		return nil, fmt.Errorf("events: charge entry: %w", err)
	}
	// Vendor float ledger: credit the vendor's accrued takings.
	if _, err := tx.Exec(ctx, `INSERT INTO vendor_float (id, vendor_id, amount_kobo, reference, idempotency_key) VALUES ($1,$2,$3,$4,$5)`,
		uuid.New().String(), vendorID, amountKobo, "tap:"+chargeID, idemKey+":float"); err != nil {
		return nil, fmt.Errorf("events: vendor float: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vendor_charges (id, vendor_id, wallet_id, amount_kobo, idempotency_key) VALUES ($1,$2,$3,$4,$5)`,
		chargeID, vendorID, walletID, amountKobo, idemKey); err != nil {
		return nil, fmt.Errorf("events: insert charge: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("events: commit charge: %w", err)
	}
	s.log("", "events.wallet.charge", chargeID, map[string]any{"vendor": vendorID, "wallet": walletID, "kobo": amountKobo})
	return &VendorCharge{ID: chargeID, VendorID: vendorID, WalletID: walletID, AmountKobo: amountKobo, IdempotencyKey: idemKey, CreatedAt: time.Now()}, nil
}

// CloseWallet flips OPEN/SPENDING -> CLOSED and refunds the unspent residual to the
// owner's MAIN wallet (NL-3 closed-loop: float never cashes out except as a refund
// of the attendee's own un-spent money back to their main Paymax balance). The
// refund credit comes FROM the escrow float account that the top-ups funded.
func (s *Service) CloseWallet(ctx context.Context, walletID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("events: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var owner, state string
	if err := tx.QueryRow(ctx, `SELECT owner_id, state FROM event_wallets WHERE id=$1 FOR UPDATE`, walletID).Scan(&owner, &state); err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("events: wallet not found")
		}
		return err
	}
	if EventWalletState(state) == WalletClosed {
		return nil // idempotent
	}
	residual, err := s.walletBalanceTx(ctx, tx, walletID)
	if err != nil {
		return err
	}

	// ── Money leg FIRST, then finalize (crash-safe ordering) ──
	// Credit the residual escrow→MAIN wallet BEFORE flipping the wallet CLOSED and
	// writing the REFUND projection row. Until we commit, the wallet stays open and
	// the REFUND row absent, so walletBalanceTx still returns the same residual on a
	// retry; re-crediting the fixed "evtwallet:refund:<id>" key dedups via
	// alreadyApplied instead of double-refunding. The previous order (mark CLOSED +
	// REFUND → commit → THEN credit) stranded the attendee's residual on a crash in
	// the gap, because the CLOSED early-return above then guarantees no re-credit.
	if residual > 0 {
		escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
		if err != nil {
			return err
		}
		if err := s.led.Credit(ctx, owner, "evtwallet-residual:"+walletID, "evtwallet:refund:"+walletID, escrowAcc.ID, residual); !alreadyApplied(err) {
			return fmt.Errorf("events: residual refund credit: %w", err)
		}
	}

	// Residual is durable — NOW flip CLOSED and append the balancing REFUND entry
	// (ON CONFLICT so a retry that re-reaches the insert after a dedup no-ops).
	if _, err := tx.Exec(ctx, `UPDATE event_wallets SET state='CLOSED' WHERE id=$1`, walletID); err != nil {
		return fmt.Errorf("events: close wallet: %w", err)
	}
	if residual > 0 {
		if _, err := tx.Exec(ctx, `INSERT INTO event_wallet_ledger (id, wallet_id, type, amount_kobo, reference, idempotency_key) VALUES ($1,$2,'REFUND',$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`,
			uuid.New().String(), walletID, residual, "residual-refund", "evtwallet:refund:"+walletID); err != nil {
			return fmt.Errorf("events: residual entry: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("events: commit close: %w", err)
	}
	s.log(owner, "events.wallet.close", walletID, map[string]any{"residual_kobo": residual})
	return nil
}

// CloseAllWallets closes every non-closed wallet for an event (called on event close).
func (s *Service) CloseAllWallets(ctx context.Context, eventID string) (int, error) {
	rows, err := s.db.Query(ctx, `SELECT id FROM event_wallets WHERE event_id=$1 AND state<>'CLOSED'`, eventID)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	n := 0
	for _, id := range ids {
		if err := s.CloseWallet(ctx, id); err == nil {
			n++
		}
	}
	return n, nil
}

// GetWallet returns an attendee wallet with its projected balance.
func (s *Service) GetWallet(ctx context.Context, ownerID, walletID string) (*EventWallet, error) {
	w, err := s.loadWallet(ctx, walletID)
	if err != nil {
		return nil, err
	}
	if w.OwnerID != ownerID {
		return nil, ErrForbidden
	}
	return w, nil
}

// ---------- Vendors + settlement (KYC-gated payouts, NL-10) ----------

// AddVendor registers a POS-lite vendor (organiser-only). The vendor user is the
// payout beneficiary; a POS-lite credential identifies them at a stall.
func (s *Service) AddVendor(ctx context.Context, organiserID, eventID string, v Vendor) (*Vendor, error) {
	if err := s.assertOwner(ctx, eventID, organiserID); err != nil {
		return nil, err
	}
	cred, err := s.cred.Issue(ctx, v.UserID, credential.KindVendorPOS, credential.Policy{AllowReentry: true, ReentryWindow: 12 * time.Hour, RotateTTL: 60 * time.Second})
	if err != nil {
		return nil, fmt.Errorf("events: issue vendor credential: %w", err)
	}
	v.ID = uuid.New().String()
	v.EventID = eventID
	v.Active = true
	v.CredentialID = cred.ID
	const ins = `INSERT INTO event_vendors (id, event_id, user_id, name, active, credential_id) VALUES ($1,$2,$3,$4,true,$5)`
	if _, err := s.db.Exec(ctx, ins, v.ID, v.EventID, v.UserID, v.Name, v.CredentialID); err != nil {
		return nil, fmt.Errorf("events: insert vendor: %w", err)
	}
	return &v, nil
}

// SettleVendor pays out a vendor's accrued float net of the platform fee. NL-10:
// the payout is KYC-gated — an unverified vendor (tier 0) is blocked fail-closed.
// The escrow float -> vendor wallet move runs through the finance/settlement spine.
func (s *Service) SettleVendor(ctx context.Context, eventID, vendorID, idemKey string) (int64, error) {
	var vendorUser string
	if err := s.db.QueryRow(ctx, `SELECT user_id FROM event_vendors WHERE id=$1 AND event_id=$2`, vendorID, eventID).Scan(&vendorUser); err != nil {
		if err == pgx.ErrNoRows {
			return 0, fmt.Errorf("events: vendor not found")
		}
		return 0, err
	}
	// NL-10 KYC gate on payout: a non-verified vendor cannot receive funds.
	tier, err := s.tiers.GetUserTier(ctx, vendorUser)
	if err != nil {
		return 0, fmt.Errorf("events: vendor kyc check (fail closed): %w", err)
	}
	if int(tier) < 1 {
		return 0, ErrKYCRequired
	}

	ev, err := s.GetEvent(ctx, eventID)
	if err != nil {
		return 0, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("events: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Sum unsettled vendor float under a row lock. The lock is held across the
	// ledger posts below, so a concurrent SettleVendor for the same vendor blocks
	// until we commit (or roll back) and can never double-count the same float.
	var gross int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(SUM(amount_kobo),0) FROM vendor_float WHERE vendor_id=$1 AND settled=false FOR UPDATE`, vendorID).Scan(&gross); err != nil {
		return 0, fmt.Errorf("events: sum float: %w", err)
	}
	if gross <= 0 {
		return 0, fmt.Errorf("events: nothing to settle")
	}
	fee := (gross * int64(ev.FeeBps)) / 10000 // integer bps, truncates toward zero (favours vendor); net+fee==gross exactly
	net := gross - fee

	// ── Money legs FIRST, then finalize (crash-safe ordering) ──
	// Post the idempotent escrow→vendor (net) and escrow→revenue (fee) legs
	// BEFORE marking the float settled. If we crash after a post but before the
	// commit below, the float stays settled=false, so a same-idemKey retry re-sums
	// the identical gross and re-posts — which dedups via alreadyApplied rather
	// than double-paying — then finalizes. The previous order (mark settled →
	// commit → THEN post) stranded a vendor's money forever on a crash in the gap:
	// settled=true with no payout and no way to re-settle (SUM(settled=false)=0).
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return 0, err
	}
	if err := s.led.Credit(ctx, vendorUser, "vendor-settle:"+vendorID, idemKey+":net", escrowAcc.ID, net); !alreadyApplied(err) {
		return 0, fmt.Errorf("events: vendor net credit: %w", err)
	}
	if fee > 0 {
		revAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if err != nil {
			return 0, err
		}
		if err := s.led.PostJournal(ctx, ledger.JournalEntry{
			Reference: "vendor-fee:" + vendorID, IdempotencyKey: idemKey + ":fee",
			AmountKobo: fee, DebitAccountID: escrowAcc.ID, CreditAccountID: revAcc.ID,
		}); !alreadyApplied(err) {
			return 0, fmt.Errorf("events: fee posting: %w", err)
		}
	}

	// Both legs are durable — NOW finalize the float + settlement record and commit.
	// (ON CONFLICT so a retry that re-reaches this insert after a dedup no-ops.)
	if _, err := tx.Exec(ctx, `UPDATE vendor_float SET settled=true, settled_at=now() WHERE vendor_id=$1 AND settled=false`, vendorID); err != nil {
		return 0, fmt.Errorf("events: mark float settled: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO event_settlements (id, event_id, vendor_id, gross_kobo, fee_kobo, net_kobo, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING`,
		uuid.New().String(), eventID, vendorID, gross, fee, net, idemKey); err != nil {
		return 0, fmt.Errorf("events: insert settlement: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("events: commit settlement: %w", err)
	}
	s.log(vendorUser, "events.vendor.settle", vendorID, map[string]any{"gross": gross, "fee": fee, "net": net})
	return net, nil
}

// ---------- internals ----------

// sqlStater matches a pgx-wrapped *pgconn.PgError without importing pgconn here
// (same shape used in internal/marketplace/repository.go).
type sqlStater interface{ SQLState() string }

// alreadyApplied reports whether a ledger/wallet post is DURABLY DONE — either it
// just succeeded (err == nil) or it failed *only because this idempotency key was
// already posted* (ErrDuplicate from the Redis fast-path, or a Postgres 23505
// unique_violation from the durable DB fallback).
//
// This is the crux of the crash-safe "post the idempotent ledger leg FIRST, mark
// the DB state final LAST" ordering used by Purchase/SettleVendor/CloseWallet. On
// a retry after a crash between the post and the state-mark, re-posting the same
// key returns duplicate — which means the money already moved, so the caller may
// safely finalize rather than treating it as a failure (which would strand funds
// forever, since the un-finalized state can never be retried past that point).
//
// A genuine failure (e.g. ledger.ErrInsufficientFunds, a connection error) is NOT
// swallowed: it returns false so the caller aborts/compensates.
func alreadyApplied(err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, ledger.ErrDuplicate) {
		return true
	}
	var st sqlStater
	if errors.As(err, &st) {
		return st.SQLState() == "23505"
	}
	return false
}

func (s *Service) appendWalletEntry(ctx context.Context, walletID, typ string, amountKobo int64, ref, idem string) error {
	const ins = `INSERT INTO event_wallet_ledger (id, wallet_id, type, amount_kobo, reference, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, uuid.New().String(), walletID, typ, amountKobo, ref, idem); err != nil {
		return fmt.Errorf("events: wallet entry: %w", err)
	}
	return nil
}

func (s *Service) walletBalance(ctx context.Context, walletID string) (int64, error) {
	const q = `SELECT COALESCE(SUM(CASE WHEN type='TOPUP' THEN amount_kobo ELSE -amount_kobo END),0) FROM event_wallet_ledger WHERE wallet_id=$1`
	var bal int64
	err := s.db.QueryRow(ctx, q, walletID).Scan(&bal)
	return bal, err
}

func (s *Service) walletBalanceTx(ctx context.Context, tx pgx.Tx, walletID string) (int64, error) {
	const q = `SELECT COALESCE(SUM(CASE WHEN type='TOPUP' THEN amount_kobo ELSE -amount_kobo END),0) FROM event_wallet_ledger WHERE wallet_id=$1`
	var bal int64
	err := tx.QueryRow(ctx, q, walletID).Scan(&bal)
	return bal, err
}

func (s *Service) loadWallet(ctx context.Context, walletID string) (*EventWallet, error) {
	const q = `SELECT id, event_id, owner_id, state, COALESCE(credential_id,''), created_at FROM event_wallets WHERE id=$1`
	var w EventWallet
	var state string
	if err := s.db.QueryRow(ctx, q, walletID).Scan(&w.ID, &w.EventID, &w.OwnerID, &state, &w.CredentialID, &w.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	w.State = EventWalletState(state)
	bal, err := s.walletBalance(ctx, walletID)
	if err != nil {
		return nil, err
	}
	w.BalanceKobo = bal
	return &w, nil
}

func (s *Service) walletFor(ctx context.Context, eventID, ownerID string) (*EventWallet, error) {
	var id string
	if err := s.db.QueryRow(ctx, `SELECT id FROM event_wallets WHERE event_id=$1 AND owner_id=$2`, eventID, ownerID).Scan(&id); err != nil {
		return nil, err
	}
	return s.loadWallet(ctx, id)
}

func (s *Service) chargeByID(ctx context.Context, id string) (*VendorCharge, error) {
	const q = `SELECT id, vendor_id, wallet_id, amount_kobo, idempotency_key, created_at FROM vendor_charges WHERE id=$1`
	var v VendorCharge
	if err := s.db.QueryRow(ctx, q, id).Scan(&v.ID, &v.VendorID, &v.WalletID, &v.AmountKobo, &v.IdempotencyKey, &v.CreatedAt); err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *Service) assertOwner(ctx context.Context, eventID, organiserID string) error {
	var owner string
	if err := s.db.QueryRow(ctx, `SELECT organiser_id FROM events WHERE id=$1`, eventID).Scan(&owner); err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	if owner != organiserID {
		return ErrForbidden
	}
	return nil
}

func (s *Service) log(actor, action, id string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "events", "event", id, nil, meta, "", "", "info")
}

// Sentinel errors.
var (
	ErrNotFound          = fmt.Errorf("events: not found")
	ErrForbidden         = fmt.Errorf("events: forbidden")
	ErrSoldOut           = fmt.Errorf("events: tier sold out")
	ErrInsufficientFloat = fmt.Errorf("events: insufficient event-wallet balance")
	ErrKYCRequired       = fmt.Errorf("events: vendor must complete KYC before payout (NL-10)")
)

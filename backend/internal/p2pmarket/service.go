package p2pmarket

import (
	"context"
	"errors"
	"fmt"
	"spotlight/backend/internal/escrow"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const moduleType = "p2pmarket"

// Auditor mirrors services.AuditService (NL-12); nil-safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Service is the P2P marketplace. It owns listings/orders/ratings but DELEGATES all
// money + dispute mechanics to the shared escrow core: checkout = escrow.Hold,
// confirm = escrow.Release, dispute = escrow.RaiseDispute, arbitration =
// escrow.Arbitrate. NL-6: funds sit held, never lent. NL-9: checkout idempotent on key.
type Service struct {
	db     *pgxpool.Pool
	escrow *escrow.Service
	audit  Auditor
}

func NewService(db *pgxpool.Pool, esc *escrow.Service, audit Auditor) *Service {
	return &Service{db: db, escrow: esc, audit: audit}
}

// CreateListing publishes a seller listing (object-level: the caller is the seller).
func (s *Service) CreateListing(ctx context.Context, sellerID, title, description string, priceKobo int64) (*Listing, error) {
	if sellerID == "" {
		return nil, errors.New("p2pmarket: seller required")
	}
	if priceKobo <= 0 {
		return nil, errors.New("p2pmarket: price must be positive kobo")
	}
	l := &Listing{ID: uuid.New().String(), SellerID: sellerID, Title: title, Description: description, PriceKobo: priceKobo, State: ListingActive, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	const ins = `INSERT INTO p2p_listings (id, seller_id, title, description, price_kobo, state) VALUES ($1,$2,$3,$4,$5,'ACTIVE')`
	if _, err := s.db.Exec(ctx, ins, l.ID, l.SellerID, l.Title, l.Description, l.PriceKobo); err != nil {
		return nil, fmt.Errorf("p2pmarket: insert listing: %w", err)
	}
	s.log(sellerID, "p2p.listing.create", l.ID, nil)
	return l, nil
}

// CloseListing closes a seller's own listing (object-level authZ).
func (s *Service) CloseListing(ctx context.Context, listingID, sellerID string) error {
	const q = `UPDATE p2p_listings SET state='CLOSED', updated_at=now() WHERE id=$1 AND seller_id=$2 AND state='ACTIVE'`
	ct, err := s.db.Exec(ctx, q, listingID, sellerID)
	if err != nil {
		return fmt.Errorf("p2pmarket: close listing: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotOwnerOrState
	}
	return nil
}

// GetListing returns a listing.
func (s *Service) GetListing(ctx context.Context, listingID string) (*Listing, error) {
	const q = `SELECT id, seller_id, title, description, price_kobo, state, created_at, updated_at FROM p2p_listings WHERE id=$1`
	var l Listing
	var state string
	if err := s.db.QueryRow(ctx, q, listingID).Scan(&l.ID, &l.SellerID, &l.Title, &l.Description, &l.PriceKobo, &state, &l.CreatedAt, &l.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrListingNotFound
		}
		return nil, err
	}
	l.State = ListingState(state)
	return &l, nil
}

// Browse returns active listings (newest first).
func (s *Service) Browse(ctx context.Context, limit int) ([]Listing, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	const q = `SELECT id, seller_id, title, description, price_kobo, state, created_at, updated_at
	           FROM p2p_listings WHERE state='ACTIVE' ORDER BY created_at DESC LIMIT $1`
	rows, err := s.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Listing
	for rows.Next() {
		var l Listing
		var state string
		if err := rows.Scan(&l.ID, &l.SellerID, &l.Title, &l.Description, &l.PriceKobo, &state, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		l.State = ListingState(state)
		out = append(out, l)
	}
	return out, rows.Err()
}

// Checkout creates an order and HOLDS the buyer's funds in escrow (escrow.Hold,
// idempotent on idemKey — NL-6/NL-9). The seller is recorded but not paid until the
// buyer confirms or an arbiter releases.
func (s *Service) Checkout(ctx context.Context, listingID, buyerID, idemKey string) (*Order, error) {
	if buyerID == "" || idemKey == "" {
		return nil, errors.New("p2pmarket: buyer and idempotency key required")
	}
	l, err := s.GetListing(ctx, listingID)
	if err != nil {
		return nil, err
	}
	if l.State != ListingActive {
		return nil, errors.New("p2pmarket: listing not available")
	}
	if l.SellerID == buyerID {
		return nil, errors.New("p2pmarket: cannot buy your own listing")
	}

	// Idempotent: an order already created for this key is returned as-is.
	if existing, err := s.orderByIdem(ctx, idemKey); err == nil && existing != nil {
		return existing, nil
	}

	// Hold buyer funds in escrow (the escrow core debits the buyer's wallet into the
	// shared escrow standing account; tier-limit + insufficient-funds fail closed).
	// The seller is pinned as the hold's payee so a later dispute can still be
	// arbitrated to RELEASE — an unpinned (NULL-payee) hold is refund-only.
	hold, err := s.escrow.HoldWithPayee(ctx, buyerID, l.SellerID, "p2p:"+listingID, moduleType, idemKey, l.PriceKobo)
	if err != nil {
		return nil, fmt.Errorf("p2pmarket: escrow hold: %w", err)
	}
	if hold.State != escrow.StateHeld {
		// A prior attempt under this key already resolved the hold — most often
		// REFUNDED after an order-insert failure below. Attaching a CHECKOUT
		// order to terminal money would wedge it forever ("in escrow" with no
		// funds held), so refuse instead: the buyer already has their money
		// back (refund) and must retry with a NEW idempotency key; a DISPUTED /
		// RELEASED outcome is a recon case that must not silently proceed.
		return nil, fmt.Errorf("p2pmarket: escrow hold %s already %s — checkout cannot proceed under this idempotency key", hold.ID, hold.State)
	}

	o := &Order{
		ID: uuid.New().String(), ListingID: listingID, BuyerID: buyerID, SellerID: l.SellerID,
		AmountKobo: l.PriceKobo, EscrowID: hold.ID, State: OrderCheckout, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	const ins = `INSERT INTO p2p_orders (id, listing_id, buyer_id, seller_id, amount_kobo, escrow_id, state, idempotency_key)
	             VALUES ($1,$2,$3,$4,$5,$6,'CHECKOUT',$7) ON CONFLICT (idempotency_key) DO NOTHING`
	ct, err := s.db.Exec(ctx, ins, o.ID, o.ListingID, o.BuyerID, o.SellerID, o.AmountKobo, o.EscrowID, idemKey)
	if err != nil {
		// The escrow hold is durable but (apparently) owns no order — normally
		// refunded best-effort (mirrors transport's refundOnFailure). But a
		// blind refund can drain a hold a COMMITTED order references: a racing
		// same-key retry may have inserted between our orderByIdem read and
		// this failed Exec (F6a). Probe before refunding — on ANY inconclusive
		// result leave the hold HELD for recon rather than move money we cannot
		// prove is unowned.
		if persisted, perr := s.orderByIdem(ctx, idemKey); perr == nil && persisted != nil {
			return persisted, nil
		} else if perr != nil && !errors.Is(perr, pgx.ErrNoRows) {
			return nil, fmt.Errorf("p2pmarket: insert order failed and the same-key order probe failed — hold left HELD for recon: %w", errors.Join(err, perr))
		}
		if owned, oerr := s.holdReferenced(ctx, hold.ID); oerr != nil || owned {
			return nil, fmt.Errorf("p2pmarket: insert order failed and the hold may be referenced by an order — refund refused, hold left HELD for recon (owned=%v): %w", owned, errors.Join(err, oerr))
		}
		// Provably unowned: refund it best-effort rather than strand a HELD
		// hold with no owning row. Refund is idempotent; a failed refund is
		// still surfaced via the insert error, and a same-key client retry also
		// self-heals (Hold replays the same hold, the insert is retried).
		_ = s.escrow.Refund(ctx, hold.ID)
		return nil, fmt.Errorf("p2pmarket: insert order: %w", err)
	}
	if ct.RowsAffected() == 0 {
		// A same-key order committed between our orderByIdem check and this
		// insert (a racing retry). The escrow hold for this key IS that order's
		// hold (escrow.Hold replays by key), so the money is accounted for —
		// return the persisted row, never the unpersisted `o` we built above
		// (which would report an order id/escrow pairing nothing saved). Do NOT
		// refund: the hold is owned by the conflicting order.
		persisted, ferr := s.orderByIdem(ctx, idemKey)
		if ferr != nil {
			return nil, fmt.Errorf("p2pmarket: order insert conflicted but re-read failed: %w", ferr)
		}
		return persisted, nil
	}
	// Mark the listing sold (single-quantity model).
	_, _ = s.db.Exec(ctx, `UPDATE p2p_listings SET state='SOLD', updated_at=now() WHERE id=$1 AND state='ACTIVE'`, listingID)
	s.log(buyerID, "p2p.order.checkout", o.ID, map[string]any{"listing": listingID, "amount_kobo": l.PriceKobo})
	return o, nil
}

// ConfirmReceipt releases escrow to the seller (only the buyer may confirm —
// object-level authZ). CHECKOUT → CONFIRMED via escrow.Release.
func (s *Service) ConfirmReceipt(ctx context.Context, orderID, buyerID string) error {
	o, err := s.GetOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if o.BuyerID != buyerID {
		return ErrNotParty
	}
	if o.State != OrderCheckout {
		return errors.New("p2pmarket: order not in CHECKOUT state")
	}
	if err := s.escrow.Release(ctx, o.EscrowID, o.SellerID); err != nil {
		return fmt.Errorf("p2pmarket: release escrow: %w", err)
	}
	if _, err := s.db.Exec(ctx, `UPDATE p2p_orders SET state='CONFIRMED', updated_at=now() WHERE id=$1`, orderID); err != nil {
		return fmt.Errorf("p2pmarket: confirm order: %w", err)
	}
	s.log(buyerID, "p2p.order.confirm", orderID, nil)
	return nil
}

// RaiseDispute contests an order via the shared escrow dispute extension. Either
// party may dispute (escrow enforces party authZ). CHECKOUT → DISPUTED.
//
// Crash convergence (F6b): the escrow side commits first (hold DISPUTED +
// dispute row in one tx); if the p2p_orders update then fails, the order is
// stuck CHECKOUT over a DISPUTED hold. A retry converges because the escrow
// core returns the existing dispute on an already-DISPUTED hold — this call
// then succeeds and marks the order DISPUTED. Likewise an order already
// DISPUTED replays as a no-op once its open dispute is confirmed.
func (s *Service) RaiseDispute(ctx context.Context, orderID, raisedBy, evidence string) error {
	o, err := s.GetOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if o.State == OrderDisputed {
		// Idempotent replay of a completed raise — converged only if the hold
		// really carries an OPEN dispute; otherwise fail loudly (recon).
		if d, derr := s.escrow.GetDispute(ctx, o.EscrowID); derr == nil && d != nil && d.State == "OPEN" {
			return nil
		}
		return errors.New("p2pmarket: order DISPUTED but no open escrow dispute — recon required")
	}
	if o.State != OrderCheckout {
		return errors.New("p2pmarket: only an in-escrow order can be disputed")
	}
	// Either party may dispute; the escrow core enforces party authZ against the
	// hold's payer/payee. On an already-DISPUTED hold (the wedge above) it
	// returns the persisted dispute, so this call still succeeds and the order
	// update below completes the convergence.
	if _, err := s.escrow.RaiseDispute(ctx, o.EscrowID, raisedBy, evidence); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, `UPDATE p2p_orders SET state='DISPUTED', updated_at=now() WHERE id=$1`, orderID); err != nil {
		return fmt.Errorf("p2pmarket: mark order disputed: %w", err)
	}
	s.log(raisedBy, "p2p.order.dispute", orderID, nil)
	return nil
}

// Arbitrate resolves a disputed order via escrow.Arbitrate (separation-of-duties
// enforced in the escrow core; the arbiter cannot be a party). DISPUTED →
// CONFIRMED (release to seller) | REFUNDED (refund to buyer).
//
// Crash convergence (F6c): the escrow side resolves first (terminal hold +
// RESOLVED dispute), then the order finalize commits. If it fails, the order
// stays DISPUTED over resolved money — a retry re-runs escrow.Arbitrate (a
// decision-consistent terminal state no-ops through its heal path) and the
// update below lands. A fully-finalized order replayed with the same decision
// is a no-op success; a contradicting decision or state fails closed.
func (s *Service) Arbitrate(ctx context.Context, orderID string, decision escrow.DisputeDecision, arbiterID string) error {
	if decision != escrow.DecisionRelease && decision != escrow.DecisionRefund {
		return fmt.Errorf("p2pmarket: invalid decision %q", decision)
	}
	o, err := s.GetOrder(ctx, orderID)
	if err != nil {
		return err
	}
	newState := OrderConfirmed
	if decision == escrow.DecisionRefund {
		newState = OrderRefunded
	}
	if o.State != OrderDisputed {
		if o.State == newState {
			return nil // converged replay: the decision already took effect on the order
		}
		return errors.New("p2pmarket: order not in DISPUTED state")
	}
	if err := s.escrow.Arbitrate(ctx, o.EscrowID, decision, arbiterID); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, `UPDATE p2p_orders SET state=$2, updated_at=now() WHERE id=$1`, orderID, string(newState)); err != nil {
		return fmt.Errorf("p2pmarket: finalize arbitration: %w", err)
	}
	s.log(arbiterID, "p2p.order.arbitrate", orderID, map[string]any{"decision": string(decision)})
	return nil
}

// GetOrder returns an order.
func (s *Service) GetOrder(ctx context.Context, orderID string) (*Order, error) {
	const q = `SELECT id, listing_id, buyer_id, seller_id, amount_kobo, escrow_id, state, created_at, updated_at FROM p2p_orders WHERE id=$1`
	var o Order
	var state string
	if err := s.db.QueryRow(ctx, q, orderID).Scan(&o.ID, &o.ListingID, &o.BuyerID, &o.SellerID, &o.AmountKobo, &o.EscrowID, &state, &o.CreatedAt, &o.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOrderNotFound
		}
		return nil, err
	}
	o.State = OrderState(state)
	return &o, nil
}

// RateSeller lets the buyer rate the seller after a CONFIRMED order (object-level
// authZ: only the buyer of that order, only once).
func (s *Service) RateSeller(ctx context.Context, orderID, buyerID string, stars int, comment string) (*Rating, error) {
	if stars < 1 || stars > 5 {
		return nil, errors.New("p2pmarket: stars must be 1..5")
	}
	o, err := s.GetOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.BuyerID != buyerID {
		return nil, ErrNotParty
	}
	if o.State != OrderConfirmed {
		return nil, errors.New("p2pmarket: can only rate a confirmed order")
	}
	r := &Rating{ID: uuid.New().String(), OrderID: orderID, SellerID: o.SellerID, BuyerID: buyerID, Stars: stars, Comment: comment, CreatedAt: time.Now()}
	const ins = `INSERT INTO p2p_seller_ratings (id, order_id, seller_id, buyer_id, stars, comment)
	             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (order_id) DO NOTHING`
	ct, err := s.db.Exec(ctx, ins, r.ID, r.OrderID, r.SellerID, r.BuyerID, r.Stars, r.Comment)
	if err != nil {
		return nil, fmt.Errorf("p2pmarket: insert rating: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, errors.New("p2pmarket: order already rated")
	}
	return r, nil
}

// SellerRating returns a seller's average stars + count.
func (s *Service) SellerRating(ctx context.Context, sellerID string) (avg float64, count int64, err error) {
	const q = `SELECT COALESCE(AVG(stars),0), COUNT(*) FROM p2p_seller_ratings WHERE seller_id=$1`
	err = s.db.QueryRow(ctx, q, sellerID).Scan(&avg, &count)
	return avg, count, err
}

// holdReferenced reports whether ANY committed order row points at this escrow
// hold — the fail-closed probe that gates the best-effort refund in Checkout,
// so a refund can never drain a hold an order still references (F6a).
func (s *Service) holdReferenced(ctx context.Context, escrowID string) (bool, error) {
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM p2p_orders WHERE escrow_id=$1)`, escrowID).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

func (s *Service) orderByIdem(ctx context.Context, idemKey string) (*Order, error) {
	const q = `SELECT id, listing_id, buyer_id, seller_id, amount_kobo, escrow_id, state, created_at, updated_at FROM p2p_orders WHERE idempotency_key=$1`
	var o Order
	var state string
	if err := s.db.QueryRow(ctx, q, idemKey).Scan(&o.ID, &o.ListingID, &o.BuyerID, &o.SellerID, &o.AmountKobo, &o.EscrowID, &state, &o.CreatedAt, &o.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, pgx.ErrNoRows
		}
		return nil, err
	}
	o.State = OrderState(state)
	return &o, nil
}

func (s *Service) log(actor, action, id string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "p2pmarket", "p2p", id, nil, meta, "", "", "info")
}

// Sentinel errors.
var (
	ErrListingNotFound = errors.New("p2pmarket: listing not found")
	ErrOrderNotFound   = errors.New("p2pmarket: order not found")
	ErrNotParty        = errors.New("p2pmarket: not a party to this order")
	ErrNotOwnerOrState = errors.New("p2pmarket: not owner or not in a closable state")
)

// ListingState is the listing lifecycle.
type ListingState string

const (
	ListingActive ListingState = "ACTIVE"
	ListingSold   ListingState = "SOLD"
	ListingClosed ListingState = "CLOSED"
)

// Listing is a seller's offer.
type Listing struct {
	ID          string       `json:"id"`
	SellerID    string       `json:"seller_id"` // FK auth.users(id)
	Title       string       `json:"title"`
	Description string       `json:"description"`
	PriceKobo   int64        `json:"price_kobo"`
	State       ListingState `json:"state"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

// OrderState is the order lifecycle. It mirrors the escrow hold underneath:
// CHECKOUT (funds HELD) → CONFIRMED (RELEASED to seller) | DISPUTED → resolved.
type OrderState string

const (
	OrderCheckout  OrderState = "CHECKOUT"  // funds held in escrow
	OrderConfirmed OrderState = "CONFIRMED" // buyer confirmed delivery → released
	OrderDisputed  OrderState = "DISPUTED"  // contested → arbitration
	OrderRefunded  OrderState = "REFUNDED"  // refunded to buyer
)

// Order is a buyer's purchase of a listing, backed by an escrow hold.
type Order struct {
	ID         string     `json:"id"`
	ListingID  string     `json:"listing_id"`
	BuyerID    string     `json:"buyer_id"`
	SellerID   string     `json:"seller_id"`
	AmountKobo int64      `json:"amount_kobo"`
	EscrowID   string     `json:"escrow_id"` // -> escrow_holds.id
	State      OrderState `json:"state"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// Rating is a buyer's rating of a seller after an order (1..5).
type Rating struct {
	ID        string    `json:"id"`
	OrderID   string    `json:"order_id"`
	SellerID  string    `json:"seller_id"`
	BuyerID   string    `json:"buyer_id"`
	Stars     int       `json:"stars"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"created_at"`
}

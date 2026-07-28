package p2pmarket

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/escrow"
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

// ───────────────────────── Listings ─────────────────────────────────────────────

// CreateListing publishes a seller listing (object-level: the caller is the seller).
func (s *Service) CreateListing(ctx context.Context, sellerID, title, description string, priceKobo int64) (*Listing, error) {
	if sellerID == "" {
		return nil, fmt.Errorf("p2pmarket: seller required")
	}
	if priceKobo <= 0 {
		return nil, fmt.Errorf("p2pmarket: price must be positive kobo")
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
		if err == pgx.ErrNoRows {
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

// ───────────────────────── Orders (escrow-backed) ───────────────────────────────

// Checkout creates an order and HOLDS the buyer's funds in escrow (escrow.Hold,
// idempotent on idemKey — NL-6/NL-9). The seller is recorded but not paid until the
// buyer confirms or an arbiter releases.
func (s *Service) Checkout(ctx context.Context, listingID, buyerID, idemKey string) (*Order, error) {
	if buyerID == "" || idemKey == "" {
		return nil, fmt.Errorf("p2pmarket: buyer and idempotency key required")
	}
	l, err := s.GetListing(ctx, listingID)
	if err != nil {
		return nil, err
	}
	if l.State != ListingActive {
		return nil, fmt.Errorf("p2pmarket: listing not available")
	}
	if l.SellerID == buyerID {
		return nil, fmt.Errorf("p2pmarket: cannot buy your own listing")
	}

	// Idempotent: an order already created for this key is returned as-is.
	if existing, err := s.orderByIdem(ctx, idemKey); err == nil && existing != nil {
		return existing, nil
	}

	// Hold buyer funds in escrow (the escrow core debits the buyer's wallet into the
	// shared escrow standing account; tier-limit + insufficient-funds fail closed).
	hold, err := s.escrow.Hold(ctx, buyerID, "p2p:"+listingID, moduleType, idemKey, l.PriceKobo)
	if err != nil {
		return nil, fmt.Errorf("p2pmarket: escrow hold: %w", err)
	}

	o := &Order{
		ID: uuid.New().String(), ListingID: listingID, BuyerID: buyerID, SellerID: l.SellerID,
		AmountKobo: l.PriceKobo, EscrowID: hold.ID, State: OrderCheckout, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	const ins = `INSERT INTO p2p_orders (id, listing_id, buyer_id, seller_id, amount_kobo, escrow_id, state, idempotency_key)
	             VALUES ($1,$2,$3,$4,$5,$6,'CHECKOUT',$7) ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, o.ID, o.ListingID, o.BuyerID, o.SellerID, o.AmountKobo, o.EscrowID, idemKey); err != nil {
		return nil, fmt.Errorf("p2pmarket: insert order: %w", err)
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
		return fmt.Errorf("p2pmarket: order not in CHECKOUT state")
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
func (s *Service) RaiseDispute(ctx context.Context, orderID, raisedBy, evidence string) error {
	o, err := s.GetOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if o.State != OrderCheckout {
		return fmt.Errorf("p2pmarket: only an in-escrow order can be disputed")
	}
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
func (s *Service) Arbitrate(ctx context.Context, orderID string, decision escrow.DisputeDecision, arbiterID string) error {
	o, err := s.GetOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if o.State != OrderDisputed {
		return fmt.Errorf("p2pmarket: order not in DISPUTED state")
	}
	if err := s.escrow.Arbitrate(ctx, o.EscrowID, decision, arbiterID); err != nil {
		return err
	}
	newState := OrderConfirmed
	if decision == escrow.DecisionRefund {
		newState = OrderRefunded
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
		if err == pgx.ErrNoRows {
			return nil, ErrOrderNotFound
		}
		return nil, err
	}
	o.State = OrderState(state)
	return &o, nil
}

// ───────────────────────── Seller ratings ───────────────────────────────────────

// RateSeller lets the buyer rate the seller after a CONFIRMED order (object-level
// authZ: only the buyer of that order, only once).
func (s *Service) RateSeller(ctx context.Context, orderID, buyerID string, stars int, comment string) (*Rating, error) {
	if stars < 1 || stars > 5 {
		return nil, fmt.Errorf("p2pmarket: stars must be 1..5")
	}
	o, err := s.GetOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.BuyerID != buyerID {
		return nil, ErrNotParty
	}
	if o.State != OrderConfirmed {
		return nil, fmt.Errorf("p2pmarket: can only rate a confirmed order")
	}
	r := &Rating{ID: uuid.New().String(), OrderID: orderID, SellerID: o.SellerID, BuyerID: buyerID, Stars: stars, Comment: comment, CreatedAt: time.Now()}
	const ins = `INSERT INTO p2p_seller_ratings (id, order_id, seller_id, buyer_id, stars, comment)
	             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (order_id) DO NOTHING`
	ct, err := s.db.Exec(ctx, ins, r.ID, r.OrderID, r.SellerID, r.BuyerID, r.Stars, r.Comment)
	if err != nil {
		return nil, fmt.Errorf("p2pmarket: insert rating: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, fmt.Errorf("p2pmarket: order already rated")
	}
	return r, nil
}

// SellerRating returns a seller's average stars + count.
func (s *Service) SellerRating(ctx context.Context, sellerID string) (avg float64, count int64, err error) {
	const q = `SELECT COALESCE(AVG(stars),0), COUNT(*) FROM p2p_seller_ratings WHERE seller_id=$1`
	err = s.db.QueryRow(ctx, q, sellerID).Scan(&avg, &count)
	return avg, count, err
}

// --- internals ---

func (s *Service) orderByIdem(ctx context.Context, idemKey string) (*Order, error) {
	const q = `SELECT id, listing_id, buyer_id, seller_id, amount_kobo, escrow_id, state, created_at, updated_at FROM p2p_orders WHERE idempotency_key=$1`
	var o Order
	var state string
	if err := s.db.QueryRow(ctx, q, idemKey).Scan(&o.ID, &o.ListingID, &o.BuyerID, &o.SellerID, &o.AmountKobo, &o.EscrowID, &state, &o.CreatedAt, &o.UpdatedAt); err != nil {
		if err == pgx.ErrNoRows {
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
	ErrListingNotFound = fmt.Errorf("p2pmarket: listing not found")
	ErrOrderNotFound   = fmt.Errorf("p2pmarket: order not found")
	ErrNotParty        = fmt.Errorf("p2pmarket: not a party to this order")
	ErrNotOwnerOrState = fmt.Errorf("p2pmarket: not owner or not in a closable state")
)

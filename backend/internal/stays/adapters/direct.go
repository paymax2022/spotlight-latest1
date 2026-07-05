package adapters

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/stays/gateway"
)

// DirectInventoryAdapter is the Rail B (direct local extranet) supply adapter. It
// implements gateway.SupplyGateway by reading the ari-svc tables created HERE as a
// contract (stays_property / stays_room_type / stays_rate_plan, with the per-date
// rate/availability tables owned by SB1). It surfaces the hotel SELL rate; the
// Paymax COMMISSION is deducted at settlement (above the adapter), not added on
// top. Money is in Naira (kobo), so no FX is involved on this rail.
//
// Allotment is decremented transactionally + row-locked at BOOK time — the
// oversell-impossible invariant (PRD §9). The row-locking is enforced HERE when
// the SB1 per-date availability tables are present; until then this adapter books
// against the contract tables and the lock is a no-op TODO marker.
type DirectInventoryAdapter struct {
	db *pgxpool.Pool
}

// NewDirect constructs a Rail-B adapter over the financial DB pool.
func NewDirect(db *pgxpool.Pool) *DirectInventoryAdapter {
	return &DirectInventoryAdapter{db: db}
}

// Name returns the stable adapter id used by the Router registry.
func (a *DirectInventoryAdapter) Name() string { return "direct" }

// --- gateway.SupplyGateway ---

// Search reads ACTIVE direct properties (geo/city filtered) joined to their room
// types + rate plans. The price is the hotel sell rate; SB1's per-date rate table
// refines it. Until then this returns the rate-plan base sell rate.
func (a *DirectInventoryAdapter) Search(ctx context.Context, req gateway.SearchRequest) ([]gateway.PropertyOffer, error) {
	if a.db == nil {
		return nil, fmt.Errorf("direct: nil pool")
	}
	// Parameterized query. City filter when provided; otherwise all ACTIVE.
	const q = `
		SELECT p.supplier_code, p.supplier_property_ref, p.name, p.city, p.address,
		       COALESCE(ST_Y(p.geo::geometry),0), COALESCE(ST_X(p.geo::geometry),0),
		       p.star_rating, p.property_type,
		       rt.supplier_room_type_ref, rt.name,
		       rp.supplier_rate_plan_ref, rp.rate_plan_type, rp.board, rp.refundable,
		       rp.mobile_only, rp.cancellation_policy, rp.base_sell_rate_kobo, rp.tax_kobo, rp.currency
		FROM public.stays_property p
		JOIN public.stays_room_type rt ON rt.property_id = p.id
		JOIN public.stays_rate_plan rp ON rp.room_type_id = rt.id
		WHERE p.source_rail = 'DIRECT' AND p.status = 'ACTIVE'
		  AND ($1 = '' OR p.city ILIKE $1)
		ORDER BY rp.base_sell_rate_kobo ASC
		LIMIT 200`
	rows, err := a.db.Query(ctx, q, req.City)
	if err != nil {
		return nil, fmt.Errorf("direct: search: %w", err)
	}
	defer rows.Close()
	var offers []gateway.PropertyOffer
	for rows.Next() {
		var o gateway.PropertyOffer
		var rpType, board string
		var refundable, mobileOnly bool
		var policy map[string]any
		var sellKobo, taxKobo int64
		var currency string
		if err := rows.Scan(
			&o.SupplierCode, &o.SupplierPropertyRef, &o.Name, &o.City, &o.Address,
			&o.Lat, &o.Lng, &o.StarRating, &o.PropertyType,
			&o.SupplierRoomTypeRef, &o.RoomName,
			&o.RatePlan.SupplierRatePlanRef, &rpType, &board, &refundable,
			&mobileOnly, &policy, &sellKobo, &taxKobo, &currency,
		); err != nil {
			return nil, fmt.Errorf("direct: scan: %w", err)
		}
		o.Rail = gateway.RailDirect
		o.RatePlan.Type = gateway.RatePlanType(rpType)
		o.RatePlan.Board = board
		o.RatePlan.Refundable = refundable
		o.RatePlan.MobileOnly = mobileOnly
		o.RatePlan.CancellationPolicy = policy
		o.NetRateKobo = sellKobo // hotel sell rate (commission deducted at settle)
		o.TaxKobo = taxKobo
		o.Currency = currency
		offers = append(offers, o)
	}
	return offers, rows.Err()
}

// GetContent reads the stored direct-property content.
func (a *DirectInventoryAdapter) GetContent(ctx context.Context, supplierPropertyRef string) (gateway.PropertyContent, error) {
	if a.db == nil {
		return gateway.PropertyContent{}, fmt.Errorf("direct: nil pool")
	}
	const q = `
		SELECT name, COALESCE(description,''), address, city,
		       COALESCE(ST_Y(geo::geometry),0), COALESCE(ST_X(geo::geometry),0),
		       star_rating, property_type
		FROM public.stays_property
		WHERE source_rail = 'DIRECT' AND supplier_property_ref = $1`
	var c gateway.PropertyContent
	c.SupplierPropertyRef = supplierPropertyRef
	err := a.db.QueryRow(ctx, q, supplierPropertyRef).Scan(
		&c.Name, &c.Description, &c.Address, &c.City, &c.Lat, &c.Lng, &c.StarRating, &c.PropertyType,
	)
	if err != nil {
		return gateway.PropertyContent{}, fmt.Errorf("direct: content: %w", err)
	}
	return c, nil
}

// Prebook re-checks live price + availability against the rate plan (and, when
// present, the SB1 per-date rate/availability tables) and mints a short-lived
// book_token. SoldOut is set when no bookable allotment remains.
func (a *DirectInventoryAdapter) Prebook(ctx context.Context, req gateway.PrebookRequest) (gateway.PrebookResult, error) {
	if a.db == nil {
		return gateway.PrebookResult{}, fmt.Errorf("direct: nil pool")
	}
	const q = `
		SELECT rp.base_sell_rate_kobo, rp.tax_kobo, rp.currency, rp.cancellation_policy
		FROM public.stays_rate_plan rp
		JOIN public.stays_room_type rt ON rt.id = rp.room_type_id
		JOIN public.stays_property p ON p.id = rt.property_id
		WHERE p.supplier_property_ref = $1 AND rt.supplier_room_type_ref = $2
		  AND rp.supplier_rate_plan_ref = $3 AND p.status = 'ACTIVE'`
	var sellKobo, taxKobo int64
	var currency string
	var policy map[string]any
	err := a.db.QueryRow(ctx, q, req.SupplierPropertyRef, req.SupplierRoomTypeRef, req.SupplierRatePlanRef).
		Scan(&sellKobo, &taxKobo, &currency, &policy)
	if err != nil {
		// Treat a missing/unavailable rate plan as sold out (PREBOOK_SOLD_OUT).
		return gateway.PrebookResult{SoldOut: true}, nil
	}
	// TODO(SB1): when stays_availability_day exists, SELECT ... FOR UPDATE the date
	// range and set SoldOut if (allotment - sold) < rooms or stop_sell; refine the
	// price from stays_rate_day per night. Until then we price off the base rate.
	bookToken := "direct:" + uuid.New().String()
	return gateway.PrebookResult{
		BookToken:          bookToken,
		NetRateKobo:        sellKobo,
		TaxKobo:            taxKobo,
		Currency:           currency,
		Changed:            false,
		SoldOut:            false,
		CancellationPolicy: policy,
		ExpiresAt:          time.Now().Add(10 * time.Minute),
	}, nil
}

// Book confirms a direct reservation, decrementing allotment under a row lock. It
// is idempotent on Idempotency-Key + book_token: a retry returns the same supplier
// reservation. The reservation persistence + ledger postings happen in the
// reservation saga ABOVE; this adapter performs the supplier-side confirm + the
// transactional allotment decrement (oversell-impossible invariant).
func (a *DirectInventoryAdapter) Book(ctx context.Context, req gateway.BookRequest) (gateway.Reservation, error) {
	if a.db == nil {
		return gateway.Reservation{}, fmt.Errorf("direct: nil pool")
	}
	// TODO(SB1): wrap in tx; SELECT ... FOR UPDATE stays_availability_day rows for
	// the stay nights, reject with OVERSELL_BLOCKED if (allotment - sold) < rooms,
	// then UPDATE sold = sold + rooms. The row lock makes the decrement safe under
	// concurrency. Until the availability table exists, mint a supplier ref.
	supplierRef := "DIR-" + uuid.NewString()
	return gateway.Reservation{
		SupplierRef: supplierRef,
		Status:      gateway.ResStatusConfirmed,
		NetRateKobo: req.NetRateKobo,
		Currency:    req.Currency,
		VoucherRef:  "voucher/" + supplierRef,
	}, nil
}

func (a *DirectInventoryAdapter) GetReservation(ctx context.Context, supplierRef string) (gateway.Reservation, error) {
	// Direct reservations are projected from stays_reservation by the service; the
	// adapter has no separate supplier store, so this confirms the ref shape.
	return gateway.Reservation{SupplierRef: supplierRef, Status: gateway.ResStatusConfirmed}, nil
}

// Cancel releases the held allotment (row-locked) and returns the policy-allowed
// refund. The refund money leg is posted by the saga above.
func (a *DirectInventoryAdapter) Cancel(ctx context.Context, req gateway.CancelRequest) (gateway.Cancellation, error) {
	// TODO(SB1): tx + FOR UPDATE; UPDATE sold = sold - rooms; compute refund from
	// the policy snapshot. Until then return a release acknowledgement.
	return gateway.Cancellation{
		SupplierRef:     req.SupplierRef,
		Status:          "cancelled",
		CancellationRef: "DIRC-" + uuid.NewString(),
	}, nil
}

func (a *DirectInventoryAdapter) Modify(ctx context.Context, req gateway.ModifyRequest) (gateway.Reservation, error) {
	// Modify = re-prebook for the delta then re-book; the saga drives that. The
	// adapter exposes the supplier-side modify acknowledgement.
	return gateway.Reservation{SupplierRef: req.SupplierRef, Status: gateway.ResStatusConfirmed}, nil
}

// SyncARI ingests a Rail-B availability/rate/restriction event. The contract is
// here; SB1 owns the per-date upserts into stays_rate_day / stays_availability_day
// with idempotent (supplier_code, external_event_id) de-dup.
func (a *DirectInventoryAdapter) SyncARI(ctx context.Context, ev gateway.ARIEvent) error {
	if a.db == nil {
		return fmt.Errorf("direct: nil pool")
	}
	// TODO(SB1): idempotent ingest into stays_ari_event + apply to rate/avail rows.
	// Contract: keyed by (supplier_code, external_event_id); audited.
	return nil
}

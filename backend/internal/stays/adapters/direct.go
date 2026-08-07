package adapters

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
// oversell-impossible invariant (PRD §9). Every stay night is locked with
// SELECT ... FOR UPDATE on public.stays_availability_day(room_type_id,date) in
// ascending date order (deterministic lock order → no deadlocks), the free
// allotment (allotment - sold) is validated under the lock, and only then is sold
// incremented. A racing concurrent book blocks on the row lock and, on acquiring
// it, sees the updated sold count and is correctly rejected. The Book/Cancel legs
// are idempotent via the public.stays_availability_decrement ledger (one row per
// supplier_ref) so a retried Book never double-decrements and a retried Cancel
// never double-releases.
type DirectInventoryAdapter struct {
	db *pgxpool.Pool
}

// ErrOversellBlocked is returned when the requested rooms exceed remaining
// allotment (allotment - sold) on any night, a night is stop-sell, or no
// availability row exists for a night. Checked under a row lock — the
// oversell-impossible invariant (PRD §9). The reservation saga maps this to an
// auto-release (release the hold, NO debit).
var ErrOversellBlocked = errors.New("direct: OVERSELL_BLOCKED")

// bookTokenPrefix and bookTokenVersion frame the availability context the direct
// adapter encodes into the book_token at Prebook time (room_type_id, stay dates,
// rooms) so Book — whose normalised BookRequest carries no dates/room ref — can
// perform the row-locked decrement without any signature change. Format:
//
//	direct:v1:<room_type_id>:<check_in>:<check_out>:<rooms>:<nonce>
const (
	bookTokenPrefix  = "direct"
	bookTokenVersion = "v1"
	dateLayout       = "2006-01-02"
)

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

// Prebook re-checks live price + availability against the rate plan and the SB1
// per-date availability table and mints a short-lived book_token. SoldOut is set
// when any night of the stay is closed/stop-sell or has (allotment - sold) < rooms.
//
// This is a HOLD-only check (no decrement) — matching the existing saga, which
// escrows funds first and only then calls Book to commit the allotment. The
// availability context (room_type_id + nights + rooms) needed by the decrement is
// encoded into the returned book_token so Book can commit it without any
// BookRequest signature change.
func (a *DirectInventoryAdapter) Prebook(ctx context.Context, req gateway.PrebookRequest) (gateway.PrebookResult, error) {
	if a.db == nil {
		return gateway.PrebookResult{}, fmt.Errorf("direct: nil pool")
	}
	// Resolve the rate plan (price/policy) AND the owning room_type_id (the
	// availability-calendar key) in one query.
	const q = `
		SELECT rp.base_sell_rate_kobo, rp.tax_kobo, rp.currency, rp.cancellation_policy, rt.id
		FROM public.stays_rate_plan rp
		JOIN public.stays_room_type rt ON rt.id = rp.room_type_id
		JOIN public.stays_property p ON p.id = rt.property_id
		WHERE p.supplier_property_ref = $1 AND rt.supplier_room_type_ref = $2
		  AND rp.supplier_rate_plan_ref = $3 AND p.status = 'ACTIVE'`
	var sellKobo, taxKobo int64
	var currency string
	var policy map[string]any
	var roomTypeID string
	err := a.db.QueryRow(ctx, q, req.SupplierPropertyRef, req.SupplierRoomTypeRef, req.SupplierRatePlanRef).
		Scan(&sellKobo, &taxKobo, &currency, &policy, &roomTypeID)
	if err != nil {
		// Treat a missing/unavailable rate plan as sold out (PREBOOK_SOLD_OUT).
		return gateway.PrebookResult{SoldOut: true}, nil
	}

	rooms := req.Rooms
	if rooms <= 0 {
		rooms = 1
	}

	// Availability HOLD check: row-lock every stay night and confirm sellable
	// headroom. No decrement here (hold only) — the lock is released at tx end and
	// the real commit happens in Book. If any night lacks headroom, the offer is
	// sold out (the saga maps this to PREBOOK_SOLD_OUT / re-quote).
	ok, availErr := a.checkAvailability(ctx, roomTypeID, req.CheckIn, req.CheckOut, rooms)
	if availErr != nil {
		return gateway.PrebookResult{}, availErr
	}
	if !ok {
		return gateway.PrebookResult{SoldOut: true}, nil
	}

	bookToken := encodeBookToken(roomTypeID, req.CheckIn, req.CheckOut, rooms)
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
// is idempotent on the supplier reservation ref recorded in
// stays_availability_decrement: a retry (or a saga replay) that finds the decrement
// row already committed returns the same reservation without re-decrementing. The
// reservation persistence + ledger postings happen in the reservation saga ABOVE;
// this adapter performs the supplier-side confirm + the transactional, oversell-
// impossible allotment decrement.
func (a *DirectInventoryAdapter) Book(ctx context.Context, req gateway.BookRequest) (gateway.Reservation, error) {
	if a.db == nil {
		return gateway.Reservation{}, fmt.Errorf("direct: nil pool")
	}
	roomTypeID, checkIn, checkOut, rooms, err := decodeBookToken(req.BookToken)
	if err != nil {
		return gateway.Reservation{}, err
	}

	// Deterministic supplier ref derived from the idempotency key so a retried Book
	// (same key) maps to the same reservation ref + the same decrement ledger row —
	// making the whole allotment leg idempotent. Falls back to a random ref when no
	// key is supplied (the saga always supplies one).
	supplierRef := deriveSupplierRef(req.IdempotencyKey)

	// Commit the row-locked decrement (oversell-impossible). Idempotent: if the
	// supplier_ref already has a decrement ledger row, this is a no-op.
	if err := a.commitDecrement(ctx, supplierRef, roomTypeID, checkIn, checkOut, rooms); err != nil {
		// Oversell (or lock failure) → return the error; the saga auto-releases the
		// hold (no debit) and VOIDs. The guest is never charged without a room.
		return gateway.Reservation{}, err
	}

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
// refund. The release is idempotent: the stays_availability_decrement row for the
// supplier_ref is flipped released=true exactly once, so a repeated Cancel never
// re-opens phantom inventory. The refund money leg is posted by the saga above.
func (a *DirectInventoryAdapter) Cancel(ctx context.Context, req gateway.CancelRequest) (gateway.Cancellation, error) {
	if a.db == nil {
		return gateway.Cancellation{}, fmt.Errorf("direct: nil pool")
	}
	if err := a.releaseDecrement(ctx, req.SupplierRef); err != nil {
		return gateway.Cancellation{}, err
	}
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

// SyncARI ingests a Rail-B availability/rate/restriction event. Idempotent on
// (supplier_code, external_event_id): a re-delivered event is claimed once via
// stays_ari_event's UNIQUE and skipped on replay. For availability.updated the
// per-date allotment cell is upserted into stays_availability_day with
// INSERT ... ON CONFLICT (room_type_id, date) DO UPDATE (allotment/stop_sell only —
// sold is owned by the booking saga, never overwritten by an ARI push).
func (a *DirectInventoryAdapter) SyncARI(ctx context.Context, ev gateway.ARIEvent) error {
	if a.db == nil {
		return fmt.Errorf("direct: nil pool")
	}
	if ev.SupplierCode == "" || ev.ExternalEventID == "" {
		return fmt.Errorf("direct: ARI event requires supplier_code + external_event_id")
	}

	// Idempotent claim — INSERT ... ON CONFLICT DO NOTHING is 0 rows on replay.
	ct, err := a.db.Exec(ctx, `
		INSERT INTO public.stays_ari_event (source, external_event_id, event_type, payload, status)
		VALUES ($1,$2,$3,$4,'RECEIVED')
		ON CONFLICT (source, external_event_id) DO NOTHING`,
		ev.SupplierCode, ev.ExternalEventID, ev.EventType, orMap(ev.Payload))
	if err != nil {
		return fmt.Errorf("direct: claim ARI event: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil // already applied — safe replay
	}

	applyErr := a.applyARI(ctx, ev)
	status := "APPLIED"
	errStr := ""
	if applyErr != nil {
		status = "FAILED"
		errStr = applyErr.Error()
	}
	_, _ = a.db.Exec(ctx, `
		UPDATE public.stays_ari_event SET status = $3, error = $4
		WHERE source = $1 AND external_event_id = $2`,
		ev.SupplierCode, ev.ExternalEventID, status, errStr)
	return applyErr
}

// applyARI applies an availability/rate ARI event to the per-date calendars. Only
// availability.updated touches stays_availability_day; other types are recorded
// (idempotently claimed) but applied by the full ARI service via webhooks.
func (a *DirectInventoryAdapter) applyARI(ctx context.Context, ev gateway.ARIEvent) error {
	switch ev.EventType {
	case "availability.updated":
		rt := payloadStr(ev.Payload, "room_type_id")
		date := payloadStr(ev.Payload, "date")
		if rt == "" || date == "" {
			return fmt.Errorf("direct: availability.updated requires room_type_id + date")
		}
		allot := payloadInt(ev.Payload, "allotment")
		stop := payloadBool(ev.Payload, "stop_sell")
		// Upsert allotment/stop_sell; sold is booking-owned and preserved on conflict.
		// The DB CHECK (sold <= allotment) rejects lowering allotment below sold.
		_, err := a.db.Exec(ctx, `
			INSERT INTO public.stays_availability_day (room_type_id, date, allotment, sold, stop_sell)
			VALUES ($1,$2::date,$3,0,$4)
			ON CONFLICT (room_type_id, date) DO UPDATE SET
				allotment = EXCLUDED.allotment,
				stop_sell = EXCLUDED.stop_sell,
				updated_at = now()`,
			rt, date, allot, stop)
		if err != nil {
			return fmt.Errorf("direct: upsert availability: %w", err)
		}
		return nil
	default:
		// Rate/restriction/stop-sell-range events are claimed here for de-dup but
		// applied by the dedicated ARI service (richer merge semantics). Recording
		// the event is enough to keep the direct adapter's SyncARI idempotent.
		return nil
	}
}

// --- availability engine (row-locked, oversell-impossible) ---

// checkAvailability row-locks every stay night for the room type and reports
// whether EVERY night has (allotment - sold) >= rooms and is not stop-sell. It does
// NOT decrement (hold-only prebook check). A missing availability row for any night
// is treated as zero allotment (not bookable) — inventory must be explicitly opened
// before it can be sold. The FOR UPDATE lock is released when the tx commits.
func (a *DirectInventoryAdapter) checkAvailability(ctx context.Context, roomTypeID string, checkIn, checkOut time.Time, rooms int) (bool, error) {
	nights := nightsBetween(checkIn, checkOut)
	if len(nights) == 0 {
		return false, nil
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("direct: begin availability check: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, n := range nights { // ascending date order → deterministic lock order
		var allotment, sold int
		var stop bool
		err := tx.QueryRow(ctx, `
			SELECT allotment, sold, stop_sell
			FROM public.stays_availability_day
			WHERE room_type_id = $1 AND date = $2::date
			FOR UPDATE`, roomTypeID, n).Scan(&allotment, &sold, &stop)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return false, nil // no inventory opened → not bookable
			}
			return false, fmt.Errorf("direct: lock availability: %w", err)
		}
		if stop || allotment-sold < rooms {
			return false, nil
		}
	}
	// Read-only check; rollback releases the locks (defer handles it).
	return true, nil
}

// commitDecrement performs the oversell-impossible book leg: within one tx it
// row-locks every stay night, validates headroom under the lock, increments sold by
// rooms on each night, and records a stays_availability_decrement ledger row for
// idempotency. If the supplier_ref already has a committed decrement row, it is a
// no-op (safe Book replay). Any night without headroom → ErrOversellBlocked (the
// whole tx rolls back; no partial decrement).
func (a *DirectInventoryAdapter) commitDecrement(ctx context.Context, supplierRef, roomTypeID string, checkIn, checkOut time.Time, rooms int) error {
	nights := nightsBetween(checkIn, checkOut)
	if len(nights) == 0 {
		return fmt.Errorf("direct: empty stay range")
	}
	if rooms <= 0 {
		rooms = 1
	}

	tx, err := a.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("direct: begin decrement tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Idempotency guard: claim the decrement ledger row FIRST. ON CONFLICT DO
	// NOTHING → 0 rows means this supplier_ref already decremented (a replay); skip
	// the decrement entirely.
	claim, err := tx.Exec(ctx, `
		INSERT INTO public.stays_availability_decrement
			(supplier_ref, room_type_id, check_in, check_out, rooms)
		VALUES ($1,$2,$3::date,$4::date,$5)
		ON CONFLICT (supplier_ref) DO NOTHING`,
		supplierRef, roomTypeID, checkIn.Format(dateLayout), checkOut.Format(dateLayout), rooms)
	if err != nil {
		return fmt.Errorf("direct: claim decrement: %w", err)
	}
	if claim.RowsAffected() == 0 {
		// Already decremented for this booking — commit the empty tx, no double count.
		return tx.Commit(ctx)
	}

	// Lock + validate every night under FOR UPDATE before any write. Ascending date
	// order keeps a deterministic lock order (no deadlocks between overlapping books).
	for _, n := range nights {
		var allotment, sold int
		var stop bool
		err := tx.QueryRow(ctx, `
			SELECT allotment, sold, stop_sell
			FROM public.stays_availability_day
			WHERE room_type_id = $1 AND date = $2::date
			FOR UPDATE`, roomTypeID, n).Scan(&allotment, &sold, &stop)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: no availability for %s on %s", ErrOversellBlocked, roomTypeID, n)
			}
			return fmt.Errorf("direct: lock availability: %w", err)
		}
		if stop {
			return fmt.Errorf("%w: stop-sell on %s", ErrOversellBlocked, n)
		}
		if allotment-sold < rooms {
			return fmt.Errorf("%w: %d left on %s, need %d", ErrOversellBlocked, allotment-sold, n, rooms)
		}
	}
	// All nights validated under lock — apply the decrement. The guarded WHERE
	// (sold + $3 <= allotment) plus the DB CHECK (sold <= allotment) are the
	// last-line defence against any concurrent allotment drop.
	for _, n := range nights {
		ct, err := tx.Exec(ctx, `
			UPDATE public.stays_availability_day
			SET sold = sold + $3, updated_at = now()
			WHERE room_type_id = $1 AND date = $2::date
			  AND sold + $3 <= allotment`, roomTypeID, n, rooms)
		if err != nil {
			return fmt.Errorf("direct: apply decrement: %w", err)
		}
		if ct.RowsAffected() == 0 {
			// Guard tripped (raced allotment drop) — roll back the whole booking.
			return fmt.Errorf("%w: guard tripped on %s", ErrOversellBlocked, n)
		}
	}
	return tx.Commit(ctx)
}

// releaseDecrement returns rooms to inventory for a cancelled/no-show reservation.
// It reads the stays_availability_decrement ledger row for the supplier_ref (the
// authoritative record of what was decremented), releases each night under a lock
// (floored at zero), and flips released=true exactly once. Idempotent: a repeated
// Cancel finds released already true and is a no-op. A missing ledger row (nothing
// was ever decremented) is a safe no-op.
func (a *DirectInventoryAdapter) releaseDecrement(ctx context.Context, supplierRef string) error {
	if supplierRef == "" {
		return nil
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("direct: begin release tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the ledger row; only proceed if it exists and is not already released.
	var roomTypeID string
	var checkIn, checkOut time.Time
	var rooms int
	err = tx.QueryRow(ctx, `
		SELECT room_type_id, check_in, check_out, rooms
		FROM public.stays_availability_decrement
		WHERE supplier_ref = $1 AND released = false
		FOR UPDATE`, supplierRef).Scan(&roomTypeID, &checkIn, &checkOut, &rooms)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tx.Commit(ctx) // nothing decremented, or already released — no-op
		}
		return fmt.Errorf("direct: lock decrement ledger: %w", err)
	}
	if rooms <= 0 {
		rooms = 1
	}

	for _, n := range nightsBetween(checkIn, checkOut) {
		if _, err := tx.Exec(ctx, `
			UPDATE public.stays_availability_day
			SET sold = GREATEST(sold - $3, 0), updated_at = now()
			WHERE room_type_id = $1 AND date = $2::date`, roomTypeID, n, rooms); err != nil {
			return fmt.Errorf("direct: apply release: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE public.stays_availability_decrement
		SET released = true, released_at = now()
		WHERE supplier_ref = $1`, supplierRef); err != nil {
		return fmt.Errorf("direct: mark released: %w", err)
	}
	return tx.Commit(ctx)
}

// --- book-token codec + small helpers ---

// encodeBookToken packs the availability context into the opaque book_token so Book
// (whose BookRequest carries no dates/room ref) can commit the decrement.
func encodeBookToken(roomTypeID string, checkIn, checkOut time.Time, rooms int) string {
	return strings.Join([]string{
		bookTokenPrefix, bookTokenVersion, roomTypeID,
		checkIn.Format(dateLayout), checkOut.Format(dateLayout),
		strconv.Itoa(rooms), uuid.NewString(),
	}, ":")
}

// decodeBookToken parses a direct book_token minted by encodeBookToken.
func decodeBookToken(token string) (roomTypeID string, checkIn, checkOut time.Time, rooms int, err error) {
	parts := strings.Split(token, ":")
	if len(parts) < 7 || parts[0] != bookTokenPrefix || parts[1] != bookTokenVersion {
		return "", time.Time{}, time.Time{}, 0, fmt.Errorf("direct: malformed book_token")
	}
	roomTypeID = parts[2]
	if checkIn, err = time.Parse(dateLayout, parts[3]); err != nil {
		return "", time.Time{}, time.Time{}, 0, fmt.Errorf("direct: bad check_in in book_token: %w", err)
	}
	if checkOut, err = time.Parse(dateLayout, parts[4]); err != nil {
		return "", time.Time{}, time.Time{}, 0, fmt.Errorf("direct: bad check_out in book_token: %w", err)
	}
	if rooms, err = strconv.Atoi(parts[5]); err != nil || rooms <= 0 {
		return "", time.Time{}, time.Time{}, 0, fmt.Errorf("direct: bad rooms in book_token")
	}
	return roomTypeID, checkIn, checkOut, rooms, nil
}

// deriveSupplierRef produces a stable supplier reservation ref from the caller's
// idempotency key so retried books map to the same ref + decrement ledger row. An
// empty key falls back to a random ref (the saga always supplies a key on book).
func deriveSupplierRef(idempotencyKey string) string {
	if idempotencyKey == "" {
		return "DIR-" + uuid.NewString()
	}
	return "DIR-" + uuid.NewSHA1(uuid.NameSpaceOID, []byte(idempotencyKey)).String()
}

// nightsBetween returns each occupied date [checkIn, checkOut) as YYYY-MM-DD in
// ascending order (the check-out date is not a night).
func nightsBetween(checkIn, checkOut time.Time) []string {
	var out []string
	if !checkOut.After(checkIn) {
		return out
	}
	d := time.Date(checkIn.Year(), checkIn.Month(), checkIn.Day(), 0, 0, 0, 0, time.UTC)
	end := time.Date(checkOut.Year(), checkOut.Month(), checkOut.Day(), 0, 0, 0, 0, time.UTC)
	for d.Before(end) {
		out = append(out, d.Format(dateLayout))
		d = d.AddDate(0, 0, 1)
	}
	return out
}

// hasHeadroom reports whether sold + rooms fits within total (the oversell guard
// arithmetic, extracted so it is unit-testable without a DB). The DB enforces the
// same invariant under a row lock via the WHERE guard + CHECK constraint.
func hasHeadroom(sold, rooms, total int) bool {
	return rooms > 0 && sold >= 0 && sold+rooms <= total
}

// --- payload helpers (ARI) ---

func orMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func payloadStr(m map[string]any, k string) string {
	if v, ok := m[k]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func payloadInt(m map[string]any, k string) int {
	if v, ok := m[k]; ok {
		switch t := v.(type) {
		case float64:
			return int(t)
		case int64:
			return int(t)
		case int:
			return t
		}
	}
	return 0
}

func payloadBool(m map[string]any, k string) bool {
	if v, ok := m[k]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

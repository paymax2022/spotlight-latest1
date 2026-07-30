package transport

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// ─── Event transport (Spotlight) ─────────────────────────────────────────────
//
// Organizer (event owner) publishes event_transport_offers tied to a Spotlight
// event_id (loose ref, no FK). Riders book seats; ticket+ride bundle links a
// ticket_ref. On book the fare is escrowed then immediately settled to the
// organizer (the catalog is trusted, like bus). QR = uuid.
//
// Offer state:   draft → open → full → departed → completed · (cancelled).
// Booking state: booked → confirmed → boarded → completed · (cancelled/refunded).
//
// Capacity is enforced server-side inside a transaction: the booked_count is
// incremented with a conditional UPDATE (booked_count + seats <= capacity). If
// the update affects zero rows the offer is full → 409, and the escrow is
// refunded.

// ─── Request bodies ──────────────────────────────────────────────────────────

// EventOfferRequest is POST /mobility/events/transport.
type EventOfferRequest struct {
	EventID         string  `json:"event_id"`
	Type            string  `json:"type"`
	Title           string  `json:"title" binding:"required"`
	VenueAddress    string  `json:"venue_address"`
	VenueLat        float64 `json:"venue_lat"`
	VenueLng        float64 `json:"venue_lng"`
	GeofenceRadiusM int     `json:"geofence_radius_m"`
	Capacity        int     `json:"capacity" binding:"required,min=1"`
	FareKobo        int64   `json:"fare_kobo" binding:"required,min=0"`
	DepartureTime   string  `json:"departure_time"` // RFC3339, optional
	BusScheduleID   string  `json:"bus_schedule_id"`
	PromoCode       string  `json:"promo_code"`
}

// EventBookRequest is POST /mobility/events/transport/:id/book.
type EventBookRequest struct {
	Seats          int    `json:"seats" binding:"required,min=1"`
	TicketRef      string `json:"ticket_ref"`
	IdempotencyKey string `json:"idempotency_key"`
}

// EventValidateRequest is POST /driver/events/validate.
type EventValidateRequest struct {
	QRCode string `json:"qr_code" binding:"required"`
}

// ─── Organizer: create offer ─────────────────────────────────────────────────

// CreateEventOffer publishes a transport offer for an event (organizer = caller).
func (s *Service) CreateEventOffer(ctx context.Context, organizerID string, req EventOfferRequest) (map[string]any, error) {
	offerType := req.Type
	if offerType == "" {
		offerType = "group_ride"
	}
	radius := req.GeofenceRadiusM
	if radius == 0 {
		radius = 500
	}
	var departure *time.Time
	if req.DepartureTime != "" {
		t, err := time.Parse(time.RFC3339, req.DepartureTime)
		if err != nil {
			return nil, codedErr(http.StatusBadRequest, "INVALID_TIME", "departure_time must be RFC3339")
		}
		departure = &t
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO event_transport_offers
			(id, event_id, organizer_id, type, title, venue_address, venue_lat, venue_lng,
			 geofence_radius_m, capacity, booked_count, fare_kobo, departure_time, bus_schedule_id, promo_code, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,$14,'open')`
	if _, err := s.db.Exec(ctx, q,
		id, nullStr(req.EventID), organizerID, offerType, req.Title, nullStr(req.VenueAddress),
		nullFloat(req.VenueLat), nullFloat(req.VenueLng), radius, req.Capacity, req.FareKobo,
		departure, nullStr(req.BusScheduleID), nullStr(req.PromoCode),
	); err != nil {
		return nil, fmt.Errorf("transport: insert event offer: %w", err)
	}
	s.recordModeEvent(ctx, organizerID, "event.offer_created", "event_transport_offer", id, "", "open",
		map[string]any{"event_id": req.EventID, "capacity": req.Capacity, "fare_kobo": req.FareKobo})
	return s.EventOfferDetail(ctx, id)
}

// ListEventOffers returns the open/active transport offers for an event.
func (s *Service) ListEventOffers(ctx context.Context, eventID string) ([]map[string]any, error) {
	const q = `
		SELECT id, event_id, organizer_id, type, title, venue_address, venue_lat, venue_lng,
		       geofence_radius_m, capacity, booked_count, fare_kobo, departure_time, status, created_at
		FROM event_transport_offers
		WHERE event_id=$1 AND status IN ('open','full','departed')
		ORDER BY departure_time NULLS LAST, created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, organizerID, offerType, title, status string
		var eventIDv, venueAddr *string
		var venueLat, venueLng *float64
		var radius, capacity, booked int
		var fare int64
		var departure *time.Time
		var createdAt time.Time
		if err := rows.Scan(&id, &eventIDv, &organizerID, &offerType, &title, &venueAddr, &venueLat, &venueLng,
			&radius, &capacity, &booked, &fare, &departure, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "eventId": eventIDv, "organizerId": organizerID, "type": offerType, "title": title,
			"venueAddress": venueAddr, "venueLat": venueLat, "venueLng": venueLng,
			"geofenceRadiusM": radius, "capacity": capacity, "bookedCount": booked,
			"seatsLeft": capacity - booked, "fareKobo": fare, "departureTime": departure,
			"status": status, "createdAt": createdAt,
		})
	}
	return out, nil
}

// EventOfferDetail returns a single offer (public-read), with venue geofence and
// post-event pickup surfaced from the offer.
func (s *Service) EventOfferDetail(ctx context.Context, id string) (map[string]any, error) {
	const q = `
		SELECT id, event_id, organizer_id, type, title, venue_address, venue_lat, venue_lng,
		       geofence_radius_m, capacity, booked_count, fare_kobo, departure_time, bus_schedule_id,
		       promo_code, status, created_at
		FROM event_transport_offers WHERE id=$1`
	var (
		oid, organizerID, offerType, title, status string
		eventID, venueAddr, busSchedID, promo      *string
		venueLat, venueLng                         *float64
		radius, capacity, booked                   int
		fare                                       int64
		departure                                  *time.Time
		createdAt                                  time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&oid, &eventID, &organizerID, &offerType, &title, &venueAddr, &venueLat, &venueLng,
		&radius, &capacity, &booked, &fare, &departure, &busSchedID, &promo, &status, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "offer not found")
	}
	return map[string]any{
		"id": oid, "eventId": eventID, "organizerId": organizerID, "type": offerType, "title": title,
		"venueAddress": venueAddr, "venueLat": venueLat, "venueLng": venueLng,
		"geofenceRadiusM": radius, "capacity": capacity, "bookedCount": booked,
		"seatsLeft": capacity - booked, "fareKobo": fare, "departureTime": departure,
		"busScheduleId": busSchedID, "promoCode": promo, "status": status, "createdAt": createdAt,
	}, nil
}

// ─── Booking ─────────────────────────────────────────────────────────────────

// BookEventTransport reserves seats: escrow → atomic capacity reservation →
// settle organizer → issue QR. Overbooking is rejected (409) and the escrow
// refunded. booked_count flips the offer to 'full' when capacity is reached.
func (s *Service) BookEventTransport(ctx context.Context, userID, offerID string, req EventBookRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	if req.Seats < 1 {
		return nil, codedErr(http.StatusBadRequest, "INVALID_SEATS", "seats must be at least 1")
	}

	// Load offer fare/status/organizer (cheap pre-check before escrow).
	var fareKobo int64
	var status, organizerID string
	if err := s.db.QueryRow(ctx,
		`SELECT fare_kobo, status, organizer_id FROM event_transport_offers WHERE id=$1`, offerID).
		Scan(&fareKobo, &status, &organizerID); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "offer not found")
	}
	if status != "open" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "offer not open for booking")
	}
	total := fareKobo * int64(req.Seats)

	// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same contract
	// as RequestRide). Gate on the FULL debit (fare × seats), not the per-seat fare.
	if err := s.enforceTierLimit(ctx, userID, total); err != nil {
		return nil, err
	}

	bookingID := uuid.New().String()
	ref := "event_transport:" + bookingID
	sett, err := s.settlement.Escrow(ctx, userID, ref, idempotencyKey, "transport", total)
	if err != nil {
		return nil, fmt.Errorf("transport: escrow event fare: %w", err)
	}

	// Atomic capacity reservation: increment booked_count only if it stays within
	// capacity. The conditional UPDATE + row lock prevents overbooking under races.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		s.settlement.Refund(ctx, sett.ID, "event_book_tx_failed")
		return nil, err
	}
	defer tx.Rollback(ctx)

	var capacity, booked int
	var lockedStatus string
	if err := tx.QueryRow(ctx,
		`SELECT capacity, booked_count, status FROM event_transport_offers WHERE id=$1 FOR UPDATE`, offerID).
		Scan(&capacity, &booked, &lockedStatus); err != nil {
		s.settlement.Refund(ctx, sett.ID, "event_offer_missing")
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "offer not found")
	}
	// Re-check status under the row lock (it may have flipped since the pre-check).
	if lockedStatus != "open" {
		s.settlement.Refund(ctx, sett.ID, "event_not_open")
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "offer not open for booking")
	}
	if booked+req.Seats > capacity {
		s.settlement.Refund(ctx, sett.ID, "event_overbook")
		return nil, codedErr(http.StatusConflict, "CAPACITY_EXCEEDED", "not enough seats available")
	}
	newBooked := booked + req.Seats
	newStatus := "open"
	if newBooked >= capacity {
		newStatus = "full"
	}
	if _, err := tx.Exec(ctx,
		`UPDATE event_transport_offers SET booked_count=$1, status=$2, updated_at=NOW() WHERE id=$3`,
		newBooked, newStatus, offerID); err != nil {
		s.settlement.Refund(ctx, sett.ID, "event_reserve_failed")
		return nil, err
	}

	qr := uuid.New().String()
	if _, err := tx.Exec(ctx, `
		INSERT INTO event_transport_bookings
			(id, offer_id, user_id, ticket_ref, seats, fare_kobo, qr_code, status, settlement_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'booked',$8,$9)`,
		bookingID, offerID, userID, nullStr(req.TicketRef), req.Seats, total, qr, sett.ID, idempotencyKey,
	); err != nil {
		s.settlement.Refund(ctx, sett.ID, "event_booking_insert_failed")
		return nil, fmt.Errorf("transport: insert event booking: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		s.settlement.Refund(ctx, sett.ID, "event_book_commit_failed")
		return nil, err
	}

	// Trusted catalog: settle the organizer immediately on book (like bus).
	comm, _ := s.commissionForTier(ctx, "standard")
	if err := s.settlement.Settle(ctx, sett.ID, settlementSplit(organizerID, comm)); err != nil {
		return nil, fmt.Errorf("transport: settle event booking: %w", err)
	}
	s.recordModeEvent(ctx, userID, "event.booked", "event_transport_booking", bookingID, "", "booked",
		map[string]any{"offer_id": offerID, "seats": req.Seats, "organizer_id": organizerID})
	return s.EventBookingDetail(ctx, bookingID, userID)
}

// EventBookingDetail returns a booking (owner only).
func (s *Service) EventBookingDetail(ctx context.Context, id, userID string) (map[string]any, error) {
	const q = `
		SELECT id, offer_id, user_id, ticket_ref, seats, fare_kobo, qr_code, status, created_at
		FROM event_transport_bookings WHERE id=$1`
	var (
		bid, offerID, uid, qr, status string
		ticketRef                     *string
		seats                         int
		fare                          int64
		createdAt                     time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&bid, &offerID, &uid, &ticketRef, &seats, &fare, &qr, &status, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if uid != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	return map[string]any{
		"id": bid, "offerId": offerID, "userId": uid, "ticketRef": ticketRef,
		"seats": seats, "fareKobo": fare, "qrCode": qr, "status": status, "createdAt": createdAt,
	}, nil
}

// ListEventBookings returns the user's event-transport bookings (QR included).
func (s *Service) ListEventBookings(ctx context.Context, userID string) ([]map[string]any, error) {
	const q = `
		SELECT b.id, b.offer_id, b.ticket_ref, b.seats, b.fare_kobo, b.qr_code, b.status, b.created_at,
		       o.title, o.type, o.departure_time
		FROM event_transport_bookings b
		JOIN event_transport_offers o ON o.id = b.offer_id
		WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, offerID, qr, status, title, offerType string
		var ticketRef *string
		var seats int
		var fare int64
		var createdAt time.Time
		var departure *time.Time
		if err := rows.Scan(&id, &offerID, &ticketRef, &seats, &fare, &qr, &status, &createdAt, &title, &offerType, &departure); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "offerId": offerID, "ticketRef": ticketRef, "seats": seats,
			"fareKobo": fare, "qrCode": qr, "status": status, "createdAt": createdAt,
			"offerTitle": title, "offerType": offerType, "departureTime": departure,
		})
	}
	return out, nil
}

// CancelEventBooking refunds the booking and releases the reserved seats. Boarded
// or completed bookings cannot be cancelled.
func (s *Service) CancelEventBooking(ctx context.Context, id, userID, reason string) error {
	var uid, offerID, status string
	var settID *string
	var seats int
	if err := s.db.QueryRow(ctx,
		`SELECT user_id, offer_id, status, settlement_id, seats FROM event_transport_bookings WHERE id=$1`, id).
		Scan(&uid, &offerID, &status, &settID, &seats); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if uid != userID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	if status == "boarded" || status == "completed" || status == "cancelled" || status == "refunded" {
		return codedErr(http.StatusConflict, CodeInvalidState, "booking cannot be cancelled")
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE event_transport_bookings SET status='refunded' WHERE id=$1 AND status IN ('booked','confirmed')`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "booking cannot be cancelled")
	}
	// Release the reserved seats and re-open the offer if it was full.
	s.db.Exec(ctx,
		`UPDATE event_transport_offers
		 SET booked_count=GREATEST(booked_count-$2,0),
		     status=CASE WHEN status='full' THEN 'open' ELSE status END,
		     updated_at=NOW()
		 WHERE id=$1`,
		offerID, seats)
	// Settlement was released to the organizer on book; refund reverses it.
	if settID != nil {
		s.settlement.Refund(ctx, *settID, "event_cancelled:"+reason)
	}
	s.recordModeEvent(ctx, userID, "event.cancelled", "event_transport_booking", id, status, "refunded",
		map[string]any{"reason": reason, "seats": seats})
	return nil
}

// ValidateEventBooking: organizer/driver scans the QR → boarded. Only the offer's
// organizer may validate.
func (s *Service) ValidateEventBooking(ctx context.Context, organizerUserID, qrCode string) (map[string]any, error) {
	var bookingID, status, organizerID string
	const q = `
		SELECT b.id, b.status, o.organizer_id
		FROM event_transport_bookings b
		JOIN event_transport_offers o ON o.id = b.offer_id
		WHERE b.qr_code=$1`
	if err := s.db.QueryRow(ctx, q, qrCode).Scan(&bookingID, &status, &organizerID); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if organizerID != organizerUserID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not the offer organizer")
	}
	if status == "boarded" || status == "completed" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking already boarded")
	}
	if status == "cancelled" || status == "refunded" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking not valid")
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE event_transport_bookings SET status='boarded' WHERE id=$1`, bookingID); err != nil {
		return nil, err
	}
	s.recordModeEvent(ctx, organizerUserID, "event.boarded", "event_transport_booking", bookingID, status, "boarded", nil)
	return map[string]any{"ok": true, "bookingId": bookingID, "status": "boarded"}, nil
}

// nullFloat returns nil for a zero coordinate so it stores as SQL NULL.
func nullFloat(f float64) any {
	if f == 0 {
		return nil
	}
	return f
}

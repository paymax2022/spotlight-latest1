package extranet

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for the hotelier extranet. It reads
// SB0-owned tables (stays_property/room_type/rate_plan/reservation) and SB1 tables
// (payouts/commission/remittance). It NEVER mutates wallet balances.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the extranet repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// --- property content ---

// Property is the editable content view returned to the extranet.
type Property struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	Address      string    `json:"address"`
	City         string    `json:"city"`
	StarRating   int       `json:"star_rating"`
	PropertyType string    `json:"property_type"`
	Status       string    `json:"status"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// GetProperty returns the property content.
func (r *Repository) GetProperty(ctx context.Context, propertyID string) (Property, error) {
	var p Property
	err := r.db.QueryRow(ctx, `
		SELECT id, name, COALESCE(description,''), address, city, star_rating,
		       property_type, status, updated_at
		FROM public.stays_property WHERE id = $1`, propertyID).Scan(
		&p.ID, &p.Name, &p.Description, &p.Address, &p.City, &p.StarRating,
		&p.PropertyType, &p.Status, &p.UpdatedAt)
	return p, err
}

// UpdatePropertyContent edits the property content fields (NOT moderation status —
// that stays an admin action). Object-scope is checked in the service.
func (r *Repository) UpdatePropertyContent(ctx context.Context, propertyID, name, description, address, city string, star int, ptype string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_property
		SET name = COALESCE(NULLIF($2,''), name),
		    description = $3,
		    address = COALESCE(NULLIF($4,''), address),
		    city = COALESCE(NULLIF($5,''), city),
		    star_rating = CASE WHEN $6 BETWEEN 0 AND 5 THEN $6 ELSE star_rating END,
		    property_type = COALESCE(NULLIF($7,''), property_type),
		    updated_at = now()
		WHERE id = $1`, propertyID, name, description, address, city, star, ptype)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("extranet: property not found")
	}
	return nil
}

// --- room types ---

// RoomType is the room-type view.
type RoomType struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Occupancy int     `json:"occupancy"`
	Bedding   string  `json:"bedding"`
	SizeSqm   float64 `json:"size_sqm"`
}

// ListRoomTypes returns the property's room types.
func (r *Repository) ListRoomTypes(ctx context.Context, propertyID string) ([]RoomType, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, name, occupancy, bedding, COALESCE(size_sqm,0)
		FROM public.stays_room_type WHERE property_id = $1 ORDER BY name`, propertyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RoomType
	for rows.Next() {
		var rt RoomType
		if err := rows.Scan(&rt.ID, &rt.Name, &rt.Occupancy, &rt.Bedding, &rt.SizeSqm); err != nil {
			return nil, err
		}
		out = append(out, rt)
	}
	return out, rows.Err()
}

// CreateRoomType inserts a room type for the property.
func (r *Repository) CreateRoomType(ctx context.Context, propertyID, name string, occupancy int, bedding string) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_room_type (property_id, name, occupancy, bedding)
		VALUES ($1,$2,$3,$4) RETURNING id`, propertyID, name, occupancy, bedding).Scan(&id)
	return id, err
}

// --- rate plans ---

// RatePlan is the rate-plan view.
type RatePlan struct {
	ID               string `json:"id"`
	RoomTypeID       string `json:"room_type_id"`
	Type             string `json:"rate_plan_type"`
	Board            string `json:"board"`
	Refundable       bool   `json:"refundable"`
	BaseSellRateKobo int64  `json:"base_sell_rate_kobo"`
	Currency         string `json:"currency"`
}

// ListRatePlans returns the property's rate plans (joined via room type).
func (r *Repository) ListRatePlans(ctx context.Context, propertyID string) ([]RatePlan, error) {
	rows, err := r.db.Query(ctx, `
		SELECT rp.id, rp.room_type_id, rp.rate_plan_type, rp.board, rp.refundable,
		       rp.base_sell_rate_kobo, rp.currency
		FROM public.stays_rate_plan rp
		JOIN public.stays_room_type rt ON rt.id = rp.room_type_id
		WHERE rt.property_id = $1 ORDER BY rp.base_sell_rate_kobo`, propertyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RatePlan
	for rows.Next() {
		var rp RatePlan
		if err := rows.Scan(&rp.ID, &rp.RoomTypeID, &rp.Type, &rp.Board, &rp.Refundable,
			&rp.BaseSellRateKobo, &rp.Currency); err != nil {
			return nil, err
		}
		out = append(out, rp)
	}
	return out, rows.Err()
}

// CreateRatePlan inserts a rate plan under a room type belonging to the property.
func (r *Repository) CreateRatePlan(ctx context.Context, propertyID, roomTypeID, planType, board string, refundable bool, baseKobo int64, currency string) (string, error) {
	// Ensure the room type belongs to the property (object scope).
	var owns bool
	if err := r.db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM public.stays_room_type WHERE id = $1 AND property_id = $2)`,
		roomTypeID, propertyID).Scan(&owns); err != nil {
		return "", err
	}
	if !owns {
		return "", fmt.Errorf("extranet: room type not in property")
	}
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_rate_plan
			(room_type_id, rate_plan_type, board, refundable, base_sell_rate_kobo, currency)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		roomTypeID, orStr(planType, "BAR"), orStr(board, "room_only"), refundable, baseKobo, orStr(currency, "NGN")).Scan(&id)
	return id, err
}

// --- reservations dashboard ---

// ReservationRow is a compact reservation view for the dashboard.
type ReservationRow struct {
	ID          string    `json:"id"`
	State       string    `json:"state"`
	CheckIn     string    `json:"check_in"`
	CheckOut    string    `json:"check_out"`
	Rooms       int       `json:"rooms"`
	GrossKobo   int64     `json:"gross_amount_kobo"`
	Currency    string    `json:"currency"`
	SupplierRef *string   `json:"supplier_ref"`
	GuestName   string    `json:"guest_name"`
	CreatedAt   time.Time `json:"created_at"`
}

// ListReservations returns reservations for a property filtered by state.
func (r *Repository) ListReservations(ctx context.Context, propertyID, state string, limit, offset int) ([]ReservationRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT res.id, res.state, to_char(res.check_in,'YYYY-MM-DD'), to_char(res.check_out,'YYYY-MM-DD'),
		       res.rooms, res.gross_amount_kobo, res.currency, res.supplier_ref,
		       COALESCE((SELECT first_name||' '||last_name FROM public.stays_reservation_guest g
		                 WHERE g.reservation_id = res.id AND g.is_lead LIMIT 1), ''),
		       res.created_at
		FROM public.stays_reservation res
		WHERE res.property_id = $1 AND ($2 = '' OR res.state = $2)
		ORDER BY res.check_in DESC LIMIT $3 OFFSET $4`, propertyID, state, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReservationRow
	for rows.Next() {
		var rr ReservationRow
		if err := rows.Scan(&rr.ID, &rr.State, &rr.CheckIn, &rr.CheckOut, &rr.Rooms,
			&rr.GrossKobo, &rr.Currency, &rr.SupplierRef, &rr.GuestName, &rr.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// Arrivals/Departures/InHouse use date-window filters on confirmed reservations.

// ListArrivals returns CONFIRMED reservations checking in on the given date.
func (r *Repository) ListArrivals(ctx context.Context, propertyID, date string) ([]ReservationRow, error) {
	return r.dashboardWindow(ctx, propertyID, `res.check_in = $2::date AND res.state = 'CONFIRMED'`, date)
}

// ListDepartures returns CONFIRMED/COMPLETED reservations checking out on the date.
func (r *Repository) ListDepartures(ctx context.Context, propertyID, date string) ([]ReservationRow, error) {
	return r.dashboardWindow(ctx, propertyID, `res.check_out = $2::date AND res.state IN ('CONFIRMED','COMPLETED')`, date)
}

// ListInHouse returns reservations occupying a room on the date (checked-in, not yet out).
func (r *Repository) ListInHouse(ctx context.Context, propertyID, date string) ([]ReservationRow, error) {
	return r.dashboardWindow(ctx, propertyID, `res.check_in <= $2::date AND res.check_out > $2::date AND res.state IN ('CONFIRMED','COMPLETED')`, date)
}

func (r *Repository) dashboardWindow(ctx context.Context, propertyID, where, date string) ([]ReservationRow, error) {
	q := `
		SELECT res.id, res.state, to_char(res.check_in,'YYYY-MM-DD'), to_char(res.check_out,'YYYY-MM-DD'),
		       res.rooms, res.gross_amount_kobo, res.currency, res.supplier_ref,
		       COALESCE((SELECT first_name||' '||last_name FROM public.stays_reservation_guest g
		                 WHERE g.reservation_id = res.id AND g.is_lead LIMIT 1), ''),
		       res.created_at
		FROM public.stays_reservation res
		WHERE res.property_id = $1 AND ` + where + `
		ORDER BY res.created_at DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q, propertyID, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReservationRow
	for rows.Next() {
		var rr ReservationRow
		if err := rows.Scan(&rr.ID, &rr.State, &rr.CheckIn, &rr.CheckOut, &rr.Rooms,
			&rr.GrossKobo, &rr.Currency, &rr.SupplierRef, &rr.GuestName, &rr.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// ReservationDetail is the full reservation detail (object-scoped to property).
type ReservationDetail struct {
	ReservationRow
	PropertyID     string         `json:"property_id"`
	RoomTypeID     string         `json:"room_type_id"`
	RatePlanID     string         `json:"rate_plan_id"`
	NetRateKobo    int64          `json:"net_rate_kobo"`
	CommissionKobo int64          `json:"commission_kobo"`
	Occupancy      map[string]any `json:"occupancy"`
}

// GetReservationDetail returns a reservation if it belongs to the property.
func (r *Repository) GetReservationDetail(ctx context.Context, propertyID, reservationID string) (ReservationDetail, error) {
	var d ReservationDetail
	err := r.db.QueryRow(ctx, `
		SELECT res.id, res.state, to_char(res.check_in,'YYYY-MM-DD'), to_char(res.check_out,'YYYY-MM-DD'),
		       res.rooms, res.gross_amount_kobo, res.currency, res.supplier_ref,
		       COALESCE((SELECT first_name||' '||last_name FROM public.stays_reservation_guest g
		                 WHERE g.reservation_id = res.id AND g.is_lead LIMIT 1), ''),
		       res.created_at, res.property_id, COALESCE(res.room_type_id::text,''),
		       COALESCE(res.rate_plan_id::text,''), res.net_rate_kobo, res.commission_kobo, res.occupancy
		FROM public.stays_reservation res
		WHERE res.id = $1 AND res.property_id = $2`, reservationID, propertyID).Scan(
		&d.ID, &d.State, &d.CheckIn, &d.CheckOut, &d.Rooms, &d.GrossKobo, &d.Currency,
		&d.SupplierRef, &d.GuestName, &d.CreatedAt, &d.PropertyID, &d.RoomTypeID,
		&d.RatePlanID, &d.NetRateKobo, &d.CommissionKobo, &d.Occupancy)
	return d, err
}

// ReservationBelongsToProperty confirms a reservation is on the property (object scope).
func (r *Repository) ReservationBelongsToProperty(ctx context.Context, reservationID, propertyID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM public.stays_reservation WHERE id = $1 AND property_id = $2)`,
		reservationID, propertyID).Scan(&ok)
	return ok, err
}

// MarkNoShow transitions a CONFIRMED reservation to NO_SHOW (optimistic on state).
func (r *Repository) MarkNoShow(ctx context.Context, reservationID, propertyID string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_reservation
		SET state = 'NO_SHOW', version = version + 1, updated_at = now()
		WHERE id = $1 AND property_id = $2 AND state = 'CONFIRMED'`, reservationID, propertyID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("extranet: reservation not CONFIRMED or not in property")
	}
	return nil
}

// CancelByHotel transitions a CONFIRMED reservation to CANCELLED_BY_HOTEL.
func (r *Repository) CancelByHotel(ctx context.Context, reservationID, propertyID, reason string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_reservation
		SET state = 'CANCELLED_BY_HOTEL', version = version + 1, updated_at = now()
		WHERE id = $1 AND property_id = $2 AND state = 'CONFIRMED'`, reservationID, propertyID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("extranet: reservation not CONFIRMED or not in property")
	}
	_, _ = r.db.Exec(ctx, `
		INSERT INTO public.stays_cancellation (reservation_id, reason, policy_snapshot)
		VALUES ($1,$2,'{"by":"hotel"}'::jsonb)`, reservationID, reason)
	return nil
}

// RoomTypeOfReservation returns the room type + date range for allotment release.
func (r *Repository) RoomTypeOfReservation(ctx context.Context, reservationID string) (string, string, string, int, error) {
	var rt, ci, co string
	var rooms int
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(room_type_id::text,''), to_char(check_in,'YYYY-MM-DD'),
		       to_char(check_out,'YYYY-MM-DD'), rooms
		FROM public.stays_reservation WHERE id = $1`, reservationID).Scan(&rt, &ci, &co, &rooms)
	return rt, ci, co, rooms, err
}

// --- finance reads (payouts / commission / remittance) ---

// PayoutRow is a hotel payout view.
type PayoutRow struct {
	ID         string    `json:"id"`
	AmountKobo int64     `json:"amount_kobo"`
	Currency   string    `json:"currency"`
	Status     string    `json:"status"`
	HoldReason string    `json:"hold_reason"`
	CreatedAt  time.Time `json:"created_at"`
}

// ListPayouts returns the property's payouts.
func (r *Repository) ListPayouts(ctx context.Context, propertyID string, limit int) ([]PayoutRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := r.db.Query(ctx, `
		SELECT id, amount_kobo, currency, status, hold_reason, created_at
		FROM public.stays_hotel_payout WHERE property_id = $1
		ORDER BY created_at DESC LIMIT $2`, propertyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PayoutRow
	for rows.Next() {
		var p PayoutRow
		if err := rows.Scan(&p.ID, &p.AmountKobo, &p.Currency, &p.Status, &p.HoldReason, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CommissionRow is a commission-ledger view.
type CommissionRow struct {
	ID            string    `json:"id"`
	ReservationID string    `json:"reservation_id"`
	AmountKobo    int64     `json:"amount_kobo"`
	Kind          string    `json:"kind"`
	CreatedAt     time.Time `json:"created_at"`
}

// ListCommission returns the property's commission entries.
func (r *Repository) ListCommission(ctx context.Context, propertyID string, limit int) ([]CommissionRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := r.db.Query(ctx, `
		SELECT id, reservation_id, amount_kobo, kind, created_at
		FROM public.stays_commission_entry WHERE property_id = $1
		ORDER BY created_at DESC LIMIT $2`, propertyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CommissionRow
	for rows.Next() {
		var ce CommissionRow
		if err := rows.Scan(&ce.ID, &ce.ReservationID, &ce.AmountKobo, &ce.Kind, &ce.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, ce)
	}
	return out, rows.Err()
}

// --- analytics (computed) ---

// Analytics is the computed occupancy/ADR/RevPAR snapshot over a window.
type Analytics struct {
	From           string  `json:"from"`
	To             string  `json:"to"`
	RoomNights     int     `json:"room_nights_available"`
	RoomNightsSold int     `json:"room_nights_sold"`
	OccupancyPct   float64 `json:"occupancy_pct"`
	RevenueKobo    int64   `json:"revenue_kobo"`
	ADRKobo        int64   `json:"adr_kobo"`    // revenue / nights sold
	RevPARKobo     int64   `json:"revpar_kobo"` // revenue / nights available
}

// ComputeAnalytics derives occupancy/ADR/RevPAR from the availability calendar +
// confirmed reservation revenue over [from,to]. Naira kobo throughout.
func (r *Repository) ComputeAnalytics(ctx context.Context, propertyID, from, to string) (Analytics, error) {
	a := Analytics{From: from, To: to}
	// Available + sold room-nights from the availability calendar.
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(ad.allotment),0), COALESCE(SUM(ad.sold),0)
		FROM public.stays_availability_day ad
		JOIN public.stays_room_type rt ON rt.id = ad.room_type_id
		WHERE rt.property_id = $1 AND ad.date BETWEEN $2::date AND $3::date`,
		propertyID, from, to).Scan(&a.RoomNights, &a.RoomNightsSold)
	if err != nil {
		return a, err
	}
	// Confirmed/completed revenue with check-in in window.
	err = r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(gross_amount_kobo),0)
		FROM public.stays_reservation
		WHERE property_id = $1 AND state IN ('CONFIRMED','COMPLETED')
		  AND check_in BETWEEN $2::date AND $3::date`,
		propertyID, from, to).Scan(&a.RevenueKobo)
	if err != nil {
		return a, err
	}
	if a.RoomNights > 0 {
		a.OccupancyPct = float64(a.RoomNightsSold) / float64(a.RoomNights) * 100.0
		a.RevPARKobo = a.RevenueKobo / int64(a.RoomNights)
	}
	if a.RoomNightsSold > 0 {
		a.ADRKobo = a.RevenueKobo / int64(a.RoomNightsSold)
	}
	return a, nil
}

// --- messaging (guest <-> hotel thread) ---

// Message is one persisted message in a reservation's guest<->hotel thread.
type Message struct {
	ID            string     `json:"id"`
	ReservationID string     `json:"reservation_id"`
	PropertyID    *string    `json:"property_id"`
	SenderRole    string     `json:"sender_role"` // guest | host | system
	SenderUserID  *string    `json:"sender_user_id"`
	Body          string     `json:"body"`
	CreatedAt     time.Time  `json:"created_at"`
	ReadAt        *time.Time `json:"read_at"`
}

// InsertMessage persists one message on a reservation's thread and returns the row.
// Object-level authorization (who may post) is enforced in the service before this.
func (r *Repository) InsertMessage(ctx context.Context, reservationID, propertyID, senderRole, senderUserID, body string) (Message, error) {
	var m Message
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_message
			(reservation_id, property_id, sender_role, sender_user_id, body)
		VALUES ($1, NULLIF($2,'')::uuid, $3, NULLIF($4,'')::uuid, $5)
		RETURNING id, reservation_id, property_id::text, sender_role,
		          sender_user_id::text, body, created_at, read_at`,
		reservationID, propertyID, senderRole, senderUserID, body).Scan(
		&m.ID, &m.ReservationID, &m.PropertyID, &m.SenderRole,
		&m.SenderUserID, &m.Body, &m.CreatedAt, &m.ReadAt)
	return m, err
}

// ListMessages returns a reservation's thread ordered oldest-first.
func (r *Repository) ListMessages(ctx context.Context, reservationID string, limit int) ([]Message, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.Query(ctx, `
		SELECT id, reservation_id, property_id::text, sender_role,
		       sender_user_id::text, body, created_at, read_at
		FROM public.stays_message
		WHERE reservation_id = $1
		ORDER BY created_at ASC
		LIMIT $2`, reservationID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Message, 0)
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.ReservationID, &m.PropertyID, &m.SenderRole,
			&m.SenderUserID, &m.Body, &m.CreatedAt, &m.ReadAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// --- account / staff ---

// StaffRow is an extranet staff grant view.
type StaffRow struct {
	ID     string `json:"id"`
	UserID string `json:"user_id"`
	Role   string `json:"role"`
	Status string `json:"status"`
}

// ListStaff returns the property's hotelier grants.
func (r *Repository) ListStaff(ctx context.Context, propertyID string) ([]StaffRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, user_id::text, role, status FROM public.stays_hotelier_profile
		WHERE property_id = $1 ORDER BY role`, propertyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StaffRow
	for rows.Next() {
		var s StaffRow
		if err := rows.Scan(&s.ID, &s.UserID, &s.Role, &s.Status); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// UpsertStaff grants/updates a staff member's role on the property.
func (r *Repository) UpsertStaff(ctx context.Context, propertyID, userID, role, status string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_hotelier_profile (user_id, property_id, role, status)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (user_id, property_id)
		DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, updated_at = now()`,
		userID, propertyID, orStr(role, "READ_ONLY"), orStr(status, "ACTIVE"))
	return err
}

// MyProperties returns the properties the user has ACTIVE grants on (the extranet
// landing — the set of objects the hotelier may act on).
func (r *Repository) MyProperties(ctx context.Context, userID string) ([]gin2H, error) {
	rows, err := r.db.Query(ctx, `
		SELECT p.id, p.name, p.city, p.status, hp.role
		FROM public.stays_hotelier_profile hp
		JOIN public.stays_property p ON p.id = hp.property_id
		WHERE hp.user_id = $1 AND hp.status = 'ACTIVE' ORDER BY p.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []gin2H
	for rows.Next() {
		var id, name, city, status, role string
		if err := rows.Scan(&id, &name, &city, &status, &role); err != nil {
			return nil, err
		}
		out = append(out, gin2H{"id": id, "name": name, "city": city, "status": status, "role": role})
	}
	return out, rows.Err()
}

// gin2H is a tiny map alias so the repo does not import gin.
type gin2H = map[string]any

func orStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

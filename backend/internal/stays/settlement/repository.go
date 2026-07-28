package settlement

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for stays settlement: hotel payouts,
// commission entries, supplier remittance reconciliation. It records domain rows
// that REFERENCE the posted finance ledger entries; it never mutates balances.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the settlement repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// --- payouts ---

// CreatePayout inserts a payout (idempotent on idempotency_key). Returns the row id.
func (r *Repository) CreatePayout(ctx context.Context, p Payout) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_hotel_payout
			(property_id, hotelier_user_id, reservation_id, amount_kobo, currency, status,
			 hold_reason, idempotency_key)
		VALUES ($1, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6, $7, $8)
		ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
		RETURNING id`,
		p.PropertyID, p.HotelierUserID, p.ReservationID, p.AmountKobo,
		orStr(p.Currency, "NGN"), orStr(p.Status, "HELD"), p.HoldReason, p.IdempotencyKey,
	).Scan(&id)
	return id, err
}

// GetPayout returns a payout by id.
func (r *Repository) GetPayout(ctx context.Context, id string) (Payout, error) {
	var p Payout
	err := r.db.QueryRow(ctx, `
		SELECT id, property_id::text, COALESCE(hotelier_user_id::text,''),
		       COALESCE(reservation_id::text,''), amount_kobo, currency, status, hold_reason,
		       ledger_ref, settlement_id, idempotency_key, paid_at, created_at
		FROM public.stays_hotel_payout WHERE id = $1`, id).Scan(
		&p.ID, &p.PropertyID, &p.HotelierUserID, &p.ReservationID, &p.AmountKobo, &p.Currency,
		&p.Status, &p.HoldReason, &p.LedgerRef, &p.SettlementID, &p.IdempotencyKey, &p.PaidAt, &p.CreatedAt)
	return p, err
}

// SetPayoutStatus updates a payout's status (+ optional ledger ref / settlement id).
func (r *Repository) SetPayoutStatus(ctx context.Context, id, status, ledgerRef, settlementID string, markPaid bool) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_hotel_payout
		SET status = $2,
		    ledger_ref = COALESCE(NULLIF($3,''), ledger_ref),
		    settlement_id = COALESCE(NULLIF($4,''), settlement_id),
		    paid_at = CASE WHEN $5 THEN now() ELSE paid_at END,
		    updated_at = now()
		WHERE id = $1`, id, status, ledgerRef, settlementID, markPaid)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListPayoutsByStatus returns payouts in a status (admin workbench).
func (r *Repository) ListPayoutsByStatus(ctx context.Context, status string, limit int) ([]Payout, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.Query(ctx, `
		SELECT id, property_id::text, COALESCE(hotelier_user_id::text,''),
		       COALESCE(reservation_id::text,''), amount_kobo, currency, status, hold_reason,
		       ledger_ref, settlement_id, idempotency_key, paid_at, created_at
		FROM public.stays_hotel_payout
		WHERE ($1 = '' OR status = $1) ORDER BY created_at DESC LIMIT $2`, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Payout
	for rows.Next() {
		var p Payout
		if err := rows.Scan(&p.ID, &p.PropertyID, &p.HotelierUserID, &p.ReservationID,
			&p.AmountKobo, &p.Currency, &p.Status, &p.HoldReason, &p.LedgerRef, &p.SettlementID,
			&p.IdempotencyKey, &p.PaidAt, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// HasCompletedStay reports whether the property has at least one CONFIRMED+COMPLETED
// reservation — the gate that releases a held first payout (fraud control).
func (r *Repository) HasCompletedStay(ctx context.Context, propertyID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.stays_reservation
			WHERE property_id = $1 AND state = 'COMPLETED'
		)`, propertyID).Scan(&ok)
	return ok, err
}

// --- commission ---

// CreateCommission records a commission accrual/reversal (idempotent on key).
func (r *Repository) CreateCommission(ctx context.Context, e CommissionEntry) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_commission_entry
			(reservation_id, property_id, amount_kobo, currency, kind, ledger_ref, idempotency_key)
		VALUES ($1, NULLIF($2,'')::uuid, $3, $4, $5, $6, $7)
		ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
		RETURNING id`,
		e.ReservationID, e.PropertyID, e.AmountKobo, orStr(e.Currency, "NGN"),
		orStr(e.Kind, "ACCRUAL"), e.LedgerRef, e.IdempotencyKey,
	).Scan(&id)
	return id, err
}

// CommissionNetForReservation returns the net commission (accruals + reversals) for
// a reservation — used to compute the reversal amount on refund.
func (r *Repository) CommissionNetForReservation(ctx context.Context, reservationID string) (int64, error) {
	var net int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo),0) FROM public.stays_commission_entry
		WHERE reservation_id = $1`, reservationID).Scan(&net)
	return net, err
}

// PropertyOfReservation resolves the owning property of a reservation.
func (r *Repository) PropertyOfReservation(ctx context.Context, reservationID string) (string, error) {
	var pid string
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(property_id::text,'') FROM public.stays_reservation WHERE id = $1`, reservationID).Scan(&pid)
	return pid, err
}

// ListCommissionByStatus / breaks feed (admin).
func (r *Repository) ListCommission(ctx context.Context, limit int) ([]CommissionEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.Query(ctx, `
		SELECT id, reservation_id::text, COALESCE(property_id::text,''), amount_kobo, currency,
		       kind, ledger_ref, idempotency_key, created_at
		FROM public.stays_commission_entry ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CommissionEntry
	for rows.Next() {
		var e CommissionEntry
		if err := rows.Scan(&e.ID, &e.ReservationID, &e.PropertyID, &e.AmountKobo, &e.Currency,
			&e.Kind, &e.LedgerRef, &e.IdempotencyKey, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// --- remittance reconciliation ---

// UpsertRemittance records a supplier remittance line (idempotent) and sets its
// match status.
func (r *Repository) UpsertRemittance(ctx context.Context, m Remittance) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_supplier_remittance
			(supplier_code, reservation_id, supplier_ref, expected_kobo, remitted_kobo,
			 currency, status, break_reason, external_ref, idempotency_key)
		VALUES ($1, NULLIF($2,'')::uuid, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (idempotency_key) DO UPDATE SET
			remitted_kobo = EXCLUDED.remitted_kobo, status = EXCLUDED.status,
			break_reason = EXCLUDED.break_reason, updated_at = now()
		RETURNING id`,
		m.SupplierCode, m.ReservationID, m.SupplierRef, m.ExpectedKobo, m.RemittedKobo,
		orStr(m.Currency, "NGN"), orStr(m.Status, "UNMATCHED"), m.BreakReason, m.ExternalRef, m.IdempotencyKey,
	).Scan(&id)
	return id, err
}

// SetRemittanceStatus updates a remittance line's status (admin resolve a break).
func (r *Repository) SetRemittanceStatus(ctx context.Context, id, status, reason string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_supplier_remittance
		SET status = $2, break_reason = $3, updated_at = now() WHERE id = $1`, id, status, reason)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ExpectedNetForReservation returns the supplier net-rate owed for a Rail-A
// reservation (the reconciliation expectation).
func (r *Repository) ExpectedNetForReservation(ctx context.Context, reservationID string) (int64, string, error) {
	var net int64
	var supplierRef string
	err := r.db.QueryRow(ctx, `
		SELECT net_rate_kobo, COALESCE(supplier_ref,'') FROM public.stays_reservation WHERE id = $1`,
		reservationID).Scan(&net, &supplierRef)
	return net, supplierRef, err
}

// ListRemittances returns remittance lines filtered by status (admin workbench).
func (r *Repository) ListRemittances(ctx context.Context, status string, limit int) ([]Remittance, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := r.db.Query(ctx, `
		SELECT id, supplier_code, COALESCE(reservation_id::text,''), supplier_ref, expected_kobo,
		       remitted_kobo, currency, status, break_reason, external_ref, idempotency_key, created_at
		FROM public.stays_supplier_remittance
		WHERE ($1 = '' OR status = $1) ORDER BY created_at DESC LIMIT $2`, status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Remittance
	for rows.Next() {
		var m Remittance
		if err := rows.Scan(&m.ID, &m.SupplierCode, &m.ReservationID, &m.SupplierRef, &m.ExpectedKobo,
			&m.RemittedKobo, &m.Currency, &m.Status, &m.BreakReason, &m.ExternalRef, &m.IdempotencyKey,
			&m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func orStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

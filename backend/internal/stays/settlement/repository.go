package settlement

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/strutil"
)

// Repository is the parameterized data layer for stays settlement: hotel payouts,
// commission entries, supplier remittance reconciliation. It records domain rows
// that REFERENCE the posted finance ledger entries; it never mutates balances.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the settlement repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

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
		strutil.FirstNonEmpty(p.Currency, "NGN"), strutil.FirstNonEmpty(p.Status, "HELD"), p.HoldReason, p.IdempotencyKey,
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

// SetPayoutStatus updates a payout's status only from a payable state
// ('HELD','PENDING') — the predicate closes the read-then-write race where a
// concurrent cancel flips the row before it can be marked PAID. A 0-row update
// returns ErrNotFound or ErrPayoutNotPayable; the caller must decide, never
// swallow it.
func (r *Repository) SetPayoutStatus(ctx context.Context, id, status, ledgerRef, settlementID string, markPaid bool) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_hotel_payout
		SET status = $2,
		    ledger_ref = COALESCE(NULLIF($3,''), ledger_ref),
		    settlement_id = COALESCE(NULLIF($4,''), settlement_id),
		    paid_at = CASE WHEN $5 THEN now() ELSE paid_at END,
		    updated_at = now()
		WHERE id = $1 AND status IN ('HELD','PENDING')`, id, status, ledgerRef, settlementID, markPaid)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		var cur string
		if err := r.db.QueryRow(ctx,
			`SELECT status FROM public.stays_hotel_payout WHERE id = $1`, id).Scan(&cur); err != nil {
			return ErrNotFound
		}
		return fmt.Errorf("%w: payout is %s", ErrPayoutNotPayable, cur)
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

// HasCompletedStay reports whether the property has a COMPLETED reservation —
// the gate releasing a held first payout (fraud control). Reservations may store
// either the internal property id or the supplier ref, so the join matches both,
// scoped by (supplier_code, source_rail) since supplier refs are only unique per
// supplier.
func (r *Repository) HasCompletedStay(ctx context.Context, propertyID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM public.stays_property p
			JOIN public.stays_reservation res
			  ON res.property_id::text = p.id::text
			  OR (res.property_id::text = p.supplier_property_ref
			      AND res.supplier_code = p.supplier_code
			      AND res.source_rail = p.source_rail)
			WHERE p.id::text = $1 AND res.state = 'COMPLETED'
		)`, propertyID).Scan(&ok)
	return ok, err
}

// ReservationState returns the reservation's state — the gate ReleasePayout
// checks before drawing provider_clearing down. Callers fail closed on any error.
func (r *Repository) ReservationState(ctx context.Context, reservationID string) (string, error) {
	var state string
	err := r.db.QueryRow(ctx, `
		SELECT state FROM public.stays_reservation WHERE id = $1`, reservationID).Scan(&state)
	return state, err
}

// CancelRefundDrawKobo returns the net kobo the cancel-refund family drew from
// the parked standing accounts — ReleasePayout's refunded-but-payable probe:
// a reservation with posted guest legs is never payable even when a flip race
// left the row looking payable.
func (r *Repository) CancelRefundDrawKobo(ctx context.Context, reservationID string) (int64, error) {
	var drawn int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type IN ('DEBIT','REVERSAL_CREDIT') THEN le.amount_kobo
		                         ELSE -le.amount_kobo END), 0)
		FROM ledger_entries le
		JOIN ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id IS NULL
		  AND a.type IN ('provider_clearing','commission','escrow')
		  AND (le.reference LIKE 'stays:refund:' || $1 || ':%'
		    OR le.reference = 'refund:stays:' || $1)`, reservationID).Scan(&drawn)
	return drawn, err
}

// LockReservation takes the same 'stays:reservation:<id>' advisory lock the
// refund sagas hold — admin money writers (commission accrue/reverse) use it so
// they can't shift the residual under an in-flight refund. Callers hold the tx
// open and must Rollback it.
func (r *Repository) LockReservation(ctx context.Context, reservationID string) (pgx.Tx, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtext($1))`, "stays:reservation:"+reservationID); err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	return tx, nil
}

// CreateCommission records a commission accrual/reversal (idempotent on key).
func (r *Repository) CreateCommission(ctx context.Context, e CommissionEntry) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_commission_entry
			(reservation_id, property_id, amount_kobo, currency, kind, ledger_ref, idempotency_key)
		VALUES ($1, NULLIF($2,'')::uuid, $3, $4, $5, $6, $7)
		ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
		RETURNING id`,
		e.ReservationID, e.PropertyID, e.AmountKobo, strutil.FirstNonEmpty(e.Currency, "NGN"),
		strutil.FirstNonEmpty(e.Kind, "ACCRUAL"), e.LedgerRef, e.IdempotencyKey,
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
		strutil.FirstNonEmpty(m.Currency, "NGN"), strutil.FirstNonEmpty(m.Status, "UNMATCHED"), m.BreakReason, m.ExternalRef, m.IdempotencyKey,
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

// Sentinel errors.
var (
	// ErrPayoutHeld is returned when a payout cannot be released yet because the
	// hotelier has no confirmed+completed stay (fraud control, PRD §12).
	ErrPayoutHeld = errors.New("settlement: payout held until first confirmed+completed stay")
	// ErrPayoutBlocked is returned when a payout's reservation is no longer live
	// (cancelled / refunded / void): the money it would pay was already refunded
	// to the guest, so releasing would double-pay the hotelier.
	ErrPayoutBlocked = errors.New("settlement: payout blocked — reservation cancelled or refunded")
	// ErrPayoutNotPayable is returned by SetPayoutStatus when the payout row
	// exists but already left a payable state (PAID / CANCELLED / FAILED) —
	// e.g. a guest cancel flipped it between the caller's read and its update.
	ErrPayoutNotPayable = errors.New("settlement: payout no longer in a payable state")
	// ErrNotFound is a generic not-found.
	ErrNotFound = errors.New("settlement: not found")
	// ErrBadAmount guards non-positive money.
	ErrBadAmount = errors.New("settlement: amount must be positive")
)

// Payout is a Naira hotel payout to a hotelier (direct rail).
type Payout struct {
	ID             string     `json:"id"`
	PropertyID     string     `json:"property_id"`
	HotelierUserID string     `json:"hotelier_user_id"`
	ReservationID  string     `json:"reservation_id"`
	AmountKobo     int64      `json:"amount_kobo"`
	Currency       string     `json:"currency"`
	Status         string     `json:"status"` // HELD | PENDING | PAID | FAILED | CANCELLED
	HoldReason     string     `json:"hold_reason"`
	LedgerRef      string     `json:"ledger_ref"`
	SettlementID   string     `json:"settlement_id"`
	IdempotencyKey string     `json:"idempotency_key"`
	PaidAt         *time.Time `json:"paid_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

// CommissionEntry records Paymax commission posted to the SEPARATE AccountCommission
// ledger account. AmountKobo is positive on accrual, negative on a refund reversal.
type CommissionEntry struct {
	ID             string    `json:"id"`
	ReservationID  string    `json:"reservation_id"`
	PropertyID     string    `json:"property_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	Currency       string    `json:"currency"`
	Kind           string    `json:"kind"` // ACCRUAL | REVERSAL
	LedgerRef      string    `json:"ledger_ref"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// Remittance is a Rail-A supplier remittance line reconciled against the expected
// net-rate owed. A mismatch beyond tolerance records a BREAK fed to the admin
// workbench.
type Remittance struct {
	ID             string    `json:"id"`
	SupplierCode   string    `json:"supplier_code"`
	ReservationID  string    `json:"reservation_id"`
	SupplierRef    string    `json:"supplier_ref"`
	ExpectedKobo   int64     `json:"expected_kobo"`
	RemittedKobo   int64     `json:"remitted_kobo"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"` // UNMATCHED | MATCHED | BREAK | RESOLVED
	BreakReason    string    `json:"break_reason"`
	ExternalRef    string    `json:"external_ref"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

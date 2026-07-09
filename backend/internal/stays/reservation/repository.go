package reservation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/stays/gateway"
)

// Repository is the parameterized data layer for reservations. It NEVER mutates
// wallet balances — money moves via the finance ledger/settlement service; this
// repo only records the stays-domain rows that reference the ledger entries.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the reservation repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const resCols = `id, guest_user_id, property_id, room_type_id, rate_plan_id, source_rail,
	supplier_code, supplier_ref, state, check_in, check_out, rooms, occupancy, currency,
	gross_amount_kobo, tax_amount_kobo, net_rate_kobo, markup_kobo, commission_kobo,
	payment_method, cancellation_policy_snapshot, idempotency_key, book_token_ref,
	voucher_ref, created_at, updated_at, version`

func scanReservation(row interface{ Scan(dest ...any) error }) (*Reservation, error) {
	var r Reservation
	var rail, method, state string
	if err := row.Scan(
		&r.ID, &r.GuestUserID, &r.PropertyID, &r.RoomTypeID, &r.RatePlanID, &rail,
		&r.SupplierCode, &r.SupplierRef, &state, &r.CheckIn, &r.CheckOut, &r.Rooms,
		&r.Occupancy, &r.Currency, &r.GrossAmountKobo, &r.TaxAmountKobo, &r.NetRateKobo,
		&r.MarkupKobo, &r.CommissionKobo, &method, &r.CancellationPolicy, &r.IdempotencyKey,
		&r.BookTokenRef, &r.VoucherRef, &r.CreatedAt, &r.UpdatedAt, &r.Version,
	); err != nil {
		return nil, err
	}
	r.SourceRail = gateway.SourceRail(rail)
	r.PaymentMethod = gateway.PaymentMethod(method)
	r.State = State(state)
	return &r, nil
}

// FindByIdempotencyKey returns an existing reservation for the key (idempotent
// book: a retried book with the same key returns the same reservation). Returns
// (nil, nil) when none exists.
func (r *Repository) FindByIdempotencyKey(ctx context.Context, key string) (*Reservation, error) {
	row := r.db.QueryRow(ctx, `SELECT `+resCols+` FROM public.stays_reservation WHERE idempotency_key = $1`, key)
	res, err := scanReservation(row)
	if err != nil {
		// pgx returns ErrNoRows; the caller treats nil,nil as "not found".
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return res, nil
}

// Create inserts a reservation in its initial state.
func (r *Repository) Create(ctx context.Context, res *Reservation) (*Reservation, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_reservation
			(guest_user_id, property_id, room_type_id, rate_plan_id, source_rail,
			 supplier_code, state, check_in, check_out, rooms, occupancy, currency,
			 gross_amount_kobo, tax_amount_kobo, net_rate_kobo, markup_kobo, commission_kobo,
			 payment_method, cancellation_policy_snapshot, idempotency_key, book_token_ref)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
		RETURNING `+resCols,
		res.GuestUserID, res.PropertyID, res.RoomTypeID, res.RatePlanID, string(res.SourceRail),
		res.SupplierCode, string(res.State), res.CheckIn, res.CheckOut, res.Rooms, res.Occupancy,
		res.Currency, res.GrossAmountKobo, res.TaxAmountKobo, res.NetRateKobo, res.MarkupKobo,
		res.CommissionKobo, string(res.PaymentMethod), res.CancellationPolicy, res.IdempotencyKey,
		res.BookTokenRef,
	)
	return scanReservation(row)
}

// SetState applies a guarded optimistic-locked state change. The WHERE clause on
// version is the optimistic lock; a 0-row update means a concurrent writer raced.
func (r *Repository) SetState(ctx context.Context, id string, to State, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_reservation
		SET state = $2, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $3`, id, string(to), expectedVersion)
	if err != nil {
		return fmt.Errorf("reservation: set state: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("reservation: optimistic lock conflict on %s → %s", id, to)
	}
	return nil
}

// SetConfirmed persists the supplier ref + voucher on confirmation (one update with
// the optimistic lock). UNIQUE(source_rail, supplier_ref) is enforced by the DB.
func (r *Repository) SetConfirmed(ctx context.Context, id, supplierRef, voucherRef string, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_reservation
		SET supplier_ref = $2, voucher_ref = $3, state = 'CONFIRMED',
		    version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $4`, id, supplierRef, voucherRef, expectedVersion)
	if err != nil {
		return fmt.Errorf("reservation: set confirmed: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("reservation: optimistic lock conflict confirming %s", id)
	}
	return nil
}

// PrebookSnapshot is the validated pricing + token + policy persisted between
// OFFER_SELECTED and PREBOOK_OK. No money has moved at this point.
type PrebookSnapshot struct {
	GrossKobo      int64
	TaxKobo        int64
	NetRateKobo    int64
	MarkupKobo     int64
	CommissionKobo int64
	Policy         map[string]any
	BookToken      string
}

// savePrebook persists the validated price breakdown + policy snapshot + book_token
// on the reservation (optimistic-locked).
func (r *Repository) savePrebook(ctx context.Context, id string, snap PrebookSnapshot, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_reservation
		SET gross_amount_kobo = $2, tax_amount_kobo = $3, net_rate_kobo = $4,
		    markup_kobo = $5, commission_kobo = $6, cancellation_policy_snapshot = $7,
		    book_token_ref = $8, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $9`,
		id, snap.GrossKobo, snap.TaxKobo, snap.NetRateKobo, snap.MarkupKobo,
		snap.CommissionKobo, orMap(snap.Policy), snap.BookToken, expectedVersion)
	if err != nil {
		return fmt.Errorf("reservation: save prebook: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("reservation: optimistic lock conflict on prebook %s", id)
	}
	return nil
}

func orMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

// setIdempotencyKey binds the caller-supplied Book Idempotency-Key onto the
// reservation. UNIQUE(idempotency_key) makes a concurrent duplicate book fail.
func (r *Repository) setIdempotencyKey(ctx context.Context, id, key string, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_reservation
		SET idempotency_key = $2, version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $3`, id, key, expectedVersion)
	if err != nil {
		return fmt.Errorf("reservation: set idempotency key: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("reservation: optimistic lock conflict setting key on %s", id)
	}
	return nil
}

// Get returns a reservation by id.
func (r *Repository) Get(ctx context.Context, id string) (*Reservation, error) {
	row := r.db.QueryRow(ctx, `SELECT `+resCols+` FROM public.stays_reservation WHERE id = $1`, id)
	return scanReservation(row)
}

// ListByUser returns the caller's reservations newest-first.
func (r *Repository) ListByUser(ctx context.Context, userID string, limit, offset int) ([]Reservation, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+resCols+` FROM public.stays_reservation
		WHERE guest_user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reservation
	for rows.Next() {
		res, err := scanReservation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *res)
	}
	return out, rows.Err()
}

// SearchAdmin returns reservations across guests (admin; RBAC gated at the route).
func (r *Repository) SearchAdmin(ctx context.Context, state, city string, limit, offset int) ([]Reservation, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+resCols+` FROM public.stays_reservation
		WHERE ($1 = '' OR state = $1)
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, state, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reservation
	for rows.Next() {
		res, err := scanReservation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *res)
	}
	return out, rows.Err()
}

// RecordCancellation writes a cancellation row with the policy snapshot + refund.
func (r *Repository) RecordCancellation(ctx context.Context, reservationID, reason string, refundKobo, penaltyKobo int64, policy map[string]any, ledgerRef string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_cancellation
			(reservation_id, reason, refund_kobo, penalty_kobo, policy_snapshot, ledger_ref)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		reservationID, reason, refundKobo, penaltyKobo, policy, ledgerRef)
	return err
}

// RecordPaymentIntent writes a payment-intent row referencing the ledger entries.
func (r *Repository) RecordPaymentIntent(ctx context.Context, reservationID, method, status, ledgerRef, idempotencyKey string, amountKobo int64) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_payment_intent
			(reservation_id, method, status, ledger_ref, idempotency_key, amount_kobo)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		reservationID, method, status, ledgerRef, idempotencyKey, amountKobo)
	return err
}

// NextModifySeq returns the number of prior modify payment-intents for the
// reservation (used to derive a per-modify idempotency suffix so a retried modify
// with the same seq is idempotent, while a genuinely new modify gets a fresh key).
func (r *Repository) NextModifySeq(ctx context.Context, reservationID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `
		SELECT count(*) FROM public.stays_payment_intent
		WHERE reservation_id = $1 AND ledger_ref LIKE 'stays:modify:%'`,
		reservationID).Scan(&n)
	return n, err
}

// ApplyModify persists the re-priced stay (new dates + new money columns + state)
// AFTER the money movement has succeeded. Optimistic-locked. State stays CONFIRMED
// (a modify does not leave the confirmed lifecycle); only the dates/amounts change.
func (r *Repository) ApplyModify(ctx context.Context, id string, newCheckIn, newCheckOut time.Time, grossKobo, taxKobo, netRateKobo, markupKobo, commissionKobo int64, expectedVersion int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_reservation
		SET check_in = $2, check_out = $3, gross_amount_kobo = $4, tax_amount_kobo = $5,
		    net_rate_kobo = $6, markup_kobo = $7, commission_kobo = $8,
		    version = version + 1, updated_at = now()
		WHERE id = $1 AND version = $9`,
		id, newCheckIn, newCheckOut, grossKobo, taxKobo, netRateKobo, markupKobo,
		commissionKobo, expectedVersion)
	if err != nil {
		return fmt.Errorf("reservation: apply modify: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("reservation: optimistic lock conflict on modify %s", id)
	}
	return nil
}

// UpsertGuest records the lead guest (PII) for a reservation. Shared with the
// supplier only after NDPA consent (checked in the saga).
func (r *Repository) UpsertGuest(ctx context.Context, reservationID, firstName, lastName, email, phone string, isLead bool) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_reservation_guest
			(reservation_id, first_name, last_name, email, phone, is_lead)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		reservationID, firstName, lastName, email, phone, isLead)
	return err
}

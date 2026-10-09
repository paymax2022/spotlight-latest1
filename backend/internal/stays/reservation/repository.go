package reservation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
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

const resCols = `id, guest_user_id, property_id,
	COALESCE(room_type_id::text,''), COALESCE(rate_plan_id::text,''), source_rail,
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
		res.CommissionKobo, string(res.PaymentMethod), orMap(res.CancellationPolicy), res.IdempotencyKey,
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

// Get returns a reservation by id. ErrNotFound for a missing row AND for a
// malformed (non-UUID) id — stays_reservation.id is uuid, so a malformed value
// can never resolve; answering not-found here keeps Postgres's 22P02 syntax
// error from surfacing as a 500 through every caller of this funnel
// (member GET/voucher/cancel/modify all reach svc.Get → repo.Get).
func (r *Repository) Get(ctx context.Context, id string) (*Reservation, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, ErrNotFound
	}
	row := r.db.QueryRow(ctx, `SELECT `+resCols+` FROM public.stays_reservation WHERE id = $1`, id)
	res, err := scanReservation(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return res, err
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

// RecordCancellation writes a cancellation row with the policy snapshot +
// refund. Idempotent check-then-insert (the table has no UNIQUE on
// reservation_id) — safe because callers hold the reservation advisory lock.
// Errors propagate: a dropped row would lose the audit trail.
func (r *Repository) RecordCancellation(ctx context.Context, reservationID, reason string, refundKobo, penaltyKobo int64, policy map[string]any, ledgerRef string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_cancellation
			(reservation_id, reason, refund_kobo, penalty_kobo, policy_snapshot, ledger_ref)
		SELECT $1,$2,$3,$4,$5,$6
		WHERE NOT EXISTS (
			SELECT 1 FROM public.stays_cancellation WHERE reservation_id = $1
		)`,
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

// LockReservation serialises money-moving sagas per reservation: callers hold
// the returned tx open for the saga's duration and must Rollback it on return.
// Uses a transaction-scoped advisory lock rather than FOR UPDATE — the refund
// path inserts into FK children of the reservation row, which would deadlock
// against a row lock taken on another pooled connection.
func (r *Repository) LockReservation(ctx context.Context, id string) (pgx.Tx, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtext($1))`, "stays:reservation:"+id); err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	return tx, nil
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

// SettlementShare is one settlements row carrying this reservation's money
// (book hold + modify-charge holds). 'settled' rows parked kobo in
// provider_clearing + commission; 'escrowed' rows still hold it in escrow.
type SettlementShare struct {
	ID           string
	Status       string
	TotalKobo    int64
	ProviderKobo int64
	FeeKobo      int64
}

// StaysSettlements returns every settlement row this reservation's saga
// escrowed — the source-of-funds map refund paths must allocate from.
func (r *Repository) StaysSettlements(ctx context.Context, reservationID string) ([]SettlementShare, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, status, total_kobo, provider_kobo, fee_kobo
		FROM public.settlements
		WHERE module_type = 'stays'
		  AND reference IN ('stays:' || $1, 'stays:modify:' || $1)`, reservationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SettlementShare
	for rows.Next() {
		var s SettlementShare
		if err := rows.Scan(&s.ID, &s.Status, &s.TotalKobo, &s.ProviderKobo, &s.FeeKobo); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// RefundDraws returns, per standing-account type, the net kobo this booking's
// refund paths already drew. Settlement rows are never decremented by a draw,
// so refunds must allocate against row totals minus these draws — otherwise a
// refund over-draws the pooled accounts (spending another booking's money).
// Covers cancel/modify refund legs, whole-row escrow releases, commission
// journals, and payout/clawback legs bound to this reservation.
// excludeIdemPrefix drops this operation's own legs — only for callers needing
// the pre-own-draw residual (modify refunds); cancel paths pass "".
// (String-prefix match, not LIKE — wildcard keys can't escape.)
func (r *Repository) RefundDraws(ctx context.Context, reservationID, excludeIdemPrefix string) (map[string]int64, error) {
	rows, err := r.db.Query(ctx, `
		SELECT a.type::text,
		       COALESCE(SUM(CASE WHEN le.type IN ('DEBIT','REVERSAL_CREDIT') THEN le.amount_kobo
		                         ELSE -le.amount_kobo END), 0)
		FROM ledger_entries le
		JOIN ledger_accounts a ON a.id = le.account_id
		LEFT JOIN public.stays_hotel_payout p
		  ON le.reference IN ('stays:payout:' || p.id::text,
		                      'stays:payout:clawback:' || p.id::text)
		WHERE a.user_id IS NULL
		  AND a.type IN ('provider_clearing','commission','escrow')
		  AND ((le.reference LIKE 'stays:refund:' || $1 || ':%'
		     OR le.reference LIKE 'stays:modify:refund:' || $1 || ':%'
		     OR le.reference = 'refund:stays:' || $1
		     OR le.reference = 'refund:stays:modify:' || $1
		     OR le.reference = 'stays:commission:' || $1
		     OR le.reference = 'stays:commission:reversal:' || $1)
		    OR p.reservation_id::text = $1)
		  AND strpos(le.idempotency_key, $2 || ':') <> 1
		GROUP BY a.type`, reservationID, excludeIdemPrefix)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var accountType string
		var drawn int64
		if err := rows.Scan(&accountType, &drawn); err != nil {
			return nil, err
		}
		out[accountType] = drawn
	}
	return out, rows.Err()
}

// CancelRefundDraws is RefundDraws scoped to cancel-refund legs across every
// initiator (they share the 'stays:refund:<id>:*' family). Unlike RefundDraws
// there is no idempotency exclusion: a retried cancel must see its own earlier
// legs so it can top the guest up rather than double-pay or stale-allocate.
func (r *Repository) CancelRefundDraws(ctx context.Context, reservationID string) (map[string]int64, error) {
	rows, err := r.db.Query(ctx, `
		SELECT a.type::text,
		       COALESCE(SUM(CASE WHEN le.type IN ('DEBIT','REVERSAL_CREDIT') THEN le.amount_kobo
		                         ELSE -le.amount_kobo END), 0)
		FROM ledger_entries le
		JOIN ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id IS NULL
		  AND a.type IN ('provider_clearing','commission','escrow')
		  AND (le.reference LIKE 'stays:refund:' || $1 || ':%'
		    OR le.reference = 'refund:stays:' || $1)
		GROUP BY a.type`, reservationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var accountType string
		var drawn int64
		if err := rows.Scan(&accountType, &drawn); err != nil {
			return nil, err
		}
		out[accountType] = drawn
	}
	return out, rows.Err()
}

// CommissionLeg is one posted commission-draw leg needing a matching
// stays_commission_entry REVERSAL row (see ensureCommissionDeltas).
type CommissionLeg struct {
	IdempotencyKey string
	Reference      string
	AmountKobo     int64
}

// CommissionRefundLegs enumerates the commission-account DEBIT legs posted by
// this reservation's refund families (guest/hotel cancel + modify refund).
func (r *Repository) CommissionRefundLegs(ctx context.Context, reservationID string) ([]CommissionLeg, error) {
	rows, err := r.db.Query(ctx, `
		SELECT le.idempotency_key, le.reference, le.amount_kobo
		FROM ledger_entries le
		JOIN ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id IS NULL
		  AND a.type = 'commission'
		  AND le.type = 'DEBIT'
		  AND le.reference IN ('stays:refund:' || $1 || ':commission',
		                       'stays:modify:refund:' || $1 || ':commission')`, reservationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CommissionLeg
	for rows.Next() {
		var l CommissionLeg
		if err := rows.Scan(&l.IdempotencyKey, &l.Reference, &l.AmountKobo); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// MarkSettlementsRefunded flips still-'escrowed' settlement rows to 'refunded'
// after the release leg posts. Retry-safe: rows already refunded are untouched.
func (r *Repository) MarkSettlementsRefunded(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := r.db.Exec(ctx, `
		UPDATE public.settlements SET status = 'refunded'
		WHERE id = ANY($1::uuid[]) AND status = 'escrowed'`, ids)
	return err
}

// CancelPendingPayouts cancels queued-but-unpaid hotel payouts so the payout
// queue can't release money a guest cancel just refunded. Paid/failed payouts
// are untouched — a PAID payout needs an ops clawback. Returns rows cancelled.
func (r *Repository) CancelPendingPayouts(ctx context.Context, reservationID string) (int64, error) {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_hotel_payout
		SET status = 'CANCELLED', hold_reason = 'reservation cancelled', updated_at = now()
		WHERE reservation_id = $1 AND status IN ('HELD','PENDING')`, reservationID)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// RecordCommissionDelta appends a signed commission entry for commission the
// refund paths moved (negative = REVERSAL, positive = ACCRUAL), keeping
// CommissionNetForReservation aligned with posted ledger legs so a later
// ReverseCommission can't double-reverse. Idempotent on the key.
func (r *Repository) RecordCommissionDelta(ctx context.Context, reservationID, propertyRef string, amountKobo int64, ledgerRef, idempotencyKey string) error {
	if amountKobo == 0 {
		return nil
	}
	kind := "ACCRUAL"
	if amountKobo < 0 {
		kind = "REVERSAL"
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_commission_entry
			(reservation_id, property_id, amount_kobo, kind, ledger_ref, idempotency_key)
		VALUES ($1,
			(SELECT p.id FROM public.stays_property p
			 WHERE p.id::text = $2 OR p.supplier_property_ref = $2 LIMIT 1),
			$3, $4, $5, $6)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		reservationID, propertyRef, amountKobo, kind, ledgerRef, idempotencyKey)
	return err
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

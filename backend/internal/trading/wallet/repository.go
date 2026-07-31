package wallet

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data layer for the trading fund's unit/NAV/fee PROJECTION.
// It NEVER moves cash — cash lives in the finance ledger. It records the unit
// holdings, the immutable order/fee journals (idempotency-keyed), and NAV
// snapshots, and it computes the journal-vs-projection reconciliation numbers.
type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// UserUnits returns a user's current unit holding (0 if none).
func (r *Repository) UserUnits(ctx context.Context, userID string) (int64, error) {
	var u int64
	err := r.db.QueryRow(ctx, `SELECT COALESCE(units,0) FROM public.trading_fund_units WHERE user_id=$1`, userID).Scan(&u)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return u, err
}

// TotalUnits returns the total units outstanding (Σ over all holders).
func (r *Repository) TotalUnits(ctx context.Context) (int64, error) {
	var u int64
	err := r.db.QueryRow(ctx, `SELECT COALESCE(SUM(units),0) FROM public.trading_fund_units`).Scan(&u)
	return u, err
}

// HWM returns a user's stored high-water mark (NAV/whole-unit). ok=false means no
// row yet — the caller seeds it at the current NAV (or par) on first assessment.
func (r *Repository) HWM(ctx context.Context, userID string) (hwmKobo int64, ok bool, err error) {
	err = r.db.QueryRow(ctx, `SELECT high_water_nav_kobo FROM public.trading_hwm_watermarks WHERE user_id=$1`, userID).Scan(&hwmKobo)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return hwmKobo, err == nil, err
}

// FundOrder is a subscribe/redeem journal row.
type FundOrder struct {
	ID, UserID, Kind string
	CashKobo         int64
	UnitsDelta       int64 // + on subscribe, − on redeem
	NAVPerUnitKobo   int64
	IdempotencyKey   string
	LedgerRef        string
}

// GetOrderByIdem returns a previously-recorded order for replay, or nil.
func (r *Repository) GetOrderByIdem(ctx context.Context, idem string) (*FundOrder, error) {
	var o FundOrder
	err := r.db.QueryRow(ctx, `SELECT id,user_id,kind,cash_kobo,units_delta,nav_per_unit_kobo,idempotency_key,COALESCE(ledger_ref,'')
		FROM public.trading_fund_orders WHERE idempotency_key=$1`, idem).
		Scan(&o.ID, &o.UserID, &o.Kind, &o.CashKobo, &o.UnitsDelta, &o.NAVPerUnitKobo, &o.IdempotencyKey, &o.LedgerRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// ReserveOrder inserts a subscribe order as an UNSETTLED reservation (units/NAV
// pinned, no balance change yet), idempotency-keyed. On a crash-retry the caller
// re-reads this reservation and settles it against the SAME reserved units,
// instead of recomputing NAV against a post-deposit balance. dup=true means the
// reservation already exists.
func (r *Repository) ReserveOrder(ctx context.Context, o FundOrder) (dup bool, err error) {
	ct, err := r.db.Exec(ctx, `
		INSERT INTO public.trading_fund_orders
			(user_id,kind,cash_kobo,units_delta,nav_per_unit_kobo,ledger_ref,idempotency_key,settled)
		VALUES ($1,$2,$3,$4,$5,$6,$7,false)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		o.UserID, o.Kind, o.CashKobo, o.UnitsDelta, o.NAVPerUnitKobo, nullIfEmpty(o.LedgerRef), o.IdempotencyKey)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 0, nil
}

// SettleOrder finalizes a reserved order: it flips settled→true and applies the
// (already-pinned) unit delta to the holder, in one transaction, ONCE. A replay
// after the balance was already applied is a no-op (alreadySettled=true).
func (r *Repository) SettleOrder(ctx context.Context, idem string) (alreadySettled bool, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	var userID string
	var delta int64
	var settled bool
	if err = tx.QueryRow(ctx, `SELECT user_id, units_delta, settled FROM public.trading_fund_orders WHERE idempotency_key=$1 FOR UPDATE`, idem).
		Scan(&userID, &delta, &settled); err != nil {
		return false, err
	}
	if settled {
		return true, nil // already applied — idempotent no-op
	}
	if _, err = tx.Exec(ctx, `UPDATE public.trading_fund_orders SET settled=true WHERE idempotency_key=$1`, idem); err != nil {
		return false, err
	}
	// Ensure-row then plain UPDATE so the units>=0 CHECK is evaluated on the final
	// value (not a speculative negative insert tuple).
	if _, err = tx.Exec(ctx, `INSERT INTO public.trading_fund_units (user_id, units) VALUES ($1,0) ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE public.trading_fund_units SET units = units + $2, updated_at = now() WHERE user_id=$1`, userID, delta); err != nil {
		return false, err
	}
	return false, tx.Commit(ctx)
}

// CancelReservation deletes an UNSETTLED order (used when the cash leg is refused,
// e.g. insufficient funds, so the reservation never becomes real).
func (r *Repository) CancelReservation(ctx context.Context, idem string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM public.trading_fund_orders WHERE idempotency_key=$1 AND settled=false`, idem)
	return err
}

// RecordRedeem atomically inserts a redeem order (settled immediately — units are
// an input, not NAV-derived) and burns the units in ONE transaction. The units>=0
// CHECK blocks any over-redeem. dup=true means already recorded.
func (r *Repository) RecordRedeem(ctx context.Context, o FundOrder) (dup bool, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	ct, err := tx.Exec(ctx, `
		INSERT INTO public.trading_fund_orders
			(user_id,kind,cash_kobo,units_delta,nav_per_unit_kobo,ledger_ref,idempotency_key,settled)
		VALUES ($1,$2,$3,$4,$5,$6,$7,true)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		o.UserID, o.Kind, o.CashKobo, o.UnitsDelta, o.NAVPerUnitKobo, nullIfEmpty(o.LedgerRef), o.IdempotencyKey)
	if err != nil {
		return false, err
	}
	if ct.RowsAffected() == 0 {
		return true, nil
	}
	if _, err = tx.Exec(ctx, `INSERT INTO public.trading_fund_units (user_id, units) VALUES ($1,0) ON CONFLICT (user_id) DO NOTHING`, o.UserID); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE public.trading_fund_units SET units = units + $2, updated_at = now() WHERE user_id=$1`, o.UserID, o.UnitsDelta); err != nil {
		return false, err
	}
	return false, tx.Commit(ctx)
}

// FeeAccrual is a performance-fee journal row.
type FeeAccrual struct {
	UserID                        string
	Period                        string
	NAVNowKobo, HWMBefore, HWMAfter int64
	ProfitKobo, FeeKobo, UnitsBurned int64
	IdempotencyKey, LedgerRef     string
}

// GetFeeByIdem returns a previously-recorded fee accrual for replay, or nil.
func (r *Repository) GetFeeByIdem(ctx context.Context, idem string) (*FeeAccrual, error) {
	var a FeeAccrual
	err := r.db.QueryRow(ctx, `SELECT user_id,COALESCE(period,''),nav_now_kobo,hwm_before_kobo,hwm_after_kobo,profit_kobo,fee_kobo,units_burned,idempotency_key,COALESCE(ledger_ref,'')
		FROM public.trading_fee_accruals WHERE idempotency_key=$1`, idem).
		Scan(&a.UserID, &a.Period, &a.NAVNowKobo, &a.HWMBefore, &a.HWMAfter, &a.ProfitKobo, &a.FeeKobo, &a.UnitsBurned, &a.IdempotencyKey, &a.LedgerRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// RecordFeeAccrual atomically inserts the accrual (idempotency-keyed), burns the
// fee units from the holder, and advances the high-water mark — in ONE tx. Returns
// dup=true if already recorded (no re-burn).
func (r *Repository) RecordFeeAccrual(ctx context.Context, a FeeAccrual) (dup bool, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	ct, err := tx.Exec(ctx, `
		INSERT INTO public.trading_fee_accruals
			(user_id,period,nav_now_kobo,hwm_before_kobo,hwm_after_kobo,profit_kobo,fee_kobo,units_burned,ledger_ref,idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		a.UserID, nullIfEmpty(a.Period), a.NAVNowKobo, a.HWMBefore, a.HWMAfter, a.ProfitKobo, a.FeeKobo, a.UnitsBurned, nullIfEmpty(a.LedgerRef), a.IdempotencyKey)
	if err != nil {
		return false, err
	}
	if ct.RowsAffected() == 0 {
		return true, nil
	}

	if a.UnitsBurned > 0 {
		if _, err = tx.Exec(ctx, `
			UPDATE public.trading_fund_units SET units = units - $2, updated_at = now() WHERE user_id = $1`,
			a.UserID, a.UnitsBurned); err != nil {
			return false, err
		}
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO public.trading_hwm_watermarks (user_id, high_water_nav_kobo, last_assessed_at, updated_at)
		VALUES ($1, $2, now(), now())
		ON CONFLICT (user_id) DO UPDATE SET high_water_nav_kobo = $2, last_assessed_at = now(), updated_at = now()`,
		a.UserID, a.HWMAfter); err != nil {
		return false, err
	}
	return false, tx.Commit(ctx)
}

// SeedHWM sets a holder's initial high-water mark if absent (first assessment).
func (r *Repository) SeedHWM(ctx context.Context, userID string, navKobo int64) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.trading_hwm_watermarks (user_id, high_water_nav_kobo, updated_at)
		VALUES ($1,$2,now()) ON CONFLICT (user_id) DO NOTHING`, userID, navKobo)
	return err
}

// InsertNAVSnapshot records an immutable NAV snapshot.
func (r *Repository) InsertNAVSnapshot(ctx context.Context, navPerUnit, totalUnits, aumKobo, clearingKobo int64, idem string) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.trading_nav_snapshots (nav_per_unit_kobo,total_units,aum_kobo,clearing_kobo,idempotency_key)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET nav_per_unit_kobo=EXCLUDED.nav_per_unit_kobo
		RETURNING id`, navPerUnit, totalUnits, aumKobo, clearingKobo, nullIfEmpty(idem)).Scan(&id)
	return id, err
}

// JournalTotals are the cash/unit totals implied by the immutable order + fee
// journals — the independent oracle the ledger balance and unit projection must
// match. A torn write (order recorded but ledger leg lost, or vice-versa) shows
// up as a divergence here.
type JournalTotals struct {
	ExpectedClearingKobo int64 // Σ subscribe cash − Σ redeem cash − Σ fees
	ExpectedUnits        int64 // Σ order unit deltas − Σ fee units burned
}

func (r *Repository) JournalTotals(ctx context.Context) (JournalTotals, error) {
	var jt JournalTotals
	// Only SETTLED orders count — an in-flight (unsettled) reservation has not
	// applied its unit delta and its cash leg may not have posted.
	err := r.db.QueryRow(ctx, `
		SELECT
			COALESCE((SELECT SUM(CASE WHEN kind='subscribe' THEN cash_kobo ELSE -cash_kobo END) FROM public.trading_fund_orders WHERE settled),0)
			  - COALESCE((SELECT SUM(fee_kobo) FROM public.trading_fee_accruals),0),
			COALESCE((SELECT SUM(units_delta) FROM public.trading_fund_orders WHERE settled),0)
			  - COALESCE((SELECT SUM(units_burned) FROM public.trading_fee_accruals),0)
	`).Scan(&jt.ExpectedClearingKobo, &jt.ExpectedUnits)
	return jt, err
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

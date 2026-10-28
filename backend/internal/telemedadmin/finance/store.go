package finance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// querier is the read-only slice of pgxpool.Pool this package needs. Every query
// here is a SELECT; nothing in this package writes.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

var errNotFound = errors.New("not found")

type store struct{ db querier }

// payoutSelect is shared by the list and detail reads. The doctor join is
// LATERAL ... LIMIT 1 so a duplicate doctor row can never multiply a payout.
const payoutSelect = `
	SELECT p.id::text, p.user_id::text, COALESCE(d.name, ''), p.ref, p.amount_kobo, p.currency,
	       p.status, p.consult_count, p.period_label, p.failure_reason, p.requested_at, p.paid_at,
	       b.bank_name, b.account_number, COALESCE(b.is_verified, false),
	       (SELECT COUNT(*) FROM doctor_settlement_disputes sd WHERE sd.payout_id = p.id AND sd.status = 'open'),
	       p.ledger_ref, p.provider_reference
	FROM doctor_payouts p
	LEFT JOIN LATERAL (SELECT name FROM doctors WHERE user_id = p.user_id LIMIT 1) d ON true
	LEFT JOIN doctor_bank_accounts b ON b.id = p.bank_account_id`

func scanPayout(row pgx.Row) (PayoutDetail, error) {
	var pd PayoutDetail
	var acct *string
	err := row.Scan(&pd.ID, &pd.DoctorUserID, &pd.DoctorName, &pd.Ref, &pd.AmountKobo, &pd.Currency,
		&pd.Status, &pd.ConsultCount, &pd.PeriodLabel, &pd.FailureReason, &pd.RequestedAt, &pd.PaidAt,
		&pd.BankAccount.BankName, &acct, &pd.BankAccount.IsVerified, &pd.OpenDisputes,
		&pd.LedgerRef, &pd.ProviderReference)
	if err != nil {
		return pd, err
	}
	pd.BankAccount.Last4 = last4(acct)
	return pd, nil
}

func (s store) summary(ctx context.Context, w window) (Summary, error) {
	out := Summary{Currency: "NGN", PayoutsByStatus: []PayoutStatusTotal{}}
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(SUM(fee_kobo), 0)::bigint,
		       COALESCE(SUM(fee_kobo * 15 / 100), 0)::bigint,
		       COALESCE(SUM(COALESCE(platform_fee_kobo, 0)), 0)::bigint
		FROM appointments
		WHERE status = 'completed'
		  AND ($1::timestamptz IS NULL OR created_at >= $1)
		  AND ($2::timestamptz IS NULL OR created_at < $2)`, w.From, w.To).
		Scan(&out.CompletedConsultations, &out.GrossConsultFeesKobo, &out.PlatformCommissionKobo, &out.PlatformBookingFeesKobo)
	if err != nil {
		return out, fmt.Errorf("finance: consult totals: %w", err)
	}
	out.DoctorNetKobo = out.GrossConsultFeesKobo - out.PlatformCommissionKobo

	rows, err := s.db.Query(ctx, `
		SELECT status, COUNT(*), COALESCE(SUM(amount_kobo), 0)::bigint
		FROM doctor_payouts
		WHERE ($1::timestamptz IS NULL OR requested_at >= $1)
		  AND ($2::timestamptz IS NULL OR requested_at < $2)
		GROUP BY status ORDER BY status`, w.From, w.To)
	if err != nil {
		return out, fmt.Errorf("finance: payout totals: %w", err)
	}
	for rows.Next() {
		var t PayoutStatusTotal
		if err := rows.Scan(&t.Status, &t.Count, &t.AmountKobo); err != nil {
			rows.Close()
			return out, err
		}
		out.PayoutsByStatus = append(out.PayoutsByStatus, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}

	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_settlement_disputes WHERE status = 'open'`).
		Scan(&out.OpenDisputes); err != nil {
		return out, fmt.Errorf("finance: open disputes: %w", err)
	}
	return out, nil
}

const payoutWhere = `
	WHERE ($1::text IS NULL OR p.status = $1)
	  AND ($2::uuid IS NULL OR p.user_id = $2)
	  AND ($3::timestamptz IS NULL OR p.requested_at >= $3)
	  AND ($4::timestamptz IS NULL OR p.requested_at < $4)`

func (s store) payouts(ctx context.Context, status, doctorUserID *string, w window, pg page) (list[Payout], error) {
	out := list[Payout]{Items: []Payout{}}
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_payouts p`+payoutWhere,
		status, doctorUserID, w.From, w.To).Scan(&out.Total); err != nil {
		return out, fmt.Errorf("finance: count payouts: %w", err)
	}
	rows, err := s.db.Query(ctx, payoutSelect+payoutWhere+` ORDER BY p.requested_at DESC, p.id LIMIT $5 OFFSET $6`,
		status, doctorUserID, w.From, w.To, pg.Limit, pg.Offset)
	if err != nil {
		return out, fmt.Errorf("finance: list payouts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		pd, err := scanPayout(rows)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, pd.Payout)
	}
	return out, rows.Err()
}

func (s store) payout(ctx context.Context, id string) (PayoutDetail, error) {
	pd, err := scanPayout(s.db.QueryRow(ctx, payoutSelect+` WHERE p.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return pd, errNotFound
	}
	if err != nil {
		return pd, fmt.Errorf("finance: get payout: %w", err)
	}
	ds, err := s.disputes(ctx, nil, &id, page{Limit: maxLimit})
	if err != nil {
		return pd, err
	}
	pd.Disputes = ds.Items
	return pd, nil
}

func (s store) earnings(ctx context.Context, doctorUserID *string, w window, pg page) (list[DoctorEarnings], error) {
	out := list[DoctorEarnings]{Items: []DoctorEarnings{}}
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctors d WHERE ($1::uuid IS NULL OR d.user_id = $1)`,
		doctorUserID).Scan(&out.Total); err != nil {
		return out, fmt.Errorf("finance: count doctors: %w", err)
	}
	rows, err := s.db.Query(ctx, `
		SELECT d.id::text, d.user_id::text, d.name, COALESCE(d.specialty, ''),
		       COALESCE(e.cnt, 0), COALESCE(e.gross, 0), COALESCE(e.comm, 0), COALESCE(e.pf, 0),
		       COALESCE(p.paid, 0), COALESCE(p.inflight, 0)
		FROM doctors d
		LEFT JOIN (
		  SELECT doctor_id, COUNT(*) AS cnt, SUM(fee_kobo)::bigint AS gross,
		         SUM(fee_kobo * 15 / 100)::bigint AS comm,
		         SUM(COALESCE(platform_fee_kobo, 0))::bigint AS pf
		  FROM appointments
		  WHERE status = 'completed'
		    AND ($2::timestamptz IS NULL OR created_at >= $2)
		    AND ($3::timestamptz IS NULL OR created_at < $3)
		  GROUP BY doctor_id
		) e ON e.doctor_id = d.id
		LEFT JOIN (
		  SELECT user_id,
		         SUM(amount_kobo) FILTER (WHERE status = 'paid')::bigint AS paid,
		         SUM(amount_kobo) FILTER (WHERE status IN ('pending', 'processing'))::bigint AS inflight
		  FROM doctor_payouts GROUP BY user_id
		) p ON p.user_id = d.user_id
		WHERE ($1::uuid IS NULL OR d.user_id = $1)
		ORDER BY COALESCE(e.gross, 0) DESC, d.name, d.id
		LIMIT $4 OFFSET $5`, doctorUserID, w.From, w.To, pg.Limit, pg.Offset)
	if err != nil {
		return out, fmt.Errorf("finance: list earnings: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var e DoctorEarnings
		if err := rows.Scan(&e.DoctorID, &e.DoctorUserID, &e.DoctorName, &e.Specialty,
			&e.CompletedConsultations, &e.GrossKobo, &e.CommissionKobo, &e.PlatformBookingFeesKobo,
			&e.PaidOutKobo, &e.InFlightKobo); err != nil {
			return out, err
		}
		e.NetKobo = e.GrossKobo - e.CommissionKobo
		out.Items = append(out.Items, e)
	}
	return out, rows.Err()
}

func (s store) invoices(ctx context.Context, doctorUserID, status *string, w window, pg page) (list[Invoice], error) {
	out := list[Invoice]{Items: []Invoice{}}
	const where = `
		WHERE ($1::uuid IS NULL OR i.user_id = $1)
		  AND ($2::text IS NULL OR i.status = $2)
		  AND ($3::timestamptz IS NULL OR i.issued_at >= $3)
		  AND ($4::timestamptz IS NULL OR i.issued_at < $4)`
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_invoices i`+where,
		doctorUserID, status, w.From, w.To).Scan(&out.Total); err != nil {
		return out, fmt.Errorf("finance: count invoices: %w", err)
	}
	rows, err := s.db.Query(ctx, `
		SELECT i.id::text, i.user_id::text, COALESCE(d.name, ''), i.ref, i.appointment_id::text,
		       i.gross_kobo, i.commission_kobo, i.vat_kobo, i.net_kobo, i.currency, i.status, i.issued_at
		FROM doctor_invoices i
		LEFT JOIN LATERAL (SELECT name FROM doctors WHERE user_id = i.user_id LIMIT 1) d ON true`+where+`
		ORDER BY i.issued_at DESC, i.id LIMIT $5 OFFSET $6`,
		doctorUserID, status, w.From, w.To, pg.Limit, pg.Offset)
	if err != nil {
		return out, fmt.Errorf("finance: list invoices: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var v Invoice
		if err := rows.Scan(&v.ID, &v.DoctorUserID, &v.DoctorName, &v.Ref, &v.AppointmentID,
			&v.GrossKobo, &v.CommissionKobo, &v.VATKobo, &v.NetKobo, &v.Currency, &v.Status, &v.IssuedAt); err != nil {
			return out, err
		}
		out.Items = append(out.Items, v)
	}
	return out, rows.Err()
}

const disputeSelect = `
	SELECT sd.id::text, sd.user_id::text, COALESCE(d.name, ''), sd.payout_id::text, sd.status,
	       sd.reason, sd.created_at, sd.updated_at
	FROM doctor_settlement_disputes sd
	LEFT JOIN LATERAL (SELECT name FROM doctors WHERE user_id = sd.user_id LIMIT 1) d ON true`

func (s store) disputes(ctx context.Context, status, payoutID *string, pg page) (list[Dispute], error) {
	out := list[Dispute]{Items: []Dispute{}}
	const where = `
		WHERE ($1::text IS NULL OR sd.status = $1)
		  AND ($2::uuid IS NULL OR sd.payout_id = $2)`
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctor_settlement_disputes sd`+where,
		status, payoutID).Scan(&out.Total); err != nil {
		return out, fmt.Errorf("finance: count disputes: %w", err)
	}
	rows, err := s.db.Query(ctx, disputeSelect+where+` ORDER BY sd.created_at DESC, sd.id LIMIT $3 OFFSET $4`,
		status, payoutID, pg.Limit, pg.Offset)
	if err != nil {
		return out, fmt.Errorf("finance: list disputes: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var d Dispute
		if err := rows.Scan(&d.ID, &d.DoctorUserID, &d.DoctorName, &d.PayoutID, &d.Status,
			&d.Reason, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return out, err
		}
		out.Items = append(out.Items, d)
	}
	return out, rows.Err()
}

func (s store) dispute(ctx context.Context, id string) (DisputeDetail, error) {
	var dd DisputeDetail
	var raw string
	var payoutID *string
	err := s.db.QueryRow(ctx, `
		SELECT sd.id::text, sd.user_id::text, COALESCE(d.name, ''), sd.payout_id::text, sd.status,
		       sd.reason, sd.created_at, sd.updated_at, sd.detail::text
		FROM doctor_settlement_disputes sd
		LEFT JOIN LATERAL (SELECT name FROM doctors WHERE user_id = sd.user_id LIMIT 1) d ON true
		WHERE sd.id = $1::uuid`, id).
		Scan(&dd.ID, &dd.DoctorUserID, &dd.DoctorName, &payoutID, &dd.Status,
			&dd.Reason, &dd.CreatedAt, &dd.UpdatedAt, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return dd, errNotFound
	}
	if err != nil {
		return dd, fmt.Errorf("finance: get dispute: %w", err)
	}
	dd.PayoutID = payoutID
	dd.Detail = map[string]any{}
	if raw != "" {
		var m map[string]any
		if json.Unmarshal([]byte(raw), &m) == nil && m != nil {
			dd.Detail = m
		}
	}
	if payoutID != nil {
		pd, err := s.payout(ctx, *payoutID)
		if err != nil && !errors.Is(err, errNotFound) {
			return dd, err
		}
		if err == nil {
			p := pd.Payout
			dd.Payout = &p
		}
	}
	return dd, nil
}

func (s store) commissionConfig(ctx context.Context) (CommissionConfigView, error) {
	out := CommissionConfigView{
		PlatformCommissionBps: PlatformCommissionBps,
		DoctorShareBps:        DoctorShareBps,
		Overrides:             []CommissionOverride{},
	}
	rows, err := s.db.Query(ctx, `
		SELECT c.user_id::text, COALESCE(d.name, ''), c.commission_bps, c.vat_bps, c.payout_cycle, c.updated_at
		FROM doctor_commission_config c
		LEFT JOIN LATERAL (SELECT name FROM doctors WHERE user_id = c.user_id LIMIT 1) d ON true
		ORDER BY d.name, c.user_id LIMIT 500`)
	if err != nil {
		return out, fmt.Errorf("finance: commission config: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var o CommissionOverride
		if err := rows.Scan(&o.DoctorUserID, &o.DoctorName, &o.CommissionBps, &o.VATBps, &o.PayoutCycle, &o.UpdatedAt); err != nil {
			return out, err
		}
		out.Overrides = append(out.Overrides, o)
	}
	return out, rows.Err()
}

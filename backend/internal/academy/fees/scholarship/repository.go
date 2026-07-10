package feesscholarship

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the data-access contract for pledges + awards. Defined as an in-package interface so
// scholarship_test.go can substitute an in-memory fake (no live DB), mirroring feesinvoice /
// edupay isolation.
//
// This package EXTENDS the existing academy scholarship spine: pledges are recorded against a
// scholarship row and awards against academy_scholarship_awards (reused where possible). There
// is NO balance column: a pledge's remaining headroom is amount − applied, tracked on the row
// and audited on every mutation.
type Store interface {
	// Pledges.
	InsertPledge(ctx context.Context, p Pledge) (*Pledge, error)
	GetPledge(ctx context.Context, id string) (*Pledge, error)
	// SetPledgeState does a GUARDED transition (WHERE state=$from), optionally stamping the
	// funding ledger reference. Status only — no balance write.
	SetPledgeState(ctx context.Context, id string, from, to PledgeState, fundLedgerRef *string) (*Pledge, error)
	// AddAppliedMinor increments the running applied total under the same tx as the award insert.
	AddAppliedMinor(ctx context.Context, id string, amountMinor int64) error

	// Awards (append + idempotent on idempotency_key).
	AppendAward(ctx context.Context, a Award) (row *Award, inserted bool, err error)
	ListAwardsByPledge(ctx context.Context, pledgeID string) ([]Award, error)

	// WriteAudit records to public.audit_logs (module 'academy.fees').
	WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error

	// WithTx runs fn in a transaction (award insert + applied-total bump + state + audit atomic).
	WithTx(ctx context.Context, fn func(tx Tx) error) error
}

// Tx is the transactional slice of Store used inside WithTx.
type Tx interface {
	AppendAward(ctx context.Context, a Award) (row *Award, inserted bool, err error)
	AddAppliedMinor(ctx context.Context, id string, amountMinor int64) error
	SetPledgeState(ctx context.Context, id string, from, to PledgeState, fundLedgerRef *string) (*Pledge, error)
	WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error
}

// Repository is the pgx implementation of Store.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds the pgx-backed Store.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// NOTE (integration gap): the migration 20260918000000_academy_fees_edtech.sql does not add a
// dedicated pledge table. The integration task should add academy_scholarship_pledges
// (id, sponsor_identity_id, target_student_id, amount_minor, applied_minor, currency, state,
// fund_ledger_ref, created_at) — additive-only — OR map pledges onto academy_scholarships with
// the target student recorded in criteria jsonb. The SQL below assumes the dedicated table.
// Awards reuse the append-only academy_scholarship_awards shape (idempotency_key UNIQUE).
// RESOLVED (migration 20260920000500): pledge-funded awards reference the pledge via the
// additive pledge_id column; academy_scholarship_awards.scholarship_id had its NOT NULL FK
// dropped (left NULL for pledge-funded awards) and the state CHECK widened to admit 'applied'.
// The append/read queries below key off pledge_id, not scholarship_id.

func (r *Repository) InsertPledge(ctx context.Context, p Pledge) (*Pledge, error) {
	id := uuid.New().String()
	now := time.Now()
	if p.Currency == "" {
		p.Currency = "NGN"
	}
	const q = `INSERT INTO academy_scholarship_pledges
	    (id, sponsor_identity_id, target_student_id, amount_minor, applied_minor, currency, state, created_at)
	    VALUES ($1,$2,$3,$4,0,$5,'pledged',$6)`
	if _, err := r.db.Exec(ctx, q, id, nullStr(p.SponsorIdentityID), p.TargetStudentID, p.AmountMinor, p.Currency, now); err != nil {
		return nil, err
	}
	return r.GetPledge(ctx, id)
}

func (r *Repository) GetPledge(ctx context.Context, id string) (*Pledge, error) {
	const q = `SELECT id, sponsor_identity_id, target_student_id, amount_minor, applied_minor, currency, state, fund_ledger_ref, created_at
	           FROM academy_scholarship_pledges WHERE id = $1`
	var p Pledge
	var sponsor, fundRef *string
	var state string
	err := r.db.QueryRow(ctx, q, id).Scan(&p.ID, &sponsor, &p.TargetStudentID, &p.AmountMinor, &p.AppliedMinor, &p.Currency, &state, &fundRef, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if sponsor != nil {
		p.SponsorIdentityID = *sponsor
	}
	p.FundLedgerRef = fundRef
	p.State = PledgeState(state)
	return &p, nil
}

func (r *Repository) SetPledgeState(ctx context.Context, id string, from, to PledgeState, fundLedgerRef *string) (*Pledge, error) {
	return setPledgeState(ctx, r.db, id, from, to, fundLedgerRef)
}

func setPledgeState(ctx context.Context, q querier, id string, from, to PledgeState, fundLedgerRef *string) (*Pledge, error) {
	if !canPledge(from, to) {
		return nil, ErrIllegalTransition
	}
	const upd = `UPDATE academy_scholarship_pledges
	             SET state = $2, fund_ledger_ref = COALESCE($3, fund_ledger_ref)
	             WHERE id = $1 AND state = $4`
	tag, err := q.Exec(ctx, upd, id, string(to), fundRefArg(fundLedgerRef), string(from))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrIllegalTransition
	}
	// Read-back via a fresh pool read is fine for the pgx impl; callers that need the row use GetPledge.
	return nil, nil
}

func (r *Repository) AddAppliedMinor(ctx context.Context, id string, amountMinor int64) error {
	return addAppliedMinor(ctx, r.db, id, amountMinor)
}

func addAppliedMinor(ctx context.Context, q querier, id string, amountMinor int64) error {
	const upd = `UPDATE academy_scholarship_pledges SET applied_minor = applied_minor + $2 WHERE id = $1`
	_, err := q.Exec(ctx, upd, id, amountMinor)
	return err
}

func (r *Repository) AppendAward(ctx context.Context, a Award) (*Award, bool, error) {
	return appendAward(ctx, r.db, a)
}

func appendAward(ctx context.Context, q querier, a Award) (*Award, bool, error) {
	id := uuid.New().String()
	now := time.Now()
	const ins = `INSERT INTO academy_scholarship_awards
	    (id, pledge_id, user_id, fee_schedule_id, amount_minor, state, idempotency_key, created_at)
	    VALUES ($1,$2,$3,NULL,$4,'applied',$5,$6)
	    ON CONFLICT (idempotency_key) DO NOTHING`
	// pledge_id references the funding pledge (academy_scholarship_pledges). scholarship_id
	// is left NULL for pledge-funded awards (migration 20260920000500 drops its NOT NULL and
	// widens the state CHECK to admit 'applied'). user_id carries the invoice's
	// guardian/student party for traceability.
	tag, err := q.Exec(ctx, ins, id, a.PledgeID, a.StudentID, a.AmountMinor, a.IdempotencyKey, now)
	if err != nil {
		return nil, false, err
	}
	if tag.RowsAffected() == 0 {
		ex, gerr := getAwardByIdem(ctx, q, a.IdempotencyKey)
		return ex, false, gerr
	}
	out := a
	out.ID = id
	out.State = AwardApplied
	out.CreatedAt = now
	return &out, true, nil
}

func getAwardByIdem(ctx context.Context, q querier, idemKey string) (*Award, error) {
	const sel = `SELECT id, pledge_id, user_id, amount_minor, state, idempotency_key, created_at
	             FROM academy_scholarship_awards WHERE idempotency_key = $1`
	var a Award
	var state string
	err := q.QueryRow(ctx, sel, idemKey).Scan(&a.ID, &a.PledgeID, &a.StudentID, &a.AmountMinor, &state, &a.IdempotencyKey, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.State = AwardState(state)
	return &a, nil
}

func (r *Repository) ListAwardsByPledge(ctx context.Context, pledgeID string) ([]Award, error) {
	const q = `SELECT id, pledge_id, user_id, amount_minor, state, idempotency_key, created_at
	           FROM academy_scholarship_awards WHERE pledge_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, pledgeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Award{}
	for rows.Next() {
		var a Award
		var state string
		if err := rows.Scan(&a.ID, &a.PledgeID, &a.StudentID, &a.AmountMinor, &state, &a.IdempotencyKey, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.State = AwardState(state)
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repository) WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error {
	return writeAudit(ctx, r.db, actorID, action, entityID, from, to, detail)
}

func writeAudit(ctx context.Context, q querier, actorID, action, entityID, from, to string, detail any) error {
	const ins = `INSERT INTO academy_commerce_audit
	    (actor_id, action, entity_type, entity_id, from_state, to_state, detail, idempotency_key)
	    VALUES ($1,$2,'academy_scholarship_pledge',$3,$4,$5,$6,NULL)`
	_, err := q.Exec(ctx, ins, nullStr(actorID), action, nullUUID(entityID), nullStr(from), nullStr(to), toJSON(detail))
	return err
}

// WithTx wraps a pgx transaction, exposing a Tx facade over the same helpers.
func (r *Repository) WithTx(ctx context.Context, fn func(tx Tx) error) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(&txAdapter{tx: tx}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type txAdapter struct{ tx pgx.Tx }

func (t *txAdapter) AppendAward(ctx context.Context, a Award) (*Award, bool, error) {
	return appendAward(ctx, t.tx, a)
}
func (t *txAdapter) AddAppliedMinor(ctx context.Context, id string, amountMinor int64) error {
	return addAppliedMinor(ctx, t.tx, id, amountMinor)
}
func (t *txAdapter) SetPledgeState(ctx context.Context, id string, from, to PledgeState, fundLedgerRef *string) (*Pledge, error) {
	return setPledgeState(ctx, t.tx, id, from, to, fundLedgerRef)
}
func (t *txAdapter) WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error {
	return writeAudit(ctx, t.tx, actorID, action, entityID, from, to, detail)
}

// ── helpers ─────────────────────────────────────────────────────────────────────

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func fundRefArg(p *string) any {
	if p == nil || *p == "" {
		return nil
	}
	return *p
}

func toJSON(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}

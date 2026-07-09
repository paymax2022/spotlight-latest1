package feesvault

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// Store is the data-access contract for FeesVaults. Defined as an in-package interface
// so vault_test.go can substitute an in-memory fake and exercise the SF-5 segregation,
// idempotency and state-machine invariants WITHOUT a live DB (mirrors
// feeschedule_test.go / edupay isolation).
//
// It maps onto the SAME rows edupay uses (academy_savings_pots +
// academy_pot_contributions) — the FeesVault does not own new tables.
type Store interface {
	// InsertVault creates a vault (status 'active', saved_minor seeded 0 — always derived).
	InsertVault(ctx context.Context, userID, goalName string, targetMinor int64, feeScheduleID string) (*Vault, error)
	// GetVault returns a vault with saved_minor DERIVED from SUM(contributions).
	GetVault(ctx context.Context, userID, id string) (*Vault, error)
	// ListVaults returns the user's vaults (derived balances).
	ListVaults(ctx context.Context, userID string) ([]Vault, error)
	// AppendContribution appends ONE immutable contribution row, idempotent on the
	// globally-UNIQUE idempotency_key. Returns whether a NEW row was inserted
	// (false ⇒ replay; no new money). saved_minor is NEVER touched here.
	AppendContribution(ctx context.Context, vaultID, userID string, amountMinor int64, ledgerRef, idemKey string) (bool, error)
	// SumContributions is the DERIVED balance (single source of truth for saved_minor).
	SumContributions(ctx context.Context, vaultID string) (int64, error)
	// SetStatus performs a GUARDED status transition (WHERE status=$from) so concurrent
	// callers cannot double-transition. Returns ErrIllegalTransition when the guard misses.
	SetStatus(ctx context.Context, vaultID string, from, to feesstatemachine.VaultState) error
	// SetInvoiceRef records the invoice a vault was applied to (metadata only; the
	// authoritative money movement is the ledger transfer).
	SetInvoiceRef(ctx context.Context, vaultID, invoiceID string) error
	WriteAudit(ctx context.Context, actorID, action, entityID, from, to, idemKey string, detail any) error
}

// Repository is the pgx implementation of Store over the edupay savings-pot tables.
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

// derivedBalanceSQL is the SUM-of-contributions projection reused by GetVault/ListVaults.
// This is the ONLY source of truth for saved_minor (no shadow column write).
const derivedBalanceSQL = `COALESCE((SELECT SUM(c.amount_minor) FROM academy_pot_contributions c WHERE c.pot_id = p.id), 0)`

// InsertVault creates a vault (academy_savings_pots row). saved_minor starts 0 and is
// ALWAYS recomputed from contributions — never a stored shadow balance.
func (r *Repository) InsertVault(ctx context.Context, userID, goalName string, targetMinor int64, feeScheduleID string) (*Vault, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_savings_pots (id, user_id, goal_name, target_minor, saved_minor, fee_schedule_id, status, created_at)
	           VALUES ($1,$2,$3,$4,0,$5,'active',$6)`
	if _, err := r.db.Exec(ctx, q, id, userID, goalName, targetMinor, nullStr(feeScheduleID), now); err != nil {
		return nil, err
	}
	return r.GetVault(ctx, userID, id)
}

func (r *Repository) GetVault(ctx context.Context, userID, id string) (*Vault, error) {
	q := `SELECT p.id, p.user_id, p.goal_name, p.target_minor, ` + derivedBalanceSQL + ` AS saved_minor,
	             p.fee_schedule_id, p.status, p.created_at
	      FROM academy_savings_pots p WHERE p.id = $1 AND p.user_id = $2`
	var v Vault
	var status string
	err := r.db.QueryRow(ctx, q, id, userID).
		Scan(&v.ID, &v.UserID, &v.GoalName, &v.TargetMinor, &v.SavedMinor, &v.FeeScheduleID, &status, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	v.Status = feesstatemachine.VaultState(status)
	return &v, nil
}

func (r *Repository) ListVaults(ctx context.Context, userID string) ([]Vault, error) {
	q := `SELECT p.id, p.user_id, p.goal_name, p.target_minor, ` + derivedBalanceSQL + ` AS saved_minor,
	             p.fee_schedule_id, p.status, p.created_at
	      FROM academy_savings_pots p WHERE p.user_id = $1 ORDER BY p.created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Vault{}
	for rows.Next() {
		var v Vault
		var status string
		if err := rows.Scan(&v.ID, &v.UserID, &v.GoalName, &v.TargetMinor, &v.SavedMinor, &v.FeeScheduleID, &status, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.Status = feesstatemachine.VaultState(status)
		out = append(out, v)
	}
	return out, rows.Err()
}

// SumContributions is the DERIVED vault balance on the pool.
func (r *Repository) SumContributions(ctx context.Context, vaultID string) (int64, error) {
	const sel = `SELECT COALESCE(SUM(amount_minor), 0) FROM academy_pot_contributions WHERE pot_id = $1`
	var sum int64
	if err := r.db.QueryRow(ctx, sel, vaultID).Scan(&sum); err != nil {
		return 0, err
	}
	return sum, nil
}

// AppendContribution APPENDS one immutable contribution row. Idempotent on the
// globally-UNIQUE idempotency_key (uq_academy_pot_contrib_idem): a replay is a no-op.
// Returns whether a NEW row was inserted (false ⇒ replay; no new money collected).
// saved_minor is NEVER written — it is derived on read (SumContributions).
func (r *Repository) AppendContribution(ctx context.Context, vaultID, userID string, amountMinor int64, ledgerRef, idemKey string) (bool, error) {
	id := uuid.New().String()
	const ins = `INSERT INTO academy_pot_contributions (id, pot_id, user_id, amount_minor, wallet_ref, idempotency_key, created_at)
	             VALUES ($1,$2,$3,$4,$5,$6, now())
	             ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, ins, id, vaultID, userID, amountMinor, nullStr(ledgerRef), idemKey)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// SetStatus performs a GUARDED vault status transition. The pure feesstatemachine guard
// is checked first (defence in depth), then the UPDATE re-checks the current status under
// WHERE status=$from so a concurrent transition cannot double-fire. A zero-row update
// means the row was not in $from ⇒ ErrIllegalTransition.
func (r *Repository) SetStatus(ctx context.Context, vaultID string, from, to feesstatemachine.VaultState) error {
	if !feesstatemachine.VaultCanTransition(from, to) {
		return ErrIllegalTransition
	}
	const upd = `UPDATE academy_savings_pots SET status = $2 WHERE id = $1 AND status = $3`
	tag, err := r.db.Exec(ctx, upd, vaultID, string(to), string(from))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrIllegalTransition
	}
	return nil
}

// SetInvoiceRef records which invoice a vault was applied to. fee_schedule_id already
// exists on academy_savings_pots; the applied invoice id is stored there when unset so
// no new column is required (metadata only — money authority is the ledger transfer).
func (r *Repository) SetInvoiceRef(ctx context.Context, vaultID, invoiceID string) error {
	const upd = `UPDATE academy_savings_pots SET fee_schedule_id = COALESCE(fee_schedule_id, $2) WHERE id = $1`
	_, err := r.db.Exec(ctx, upd, vaultID, nullStr(invoiceID))
	return err
}

// WriteAudit reuses public.academy_commerce_audit (the sibling edupay/feeschedule audit).
func (r *Repository) WriteAudit(ctx context.Context, actorID, action, entityID, from, to, idemKey string, detail any) error {
	return writeAudit(ctx, r.db, actorID, action, entityID, from, to, idemKey, detail)
}

func writeAudit(ctx context.Context, q querier, actorID, action, entityID, from, to, idemKey string, detail any) error {
	const ins = `INSERT INTO public.academy_commerce_audit
	             (actor_id, action, entity_type, entity_id, from_state, to_state, detail, idempotency_key)
	             VALUES ($1,$2,'academy_fees_vault',$3,$4,$5,$6,$7)`
	_, err := q.Exec(ctx, ins, nullStr(actorID), action, nullUUID(entityID),
		nullStr(from), nullStr(to), toJSON(detail), nullStr(idemKey))
	return err
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

func toJSON(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	if b, ok := v.([]byte); ok {
		if len(b) == 0 {
			return []byte("{}")
		}
		return b
	}
	if rm, ok := v.(json.RawMessage); ok {
		if len(rm) == 0 {
			return []byte("{}")
		}
		return rm
	}
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}

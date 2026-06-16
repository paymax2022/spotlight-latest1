package ledger

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository handles all ledger DB operations over a pgx pool.
// All writes are INSERT-only — never UPDATE or DELETE.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// GetOrCreateAccount returns the ledger account for a user+type pair,
// creating it if it doesn't exist.
// For standing accounts (userID == nil), the unique constraint is on (type) WHERE user_id IS NULL.
func (r *Repository) GetOrCreateAccount(ctx context.Context, userID *string, accountType AccountType) (*Account, error) {
	var a Account
	var err error

	if userID == nil {
		// Standing account — keyed only by type.
		const upsert = `
			INSERT INTO ledger_accounts (type)
			VALUES ($1)
			ON CONFLICT DO NOTHING
			RETURNING id, user_id, type, created_at`
		err = r.db.QueryRow(ctx, upsert, string(accountType)).
			Scan(&a.ID, &a.UserID, &a.Type, &a.CreatedAt)
		if err == pgx.ErrNoRows {
			const fetch = `SELECT id, user_id, type, created_at FROM ledger_accounts WHERE user_id IS NULL AND type=$1`
			err = r.db.QueryRow(ctx, fetch, string(accountType)).
				Scan(&a.ID, &a.UserID, &a.Type, &a.CreatedAt)
		}
	} else {
		const upsert = `
			INSERT INTO ledger_accounts (user_id, type)
			VALUES ($1, $2)
			ON CONFLICT (user_id, type) DO NOTHING
			RETURNING id, user_id, type, created_at`
		err = r.db.QueryRow(ctx, upsert, userID, string(accountType)).
			Scan(&a.ID, &a.UserID, &a.Type, &a.CreatedAt)
		if err == pgx.ErrNoRows {
			const fetch = `SELECT id, user_id, type, created_at FROM ledger_accounts WHERE user_id=$1 AND type=$2`
			err = r.db.QueryRow(ctx, fetch, userID, string(accountType)).
				Scan(&a.ID, &a.UserID, &a.Type, &a.CreatedAt)
		}
	}

	if err != nil {
		return nil, fmt.Errorf("ledger: get/create account user=%v type=%s: %w", userID, accountType, err)
	}
	return &a, nil
}

// GetBalance returns the current balance in kobo for an account by projecting
// ledger entries. It never reads a balance column directly.
func (r *Repository) GetBalance(ctx context.Context, accountID string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(
			CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo
			     ELSE -amount_kobo END
		), 0)
		FROM ledger_entries
		WHERE account_id = $1`
	var balance int64
	err := r.db.QueryRow(ctx, q, accountID).Scan(&balance)
	if err != nil {
		return 0, fmt.Errorf("ledger: get balance account=%s: %w", accountID, err)
	}
	return balance, nil
}

// PostJournal writes a balanced pair of ledger entries atomically.
// Fails with a duplicate-key error if idempotency_key already exists.
func (r *Repository) PostJournal(ctx context.Context, j JournalEntry) error {
	if j.AmountKobo <= 0 {
		return fmt.Errorf("ledger: amount must be positive kobo, got %d", j.AmountKobo)
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ledger: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insertEntry = `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1, $2, $3, $4, $5)`

	// debit side
	_, err = tx.Exec(ctx, insertEntry,
		j.DebitAccountID, string(EntryDebit), j.AmountKobo, j.Reference, j.IdempotencyKey+":debit")
	if err != nil {
		return fmt.Errorf("ledger: insert debit entry: %w", err)
	}
	// credit side
	_, err = tx.Exec(ctx, insertEntry,
		j.CreditAccountID, string(EntryCredit), j.AmountKobo, j.Reference, j.IdempotencyKey+":credit")
	if err != nil {
		return fmt.Errorf("ledger: insert credit entry: %w", err)
	}

	return tx.Commit(ctx)
}

// ListEntries returns ledger entries for an account ordered by created_at desc.
func (r *Repository) ListEntries(ctx context.Context, accountID string, limit, offset int) ([]Entry, error) {
	const q = `
		SELECT id, account_id, type, amount_kobo, reference, idempotency_key, created_at
		FROM ledger_entries
		WHERE account_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`
	rows, err := r.db.Query(ctx, q, accountID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("ledger: list entries: %w", err)
	}
	defer rows.Close()

	var entries []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.AccountID, &e.Type, &e.AmountKobo, &e.Reference, &e.IdempotencyKey, &e.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

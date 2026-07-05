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

// balanceProjectionSQL projects an account balance from immutable ledger_entries.
// CREDIT + REVERSAL_DEBIT count as +balance; DEBIT + REVERSAL_CREDIT as -balance.
// Kept as a single const so the pooled (GetBalance) and in-tx (getBalanceTx)
// readers can never drift apart — both must classify entry types identically.
const balanceProjectionSQL = `
	SELECT COALESCE(SUM(
		CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo
		     ELSE -amount_kobo END
	), 0)
	FROM ledger_entries
	WHERE account_id = $1`

// GetBalance returns the current balance in kobo for an account by projecting
// ledger entries. It never reads a balance column directly.
//
// NOTE: this reads on the pool (no lock). It is safe for display/read paths, but
// MUST NOT be used as the sufficiency check that gates a debit — that check has a
// TOCTOU race against concurrent debits and must run inside the debiting tx under
// the account advisory lock (see getBalanceTx / Service.Debit).
func (r *Repository) GetBalance(ctx context.Context, accountID string) (int64, error) {
	var balance int64
	err := r.db.QueryRow(ctx, balanceProjectionSQL, accountID).Scan(&balance)
	if err != nil {
		return 0, fmt.Errorf("ledger: get balance account=%s: %w", accountID, err)
	}
	return balance, nil
}

// EntryExists reports whether a ledger entry with exactly this idempotency_key has
// been durably posted. Read-only; lets callers decide crash-recovery from the
// ledger of record without trusting the (optional) Redis idempotency cache.
func (r *Repository) EntryExists(ctx context.Context, idempotencyKey string) (bool, error) {
	var exists bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ledger_entries WHERE idempotency_key=$1)`, idempotencyKey).Scan(&exists); err != nil {
		return false, fmt.Errorf("ledger: entry exists idem=%s: %w", idempotencyKey, err)
	}
	return exists, nil
}

// getBalanceTx projects an account balance from WITHIN an open transaction, so the
// read observes any uncommitted entries the same tx already posted and — when the
// caller holds the account's pg_advisory_xact_lock — is serialised against other
// debits on the same account. This is the read half of the TOCTOU fix: check and
// insert under one lock, one tx.
func getBalanceTx(ctx context.Context, tx pgx.Tx, accountID string) (int64, error) {
	var balance int64
	if err := tx.QueryRow(ctx, balanceProjectionSQL, accountID).Scan(&balance); err != nil {
		return 0, fmt.Errorf("ledger: get balance (tx) account=%s: %w", accountID, err)
	}
	return balance, nil
}

// DebitWithBalanceCheck performs the balance sufficiency check and the balanced
// debit/credit insert as ONE atomic, serialised unit — closing the balance TOCTOU
// race where two concurrent debits both read the pre-debit balance, both pass the
// check, and together overdraw the wallet.
//
// Concurrency design:
//   - Open a tx and take pg_advisory_xact_lock(hashtext("wallet:"+userID)) FIRST.
//     Two debits on the same wallet therefore serialise: the second blocks until
//     the first commits (releasing the xact-scoped lock), so it reads the balance
//     AFTER the first debit landed. This mirrors the identical pattern already used
//     in finance/transfers/service.go, so lock keys are consistent app-wide and the
//     ordering can't deadlock against a transfer (both grab exactly one wallet lock,
//     same key namespace "wallet:<userID>", in the same order — no lock cycle).
//   - Re-project the balance INSIDE the tx (getBalanceTx) and fail-closed with
//     ErrInsufficientFunds if it's short.
//   - Insert the balanced DEBIT/CREDIT pair on the SAME tx. Idempotency is preserved:
//     the per-side unique idempotency_key + ON CONFLICT DO NOTHING makes a replay a
//     no-op instead of a duplicate-key error (the Redis fast-path in Service still
//     short-circuits the common case before we ever open a tx).
//
// debitAccountID is the user wallet being drawn down; creditAccountID is the
// counterpart (escrow / clearing / revenue). walletLockKey is the userID whose
// wallet lock guards the check — always the debited wallet's owner.
func (r *Repository) DebitWithBalanceCheck(ctx context.Context, walletLockKey string, j JournalEntry, amountKobo int64) error {
	if amountKobo <= 0 {
		return fmt.Errorf("ledger: debit amount must be positive kobo, got %d", amountKobo)
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ledger: begin debit tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Serialise all debits against this wallet before reading its balance.
	const lock = `SELECT pg_advisory_xact_lock(hashtext($1))`
	if _, err := tx.Exec(ctx, lock, "wallet:"+walletLockKey); err != nil {
		return fmt.Errorf("ledger: advisory lock wallet=%s: %w", walletLockKey, err)
	}

	// Sufficiency check under the lock — no other debit on this wallet can interleave
	// between here and Commit.
	balance, err := getBalanceTx(ctx, tx, j.DebitAccountID)
	if err != nil {
		return err
	}
	if balance < amountKobo {
		return ErrInsufficientFunds
	}

	// Post the balanced pair on the SAME tx. ON CONFLICT DO NOTHING keeps a retry
	// idempotent (unique idempotency_key would otherwise error the replay).
	const insertEntry = `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := tx.Exec(ctx, insertEntry,
		j.DebitAccountID, string(EntryDebit), amountKobo, j.Reference, j.IdempotencyKey+":debit"); err != nil {
		return fmt.Errorf("ledger: insert debit entry: %w", err)
	}
	if _, err := tx.Exec(ctx, insertEntry,
		j.CreditAccountID, string(EntryCredit), amountKobo, j.Reference, j.IdempotencyKey+":credit"); err != nil {
		return fmt.Errorf("ledger: insert credit entry: %w", err)
	}

	return tx.Commit(ctx)
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

// PostReversalPair writes a balanced REVERSAL_DEBIT / REVERSAL_CREDIT pair
// atomically. Unlike PostJournal (which always posts DEBIT/CREDIT), this is the
// only correction primitive: it restores a held amount to creditAccountID
// (REVERSAL_DEBIT, counted as +balance) and drains debitAccountID
// (REVERSAL_CREDIT). Idempotency keys are suffixed per side so a duplicate
// webhook violates the unique constraint and is a no-op.
//
// creditAccountID is the account whose balance is restored (e.g. the user
// wallet); debitAccountID is the account the hold is released from (e.g. the
// failed-transfer suspense account).
func (r *Repository) PostReversalPair(ctx context.Context, creditAccountID, debitAccountID string, amountKobo int64, reference, idempotencyKey string) error {
	if amountKobo <= 0 {
		return fmt.Errorf("ledger: reversal amount must be positive kobo, got %d", amountKobo)
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ledger: begin reversal tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insertEntry = `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1, $2, $3, $4, $5)`

	// Restore balance to the user wallet — REVERSAL_DEBIT reads as +balance.
	if _, err := tx.Exec(ctx, insertEntry,
		creditAccountID, string(EntryReversalDebit), amountKobo, reference, idempotencyKey+":rev_debit"); err != nil {
		return fmt.Errorf("ledger: insert reversal debit: %w", err)
	}
	// Drain the suspense hold — REVERSAL_CREDIT reads as -balance.
	if _, err := tx.Exec(ctx, insertEntry,
		debitAccountID, string(EntryReversalCredit), amountKobo, reference, idempotencyKey+":rev_credit"); err != nil {
		return fmt.Errorf("ledger: insert reversal credit: %w", err)
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

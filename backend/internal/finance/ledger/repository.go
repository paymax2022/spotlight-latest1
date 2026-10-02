package ledger

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
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
//
// READ-FIRST, not write-first. In steady state the account already exists, so the
// common path is a single SELECT — no write transaction, no XID, no speculative
// insertion against the unique index. The previous shape upserted FIRST and only
// fell back to SELECT when the INSERT conflicted (INSERT ... ON CONFLICT DO
// NOTHING RETURNING yields zero rows on conflict), so every read paid for a write
// attempt plus a second query — two round trips where one suffices, on the hottest
// read path in the API (every balance / transaction / transfer call resolves its
// account here). On a saturated pool the extra write-shaped acquisition also held
// a connection longer per request (AGT1-PERF-001).
//
// Race safety is unchanged: two first-touch creators still converge on the
// unique constraint — one inserts, the other conflicts (DO NOTHING → no rows)
// and re-selects the now-committed row.
func (r *Repository) GetOrCreateAccount(ctx context.Context, userID *string, accountType AccountType) (*Account, error) {
	if userID == nil {
		return r.getOrCreateStandingAccount(ctx, accountType)
	}
	return r.getOrCreateUserAccount(ctx, *userID, accountType)
}

// getOrCreateUserAccount implements GetOrCreateAccount for user-owned accounts
// (unique key: (user_id, type)).
func (r *Repository) getOrCreateUserAccount(ctx context.Context, userID string, accountType AccountType) (*Account, error) {
	var a Account
	const fetch = `SELECT id, user_id, type, created_at FROM ledger_accounts WHERE user_id=$1 AND type=$2`
	err := r.db.QueryRow(ctx, fetch, userID, string(accountType)).
		Scan(&a.ID, &a.UserID, &a.Type, &a.CreatedAt)
	if err == nil {
		return &a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("ledger: get account user=%s type=%s: %w", userID, accountType, err)
	}

	// First touch — create it. ON CONFLICT DO NOTHING keeps a concurrent creator
	// a no-op; on conflict this returns no rows and we re-select below.
	const upsert = `
		INSERT INTO ledger_accounts (user_id, type)
		VALUES ($1, $2)
		ON CONFLICT (user_id, type) DO NOTHING
		RETURNING id, user_id, type, created_at`
	err = r.db.QueryRow(ctx, upsert, userID, string(accountType)).
		Scan(&a.ID, &a.UserID, &a.Type, &a.CreatedAt)
	if err == nil {
		return &a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("ledger: create account user=%s type=%s: %w", userID, accountType, err)
	}

	// Lost a create race — the winner's row is committed now.
	if err := r.db.QueryRow(ctx, fetch, userID, string(accountType)).
		Scan(&a.ID, &a.UserID, &a.Type, &a.CreatedAt); err != nil {
		return nil, fmt.Errorf("ledger: re-fetch account user=%s type=%s: %w", userID, accountType, err)
	}
	return &a, nil
}

// getOrCreateStandingAccount implements GetOrCreateAccount for system standing
// accounts (unique key: (type) WHERE user_id IS NULL AND group_id IS NULL).
func (r *Repository) getOrCreateStandingAccount(ctx context.Context, accountType AccountType) (*Account, error) {
	var a Account
	const fetch = `SELECT id, user_id, type, created_at FROM ledger_accounts WHERE user_id IS NULL AND type=$1`
	err := r.db.QueryRow(ctx, fetch, string(accountType)).
		Scan(&a.ID, &a.UserID, &a.Type, &a.CreatedAt)
	if err == nil {
		return &a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("ledger: get standing account type=%s: %w", accountType, err)
	}

	const upsert = `
		INSERT INTO ledger_accounts (type)
		VALUES ($1)
		ON CONFLICT DO NOTHING
		RETURNING id, user_id, type, created_at`
	err = r.db.QueryRow(ctx, upsert, string(accountType)).
		Scan(&a.ID, &a.UserID, &a.Type, &a.CreatedAt)
	if err == nil {
		return &a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("ledger: create standing account type=%s: %w", accountType, err)
	}

	if err := r.db.QueryRow(ctx, fetch, string(accountType)).
		Scan(&a.ID, &a.UserID, &a.Type, &a.CreatedAt); err != nil {
		return nil, fmt.Errorf("ledger: re-fetch standing account type=%s: %w", accountType, err)
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

// EntryAmount returns the amount_kobo posted under this idempotency_key on the
// given account. Used for replay verification and reversal lookups — the
// recorded ledger amount is the source of truth, never the caller's claim.
func (r *Repository) EntryAmount(ctx context.Context, accountID, idempotencyKey string) (int64, bool, error) {
	var amount int64
	err := r.db.QueryRow(ctx,
		`SELECT amount_kobo FROM ledger_entries WHERE account_id=$1 AND idempotency_key=$2`,
		accountID, idempotencyKey).Scan(&amount)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("ledger: entry amount account=%s idem=%s: %w", accountID, idempotencyKey, err)
	}
	return amount, true, nil
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
	// idempotent (unique idempotency_key would otherwise error the replay) — but
	// only when the replayed amount matches what was actually posted. A different
	// amount under a REUSED key is a tampered retry, not a retry at all: a caller
	// could pre-claim the key cheaply at this endpoint, then replay it through a
	// higher-level path that re-derives the real price and trusts the no-op.
	const insertEntry = `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := tx.Exec(ctx, insertEntry,
		j.DebitAccountID, string(EntryDebit), amountKobo, j.Reference, j.IdempotencyKey+":debit")
	if err != nil {
		return fmt.Errorf("ledger: insert debit entry: %w", err)
	}
	if err := verifyReplayAmount(ctx, tx, j.IdempotencyKey+":debit", amountKobo, tag); err != nil {
		return err
	}
	tag, err = tx.Exec(ctx, insertEntry,
		j.CreditAccountID, string(EntryCredit), amountKobo, j.Reference, j.IdempotencyKey+":credit")
	if err != nil {
		return fmt.Errorf("ledger: insert credit entry: %w", err)
	}
	if err := verifyReplayAmount(ctx, tx, j.IdempotencyKey+":credit", amountKobo, tag); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// verifyReplayAmount runs when an idempotent insert hit an existing row
// (RowsAffected==0). A same-amount replay is a true duplicate and stays a
// no-op; a different amount fails closed as ErrDuplicate so the caller can
// reject rather than silently absorb a cheaper journal under a recycled key.
func verifyReplayAmount(ctx context.Context, tx pgx.Tx, idempotencyKey string, amountKobo int64, tag pgconn.CommandTag) error {
	if tag.RowsAffected() > 0 {
		return nil
	}
	var existing int64
	if err := tx.QueryRow(ctx,
		`SELECT amount_kobo FROM ledger_entries WHERE idempotency_key=$1`,
		idempotencyKey).Scan(&existing); err != nil {
		return fmt.Errorf("ledger: verify replay for %s: %w", idempotencyKey, err)
	}
	if existing != amountKobo {
		return fmt.Errorf("%w: key %s replayed with different amount (posted %d, requested %d)",
			ErrDuplicate, idempotencyKey, existing, amountKobo)
	}
	return nil
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

	// debit side. A duplicate idempotency_key means this exact journal was already
	// posted (replay) — surface the typed ErrDuplicate so callers can treat the
	// retry as a no-op instead of a hard failure.
	_, err = tx.Exec(ctx, insertEntry,
		j.DebitAccountID, string(EntryDebit), j.AmountKobo, j.Reference, j.IdempotencyKey+":debit")
	if err != nil {
		if dbutil.IsUniqueViolation(err) {
			return ErrDuplicate
		}
		return fmt.Errorf("ledger: insert debit entry: %w", err)
	}
	// credit side
	_, err = tx.Exec(ctx, insertEntry,
		j.CreditAccountID, string(EntryCredit), j.AmountKobo, j.Reference, j.IdempotencyKey+":credit")
	if err != nil {
		if dbutil.IsUniqueViolation(err) {
			return ErrDuplicate
		}
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
	// A duplicate idempotency_key means this exact reversal was already posted
	// (replay) — surface the typed ErrDuplicate, mirroring PostJournal above,
	// so callers (e.g. marketplace CancelBoost/RejectBoost) can treat the
	// retry as a no-op instead of a hard failure. Without this, a caller's
	// Redis-lock-based dedup is the ONLY thing standing between a replay and a
	// raw wrapped error — and that lock does not always answer (Redis unset,
	// unreachable, or its TTL elapsed between two attempts).
	if _, err := tx.Exec(ctx, insertEntry,
		creditAccountID, string(EntryReversalDebit), amountKobo, reference, idempotencyKey+":rev_debit"); err != nil {
		if dbutil.IsUniqueViolation(err) {
			return ErrDuplicate
		}
		return fmt.Errorf("ledger: insert reversal debit: %w", err)
	}
	// Drain the suspense hold — REVERSAL_CREDIT reads as -balance.
	if _, err := tx.Exec(ctx, insertEntry,
		debitAccountID, string(EntryReversalCredit), amountKobo, reference, idempotencyKey+":rev_credit"); err != nil {
		if dbutil.IsUniqueViolation(err) {
			return ErrDuplicate
		}
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

// userPotTypes are the ledger account types that together hold a user's
// spendable balance. Two exist for historical reasons: the Go finance modules
// post to 'user_wallet', while the Next.js wallet (Paystack top-ups, transfers)
// posts to 'wallet'. Reporting must span both or it under-reports the user.
var userPotTypes = []string{string(AccountUserWallet), "wallet"}

// GetBalanceAcrossUserPots projects a user's balance over every pot they hold.
// Read-only reporting accessor — like GetBalance it takes no lock and MUST NOT
// gate a debit.
func (r *Repository) GetBalanceAcrossUserPots(ctx context.Context, userID string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(
			CASE WHEN e.type IN ('CREDIT','REVERSAL_DEBIT') THEN e.amount_kobo
			     ELSE -e.amount_kobo END
		), 0)
		FROM ledger_entries e
		JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id = $1 AND a.type = ANY($2)`

	var balance int64
	if err := r.db.QueryRow(ctx, q, userID, userPotTypes).Scan(&balance); err != nil {
		return 0, fmt.Errorf("ledger: get balance across pots user=%s: %w", userID, err)
	}
	return balance, nil
}

// ListEntriesAcrossUserPots returns a user's ledger entries from every pot they
// hold, newest first. Read-only reporting accessor.
func (r *Repository) ListEntriesAcrossUserPots(ctx context.Context, userID string, limit, offset int) ([]Entry, error) {
	const q = `
		SELECT e.id, e.account_id, e.type, e.amount_kobo, e.reference, e.idempotency_key, e.created_at
		FROM ledger_entries e
		JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id = $1 AND a.type = ANY($2)
		ORDER BY e.created_at DESC
		LIMIT $3 OFFSET $4`

	rows, err := r.db.Query(ctx, q, userID, userPotTypes, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("ledger: list entries across pots: %w", err)
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

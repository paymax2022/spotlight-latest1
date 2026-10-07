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
// insertion against the unique index. A write-first upsert would make every read
// pay for a write attempt plus a fallback SELECT on the hottest read path in the
// API (every balance / transaction / transfer call resolves its account here;
// AGT1-PERF-001).
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

	// First touch — create it. Plain ON CONFLICT DO NOTHING with NO arbiter:
	// the table carries two uniqueness surfaces ((user_id,type) index AND the
	// older (user_id,type,currency) constraint). An arbiter only suppresses
	// conflicts on its own index — a concurrent loser could still hit a hard
	// 23505 on the other (AUD-DB-007). With no arbiter, ANY unique conflict
	// resolves to DO NOTHING.
	const upsert = `
		INSERT INTO ledger_accounts (user_id, type)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING
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
// debit/credit insert as ONE atomic, serialised unit — closing the TOCTOU race
// where two concurrent debits both pass a pre-debit balance check and overdraw.
//   - pg_advisory_xact_lock(hashtext("wallet:"+userID)) serialises debits on
//     the same wallet — same key namespace as finance/transfers/service.go, so
//     no lock cycle.
//   - The balance is re-projected INSIDE the tx (getBalanceTx); short →
//     ErrInsufficientFunds.
//   - The balanced pair posts on the same tx; per-side unique idempotency_key
//   - ON CONFLICT DO NOTHING makes a replay a no-op.
//
// walletLockKey is the owner of the wallet being drawn down.
func (r *Repository) DebitWithBalanceCheck(ctx context.Context, walletLockKey string, j JournalEntry, amountKobo int64) error {
	if amountKobo <= 0 {
		return fmt.Errorf("ledger: debit amount must be positive kobo, got %d", amountKobo)
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ledger: begin debit tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const lock = `SELECT pg_advisory_xact_lock(hashtext($1))`
	if _, err := tx.Exec(ctx, lock, "wallet:"+walletLockKey); err != nil {
		return fmt.Errorf("ledger: advisory lock wallet=%s: %w", walletLockKey, err)
	}

	// Sufficiency check under the lock — no interleaving debit before Commit.
	balance, err := getBalanceTx(ctx, tx, j.DebitAccountID)
	if err != nil {
		return err
	}
	if balance < amountKobo {
		return ErrInsufficientFunds
	}

	// Balanced pair on the SAME tx. ON CONFLICT makes a retry idempotent — but
	// only when the replay is the SAME journal: amount, debit/credit account and
	// reference must all match the row already holding the key. A reused key for
	// a different journal is a tampered or foreign retry (a key pre-claimed
	// cheaply here could otherwise absorb another user's or another rail's
	// posting as a silent no-op — the phantom-paid-row bug), so the check
	// fails closed.
	const insertEntry = `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := tx.Exec(ctx, insertEntry,
		j.DebitAccountID, string(EntryDebit), amountKobo, j.Reference, j.IdempotencyKey+":debit")
	if err != nil {
		return fmt.Errorf("ledger: insert debit entry: %w", err)
	}
	if err := verifyReplay(ctx, tx, j.IdempotencyKey+":debit", j.DebitAccountID, j.Reference, amountKobo, tag); err != nil {
		return err
	}
	tag, err = tx.Exec(ctx, insertEntry,
		j.CreditAccountID, string(EntryCredit), amountKobo, j.Reference, j.IdempotencyKey+":credit")
	if err != nil {
		return fmt.Errorf("ledger: insert credit entry: %w", err)
	}
	if err := verifyReplay(ctx, tx, j.IdempotencyKey+":credit", j.CreditAccountID, j.Reference, amountKobo, tag); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// verifyReplay runs when an idempotent insert hit an existing row
// (RowsAffected==0). A replay is a true duplicate ONLY when the existing row
// is the same journal leg: same account, same reference AND same amount — a
// no-op. Anything else under the same key is a foreign or tampered claim
// (cross-user/cross-rail key reuse, or a key pre-claimed with a cheaper
// amount absorbing a pricier replay): fail closed as ErrDuplicate so the
// caller rejects instead of silently absorbing somebody else's posting —
// which is how a silent no-op used to mint a paid vote/gift/payout row with
// no money behind it.
func verifyReplay(ctx context.Context, tx pgx.Tx, idempotencyKey, accountID, reference string, amountKobo int64, tag pgconn.CommandTag) error {
	if tag.RowsAffected() > 0 {
		return nil
	}
	var existingAccountID, existingRef string
	var existingAmount int64
	if err := tx.QueryRow(ctx,
		`SELECT account_id::text, reference, amount_kobo FROM ledger_entries WHERE idempotency_key=$1`,
		idempotencyKey).Scan(&existingAccountID, &existingRef, &existingAmount); err != nil {
		return fmt.Errorf("ledger: verify replay for %s: %w", idempotencyKey, err)
	}
	if existingAccountID != accountID || existingRef != reference || existingAmount != amountKobo {
		return fmt.Errorf("%w: key %s replayed for a different journal "+
			"(posted account=%s ref=%q amount=%d, requested account=%s ref=%q amount=%d)",
			ErrDuplicate, idempotencyKey,
			existingAccountID, existingRef, existingAmount,
			accountID, reference, amountKobo)
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
	defer func() { _ = tx.Rollback(ctx) }()

	const insertEntry = `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1, $2, $3, $4, $5)`

	// A duplicate idempotency_key means this journal already posted (replay) —
	// surface typed ErrDuplicate so callers treat the retry as a no-op.
	_, err = tx.Exec(ctx, insertEntry,
		j.DebitAccountID, string(EntryDebit), j.AmountKobo, j.Reference, j.IdempotencyKey+":debit")
	if err != nil {
		if dbutil.IsUniqueViolation(err) {
			return ErrDuplicate
		}
		return fmt.Errorf("ledger: insert debit entry: %w", err)
	}
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
// atomically — the only correction primitive (ledger entries are immutable).
// creditAccountID is restored (REVERSAL_DEBIT, +balance); debitAccountID is
// the hold drained (REVERSAL_CREDIT, e.g. the failed-transfer suspense).
// Per-side key suffixes make a duplicate webhook a no-op.
func (r *Repository) PostReversalPair(ctx context.Context, creditAccountID, debitAccountID string, amountKobo int64, reference, idempotencyKey string) error {
	if amountKobo <= 0 {
		return fmt.Errorf("ledger: reversal amount must be positive kobo, got %d", amountKobo)
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ledger: begin reversal tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertEntry = `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1, $2, $3, $4, $5)`

	// REVERSAL_DEBIT reads as +balance (restore). Duplicate key → typed
	// ErrDuplicate so callers treat a replay as a no-op — Redis-lock dedup is
	// not always there to absorb it (Redis unset, unreachable, TTL elapsed).
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

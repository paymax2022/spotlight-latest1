package transfers

// Transaction-scoped money-path helpers for the transfers rail.
//
// These exist because the ledger package's tx-scoped primitives
// (ledger.getBalanceTx, the journal body of Repository.PostJournal /
// PostReversalPair) are unexported or own their transaction internally — a
// caller cannot compose them with OTHER writes (like the bank_transfers status
// flip) in one commit. The audit finding they close: settleTransfer/markFunded
// used to post the journal in one pooled tx and flip the status in a second
// pooled exec, so a crash between the two left the row at 'funds_reserved' /
// 'awaiting_funding' with the ledger already moved. Here the journal legs and
// the CAS status update share ONE pgx tx: both land or neither does.
//
// SQL note: the projection and the idempotency-key suffix scheme deliberately
// MIRROR backend/internal/finance/ledger/repository.go — that file owns the
// ledger write contract, so keep the CASE sign rule and the
// ":debit"/":credit"/":rev_debit"/":rev_credit" suffixes in lockstep with it.

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// balanceProjectionSQL mirrors ledger.balanceProjectionSQL verbatim:
// CREDIT + REVERSAL_DEBIT count as +balance; every other type (DEBIT,
// REVERSAL_CREDIT) as -balance. Duplicated (not imported) because the ledger
// const is unexported; the sign rule is the single invariant both copies must
// never drift on.
const balanceProjectionSQL = `
	SELECT COALESCE(SUM(
		CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo
		     ELSE -amount_kobo END
	), 0)
	FROM ledger_entries
	WHERE account_id = $1`

// balanceTx projects an account balance from WITHIN an open transaction — the
// in-tx counterpart of ledger.getBalanceTx. Used as the sufficiency check that
// gates a debit: with the account's advisory lock held in the same tx the read
// is serialised against every writer that honours that lock (this rail AND the
// SQL-RPC wallet plane — see InitiateWalletToWallet).
func balanceTx(ctx context.Context, tx pgx.Tx, accountID string) (int64, error) {
	var balance int64
	if err := tx.QueryRow(ctx, balanceProjectionSQL, accountID).Scan(&balance); err != nil {
		return 0, fmt.Errorf("transfers: balance (tx) account=%s: %w", accountID, err)
	}
	return balance, nil
}

// insertEntryTx is the shared insert for all in-tx legs. ON CONFLICT
// (idempotency_key) DO NOTHING replaces the ledger service's pooled
// ErrDuplicate-tolerance: inside an outer tx a raised 23505 would abort the
// whole transaction, so replayed legs are made no-ops at the INSERT level
// instead. The key is deterministic per leg and bound to this transfer's row
// (cross-user reuse is refused at initiation by ErrIdempotencyKeyConflict), so
// a conflict can only be the same leg replaying the same amount.
const insertEntryTx = `
	INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
	VALUES ($1, $2, $3, $4, $5)
	ON CONFLICT (idempotency_key) DO NOTHING`

// insertJournalLegTx posts one balanced DEBIT/CREDIT pair inside tx — the
// in-tx counterpart of ledger.Repository.PostJournal, using its exact
// idempotency-key suffix scheme (base+":debit" / base+":credit") so a leg
// posted by the old pooled path and a replay through this path see the same
// durable dedup.
func insertJournalLegTx(ctx context.Context, tx pgx.Tx, reference, baseIdempotencyKey string, amountKobo int64, debitAccountID, creditAccountID string) error {
	if amountKobo <= 0 {
		return fmt.Errorf("transfers: journal amount must be positive kobo, got %d", amountKobo)
	}
	if _, err := tx.Exec(ctx, insertEntryTx,
		debitAccountID, "DEBIT", amountKobo, reference, baseIdempotencyKey+":debit"); err != nil {
		return fmt.Errorf("transfers: journal debit leg %s: %w", baseIdempotencyKey, err)
	}
	if _, err := tx.Exec(ctx, insertEntryTx,
		creditAccountID, "CREDIT", amountKobo, reference, baseIdempotencyKey+":credit"); err != nil {
		return fmt.Errorf("transfers: journal credit leg %s: %w", baseIdempotencyKey, err)
	}
	return nil
}

// insertReversalLegTx posts one balanced REVERSAL_DEBIT / REVERSAL_CREDIT pair
// inside tx — the in-tx counterpart of ledger.Repository.PostReversalPair,
// same key scheme (base+":rev_debit" / base+":rev_credit"). restoreAccountID
// is credited back (REVERSAL_DEBIT, +balance); holdAccountID has its hold
// drained (REVERSAL_CREDIT). Corrections are reversing entries only.
func insertReversalLegTx(ctx context.Context, tx pgx.Tx, reference, baseIdempotencyKey string, amountKobo int64, restoreAccountID, holdAccountID string) error {
	if amountKobo <= 0 {
		return fmt.Errorf("transfers: reversal amount must be positive kobo, got %d", amountKobo)
	}
	if _, err := tx.Exec(ctx, insertEntryTx,
		restoreAccountID, "REVERSAL_DEBIT", amountKobo, reference, baseIdempotencyKey+":rev_debit"); err != nil {
		return fmt.Errorf("transfers: reversal debit leg %s: %w", baseIdempotencyKey, err)
	}
	if _, err := tx.Exec(ctx, insertEntryTx,
		holdAccountID, "REVERSAL_CREDIT", amountKobo, reference, baseIdempotencyKey+":rev_credit"); err != nil {
		return fmt.Errorf("transfers: reversal credit leg %s: %w", baseIdempotencyKey, err)
	}
	return nil
}

// payoutLegLockKey namespaces the per-transfer advisory lock that serialises
// the provider payout leg (claim-then-act for AdminRetry and every other path
// that can fire InitiatePayoutFailover on the same transfer).
func payoutLegLockKey(transferID string) string {
	return "transfers:payout-leg:" + transferID
}

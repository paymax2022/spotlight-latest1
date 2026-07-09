package adminext

// Crowdfunding withdrawal MONEY-PATH (admin approval → payout).
//
// This is the escrow-release leg of the creator cash-out flow. SubmitWithdrawal
// (wallet domain) only files a PENDING request and moves no money; DecideWithdrawal
// (service.go) flips PENDING→APPROVED/REJECTED but still moves no money. This file
// adds the single place where a crowdfunding withdrawal actually posts to the
// finance ledger and drains campaign escrow.
//
// LEDGER MODEL (mirrors internal/finance/settlement):
//   - Contributions escrow money via settlement.Escrow → ledger.Debit(payer) /
//     CREDIT AccountEscrow. So crowdfunding funds live in the AccountEscrow
//     standing account.
//   - A withdrawal pays the creator OUT to a bank (funds LEAVE the platform).
//     The balanced payout leg is therefore:
//         DEBIT  AccountEscrow           (release held campaign funds)
//         CREDIT AccountProviderClearing (stage funds for the payout rail)
//     The bank transfer itself is a separate rail (see TODO(prod) below); until a
//     disbursement provider is wired into this admin surface we post to the
//     clearing account and DO NOT fabricate a provider success.
//
// IRON RULES enforced here:
//   - integer kobo only (BIGINT throughout);
//   - a deterministic idempotency key derived from the withdrawal id makes the
//     whole approval safe to replay (ledger PostJournal + guarded UPDATEs);
//   - a balanced double-entry is posted before the terminal state flip;
//   - an immutable cf_audit_logs row is written in the same tx as the flip;
//   - fail-closed: illegal states are rejected, and a missing ledger dependency
//     refuses to move money rather than silently skipping the posting.

import (
	"context"
	"errors"
	"fmt"

	financeledger "spotlight/backend/internal/finance/ledger"
)

// Withdrawal states (subset of the cf_withdrawals status CHECK constraint that the
// approval money-path cares about). PENDING → APPROVED → COMPLETED is the happy
// path; REJECTED is terminal-dead for approval.
const (
	wStatusPending   = "PENDING"
	wStatusApproved  = "APPROVED"
	wStatusCompleted = "COMPLETED" // terminal PAID state (funds released from escrow)
	wStatusRejected  = "REJECTED"
)

// ErrWithdrawalNotFound is returned when the id resolves to no row.
var ErrWithdrawalNotFound = errors.New("adminext: withdrawal not found")

// ErrWithdrawalIllegalState is returned when the withdrawal cannot be approved
// from its current state (e.g. already REJECTED). Callers map this to 409/400.
var ErrWithdrawalIllegalState = errors.New("adminext: withdrawal is not in an approvable state")

// ErrLedgerUnavailable is returned when the money-path is invoked without a wired
// finance ledger. Fail-closed: we refuse to transition without posting money.
var ErrLedgerUnavailable = errors.New("adminext: finance ledger not configured — cannot approve withdrawal")

// ApproveWithdrawalResult summarises the outcome of an approval.
type ApproveWithdrawalResult struct {
	ID         string `json:"id"`
	Reference  string `json:"reference"`
	Status     string `json:"status"`
	AmountKobo int64  `json:"amountKobo"`
	// Posted reports whether THIS call posted the ledger legs (false on an
	// idempotent replay where the money already moved).
	Posted bool `json:"posted"`
}

// ApproveWithdrawal is the crowdfunding withdrawal money-path.
//
// Guarded + idempotent. It:
//  1. loads the withdrawal; a non-PENDING/APPROVED/COMPLETED state (e.g. REJECTED)
//     is illegal; an already-COMPLETED row is an idempotent no-op;
//  2. posts a BALANCED double-entry via the finance ledger —
//     DEBIT AccountEscrow / CREDIT AccountProviderClearing — for the exact
//     amount_kobo, keyed deterministically on the withdrawal id so a replay posts
//     nothing twice;
//  3. transitions PENDING→APPROVED→COMPLETED with guarded UPDATEs (WHERE status=…);
//  4. writes an immutable cf_audit_logs row in the same tx as the terminal flip.
//
// A nil idempotencyKey/approverID or a missing ledger dependency fails closed
// BEFORE any state change. The ledger posting is idempotent (Redis fast-path +
// DB unique constraint on idempotency_key) so ErrDuplicate on replay is success.
func (s *Service) ApproveWithdrawal(ctx context.Context, withdrawalID, approverID, idempotencyKey string) (*ApproveWithdrawalResult, error) {
	// ── Fail-closed input guards (run before any DB access) ──────────────────
	if withdrawalID == "" {
		return nil, fmt.Errorf("adminext: withdrawal id is required")
	}
	if approverID == "" {
		return nil, fmt.Errorf("adminext: approver id is required")
	}
	if idempotencyKey == "" {
		return nil, fmt.Errorf("adminext: Idempotency-Key is required")
	}
	if s.ledger == nil {
		return nil, ErrLedgerUnavailable
	}

	// ── (1) Load the withdrawal + validate its state ─────────────────────────
	var (
		reference string
		amount    int64
		status    string
	)
	const sel = `SELECT reference, amount_kobo, status FROM cf_withdrawals WHERE id = $1`
	if err := s.db.QueryRow(ctx, sel, withdrawalID).Scan(&reference, &amount, &status); err != nil {
		return nil, ErrWithdrawalNotFound
	}

	// Idempotent no-op: money already released.
	if status == wStatusCompleted {
		return &ApproveWithdrawalResult{
			ID: withdrawalID, Reference: reference, Status: wStatusCompleted,
			AmountKobo: amount, Posted: false,
		}, nil
	}
	// Only PENDING or a mid-flight APPROVED (crash-recovery) may proceed to pay.
	if status != wStatusPending && status != wStatusApproved {
		return nil, fmt.Errorf("%w: %s", ErrWithdrawalIllegalState, status)
	}
	if amount <= 0 {
		return nil, fmt.Errorf("adminext: withdrawal amount must be positive, got %d", amount)
	}

	// ── (2) Post the BALANCED double-entry (money leaves escrow) ─────────────
	// Deterministic key derived from the withdrawal id ⇒ replay posts nothing twice.
	payoutIdem := "cf:withdraw:payout:" + withdrawalID
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, financeledger.AccountEscrow)
	if err != nil {
		return nil, fmt.Errorf("adminext: resolve escrow account: %w", err)
	}
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		return nil, fmt.Errorf("adminext: resolve clearing account: %w", err)
	}
	posted := true
	if err := s.ledger.PostJournal(ctx, financeledger.JournalEntry{
		Reference:       "cf:withdraw:" + reference,
		IdempotencyKey:  payoutIdem,
		AmountKobo:      amount,
		DebitAccountID:  escrowAcc.ID,   // release held campaign funds
		CreditAccountID: clearingAcc.ID, // stage for the payout rail (leaves platform)
	}); err != nil {
		if !errors.Is(err, financeledger.ErrDuplicate) {
			return nil, fmt.Errorf("adminext: post withdrawal payout: %w", err)
		}
		posted = false // already posted on an earlier attempt — safe to continue
	}

	// TODO(prod): trigger payout-rail transfer.
	// Funds are now parked in AccountProviderClearing. A production build must hand
	// this off to a disbursement provider (see internal/provider/disbursement.Registry
	// / internal/finance/transfers) to actually push money to the creator's bank,
	// then reconcile the clearing account on the provider webhook. We deliberately
	// DO NOT fabricate a provider success here.

	// ── (3) Guarded state transitions PENDING→APPROVED→COMPLETED, plus audit ──
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// PENDING → APPROVED (skipped/no-op if already APPROVED from a prior attempt).
	if _, err := tx.Exec(ctx,
		`UPDATE cf_withdrawals SET status=$1 WHERE id=$2 AND status=$3`,
		wStatusApproved, withdrawalID, wStatusPending); err != nil {
		return nil, fmt.Errorf("adminext: approve withdrawal: %w", err)
	}
	// APPROVED → COMPLETED (guarded; funds released from escrow).
	tag, err := tx.Exec(ctx,
		`UPDATE cf_withdrawals SET status=$1 WHERE id=$2 AND status IN ($3,$4)`,
		wStatusCompleted, withdrawalID, wStatusApproved, wStatusPending)
	if err != nil {
		return nil, fmt.Errorf("adminext: complete withdrawal: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Lost a race — re-read; if already COMPLETED, treat as idempotent success.
		var now string
		if err := tx.QueryRow(ctx, `SELECT status FROM cf_withdrawals WHERE id=$1`, withdrawalID).Scan(&now); err == nil && now == wStatusCompleted {
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return &ApproveWithdrawalResult{
				ID: withdrawalID, Reference: reference, Status: wStatusCompleted,
				AmountKobo: amount, Posted: false,
			}, nil
		}
		return nil, fmt.Errorf("%w: concurrent change on %s", ErrWithdrawalIllegalState, withdrawalID)
	}

	// (4) Immutable audit row, committed atomically with the terminal flip.
	if err := s.audit(ctx, tx, approverID, "withdrawal.approve.payout", reference); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &ApproveWithdrawalResult{
		ID: withdrawalID, Reference: reference, Status: wStatusCompleted,
		AmountKobo: amount, Posted: posted,
	}, nil
}

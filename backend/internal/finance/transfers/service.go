package transfers

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/provider"
)

// Service handles wallet-to-wallet and wallet-to-bank transfers.
type Service struct {
	db      *pgxpool.Pool
	ledger  *ledger.Service
	tiers   *tiers.Service
	payment provider.PaymentProvider
}

func NewService(db *pgxpool.Pool, ledgerSvc *ledger.Service, tiersSvc *tiers.Service, payment provider.PaymentProvider) *Service {
	return &Service{db: db, ledger: ledgerSvc, tiers: tiersSvc, payment: payment}
}

// ResolvePaymaxUser returns masked identity for a phone number (wallet-to-wallet recipient lookup).
// Returns ErrRecipientNotFound (→404) when no Paymax user matches the phone.
func (s *Service) ResolvePaymaxUser(ctx context.Context, phone string) (*WalletTransferResolveResponse, error) {
	if strings.TrimSpace(phone) == "" {
		return nil, ErrRecipientNotFound
	}
	const q = `SELECT id, full_name, phone FROM user_profiles WHERE phone = $1 LIMIT 1`
	var id, fullName, rawPhone string
	if err := s.db.QueryRow(ctx, q, phone).Scan(&id, &fullName, &rawPhone); err != nil {
		// No row (or any lookup failure) → recipient not found, fail closed.
		return nil, ErrRecipientNotFound
	}
	return &WalletTransferResolveResponse{
		UserID:      id,
		FullName:    fullName,
		MaskedPhone: MaskPhone(rawPhone),
	}, nil
}

// InitiateWalletToWallet executes a wallet-to-wallet transfer atomically via
// the transfer_wallet_atomic() Supabase RPC (mirrors block-10 logic).
func (s *Service) InitiateWalletToWallet(ctx context.Context, senderID string, req WalletTransferRequest) (*WalletTransfer, error) {
	// DB-free pre-flight: Idempotency-Key required, positive kobo amount, phone present.
	if err := ValidateWalletTransferRequest(req); err != nil {
		return nil, err
	}

	// Resolve recipient (returns ErrRecipientNotFound → 404 on miss).
	recipient, err := s.ResolvePaymaxUser(ctx, req.RecipientPhone)
	if err != nil {
		return nil, err
	}
	if recipient.UserID == senderID {
		return nil, ErrSelfTransfer // → 422
	}

	// Tier guard (fail-closed): Tier 0 → ErrWalletDisabled (403),
	// over daily cap → ErrDailyLimitExceeded (403).
	if err := s.tiers.EnforceWalletDebitLimit(ctx, senderID, req.AmountKobo); err != nil {
		return nil, err
	}

	fee := WalletTransferFee(req.AmountKobo)
	reference := "ww-" + uuid.New().String()

	// Idempotency replay: same key already processed → return the prior result
	// flagged AlreadyProcessed, no second debit/credit.
	var existingID string
	const checkDup = `SELECT id FROM wallet_transfers WHERE idempotency_key = $1 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, req.IdempotencyKey).Scan(&existingID)
	if existingID != "" {
		wt, err := s.getWalletTransfer(ctx, existingID)
		if err != nil {
			return nil, err
		}
		wt.AlreadyProcessed = true
		return wt, nil
	}

	// Use pgx transaction + advisory lock (mirrors transfer_wallet_atomic RPC).
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("transfers: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Advisory lock on sender's account.
	const lock = `SELECT pg_advisory_xact_lock(hashtext($1))`
	if _, err := tx.Exec(ctx, lock, "wallet:"+senderID); err != nil {
		return nil, fmt.Errorf("transfers: advisory lock: %w", err)
	}

	// Balance check.
	senderBalance, err := s.ledger.GetBalance(ctx, senderID)
	if err != nil {
		return nil, err
	}
	total := req.AmountKobo + fee
	if senderBalance < total {
		return nil, ledger.ErrInsufficientFunds
	}

	// Post ledger entries.
	senderAcc, err := s.ledger.GetOrCreateUserWallet(ctx, senderID)
	if err != nil {
		return nil, err
	}
	recipientAcc, err := s.ledger.GetOrCreateUserWallet(ctx, recipient.UserID)
	if err != nil {
		return nil, err
	}
	revenueAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return nil, err
	}

	// Debit sender (amount + fee).
	const insertEntry = `INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key) VALUES ($1, $2, $3, $4, $5)`
	if _, err := tx.Exec(ctx, insertEntry, senderAcc.ID, "DEBIT", total, reference, req.IdempotencyKey+":debit"); err != nil {
		return nil, fmt.Errorf("transfers: debit sender: %w", err)
	}
	// Credit recipient.
	if _, err := tx.Exec(ctx, insertEntry, recipientAcc.ID, "CREDIT", req.AmountKobo, reference, req.IdempotencyKey+":credit"); err != nil {
		return nil, fmt.Errorf("transfers: credit recipient: %w", err)
	}
	// Credit fee to revenue.
	if fee > 0 {
		if _, err := tx.Exec(ctx, insertEntry, revenueAcc.ID, "CREDIT", fee, reference, req.IdempotencyKey+":fee"); err != nil {
			return nil, fmt.Errorf("transfers: credit fee: %w", err)
		}
	}

	// Insert wallet_transfers row.
	const insertTx = `
		INSERT INTO wallet_transfers (sender_id, recipient_id, amount_kobo, fee_kobo, reference, status, idempotency_key)
		VALUES ($1, $2, $3, $4, $5, 'successful', $6)
		RETURNING id, created_at`
	wt := &WalletTransfer{
		SenderID:       senderID,
		RecipientID:    recipient.UserID,
		AmountKobo:     req.AmountKobo,
		FeeKobo:        fee,
		Reference:      reference,
		Status:         WalletTransferSuccessful,
		IdempotencyKey: req.IdempotencyKey,
	}
	if err := tx.QueryRow(ctx, insertTx, senderID, recipient.UserID, req.AmountKobo, fee, reference, req.IdempotencyKey).
		Scan(&wt.ID, &wt.CreatedAt); err != nil {
		return nil, fmt.Errorf("transfers: insert wallet_transfers: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("transfers: commit: %w", err)
	}
	return wt, nil
}

// InitiateBankTransfer reserves funds and initiates a Paystack bank transfer.
func (s *Service) InitiateBankTransfer(ctx context.Context, userID string, req BankTransferRequest) (*BankTransfer, error) {
	// DB-free pre-flight: Idempotency-Key required, positive amount, NUBAN shape.
	if err := ValidateBankTransferRequest(req); err != nil {
		return nil, err
	}

	// Idempotency replay: same key already processed → return prior result,
	// no second debit. Prevents double-debit on retry.
	var existingID string
	const checkDup = `SELECT id FROM bank_transfers WHERE idempotency_key = $1 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, req.IdempotencyKey).Scan(&existingID)
	if existingID != "" {
		bt, err := s.getBankTransfer(ctx, existingID)
		if err != nil {
			return nil, err
		}
		bt.AlreadyProcessed = true
		return bt, nil
	}

	// Tier guard (fail-closed): Tier 0 → 403, over daily cap → 403.
	if err := s.tiers.EnforceWalletDebitLimit(ctx, userID, req.AmountKobo); err != nil {
		return nil, err
	}

	fee := BankTransferFee(req.AmountKobo)
	total := req.AmountKobo + fee
	reference := "bt-" + time.Now().Format("20060102150405") + "-" + uuid.New().String()[:8]

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("bank_transfer: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Advisory lock.
	const lock = `SELECT pg_advisory_xact_lock(hashtext($1))`
	if _, err := tx.Exec(ctx, lock, "wallet:"+userID); err != nil {
		return nil, fmt.Errorf("bank_transfer: advisory lock: %w", err)
	}

	// Balance check.
	balance, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, err
	}
	if balance < total {
		return nil, ledger.ErrInsufficientFunds
	}

	// Debit from user wallet.
	userAcc, err := s.ledger.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return nil, err
	}
	suspenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		return nil, err
	}

	const insertEntry = `INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key) VALUES ($1, $2, $3, $4, $5)`
	if _, err := tx.Exec(ctx, insertEntry, userAcc.ID, "DEBIT", total, reference, req.IdempotencyKey+":debit"); err != nil {
		return nil, fmt.Errorf("bank_transfer: debit user: %w", err)
	}
	// Credit suspense (holds funds until provider confirms).
	if _, err := tx.Exec(ctx, insertEntry, suspenseAcc.ID, "CREDIT", total, reference, req.IdempotencyKey+":suspense"); err != nil {
		return nil, fmt.Errorf("bank_transfer: credit suspense: %w", err)
	}

	const insertBT = `
		INSERT INTO bank_transfers (user_id, amount_kobo, fee_kobo, account_number, bank_code, reference, status, idempotency_key)
		VALUES ($1, $2, $3, $4, $5, $6, 'funds_reserved', $7)
		RETURNING id, created_at`
	bt := &BankTransfer{
		UserID:         userID,
		AmountKobo:     req.AmountKobo,
		FeeKobo:        fee,
		AccountNumber:  req.AccountNumber,
		BankCode:       req.BankCode,
		Reference:      reference,
		Status:         BankTransferFundsReserved,
		IdempotencyKey: req.IdempotencyKey,
	}
	if err := tx.QueryRow(ctx, insertBT,
		userID, req.AmountKobo, fee, req.AccountNumber, req.BankCode, reference, req.IdempotencyKey,
	).Scan(&bt.ID, &bt.CreatedAt); err != nil {
		return nil, fmt.Errorf("bank_transfer: insert: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("bank_transfer: commit: %w", err)
	}

	return bt, nil
}

func (s *Service) getWalletTransfer(ctx context.Context, id string) (*WalletTransfer, error) {
	const q = `SELECT id, sender_id, recipient_id, amount_kobo, fee_kobo, reference, status, idempotency_key, created_at FROM wallet_transfers WHERE id=$1`
	wt := &WalletTransfer{}
	var status string
	err := s.db.QueryRow(ctx, q, id).Scan(&wt.ID, &wt.SenderID, &wt.RecipientID, &wt.AmountKobo, &wt.FeeKobo, &wt.Reference, &status, &wt.IdempotencyKey, &wt.CreatedAt)
	wt.Status = WalletTransferStatus(status)
	return wt, err
}

func (s *Service) getBankTransfer(ctx context.Context, id string) (*BankTransfer, error) {
	const q = `SELECT id, user_id, amount_kobo, fee_kobo, account_number, bank_code, reference, status, idempotency_key, created_at FROM bank_transfers WHERE id=$1`
	bt := &BankTransfer{}
	var status string
	err := s.db.QueryRow(ctx, q, id).Scan(&bt.ID, &bt.UserID, &bt.AmountKobo, &bt.FeeKobo, &bt.AccountNumber, &bt.BankCode, &bt.Reference, &status, &bt.IdempotencyKey, &bt.CreatedAt)
	bt.Status = BankTransferStatus(status)
	return bt, err
}

// HandleWebhook processes a Paystack transfer webhook (success / failed / reversed).
// It updates bank_transfers.status and, on failure/reversal, posts a correcting
// credit ledger entry to return funds from the suspense account to the user wallet.
func (s *Service) HandleWebhook(ctx context.Context, reference, newStatus string, amountKobo int64) error {
	const getQ = `SELECT id, user_id, amount_kobo, fee_kobo, status, idempotency_key FROM bank_transfers WHERE reference = $1 LIMIT 1`
	bt := &BankTransfer{}
	var curStatus string
	err := s.db.QueryRow(ctx, getQ, reference).Scan(&bt.ID, &bt.UserID, &bt.AmountKobo, &bt.FeeKobo, &curStatus, &bt.IdempotencyKey)
	if err != nil {
		// Unknown reference — not our transfer; ignore idempotently.
		return nil
	}

	// Map provider status → internal enum + whether it releases reserved funds.
	next, releasesFunds, known := ClassifyWebhookStatus(newStatus)
	if !known {
		return nil // status we don't act on; safe no-op
	}
	if BankTransferStatus(curStatus) == next {
		return nil // duplicate webhook — already applied; idempotent no-op
	}

	const upQ = `UPDATE bank_transfers SET status = $1 WHERE id = $2`
	if _, err := s.db.Exec(ctx, upQ, string(next), bt.ID); err != nil {
		return fmt.Errorf("transfers webhook: update status: %w", err)
	}

	// On failure/reversal, restore the reserved amount to the user wallet via a
	// REVERSAL_DEBIT correction (never a fresh CREDIT, never a balance UPDATE).
	if releasesFunds {
		userAcc, err := s.ledger.GetOrCreateUserWallet(ctx, bt.UserID)
		if err != nil {
			return fmt.Errorf("transfers webhook: get user wallet: %w", err)
		}
		suspenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
		if err != nil {
			return fmt.Errorf("transfers webhook: get suspense: %w", err)
		}
		rev := BuildReversalEntry(reference, userAcc.ID, suspenseAcc.ID, bt.AmountKobo+bt.FeeKobo, bt.IdempotencyKey, next)
		// restoreAccountID = user wallet (REVERSAL_DEBIT, +balance);
		// releaseAccountID = suspense hold (REVERSAL_CREDIT).
		if err := s.ledger.PostReversal(ctx, rev.UserAccountID, rev.SuspenseAccountID, rev.AmountKobo, rev.Reference, rev.IdempotencyKey); err != nil {
			// A duplicate reversal (concurrent webhook) is benign — the ledger
			// unique constraint already holds the funds-restored invariant.
			if err == ledger.ErrDuplicate {
				return nil
			}
			return fmt.Errorf("transfers webhook: post reversal ledger: %w", err)
		}
	}
	return nil
}

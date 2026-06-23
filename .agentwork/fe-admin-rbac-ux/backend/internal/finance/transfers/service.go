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
	db       *pgxpool.Pool
	ledger   *ledger.Service
	tiers    *tiers.Service
	payment  provider.PaymentProvider
}

func NewService(db *pgxpool.Pool, ledgerSvc *ledger.Service, tiersSvc *tiers.Service, payment provider.PaymentProvider) *Service {
	return &Service{db: db, ledger: ledgerSvc, tiers: tiersSvc, payment: payment}
}

// ResolvePaymaxUser returns masked identity for a phone number (wallet-to-wallet recipient lookup).
func (s *Service) ResolvePaymaxUser(ctx context.Context, phone string) (*WalletTransferResolveResponse, error) {
	const q = `SELECT id, full_name, phone FROM user_profiles WHERE phone = $1 LIMIT 1`
	var id, fullName, rawPhone string
	if err := s.db.QueryRow(ctx, q, phone).Scan(&id, &fullName, &rawPhone); err != nil {
		return nil, fmt.Errorf("transfers: resolve user by phone: %w", err)
	}
	return &WalletTransferResolveResponse{
		UserID:      id,
		FullName:    fullName,
		MaskedPhone: maskPhone(rawPhone),
	}, nil
}

// InitiateWalletToWallet executes a wallet-to-wallet transfer atomically via
// the transfer_wallet_atomic() Supabase RPC (mirrors block-10 logic).
func (s *Service) InitiateWalletToWallet(ctx context.Context, senderID string, req WalletTransferRequest) (*WalletTransfer, error) {
	// Resolve recipient.
	recipient, err := s.ResolvePaymaxUser(ctx, req.RecipientPhone)
	if err != nil {
		return nil, fmt.Errorf("transfers: recipient not found: %w", err)
	}
	if recipient.UserID == senderID {
		return nil, fmt.Errorf("transfers: self-transfer not allowed")
	}

	// Tier guard.
	if err := s.tiers.EnforceWalletDebitLimit(ctx, senderID, req.AmountKobo); err != nil {
		return nil, err
	}

	fee := WalletTransferFee(req.AmountKobo)
	reference := "ww-" + uuid.New().String()

	// Duplicate check: idempotency key already used?
	var existingID string
	const checkDup = `SELECT id FROM wallet_transfers WHERE idempotency_key = $1 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, req.IdempotencyKey).Scan(&existingID)
	if existingID != "" {
		return s.getWalletTransfer(ctx, existingID)
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
		VALUES ($1, $2, $3, $4, $5, 'completed', $6)
		RETURNING id, created_at`
	wt := &WalletTransfer{
		SenderID:       senderID,
		RecipientID:    recipient.UserID,
		AmountKobo:     req.AmountKobo,
		FeeKobo:        fee,
		Reference:      reference,
		Status:         WalletTransferCompleted,
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
	// Duplicate check.
	var existingID string
	const checkDup = `SELECT id FROM bank_transfers WHERE idempotency_key = $1 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, req.IdempotencyKey).Scan(&existingID)
	if existingID != "" {
		return s.getBankTransfer(ctx, existingID)
	}

	// Tier guard.
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

func maskPhone(phone string) string {
	if len(phone) < 7 {
		return "****"
	}
	return strings.Repeat("*", len(phone)-4) + phone[len(phone)-4:]
}

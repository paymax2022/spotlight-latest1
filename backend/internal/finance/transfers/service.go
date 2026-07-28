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
	"spotlight/backend/internal/provider/disbursement"
)

// Service handles wallet-to-wallet, wallet-to-bank, and bank-to-bank transfers.
type Service struct {
	db       *pgxpool.Pool
	ledger   *ledger.Service
	tiers    *tiers.Service
	payment  provider.PaymentProvider
	registry *disbursement.Registry // multi-provider payout (nil = bank routes degraded)
	pins     *pinStore
}

// NewService builds the transfers service. registry may be nil (e.g. REST-only or
// no providers configured) — bank routes then fail closed with ErrProviderUnavailable.
func NewService(db *pgxpool.Pool, ledgerSvc *ledger.Service, tiersSvc *tiers.Service, payment provider.PaymentProvider, registry *disbursement.Registry) *Service {
	return &Service{
		db:       db,
		ledger:   ledgerSvc,
		tiers:    tiersSvc,
		payment:  payment,
		registry: registry,
		pins:     newPinStore(db),
	}
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

// InitiateBankTransfer reserves funds (DR wallet amount+fee → CR suspense) and
// initiates a multi-provider bank payout with auto-failover. On provider error
// the funds stay reserved (never lost). Requires a verified transaction PIN.
func (s *Service) InitiateBankTransfer(ctx context.Context, userID string, req BankTransferRequest) (*BankTransfer, error) {
	// DB-free pre-flight: Idempotency-Key required, positive amount, NUBAN shape.
	if err := ValidateBankTransferRequest(req); err != nil {
		return nil, err
	}
	if s.registry == nil {
		return nil, ErrProviderUnavailable
	}

	// Idempotency replay: same key already processed → return prior result.
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

	// Transaction PIN (second factor) — fail-closed before any money movement.
	if err := s.pins.Verify(ctx, userID, req.PIN); err != nil {
		return nil, err
	}

	// Tier guard (fail-closed): Tier 0 → 403, over daily cap → 403.
	if err := s.tiers.EnforceWalletDebitLimit(ctx, userID, req.AmountKobo); err != nil {
		return nil, err
	}

	fee := BankTransferFee(req.AmountKobo)
	total := req.AmountKobo + fee
	reference := "bt-" + time.Now().Format("20060102150405") + "-" + uuid.New().String()[:8]

	// Resolve account name + a usable recipient code BEFORE reserving funds: the
	// bank_transfers row requires bank_name/account_name/account_number_last4/
	// paystack_recipient_code NOT NULL. This is read-only (no money moves yet).
	accName, _, _ := s.registry.ResolveAccountFailover(ctx, req.Provider, req.BankCode, req.AccountNumber)
	accountName := "UNRESOLVED"
	if accName != nil && accName.AccountName != "" {
		accountName = accName.AccountName
	}
	bankName := s.bankName(ctx, req.BankCode)

	// --- Reserve leg: DR user_wallet (amount+fee) → CR failed_transfer_suspense ---
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("bank_transfer: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const lock = `SELECT pg_advisory_xact_lock(hashtext($1))`
	if _, err := tx.Exec(ctx, lock, "wallet:"+userID); err != nil {
		return nil, fmt.Errorf("bank_transfer: advisory lock: %w", err)
	}

	balance, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, err
	}
	if balance < total {
		return nil, ledger.ErrInsufficientFunds
	}

	userAcc, err := s.ledger.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return nil, err
	}
	suspenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		return nil, err
	}

	const insertEntry = `INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key) VALUES ($1, $2, $3, $4, $5)`
	if _, err := tx.Exec(ctx, insertEntry, userAcc.ID, "DEBIT", total, reference, LegKey(req.IdempotencyKey, "debit")); err != nil {
		return nil, fmt.Errorf("bank_transfer: debit user: %w", err)
	}
	if _, err := tx.Exec(ctx, insertEntry, suspenseAcc.ID, "CREDIT", total, reference, LegKey(req.IdempotencyKey, "suspense")); err != nil {
		return nil, fmt.Errorf("bank_transfer: credit suspense: %w", err)
	}

	last4 := req.AccountNumber
	if len(last4) > 4 {
		last4 = last4[len(last4)-4:]
	}
	const insertBT = `
		INSERT INTO bank_transfers
			(user_id, amount_kobo, fee_kobo, bank_code, bank_name, account_number_last4, account_name,
			 paystack_recipient_code, reference, status, idempotency_key, source_type, provider)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'funds_reserved',$10,'wallet',$11)
		RETURNING id, created_at`
	bt := &BankTransfer{
		UserID:         userID,
		AmountKobo:     req.AmountKobo,
		FeeKobo:        fee,
		AccountNumber:  req.AccountNumber,
		AccountName:    accountName,
		BankCode:       req.BankCode,
		Reference:      reference,
		Status:         BankTransferFundsReserved,
		IdempotencyKey: req.IdempotencyKey,
		SourceType:     string(SourceWallet),
		Provider:       defaultStr(req.Provider, s.registry.Default()),
	}
	// paystack_recipient_code is still NOT NULL on the base table — seed with a
	// placeholder; the real provider recipient code lands on the disburse leg.
	if err := tx.QueryRow(ctx, insertBT,
		userID, req.AmountKobo, fee, req.BankCode, bankName, last4, accountName,
		"pending", reference, req.IdempotencyKey, bt.Provider,
	).Scan(&bt.ID, &bt.CreatedAt); err != nil {
		return nil, fmt.Errorf("bank_transfer: insert: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("bank_transfer: commit: %w", err)
	}
	s.audit(ctx, userID, "transfer.bank.reserve", bt.ID, reference)

	// --- Disburse leg: provider recipient + payout with auto-failover ---
	// On any provider error we DO NOT roll back the reserve — funds stay parked in
	// suspense (status funds_reserved) for retry/reconciliation. Never double-spend.
	s.initiatePayoutLeg(ctx, bt, req.SaveBeneficiary, req.Provider, req.Narration)
	return bt, nil
}

// initiatePayoutLeg resolves a recipient (reusing cached codes), creates one with
// the provider when missing, calls the registry payout with failover, and on
// success persists the provider routing fields + advances to provider_initiated.
// On error the transfer is left in its reserved/funded hold state.
func (s *Service) initiatePayoutLeg(ctx context.Context, bt *BankTransfer, saveBeneficiary bool, preferred, narration string) {
	if s.registry == nil {
		return
	}
	accName := bt.AccountName
	if accName == "" || accName == "UNRESOLVED" {
		if res, _, err := s.registry.ResolveAccountFailover(ctx, preferred, bt.BankCode, bt.AccountNumber); err == nil && res != nil {
			accName = res.AccountName
		}
	}
	// Cached recipient codes per provider for this destination.
	cached := s.cachedRecipients(ctx, bt.UserID, bt.BankCode, bt.AccountNumber)

	result, err := s.registry.InitiatePayoutFailover(ctx, preferred,
		provider.RecipientRequest{AccountName: accName, AccountNumber: bt.AccountNumber, BankCode: bt.BankCode, Currency: "NGN"},
		cached, bt.AmountKobo, bt.Reference, narration)
	if err != nil {
		// Hold funds; a later retry / admin retry resolves it.
		s.audit(ctx, bt.UserID, "transfer.bank.provider_error", bt.ID, err.Error())
		return
	}

	// Persist provider routing + advance status.
	const up = `
		UPDATE bank_transfers
		SET status='provider_initiated', provider=$2, provider_recipient_code=$3,
		    provider_transfer_ref=$4, provider_transfer_code=$4, failover_from=$5,
		    account_name=COALESCE(NULLIF($6,''), account_name)
		WHERE id=$1`
	var failoverFrom *string
	if result.FailoverFrom != "" {
		failoverFrom = &result.FailoverFrom
	}
	_, _ = s.db.Exec(ctx, up, bt.ID, result.Provider, result.RecipientCode, result.Response.ProviderRef, failoverFrom, accName)
	bt.Status = BankTransferProviderInitiated
	bt.Provider = result.Provider
	bt.ProviderRecipientCode = &result.RecipientCode
	pref := result.Response.ProviderRef
	bt.ProviderTransferRef = &pref
	bt.FailoverFrom = failoverFrom
	if accName != "" {
		bt.AccountName = accName
	}

	// Cache the recipient code for reuse + save beneficiary when requested.
	if accName != "" {
		s.cacheRecipient(ctx, bt.UserID, result.Provider, bt.BankCode, bt.AccountNumber, accName, result.RecipientCode)
	}
	if saveBeneficiary && accName != "" {
		s.saveBeneficiaryRow(ctx, bt.UserID, result.Provider, bt.BankCode, bt.AccountNumber, accName, result.RecipientCode)
	}
	s.audit(ctx, bt.UserID, "transfer.bank.provider_initiated", bt.ID, result.Provider)
}

// InitiateBankToBank creates a bank→bank pass-through at awaiting_funding with a
// provider collection (funding_reference). The funding webhook later marks it
// funded (DR provider_clearing(amount+fee) → CR suspense) and auto-initiates the
// payout leg. Requires a verified transaction PIN.
func (s *Service) InitiateBankToBank(ctx context.Context, userID string, req BankToBankRequest) (*BankTransfer, error) {
	if strings.TrimSpace(req.IdempotencyKey) == "" {
		return nil, ErrMissingIdempotencyKey
	}
	if req.AmountKobo <= 0 {
		return nil, ErrInvalidAmount
	}
	if !looksLikeNUBAN(req.AccountNumber) || strings.TrimSpace(req.BankCode) == "" {
		return nil, ErrInvalidAccount
	}
	if s.registry == nil {
		return nil, ErrProviderUnavailable
	}

	// Idempotency replay.
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

	// Transaction PIN — fail-closed.
	if err := s.pins.Verify(ctx, userID, req.PIN); err != nil {
		return nil, err
	}

	fee := BankTransferFee(req.AmountKobo)
	reference := "btb-" + time.Now().Format("20060102150405") + "-" + uuid.New().String()[:8]
	fundingRef := "fund-" + reference

	res, _, _ := s.registry.ResolveAccountFailover(ctx, req.Provider, req.BankCode, req.AccountNumber)
	accountName := "UNRESOLVED"
	if res != nil && res.AccountName != "" {
		accountName = res.AccountName
	}
	bankName := s.bankName(ctx, req.BankCode)
	last4 := req.AccountNumber
	if len(last4) > 4 {
		last4 = last4[len(last4)-4:]
	}

	// No wallet debit here — the user pays in through the provider. We create the
	// row at awaiting_funding with a collection funding_reference. No ledger entry
	// is posted until the collection settles (funded webhook).
	const insertBT = `
		INSERT INTO bank_transfers
			(user_id, amount_kobo, fee_kobo, bank_code, bank_name, account_number_last4, account_name,
			 paystack_recipient_code, reference, status, idempotency_key, source_type, provider,
			 funding_reference, funding_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'awaiting_funding',$10,'bank',$11,$12,'pending')
		RETURNING id, created_at`
	bt := &BankTransfer{
		UserID:         userID,
		AmountKobo:     req.AmountKobo,
		FeeKobo:        fee,
		AccountNumber:  req.AccountNumber,
		AccountName:    accountName,
		BankCode:       req.BankCode,
		Reference:      reference,
		Status:         BankTransferAwaitingFunding,
		IdempotencyKey: req.IdempotencyKey,
		SourceType:     string(SourceBank),
		Provider:       defaultStr(req.Provider, s.registry.Default()),
	}
	fr := fundingRef
	bt.FundingReference = &fr
	if err := s.db.QueryRow(ctx, insertBT,
		userID, req.AmountKobo, fee, req.BankCode, bankName, last4, accountName,
		"pending", reference, req.IdempotencyKey, bt.Provider, fundingRef,
	).Scan(&bt.ID, &bt.CreatedAt); err != nil {
		return nil, fmt.Errorf("bank_to_bank: insert: %w", err)
	}
	s.audit(ctx, userID, "transfer.bank_to_bank.awaiting_funding", bt.ID, fundingRef)
	return bt, nil
}

// markFunded handles a funding (collection) webhook for a bank→bank transfer:
// posts DR provider_clearing(amount+fee) → CR suspense, advances to funded, then
// auto-initiates the payout leg from suspense (same as wallet→bank). Idempotent.
func (s *Service) markFunded(ctx context.Context, bt *BankTransfer, curStatus BankTransferStatus) error {
	if !CanAdvanceBankToBank(curStatus, BankTransferFunded) {
		return nil // illegal/duplicate transition — no-op
	}
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return fmt.Errorf("bank_to_bank funded: clearing acct: %w", err)
	}
	suspenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		return fmt.Errorf("bank_to_bank funded: suspense acct: %w", err)
	}
	total := bt.AmountKobo + bt.FeeKobo
	// DR provider_clearing → CR suspense (the collected money is parked for payout).
	if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       bt.Reference,
		IdempotencyKey:  LegKey(bt.IdempotencyKey, LegFund),
		AmountKobo:      total,
		DebitAccountID:  clearingAcc.ID,
		CreditAccountID: suspenseAcc.ID,
	}); err != nil && err != ledger.ErrDuplicate {
		return fmt.Errorf("bank_to_bank funded: post journal: %w", err)
	}
	const up = `UPDATE bank_transfers SET status='funded', funding_status='successful' WHERE id=$1 AND status='awaiting_funding'`
	if _, err := s.db.Exec(ctx, up, bt.ID); err != nil {
		return fmt.Errorf("bank_to_bank funded: update: %w", err)
	}
	bt.Status = BankTransferFunded
	s.audit(ctx, bt.UserID, "transfer.bank_to_bank.funded", bt.ID, bt.Reference)
	// Auto-initiate the payout leg (mirrors wallet→bank disburse from suspense).
	s.initiatePayoutLeg(ctx, bt, false, bt.Provider, "")
	return nil
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
	const q = `
		SELECT id, user_id, amount_kobo, fee_kobo, account_number_last4, account_name, bank_code,
		       reference, status, idempotency_key, provider, source_type,
		       provider_recipient_code, provider_transfer_ref, failover_from,
		       funding_reference, funding_status, created_at
		FROM bank_transfers WHERE id=$1`
	return s.scanBankTransfer(s.db.QueryRow(ctx, q, id))
}

func (s *Service) getBankTransferByRef(ctx context.Context, reference string) (*BankTransfer, error) {
	const q = `
		SELECT id, user_id, amount_kobo, fee_kobo, account_number_last4, account_name, bank_code,
		       reference, status, idempotency_key, provider, source_type,
		       provider_recipient_code, provider_transfer_ref, failover_from,
		       funding_reference, funding_status, created_at
		FROM bank_transfers WHERE reference=$1 LIMIT 1`
	return s.scanBankTransfer(s.db.QueryRow(ctx, q, reference))
}

func (s *Service) getBankTransferByProviderRef(ctx context.Context, providerRef string) (*BankTransfer, error) {
	const q = `
		SELECT id, user_id, amount_kobo, fee_kobo, account_number_last4, account_name, bank_code,
		       reference, status, idempotency_key, provider, source_type,
		       provider_recipient_code, provider_transfer_ref, failover_from,
		       funding_reference, funding_status, created_at
		FROM bank_transfers WHERE provider_transfer_ref=$1 LIMIT 1`
	return s.scanBankTransfer(s.db.QueryRow(ctx, q, providerRef))
}

func (s *Service) getBankTransferByFundingRef(ctx context.Context, fundingRef string) (*BankTransfer, error) {
	const q = `
		SELECT id, user_id, amount_kobo, fee_kobo, account_number_last4, account_name, bank_code,
		       reference, status, idempotency_key, provider, source_type,
		       provider_recipient_code, provider_transfer_ref, failover_from,
		       funding_reference, funding_status, created_at
		FROM bank_transfers WHERE funding_reference=$1 LIMIT 1`
	return s.scanBankTransfer(s.db.QueryRow(ctx, q, fundingRef))
}

type rowScanner interface {
	Scan(dest ...any) error
}

func (s *Service) scanBankTransfer(row rowScanner) (*BankTransfer, error) {
	bt := &BankTransfer{}
	var status string
	err := row.Scan(&bt.ID, &bt.UserID, &bt.AmountKobo, &bt.FeeKobo, &bt.AccountNumber, &bt.AccountName, &bt.BankCode,
		&bt.Reference, &status, &bt.IdempotencyKey, &bt.Provider, &bt.SourceType,
		&bt.ProviderRecipientCode, &bt.ProviderTransferRef, &bt.FailoverFrom,
		&bt.FundingReference, &bt.FundingStatus, &bt.CreatedAt)
	bt.Status = BankTransferStatus(status)
	return bt, err
}

// HandleWebhook is the legacy entrypoint kept for the Paystack handler that passes
// a (reference, status) pair. It routes to the unified settlement path.
func (s *Service) HandleWebhook(ctx context.Context, reference, newStatus string, amountKobo int64) error {
	bt, err := s.getBankTransferByRef(ctx, reference)
	if err != nil {
		// Try provider_transfer_ref (Paystack routes by transfer_code).
		bt, err = s.getBankTransferByProviderRef(ctx, reference)
		if err != nil {
			return nil // unknown — idempotent ignore
		}
	}
	next, _, known := ClassifyWebhookStatus(newStatus)
	if !known {
		return nil
	}
	return s.settleTransfer(ctx, bt, next)
}

// HandleProviderWebhook is the unified, provider-routed webhook entrypoint. It is
// keyed by provider_transfer_ref (transfer leg) or funding_reference (collection
// leg) so both providers settle through the same path. Duplicate webhooks are
// benign no-ops (status guard + ledger unique constraint).
func (s *Service) HandleProviderWebhook(ctx context.Context, ev *provider.WebhookEvent) error {
	if ev == nil {
		return nil
	}
	// Collection (funding) leg for bank→bank.
	if ev.Type == "collection" {
		bt, err := s.getBankTransferByFundingRef(ctx, ev.ProviderRef)
		if err != nil {
			if bt, err = s.getBankTransferByFundingRef(ctx, ev.Reference); err != nil {
				return nil
			}
		}
		if ev.Status != "successful" {
			return nil // only a successful collection funds the transfer
		}
		return s.markFunded(ctx, bt, bt.Status)
	}
	// Transfer (disbursement) leg.
	bt, err := s.getBankTransferByProviderRef(ctx, ev.ProviderRef)
	if err != nil {
		if bt, err = s.getBankTransferByRef(ctx, ev.Reference); err != nil {
			return nil
		}
	}
	next, _, known := ClassifyWebhookStatus(ev.Status)
	if !known {
		return nil
	}
	return s.settleTransfer(ctx, bt, next)
}

// settleTransfer applies the terminal disbursement outcome:
//   - successful: sweep DR suspense(amount) → CR settlement, and
//     DR suspense(fee) → CR paymax_revenue (fee recognition).
//   - failed/reversed: reverse the hold back to the source — REVERSAL_DEBIT to the
//     user wallet (wallet-src) or to provider_clearing (bank-src refund).
//
// All legs use per-leg idempotency keys, so a duplicate webhook is a no-op.
func (s *Service) settleTransfer(ctx context.Context, bt *BankTransfer, next BankTransferStatus) error {
	if bt.Status == next {
		return nil // duplicate — already applied
	}
	// Don't move backwards from a terminal state.
	if bt.Status == BankTransferSuccessful || bt.Status == BankTransferFailed || bt.Status == BankTransferReversed {
		return nil
	}

	suspenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		return fmt.Errorf("settle: suspense acct: %w", err)
	}

	switch next {
	case BankTransferSuccessful:
		settlementAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
		if err != nil {
			return fmt.Errorf("settle: settlement acct: %w", err)
		}
		// Sweep the amount: DR suspense → CR settlement (money has left the building).
		if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       bt.Reference,
			IdempotencyKey:  LegKey(bt.IdempotencyKey, LegSettle),
			AmountKobo:      bt.AmountKobo,
			DebitAccountID:  suspenseAcc.ID,
			CreditAccountID: settlementAcc.ID,
		}); err != nil && err != ledger.ErrDuplicate {
			return fmt.Errorf("settle: sweep amount: %w", err)
		}
		// Recognize the fee: DR suspense(fee) → CR paymax_revenue.
		if bt.FeeKobo > 0 {
			revenueAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
			if err != nil {
				return fmt.Errorf("settle: revenue acct: %w", err)
			}
			if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
				Reference:       bt.Reference,
				IdempotencyKey:  LegKey(bt.IdempotencyKey, LegFeeRev),
				AmountKobo:      bt.FeeKobo,
				DebitAccountID:  suspenseAcc.ID,
				CreditAccountID: revenueAcc.ID,
			}); err != nil && err != ledger.ErrDuplicate {
				return fmt.Errorf("settle: recognize fee: %w", err)
			}
		}

	case BankTransferFailed, BankTransferReversed:
		// Reverse the hold back to the source: REVERSAL_DEBIT to the restore account,
		// REVERSAL_CREDIT draining suspense.
		var restoreAcc *ledger.Account
		if SourceType(bt.SourceType) == SourceBank {
			// bank→bank: refund to provider_clearing (the money came from a collection).
			restoreAcc, err = s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
		} else {
			// wallet→bank: restore to the user wallet.
			restoreAcc, err = s.ledger.GetOrCreateUserWallet(ctx, bt.UserID)
		}
		if err != nil {
			return fmt.Errorf("settle: restore acct: %w", err)
		}
		rev := BuildReversalEntry(bt.Reference, restoreAcc.ID, suspenseAcc.ID, bt.AmountKobo+bt.FeeKobo, bt.IdempotencyKey, next)
		if err := s.ledger.PostReversal(ctx, rev.UserAccountID, rev.SuspenseAccountID, rev.AmountKobo, rev.Reference, rev.IdempotencyKey); err != nil {
			if err == ledger.ErrDuplicate {
				// fall through to the status update (idempotent)
			} else {
				return fmt.Errorf("settle: post reversal: %w", err)
			}
		}
	default:
		return nil
	}

	const upQ = `UPDATE bank_transfers SET status=$1 WHERE id=$2`
	if _, err := s.db.Exec(ctx, upQ, string(next), bt.ID); err != nil {
		return fmt.Errorf("settle: update status: %w", err)
	}
	bt.Status = next
	s.audit(ctx, bt.UserID, "transfer.bank.settle."+string(next), bt.ID, bt.Reference)
	return nil
}

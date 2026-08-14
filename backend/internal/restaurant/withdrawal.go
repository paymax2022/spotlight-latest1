package restaurant

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/finance/ledger"
)

// ─────────────────────────────────────────────────────────────────────────────
// Restaurant merchant WITHDRAWAL money path (wallet → saved bank account).
//
// This is the money-path half of the merchant bank feature (the capture half —
// bankaccount.go — is NOT money-path). A withdrawal moves a merchant's EARNED
// wallet balance (credited by paid restaurant_payout_runs; see payout.go) OUT to
// one of their saved settlement bank accounts.
//
// Money model — mirrors the canonical wallet→bank corridor in
// finance/transfers.InitiateBankTransfer:
//
//	RequestWithdrawal  reserves: DR merchant user_wallet → CR failed_transfer_suspense
//	                   (ONE balanced ledger post, keyed on the caller Idempotency-Key),
//	                   records a `processing` row, then hands to the disbursement
//	                   adapter. With the default NoopDisburser NOTHING is executed —
//	                   the funds stay reserved in suspense until a real provider is
//	                   wired. (Mirrors the AI-trading fund NoopAdapter: executed=false.)
//	MarkWithdrawalPaid  provider webhook confirms the payout landed: DR suspense →
//	                    CR provider_clearing (money has left the platform), row → paid.
//	MarkWithdrawalFailed provider webhook reports failure: a balanced REVERSAL returns
//	                     the reserved funds to the merchant wallet, row → reversed.
//
// Iron rules honoured (root CLAUDE.md "Money handling"):
//   - amounts are integer minor units (kobo) — BIGINT, never float/string math;
//   - the mutation REQUIRES an Idempotency-Key and posts a BALANCED double-entry
//     ONLY through ledger entries (no shadow ledger; no direct balance mutation);
//   - a duplicate request is a safe no-op via the UNIQUE idempotency_key + an
//     in-lock re-check, so a merchant is never double-debited;
//   - the wallet debit is fail-closed on both the tier limit AND the balance
//     sufficiency check (under a per-wallet advisory lock — no TOCTOU overdraw);
//   - every request/settlement emits an audit event.
//
// Feature-flagged: RequestWithdrawal refuses unless WithWithdrawals(true) was
// wired (FEATURE_RESTAURANT_WITHDRAWALS_ENABLED). No flag, no money path.
// ─────────────────────────────────────────────────────────────────────────────

// Withdrawal statuses (mirror the CHECK constraint on restaurant_withdrawals).
const (
	WithdrawalStatusPending    = "pending"
	WithdrawalStatusProcessing = "processing"
	WithdrawalStatusPaid       = "paid"
	WithdrawalStatusFailed     = "failed"
	WithdrawalStatusReversed   = "reversed"
)

// Sentinel errors.
var (
	ErrWithdrawalsDisabled  = errors.New("restaurant: merchant withdrawals are disabled (FEATURE_RESTAURANT_WITHDRAWALS_ENABLED off)")
	ErrWithdrawMissingIdem  = errors.New("restaurant: Idempotency-Key required to request a withdrawal")
	ErrWithdrawBadAmount    = errors.New("restaurant: withdrawal amount must be a positive integer (kobo)")
	ErrWithdrawNoBankAccount = errors.New("restaurant: bank account not found for this merchant")
	ErrWithdrawNotFound     = errors.New("restaurant: withdrawal not found")
	ErrWithdrawNotReady     = errors.New("restaurant: withdrawal is not in a settleable state")
)

// Withdrawal mirrors a row of public.restaurant_withdrawals.
type Withdrawal struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id"`
	BankAccountID     string    `json:"bank_account_id"`
	AmountKobo        int64     `json:"amount_kobo"`
	Currency          string    `json:"currency"`
	Status            string    `json:"status"` // pending|processing|paid|failed|reversed
	LedgerRef         *string   `json:"ledger_ref,omitempty"`
	ProviderReference *string   `json:"provider_reference,omitempty"`
	FailureReason     *string   `json:"failure_reason,omitempty"`
	IdempotencyKey    string    `json:"idempotency_key"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
	// AlreadyProcessed is a transient flag (never persisted): true when this row is
	// returned by an idempotent replay of RequestWithdrawal rather than a fresh move.
	AlreadyProcessed bool `json:"already_processed,omitempty"`
}

// RequestWithdrawalInput is the validated body for a merchant withdrawal.
type RequestWithdrawalInput struct {
	AmountKobo     int64  `json:"amount_kobo"`
	BankAccountID  string `json:"bank_account_id"`
	IdempotencyKey string `json:"-"` // from the Idempotency-Key header — REQUIRED
}

// ── Disbursement seam ────────────────────────────────────────────────────────

// WithdrawalDisburseRequest is the outbound-payout instruction handed to the
// disbursement adapter after funds are reserved.
type WithdrawalDisburseRequest struct {
	WithdrawalID   string
	AmountKobo     int64
	BankCode       string
	AccountNumber  string
	AccountName    string
	Reference      string
	IdempotencyKey string
}

// WithdrawalDisburseResult reports whether a REAL outbound transfer was executed.
// Until a live provider is wired, Executed is false (the NoopDisburser) and the
// withdrawal simply stays reserved/`processing`.
type WithdrawalDisburseResult struct {
	Executed          bool
	ProviderReference string
}

// WithdrawalDisburser sends reserved funds to a bank account. Swap the Noop for a
// registry-backed adapter (backend/internal/provider/disbursement) when going live.
type WithdrawalDisburser interface {
	Disburse(ctx context.Context, req WithdrawalDisburseRequest) (WithdrawalDisburseResult, error)
}

// NoopDisburser is the default sandbox adapter: it executes NOTHING and reports
// Executed=false, so a withdrawal's funds stay reserved until a real provider is
// wired. Mirrors the AI-trading fund's NoopAdapter pattern (no live side effect).
type NoopDisburser struct{}

func (NoopDisburser) Disburse(ctx context.Context, req WithdrawalDisburseRequest) (WithdrawalDisburseResult, error) {
	return WithdrawalDisburseResult{Executed: false}, nil
}

// ── Builders ─────────────────────────────────────────────────────────────────
// NOTE: WithTiers lives in service.go (it also gates the order-escrow debit); the
// withdrawal path reuses the same tiers field as its fail-closed wallet-debit gate.

// WithWithdrawals enables (or disables) the merchant withdrawal money path. This
// is the FEATURE_RESTAURANT_WITHDRAWALS_ENABLED gate — default OFF.
func (s *Service) WithWithdrawals(enabled bool) *Service {
	s.withdrawalsOn = enabled
	return s
}

// WithDisburser injects the outbound disbursement adapter. nil ⇒ NoopDisburser.
func (s *Service) WithDisburser(d WithdrawalDisburser) *Service {
	s.disburser = d
	return s
}

// withdrawLegKey builds the stable per-leg ledger idempotency key for a
// withdrawal, so a balanced pair (and each later settle/reversal leg) is posted
// at most once regardless of retries. Same convention as transfers.LegKey.
func withdrawLegKey(base, leg string) string { return base + ":" + leg }

// ── RequestWithdrawal (the money-path mutation) ──────────────────────────────

// RequestWithdrawal reserves a merchant withdrawal: it validates the request
// fail-closed (feature flag, idempotency key, positive amount, owned bank
// account, tier limit), then under a per-wallet advisory lock checks the wallet
// has sufficient funds and posts ONE balanced ledger reserve (DR merchant wallet,
// CR failed_transfer_suspense) atomically with the `processing` withdrawal row.
// Idempotent on the Idempotency-Key (a replay returns the existing row and posts
// no second move). After the reserve, funds are handed to the disbursement
// adapter — with the default NoopDisburser nothing is executed, so the withdrawal
// stays `processing` until a real provider webhook flips it paid/failed.
func (s *Service) RequestWithdrawal(ctx context.Context, ownerID string, in RequestWithdrawalInput) (*Withdrawal, error) {
	if !s.withdrawalsOn {
		return nil, ErrWithdrawalsDisabled
	}
	if in.IdempotencyKey == "" {
		return nil, ErrWithdrawMissingIdem
	}
	if in.AmountKobo <= 0 {
		return nil, ErrWithdrawBadAmount
	}
	if s.ledger == nil {
		return nil, fmt.Errorf("restaurant: withdrawals require a ledger (WithLedger not wired)")
	}
	if s.tiers == nil {
		// Fail-closed: a money path with no tier gate must refuse to move money.
		// Shares PlaceOrder's sentinel so both money paths report an unwired gate
		// identically (503 via escrowErrStatus / withdrawalErrStatus).
		return nil, ErrTierGateUnwired
	}

	// Fast idempotency path: a prior request with this key already reserved funds.
	if existing, err := s.getWithdrawalByIdem(ctx, in.IdempotencyKey, ownerID); err == nil && existing != nil {
		existing.AlreadyProcessed = true
		return existing, nil
	}

	// Owner-scope the destination account: a merchant may only withdraw to their
	// OWN saved bank account (owner-scoping / prevents cross-tenant payout).
	var ok bool
	if err := s.db.QueryRow(ctx,
		`SELECT true FROM restaurant_bank_accounts WHERE id=$1 AND user_id=$2`,
		in.BankAccountID, ownerID).Scan(&ok); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrWithdrawNoBankAccount
		}
		return nil, fmt.Errorf("restaurant: withdrawal resolve bank account: %w", err)
	}

	// Tier guard (fail-closed): Tier 0 wallet disabled → blocked; over daily cap → blocked.
	if err := s.tiers.EnforceWalletDebitLimit(ctx, ownerID, in.AmountKobo); err != nil {
		return nil, err
	}

	// Resolve the ledger accounts (no money moves here — GetOrCreate* only ensures
	// the account rows exist). Money leaves the merchant wallet; it is parked in the
	// failed-transfer suspense account (the reserve/clearing posture) until the
	// provider confirms or fails, exactly like finance/transfers.
	walletAcc, err := s.ledger.GetOrCreateUserWallet(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	suspenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		return nil, err
	}

	withdrawalID := uuid.New().String()
	reference := "rwithdraw:" + withdrawalID

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Serialise concurrent debits of THIS wallet so the balance check + reserve are
	// atomic (no TOCTOU overdraw). Same advisory-lock key as finance/transfers.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "wallet:"+ownerID); err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal advisory lock: %w", err)
	}

	// Re-check idempotency INSIDE the lock: a concurrent request with the same key
	// that beat us to commit is returned as-is rather than colliding on the reserve.
	if existing, ierr := s.getWithdrawalByIdemTx(ctx, tx, in.IdempotencyKey, ownerID); ierr == nil && existing != nil {
		_ = tx.Rollback(ctx)
		existing.AlreadyProcessed = true
		return existing, nil
	}

	// Balance sufficiency (fail-closed). The projection reflects committed entries;
	// under the advisory lock a concurrent reserve of this wallet is blocked until
	// our commit, so this read cannot be raced into an overdraw.
	balance, err := s.ledger.GetBalance(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	if balance < in.AmountKobo {
		return nil, ledger.ErrInsufficientFunds
	}

	// ── ONE balanced reserve: DR merchant wallet → CR suspense (equal amounts) ──
	const insertEntry = `INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key) VALUES ($1,$2,$3,$4,$5)`
	if _, err := tx.Exec(ctx, insertEntry, walletAcc.ID, string(ledger.EntryDebit), in.AmountKobo, reference, withdrawLegKey(in.IdempotencyKey, "debit")); err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal debit wallet: %w", err)
	}
	if _, err := tx.Exec(ctx, insertEntry, suspenseAcc.ID, string(ledger.EntryCredit), in.AmountKobo, reference, withdrawLegKey(in.IdempotencyKey, "suspense")); err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal credit suspense: %w", err)
	}

	// Record the withdrawal row (idempotent on idempotency_key). If a racing request
	// already inserted it, ON CONFLICT yields 0 rows — return the existing row.
	var w Withdrawal
	const insertRow = `
		INSERT INTO restaurant_withdrawals
			(id, user_id, bank_account_id, amount_kobo, currency, status, ledger_ref, idempotency_key)
		VALUES ($1,$2,$3,$4,'NGN','processing',$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id, user_id, bank_account_id, amount_kobo, currency, status, ledger_ref,
		          provider_reference, failure_reason, idempotency_key, created_at, updated_at`
	err = tx.QueryRow(ctx, insertRow, withdrawalID, ownerID, in.BankAccountID, in.AmountKobo, reference, in.IdempotencyKey).Scan(
		&w.ID, &w.UserID, &w.BankAccountID, &w.AmountKobo, &w.Currency, &w.Status, &w.LedgerRef,
		&w.ProviderReference, &w.FailureReason, &w.IdempotencyKey, &w.CreatedAt, &w.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost the race on the unique key — the reserve legs we just tried to insert
		// would also have conflicted, so the tx is rolled back and the winner returned.
		_ = tx.Rollback(ctx)
		existing, gerr := s.getWithdrawalByIdem(ctx, in.IdempotencyKey, ownerID)
		if gerr != nil || existing == nil {
			return nil, fmt.Errorf("restaurant: withdrawal idempotent replay lookup: %w", gerr)
		}
		existing.AlreadyProcessed = true
		return existing, nil
	}
	if err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal insert row: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal commit: %w", err)
	}

	// Hand the reserved funds to the disbursement adapter. The default NoopDisburser
	// executes NOTHING (Executed=false) → the withdrawal stays `processing` until a
	// real provider webhook flips it. When a live adapter DOES execute, stamp the
	// provider reference so the webhook can be routed back to this row.
	res, derr := s.disburse(ctx, WithdrawalDisburseRequest{
		WithdrawalID:   w.ID,
		AmountKobo:     w.AmountKobo,
		Reference:      reference,
		IdempotencyKey: in.IdempotencyKey,
	})
	if derr == nil && res.Executed && res.ProviderReference != "" {
		if _, uerr := s.db.Exec(ctx,
			`UPDATE restaurant_withdrawals SET provider_reference=$2, updated_at=now() WHERE id=$1`,
			w.ID, res.ProviderReference); uerr == nil {
			w.ProviderReference = &res.ProviderReference
		}
	}

	// Immutable audit event (best-effort; the ledger entries are the durable record).
	s.notify(ctx, Notification{
		UserID: ownerID,
		Event:  EventWithdrawalRequested,
		Title:  "Withdrawal requested",
		Body:   fmt.Sprintf("Your withdrawal of ₦%d.%02d is being processed.", w.AmountKobo/100, w.AmountKobo%100),
		Data: map[string]any{
			"withdrawal_id": w.ID,
			"amount_kobo":   w.AmountKobo,
			"ledger_ref":    reference,
		},
	})
	return &w, nil
}

// disburse routes through the configured adapter, defaulting to the Noop.
func (s *Service) disburse(ctx context.Context, req WithdrawalDisburseRequest) (WithdrawalDisburseResult, error) {
	d := s.disburser
	if d == nil {
		d = NoopDisburser{}
	}
	return d.Disburse(ctx, req)
}

// ── Webhook status flips ─────────────────────────────────────────────────────

// MarkWithdrawalPaid settles a reserved withdrawal after the provider confirms
// the payout landed. It posts the balanced settle leg (DR suspense → CR
// provider_clearing — the money has left the platform; the wallet is NOT touched
// again) keyed idempotently on the withdrawal, then flips the row to `paid`.
//
// The whole transition runs under a `SELECT … FOR UPDATE` lock on the withdrawal
// row, which makes the paid and reversed transitions MUTUALLY EXCLUSIVE: a
// concurrent MarkWithdrawalFailed blocks on the same row lock until this commits,
// then sees the terminal status and does NOT post its reversal leg — so a settle
// and a reversal can never BOTH post for one withdrawal (no double-move). The
// settle leg is idempotent on the :settle key, so a duplicate webhook is a no-op.
func (s *Service) MarkWithdrawalPaid(ctx context.Context, withdrawalID, providerRef, _ string) (*Withdrawal, error) {
	if s.ledger == nil {
		return nil, fmt.Errorf("restaurant: withdrawals require a ledger (WithLedger not wired)")
	}
	suspenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		return nil, err
	}
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal settle begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	w, err := s.lockWithdrawalTx(ctx, tx, withdrawalID)
	if err != nil {
		return nil, err
	}
	if w.Status == WithdrawalStatusPaid {
		return w, nil // already settled — idempotent no-op
	}
	if w.Status != WithdrawalStatusProcessing && w.Status != WithdrawalStatusPending {
		return nil, ErrWithdrawNotReady // e.g. already reversed — cannot pay
	}

	// Balanced settle leg (DR suspense → CR provider_clearing). Posted under the row
	// lock, BEFORE the status flip: a crash after this post leaves the row unchanged
	// so a retry re-drives it (ErrDuplicate is a no-op) — never a missing-move.
	settleRef := "rwithdraw:" + w.ID + ":settle"
	if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       settleRef,
		IdempotencyKey:  withdrawLegKey(w.IdempotencyKey, "settle"),
		AmountKobo:      w.AmountKobo,
		DebitAccountID:  suspenseAcc.ID,
		CreditAccountID: clearingAcc.ID,
		Description:     "restaurant withdrawal settled",
	}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return nil, fmt.Errorf("restaurant: withdrawal settle post: %w", err)
	}

	out, err := s.scanWithdrawal(tx.QueryRow(ctx, `
		UPDATE restaurant_withdrawals
		SET status='paid', provider_reference=COALESCE(NULLIF($2,''), provider_reference), updated_at=now()
		WHERE id=$1
		RETURNING id, user_id, bank_account_id, amount_kobo, currency, status, ledger_ref,
		          provider_reference, failure_reason, idempotency_key, created_at, updated_at`,
		w.ID, providerRef))
	if err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal finalise paid: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal settle commit: %w", err)
	}
	s.notify(ctx, Notification{
		UserID: out.UserID,
		Event:  EventWithdrawalPaid,
		Title:  "Withdrawal paid",
		Body:   fmt.Sprintf("Your withdrawal of ₦%d.%02d has been paid to your bank.", out.AmountKobo/100, out.AmountKobo%100),
		Data:   map[string]any{"withdrawal_id": out.ID, "amount_kobo": out.AmountKobo},
	})
	return out, nil
}

// MarkWithdrawalFailed reverses a reserved withdrawal after the provider reports
// failure: a balanced REVERSAL returns the reserved funds from suspense back to the
// merchant wallet (restore wallet, drain suspense), then flips the row to
// `reversed` with the failure reason.
//
// Like MarkWithdrawalPaid, the transition runs under the withdrawal-row
// `SELECT … FOR UPDATE` lock, so paid and reversed are MUTUALLY EXCLUSIVE — a
// settle and a reversal can never both post. The reversal (money back to the
// merchant) is posted under the lock BEFORE the status flip and is idempotent on
// the :reversal key, so a crash after the post leaves the row still processing and
// a retry re-drives it (never a reversed row whose funds were not actually
// returned). A duplicate failure webhook is a no-op.
func (s *Service) MarkWithdrawalFailed(ctx context.Context, withdrawalID, reason, _ string) (*Withdrawal, error) {
	if s.ledger == nil {
		return nil, fmt.Errorf("restaurant: withdrawals require a ledger (WithLedger not wired)")
	}
	suspenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal reversal begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	w, err := s.lockWithdrawalTx(ctx, tx, withdrawalID)
	if err != nil {
		return nil, err
	}
	if w.Status == WithdrawalStatusReversed || w.Status == WithdrawalStatusFailed {
		return w, nil // already reversed/failed — idempotent no-op
	}
	if w.Status != WithdrawalStatusProcessing && w.Status != WithdrawalStatusPending {
		return nil, ErrWithdrawNotReady // e.g. already paid — cannot reverse
	}

	walletAcc, err := s.ledger.GetOrCreateUserWallet(ctx, w.UserID)
	if err != nil {
		return nil, err
	}
	// PostReversal: restoreAccountID (wallet) credited back (+balance); releaseAccountID
	// (suspense) drained. Idempotent on the reversal key.
	reverseRef := "rwithdraw:" + w.ID + ":reversal"
	if err := s.ledger.PostReversal(ctx, walletAcc.ID, suspenseAcc.ID, w.AmountKobo, reverseRef, withdrawLegKey(w.IdempotencyKey, "reversal")); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return nil, fmt.Errorf("restaurant: withdrawal reversal post: %w", err)
	}

	out, err := s.scanWithdrawal(tx.QueryRow(ctx, `
		UPDATE restaurant_withdrawals
		SET status='reversed', failure_reason=NULLIF($2,''), updated_at=now()
		WHERE id=$1
		RETURNING id, user_id, bank_account_id, amount_kobo, currency, status, ledger_ref,
		          provider_reference, failure_reason, idempotency_key, created_at, updated_at`,
		w.ID, reason))
	if err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal finalise reversed: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("restaurant: withdrawal reversal commit: %w", err)
	}
	s.notify(ctx, Notification{
		UserID: out.UserID,
		Event:  EventWithdrawalReversed,
		Title:  "Withdrawal reversed",
		Body:   fmt.Sprintf("Your withdrawal of ₦%d.%02d could not be completed and was returned to your wallet.", out.AmountKobo/100, out.AmountKobo%100),
		Data:   map[string]any{"withdrawal_id": out.ID, "amount_kobo": out.AmountKobo, "reason": reason},
	})
	return out, nil
}

// ── Reads ────────────────────────────────────────────────────────────────────

// ListWithdrawals returns the caller's withdrawal history, newest first (owner-scoped).
func (s *Service) ListWithdrawals(ctx context.Context, ownerID string, limit int) ([]Withdrawal, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT id, user_id, bank_account_id, amount_kobo, currency, status, ledger_ref,
		       provider_reference, failure_reason, idempotency_key, created_at, updated_at
		FROM restaurant_withdrawals WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := s.db.Query(ctx, q, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("restaurant: list withdrawals: %w", err)
	}
	defer rows.Close()
	out := []Withdrawal{}
	for rows.Next() {
		w, err := s.scanWithdrawal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

// GetWithdrawal returns a single withdrawal, owner-scoped (a merchant may only read
// their own).
func (s *Service) GetWithdrawal(ctx context.Context, ownerID, id string) (*Withdrawal, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, ErrWithdrawNotFound
	}
	const q = `
		SELECT id, user_id, bank_account_id, amount_kobo, currency, status, ledger_ref,
		       provider_reference, failure_reason, idempotency_key, created_at, updated_at
		FROM restaurant_withdrawals WHERE id=$1 AND user_id=$2`
	w, err := s.scanWithdrawal(s.db.QueryRow(ctx, q, id, ownerID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrWithdrawNotFound
		}
		return nil, err
	}
	return w, nil
}

// getWithdrawalByIdem resolves a withdrawal by its idempotency key (idempotent replay).
// Scoped to the requesting merchant: Idempotency-Keys are client-chosen, so an
// unscoped lookup would hand a merchant another merchant's withdrawal record (amount,
// bank account, provider reference) whenever they replayed that merchant's key. A key
// that exists but belongs to someone else is a miss here. Same reasoning as
// findOrderByIdempotencyKey on the order-escrow path.
func (s *Service) getWithdrawalByIdem(ctx context.Context, idemKey, userID string) (*Withdrawal, error) {
	const q = `
		SELECT id, user_id, bank_account_id, amount_kobo, currency, status, ledger_ref,
		       provider_reference, failure_reason, idempotency_key, created_at, updated_at
		FROM restaurant_withdrawals WHERE idempotency_key=$1 AND user_id=$2`
	w, err := s.scanWithdrawal(s.db.QueryRow(ctx, q, idemKey, userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil // not found is not an error for the fast idempotency probe
		}
		return nil, err
	}
	return w, nil
}

// lockWithdrawalTx loads a withdrawal row FOR UPDATE inside tx, so the paid and
// reversed transitions serialise on the row lock (mutually exclusive). Not owner
// scoped — the webhook/admin settle path routes by withdrawal id.
func (s *Service) lockWithdrawalTx(ctx context.Context, tx pgx.Tx, id string) (*Withdrawal, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, ErrWithdrawNotFound
	}
	const q = `
		SELECT id, user_id, bank_account_id, amount_kobo, currency, status, ledger_ref,
		       provider_reference, failure_reason, idempotency_key, created_at, updated_at
		FROM restaurant_withdrawals WHERE id=$1 FOR UPDATE`
	w, err := s.scanWithdrawal(tx.QueryRow(ctx, q, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrWithdrawNotFound
		}
		return nil, err
	}
	return w, nil
}

// getWithdrawalByIdemTx is the in-transaction variant used for the race-safe
// re-check under the wallet advisory lock.
func (s *Service) getWithdrawalByIdemTx(ctx context.Context, tx pgx.Tx, idemKey, userID string) (*Withdrawal, error) {
	const q = `
		SELECT id, user_id, bank_account_id, amount_kobo, currency, status, ledger_ref,
		       provider_reference, failure_reason, idempotency_key, created_at, updated_at
		FROM restaurant_withdrawals WHERE idempotency_key=$1 AND user_id=$2`
	w, err := s.scanWithdrawal(tx.QueryRow(ctx, q, idemKey, userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return w, nil
}

// rowScanner abstracts pgx.Row / pgx.Rows for the shared withdrawal scanner.
type rowScanner interface {
	Scan(dest ...any) error
}

func (s *Service) scanWithdrawal(row rowScanner) (*Withdrawal, error) {
	var w Withdrawal
	if err := row.Scan(
		&w.ID, &w.UserID, &w.BankAccountID, &w.AmountKobo, &w.Currency, &w.Status, &w.LedgerRef,
		&w.ProviderReference, &w.FailureReason, &w.IdempotencyKey, &w.CreatedAt, &w.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &w, nil
}

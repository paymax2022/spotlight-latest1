package wallet

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
)

// Service exposes the campaign wallet, ledger projection, bank accounts, and the
// withdrawal flow. It never stores a balance: every balance is derived from the
// contributions ledger and cf_withdrawals on read.
type Service struct {
	db     *pgxpool.Pool
	ledger *financeledger.Service // required for SubmitWithdrawal's payout leg; nil fails that path closed
}

// NewService constructs a wallet Service over a pgx pool.
func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// WithLedger injects the finance ledger used by SubmitWithdrawal's payout
// money-path. Non-breaking: existing NewService(db) callers keep a nil ledger
// and the payout path fails closed until one is wired.
func (s *Service) WithLedger(l *financeledger.Service) *Service { s.ledger = l; return s }

// ErrLedgerUnavailable is returned when SubmitWithdrawal is invoked without a
// wired finance ledger. Fail-closed: we refuse to transition without posting money.
var ErrLedgerUnavailable = errors.New("crowdfunding/wallet: finance ledger not configured — cannot pay out withdrawal")

// ErrCampaignNotFound is returned when a campaign id resolves to no row.
var ErrCampaignNotFound = errors.New("crowdfunding/wallet: campaign not found")

// ─── Wallet summary (fully derived — no stored balance) ──────────────────────

// GetWallet returns a campaign's derived wallet summary.
//
// Derivation (all kobo, integers only):
//   - totalRaised     = Σ contributions in (escrowed, released)
//   - escrow          = Σ contributions in (escrowed)            [held until release]
//   - released        = Σ contributions in (released)            [settled to creator]
//   - totalWithdrawn  = Σ cf_withdrawals in (COMPLETED)
//   - pending         = Σ cf_withdrawals in (PENDING, PROCESSING, APPROVED) [in-flight out]
//   - available       = released − totalWithdrawn − pending      [withdrawable now]
func (s *Service) GetWallet(ctx context.Context, campaignID string) (*CampaignWalletSummary, error) {
	var (
		title   string
		frozen  bool
		escrow  int64
		release int64
	)
	const campQ = `
		SELECT c.title,
		       (c.review_status = 'FROZEN') AS frozen,
		       COALESCE(SUM(co.amount_kobo) FILTER (WHERE co.status = 'escrowed'), 0) AS escrow_kobo,
		       COALESCE(SUM(co.amount_kobo) FILTER (WHERE co.status = 'released'), 0) AS released_kobo
		FROM campaigns c
		LEFT JOIN contributions co ON co.campaign_id = c.id
		WHERE c.id = $1
		GROUP BY c.id, c.title, c.review_status`
	if err := s.db.QueryRow(ctx, campQ, campaignID).Scan(&title, &frozen, &escrow, &release); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}

	var withdrawn, pending int64
	const wQ = `
		SELECT
			COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'COMPLETED'), 0),
			COALESCE(SUM(amount_kobo) FILTER (WHERE status IN ('PENDING','PROCESSING','APPROVED')), 0)
		FROM cf_withdrawals WHERE campaign_id = $1`
	if err := s.db.QueryRow(ctx, wQ, campaignID).Scan(&withdrawn, &pending); err != nil {
		return nil, err
	}

	available := release - withdrawn - pending
	if available < 0 {
		available = 0
	}

	return &CampaignWalletSummary{
		CampaignID:         campaignID,
		CampaignTitle:      title,
		AvailableKobo:      available,
		PendingKobo:        pending,
		EscrowKobo:         escrow,
		TotalRaisedKobo:    escrow + release,
		TotalWithdrawnKobo: withdrawn,
		Frozen:             frozen,
	}, nil
}

// ─── Ledger projection (signed entries with running balance) ─────────────────

type rawEntry struct {
	id          string
	typ         string
	description string
	amountKobo  int64 // signed: +credit / -debit
	reference   string
	status      string
	createdAt   time.Time
}

// GetLedger projects a campaign's money movements into signed ledger entries with
// a running balance. Contributions are credits (+); withdrawals are debits (−).
// The projection is ordered oldest→newest so the running balance accumulates,
// then returned newest-first for the client feed.
func (s *Service) GetLedger(ctx context.Context, campaignID string) ([]LedgerEntry, error) {
	// Verify the campaign exists so a bad id is a 404, not an empty list.
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT TRUE FROM campaigns WHERE id = $1`, campaignID).Scan(&exists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}

	raw, err := s.collectEntries(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	return projectRunningBalance(raw), nil
}

// GetLedgerEntry returns a single projected ledger entry by its id. Because the
// running balance is path-dependent, we must rebuild the campaign's full ledger
// and locate the entry within it.
func (s *Service) GetLedgerEntry(ctx context.Context, entryID string) (*LedgerEntry, error) {
	// Resolve which campaign the entry belongs to (contribution or withdrawal).
	var campaignID string
	const lookup = `
		SELECT campaign_id FROM contributions WHERE id = $1
		UNION ALL
		SELECT campaign_id FROM cf_withdrawals WHERE id = $1
		LIMIT 1`
	if err := s.db.QueryRow(ctx, lookup, entryID).Scan(&campaignID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("crowdfunding/wallet: ledger entry not found")
		}
		return nil, err
	}

	entries, err := s.GetLedger(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	for i := range entries {
		if entries[i].ID == entryID {
			return &entries[i], nil
		}
	}
	return nil, errors.New("crowdfunding/wallet: ledger entry not found")
}

// collectEntries unions contributions (credits) and cf_withdrawals (debits) into
// time-ordered raw entries for a single campaign.
func (s *Service) collectEntries(ctx context.Context, campaignID string) ([]rawEntry, error) {
	const q = `
		SELECT id, type, description, amount_kobo, reference, status, created_at FROM (
			SELECT co.id::text AS id,
			       CASE WHEN co.status = 'refunded' THEN 'REFUND' ELSE 'CONTRIBUTION' END AS type,
			       CASE WHEN co.status = 'refunded' THEN 'Contribution refunded' ELSE 'Contribution received' END AS description,
			       CASE WHEN co.status = 'refunded' THEN -co.amount_kobo ELSE co.amount_kobo END AS amount_kobo,
			       COALESCE(co.idempotency_key, co.id::text) AS reference,
			       CASE WHEN co.status = 'refunded' THEN 'REVERSED' ELSE 'POSTED' END AS status,
			       co.created_at AS created_at
			FROM contributions co
			WHERE co.campaign_id = $1 AND co.status IN ('escrowed','released','refunded')
			UNION ALL
			SELECT w.id::text AS id,
			       'WITHDRAWAL' AS type,
			       'Withdrawal' AS description,
			       -w.amount_kobo AS amount_kobo,
			       w.reference AS reference,
			       CASE WHEN w.status = 'COMPLETED' THEN 'POSTED'
			            WHEN w.status = 'REJECTED'  THEN 'REVERSED'
			            ELSE 'PENDING' END AS status,
			       w.requested_at AS created_at
			FROM cf_withdrawals w
			WHERE w.campaign_id = $1 AND w.status <> 'REJECTED'
		) entries
		ORDER BY created_at ASC, id ASC`

	rows, err := s.db.Query(ctx, q, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []rawEntry{}
	for rows.Next() {
		var e rawEntry
		if err := rows.Scan(&e.id, &e.typ, &e.description, &e.amountKobo, &e.reference, &e.status, &e.createdAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// projectRunningBalance walks entries oldest→newest accumulating the running
// balance, then returns them newest-first for the client feed.
func projectRunningBalance(raw []rawEntry) []LedgerEntry {
	var balance int64
	asc := make([]LedgerEntry, 0, len(raw))
	for _, e := range raw {
		balance += e.amountKobo
		asc = append(asc, LedgerEntry{
			ID:          e.id,
			Type:        e.typ,
			Description: e.description,
			AmountKobo:  e.amountKobo,
			BalanceKobo: balance,
			Reference:   e.reference,
			Status:      e.status,
			CreatedAt:   e.createdAt.UTC().Format(time.RFC3339),
		})
	}
	// Reverse into newest-first.
	out := make([]LedgerEntry, len(asc))
	for i := range asc {
		out[len(asc)-1-i] = asc[i]
	}
	return out
}

// ─── Bank accounts ───────────────────────────────────────────────────────────

// GetBankAccounts returns a user's saved (masked) bank accounts, default first.
func (s *Service) GetBankAccounts(ctx context.Context, userID string) ([]BankAccount, error) {
	const q = `
		SELECT id, bank_name, account_number_masked, account_name, is_default
		FROM cf_bank_accounts
		WHERE user_id = $1
		ORDER BY is_default DESC, created_at ASC`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BankAccount{}
	for rows.Next() {
		var b BankAccount
		if err := rows.Scan(&b.ID, &b.BankName, &b.AccountNumberMasked, &b.AccountName, &b.IsDefault); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ─── Withdrawal (money-path: pays out immediately, no admin approval) ────────

// SubmitWithdrawal pays out a creator's withdrawal immediately — no separate
// admin-approval step. Campaign review is the gate on whether a campaign can
// accept contributions at all (see crowdfunding.Service.Contribute); once it
// can, contributions settle into the wallet on arrival and the creator may
// withdraw at will.
//
// IRON RULES: requires a non-empty idempotencyKey; validates the amount against
// the derived available balance fail-closed; posts a BALANCED double-entry via
// the finance ledger (DEBIT AccountEscrow / CREDIT AccountProviderClearing,
// mirroring the crowdfunding admin withdrawal money-path in
// adminext/withdraw_approve.go) keyed deterministically on the withdrawal id so
// a replay never posts twice; writes an immutable cf_audit_logs row in the same
// tx as the terminal status flip. A missing ledger dependency fails closed
// BEFORE any state change.
//
// TODO(prod): trigger the actual payout-rail transfer once a disbursement
// provider is wired into this surface (see internal/provider/disbursement).
// Funds are parked in AccountProviderClearing meanwhile — we do not fabricate a
// provider success.
func (s *Service) SubmitWithdrawal(ctx context.Context, creatorID, campaignID, idempotencyKey string, in WithdrawalRequestInput) (*WithdrawalResult, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, errors.New("crowdfunding/wallet: Idempotency-Key is required")
	}
	if in.AmountKobo < 100 {
		return nil, errors.New("crowdfunding/wallet: amount must be at least 100 kobo")
	}
	if s.ledger == nil {
		return nil, ErrLedgerUnavailable
	}

	// Idempotent replay: return the prior request unchanged.
	if existing, ok, err := s.findByIdempotencyKey(ctx, idempotencyKey); err != nil {
		return nil, err
	} else if ok {
		return existing, nil
	}

	// Ownership + available-balance check (fail-closed).
	wallet, err := s.GetWallet(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	var ownerID string
	if err := s.db.QueryRow(ctx, `SELECT creator_id FROM campaigns WHERE id = $1`, campaignID).Scan(&ownerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}
	if ownerID != creatorID {
		return nil, errors.New("crowdfunding/wallet: only the campaign creator may request a withdrawal")
	}
	if wallet.Frozen {
		return nil, errors.New("crowdfunding/wallet: campaign is frozen — withdrawals are disabled")
	}
	if in.AmountKobo > wallet.AvailableKobo {
		return nil, fmt.Errorf("crowdfunding/wallet: amount %d kobo exceeds available balance %d kobo", in.AmountKobo, wallet.AvailableKobo)
	}

	// Resolve the bank label from the (owned) saved account.
	bankLabel, err := s.resolveBankLabel(ctx, creatorID, in.BankAccountID)
	if err != nil {
		return nil, err
	}

	id := uuid.New().String()
	reference := "SPL-CFWD-" + id[:8]
	now := time.Now()

	// Post the balanced double-entry (money leaves the CREATOR'S wallet) BEFORE
	// the row exists — a deterministic key derived from the withdrawal id makes
	// a retry-after-partial-failure safe to replay.
	//
	// DEBIT the creator's own user_wallet, not the shared escrow standing
	// account: Contribute()'s instant settle already moved the creator's 90%
	// share OUT of escrow and into their user_wallet via settlement.Settle
	// (escrow → provider wallet). Debiting escrow here would have drained
	// OTHER campaigns' unsettled contributions instead of this creator's own
	// balance — ledger.Debit is also TOCTOU-safe (advisory-locked balance
	// check), which the manual escrow posting below was not.
	payoutIdem := "cf:withdraw:payout:" + id
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		return nil, fmt.Errorf("crowdfunding/wallet: resolve clearing account: %w", err)
	}
	if err := s.ledger.Debit(ctx, creatorID, "cf:withdraw:"+reference, payoutIdem, clearingAcc.ID, in.AmountKobo); err != nil &&
		!errors.Is(err, financeledger.ErrDuplicate) {
		return nil, fmt.Errorf("crowdfunding/wallet: post withdrawal payout: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	const ins = `
		INSERT INTO cf_withdrawals
			(id, campaign_id, creator_id, reference, amount_kobo, bank_label, status, reason, idempotency_key, requested_at)
		VALUES ($1,$2,$3,$4,$5,$6,'COMPLETED',$7,$8,$9)`
	if _, err := tx.Exec(ctx, ins,
		id, campaignID, creatorID, reference, in.AmountKobo, bankLabel, in.Reason, idempotencyKey, now,
	); err != nil {
		return nil, fmt.Errorf("crowdfunding/wallet: insert withdrawal: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO cf_audit_logs (actor, action, target, ip) VALUES ($1,'withdrawal.payout',$2,'')`,
		creatorID, reference,
	); err != nil {
		return nil, fmt.Errorf("crowdfunding/wallet: write audit row: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &WithdrawalResult{
		ID:          id,
		Reference:   reference,
		Status:      "COMPLETED",
		AmountKobo:  in.AmountKobo,
		BankLabel:   bankLabel,
		RequestedAt: now.UTC().Format(time.RFC3339),
	}, nil
}

func (s *Service) findByIdempotencyKey(ctx context.Context, key string) (*WithdrawalResult, bool, error) {
	const q = `
		SELECT id, reference, amount_kobo, bank_label, status, requested_at
		FROM cf_withdrawals WHERE idempotency_key = $1`
	var r WithdrawalResult
	var requestedAt time.Time
	err := s.db.QueryRow(ctx, q, key).Scan(&r.ID, &r.Reference, &r.AmountKobo, &r.BankLabel, &r.Status, &requestedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	r.RequestedAt = requestedAt.UTC().Format(time.RFC3339)
	return &r, true, nil
}

func (s *Service) resolveBankLabel(ctx context.Context, userID, bankAccountID string) (string, error) {
	const q = `
		SELECT bank_name, account_number_masked
		FROM cf_bank_accounts WHERE id = $1 AND user_id = $2`
	var bankName, masked string
	if err := s.db.QueryRow(ctx, q, bankAccountID, userID).Scan(&bankName, &masked); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errors.New("crowdfunding/wallet: bank account not found")
		}
		return "", err
	}
	return bankName + " " + masked, nil
}

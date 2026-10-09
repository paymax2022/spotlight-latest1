package transfers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/strutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/disbursement"
)

// Service handles wallet-to-wallet, wallet-to-bank, and bank-to-bank transfers.
type Service struct {
	db         *pgxpool.Pool
	ledger     *ledger.Service
	tiers      *tiers.Service
	payment    provider.PaymentProvider
	registry   *disbursement.Registry // multi-provider payout (nil = bank routes degraded)
	pins       *pinStore
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
	auditSink  Auditor            // optional; nil ⇒ audit() stays a stdout breadcrumb only
}

// Auditor is the nil-safe seam into the shared durable audit sink
// (services.AuditService satisfies this signature — the app-wiring auditSink).
// Modeled as a LOCAL interface (mirrors CommissionRecorder) so transfers never
// imports the services package at compile time. Injection is post-construction
// via SetAuditor; when nil, audit() degrades to its original stdout-only
// behaviour — a missing sink must never fail the money path.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// SetAuditor injects the durable audit sink (app-wiring, post-construction).
// Nil is accepted and leaves audit() stdout-only.
func (s *Service) SetAuditor(a Auditor) { s.auditSink = a }

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (local interface so transfers never imports commission; mirrors
// transport/service.go). It records realized profit ONLY and never moves
// money — the injected recorder is built WITHOUT a ledger so RecordFor appends
// the immutable earning row only (no double count).
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
	RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized profit for a completed transfer.
// Best-effort: nil-safe and errors are swallowed so it can never fail/reverse
// a money movement; the transfer id doubles as source ref + idempotency key.
// The real earning is the fixed-kobo fee, NOT a % of principal, so RecordExact
// is used; callers gate on fee > 0 (a free transfer records nothing).
func (s *Service) recordCommissionSafe(ctx context.Context, service string, grossKobo, feeKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || feeKobo <= 0 {
		return
	}
	if err := s.commission.RecordExact(ctx, "Finance", service, "", grossKobo, feeKobo,
		"transfers", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[transfers] commission record (source=%s gross=%d fee=%d) failed, continuing: %v", sourceRef, grossKobo, feeKobo, err)
	}
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
// Returns ErrRecipientNotFound (→404) when no Paymax user matches the phone, and
// ErrAmbiguousRecipient (→409) when more than one account carries the number.
// Matches on the 10-digit NSN, not the raw string — stored phones were never
// normalised (a row may hold "8159491618", "08159491618" or "+2348159491618"),
// so an exact-match lookup would miss most recipients.
func (s *Service) ResolvePaymaxUser(ctx context.Context, phone string) (*WalletTransferResolveResponse, error) {
	nsn := NormalizeRecipientPhone(phone)
	if nsn == "" {
		// Not a usable Nigerian mobile — no match, and never a looser probe.
		return nil, ErrRecipientNotFound
	}

	// The filter mirrors user_profiles_phone_nsn_idx EXACTLY: both the
	// right(regexp_replace(COALESCE(phone,''),...),10) expression and the
	// partial `phone IS NOT NULL AND phone <> ''` predicate. Verified with
	// EXPLAIN: drop the COALESCE and the index degrades to a filter; drop the
	// partial predicate and Postgres cannot prove the index applies at all and
	// falls back to a sequential scan of every profile.
	// LIMIT 5, not 1: one row cannot reveal that a second account shares the
	// number, and silently taking the first would pay whichever row the planner
	// happened to return.
	const q = `SELECT id, full_name, phone
	             FROM user_profiles
	            WHERE phone IS NOT NULL AND phone <> ''
	              AND right(regexp_replace(COALESCE(phone,''), '\D', '', 'g'), 10) = $1
	            LIMIT 5`

	rows, err := s.db.Query(ctx, q, nsn)
	if err != nil {
		// Fail closed, but do not let an outage look like an empty database.
		log.Printf("[transfers] recipient lookup failed: %v", err)
		return nil, ErrRecipientNotFound
	}
	defer rows.Close()

	var candidates []RecipientCandidate
	for rows.Next() {
		var c RecipientCandidate
		if err := rows.Scan(&c.UserID, &c.FullName, &c.Phone); err != nil {
			log.Printf("[transfers] recipient scan failed: %v", err)
			return nil, ErrRecipientNotFound
		}
		candidates = append(candidates, c)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[transfers] recipient lookup iteration failed: %v", err)
		return nil, ErrRecipientNotFound
	}

	match, err := ChooseRecipient(nsn, candidates)
	if err != nil {
		return nil, err
	}
	return &WalletTransferResolveResponse{
		UserID:      match.UserID,
		FullName:    match.FullName,
		MaskedPhone: MaskPhone(match.Phone),
	}, nil
}

// walletPreflight is the pre-flight sequence of a wallet-to-wallet transfer,
// expressed with explicit seams so its ORDER can be tested without a database.
// The order is the invariant, not an implementation detail — see run.
type walletPreflight struct {
	// findReplay returns the transfer already recorded under this idempotency
	// key, or (nil, nil) when the key is new.
	findReplay func(ctx context.Context, key string) (*WalletTransfer, error)
	// verifyPIN is the transaction-PIN second factor — fail-closed.
	verifyPIN func(ctx context.Context, userID, pin string) error
	// resolve turns the recipient phone into an account.
	resolve func(ctx context.Context, phone string) (*WalletTransferResolveResponse, error)
	// enforceTier applies the fail-closed tier / daily-limit guard.
	enforceTier func(ctx context.Context, userID string, amountKobo int64) error
}

// run executes the pre-flight and returns EITHER a prior transfer to replay, OR
// the resolved recipient to proceed with. Exactly one is non-nil on success.
// The replay lookup runs FIRST, before resolution and before the tier guard.
// Once a transfer has completed, re-running those gates can only refuse a
// request that already succeeded: the daily cap now counts the very transfer
// being replayed, and a recipient whose number has since become ambiguous
// answers 409. Neither can double-spend — wallet_transfers.idempotency_key is
// UNIQUE — but telling a caller its completed transfer failed invites them to
// send it again under a fresh key, which is a real second debit.
func (p walletPreflight) run(ctx context.Context, senderID string, req WalletTransferRequest) (*WalletTransfer, *WalletTransferResolveResponse, error) {
	// DB-free pre-flight: Idempotency-Key required, positive kobo amount, phone present.
	if err := ValidateWalletTransferRequest(req); err != nil {
		return nil, nil, err
	}

	// Replay first: a completed key returns the prior transfer, never reaching
	// the gates below (which could now refuse it — see run's doc).
	prior, err := p.findReplay(ctx, req.IdempotencyKey)
	if err != nil {
		return nil, nil, err
	}
	if prior != nil {
		return prior, nil, nil
	}

	// Transaction PIN (second factor) — fail-closed, before recipient
	// resolution and before any money movement. WAL-002: this rail ran with
	// no PIN check at all, so a Bearer token alone could drain a funded
	// wallet; the bank-transfer rails and the BFF pin-guard both verify the
	// PIN before resolving the counterparty, so this rail now matches them.
	if err := p.verifyPIN(ctx, senderID, req.PIN); err != nil {
		return nil, nil, err
	}

	recipient, err := p.resolve(ctx, req.RecipientPhone)
	if err != nil {
		return nil, nil, err
	}
	if recipient.UserID == senderID {
		return nil, nil, ErrSelfTransfer // → 422
	}

	// Tier guard (fail-closed): Tier 0 / over daily cap → 403.
	if err := p.enforceTier(ctx, senderID, req.AmountKobo); err != nil {
		return nil, nil, err
	}
	return nil, recipient, nil
}

// findWalletTransferByKey returns the transfer previously recorded under this
// idempotency key BY THIS SENDER, or (nil, nil) when the key is new for them.
// The lookup is scoped to the caller: replaying on key alone would hand any
// caller another user's completed transfer — sender, recipient and amount —
// on a guessed key. A foreign key colliding on insert is instead the durable
// signal of a cross-user clash, mapped to ErrIdempotencyKeyConflict there.
// A lookup failure is deliberately read as "new key" rather than surfaced: it
// preserves the prior behaviour, and wallet_transfers.idempotency_key is UNIQUE,
// so a genuine duplicate still cannot insert a second time.
func (s *Service) findWalletTransferByKey(ctx context.Context, senderID, key string) (*WalletTransfer, error) {
	var existingID string
	const checkDup = `SELECT id FROM wallet_transfers WHERE idempotency_key = $1 AND sender_id = $2 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, key, senderID).Scan(&existingID)
	if existingID == "" {
		return nil, nil
	}
	return s.getWalletTransfer(ctx, existingID)
}

// InitiateWalletToWallet executes a wallet-to-wallet transfer atomically via
// the transfer_wallet_atomic() Supabase RPC (mirrors block-10 logic).
func (s *Service) InitiateWalletToWallet(ctx context.Context, senderID string, req WalletTransferRequest) (*WalletTransfer, error) {
	prior, recipient, err := walletPreflight{
		// Caller-scoped replay: only THIS sender's key short-circuits.
		findReplay: func(ctx context.Context, key string) (*WalletTransfer, error) {
			return s.findWalletTransferByKey(ctx, senderID, key)
		},
		verifyPIN:   s.pins.Verify,
		resolve:     s.ResolvePaymaxUser,
		enforceTier: s.tiers.EnforceWalletDebitLimit,
	}.run(ctx, senderID, req)
	if err != nil {
		return nil, err
	}
	if prior != nil {
		prior.AlreadyProcessed = true
		return prior, nil
	}

	fee := WalletTransferFee(req.AmountKobo)
	reference := "ww-" + uuid.New().String()

	// Resolve every account BEFORE Begin: GetOrCreate* runs on the pool, and
	// pooled calls made while a tx conn is checked out (holding locks) are the
	// pool-starvation pattern settlement was fixed for (#559) — a tx that
	// blocks waiting for a conn it itself must supply can wedge the pool.
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

	// Use pgx transaction + advisory lock (mirrors transfer_wallet_atomic RPC).
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("transfers: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const lock = `SELECT pg_advisory_xact_lock(hashtext($1))`
	if _, err := tx.Exec(ctx, lock, "wallet:"+senderID); err != nil {
		return nil, fmt.Errorf("transfers: advisory lock: %w", err)
	}

	// Cross-plane serialisation (audit finding: pooled GetBalance read raced
	// the SQL-RPC wallet plane). transfer_wallet_atomic /
	// reserve_for_bank_transfer lock pg_advisory_xact_lock(hashtext(
	// sender_account_id)) — a DIFFERENT key from the Go-plane "wallet:"+uid
	// lock above. Holding BOTH makes the in-tx balance projection below
	// authoritative against either writer. Lock order is fixed (user key
	// first, account key second) and the RPC plane takes only the account
	// key, so no lock cycle is possible.
	if _, err := tx.Exec(ctx, lock, senderAcc.ID); err != nil {
		return nil, fmt.Errorf("transfers: account advisory lock: %w", err)
	}

	// Sufficiency check inside the tx (balanceTx), not the pool: a pooled
	// read cannot observe entries a lock-honouring peer is about to commit,
	// and re-checking here is what closes the double-spend race.
	total := req.AmountKobo + fee
	senderBalance, err := balanceTx(ctx, tx, senderAcc.ID)
	if err != nil {
		return nil, err
	}
	if senderBalance < total {
		return nil, ledger.ErrInsufficientFunds
	}

	const insertEntry = `INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key) VALUES ($1, $2, $3, $4, $5)`
	// A 23505 on any leg means the caller's key (or a leg of it) is already
	// claimed — with the replay lookup caller-scoped, that can only be another
	// user's transfer carrying the same key. Report it as a conflict rather
	// than a server fault.
	if _, err := tx.Exec(ctx, insertEntry, senderAcc.ID, "DEBIT", total, reference, req.IdempotencyKey+":debit"); err != nil {
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrIdempotencyKeyConflict
		}
		return nil, fmt.Errorf("transfers: debit sender: %w", err)
	}
	if _, err := tx.Exec(ctx, insertEntry, recipientAcc.ID, "CREDIT", req.AmountKobo, reference, req.IdempotencyKey+":credit"); err != nil {
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrIdempotencyKeyConflict
		}
		return nil, fmt.Errorf("transfers: credit recipient: %w", err)
	}
	if fee > 0 {
		if _, err := tx.Exec(ctx, insertEntry, revenueAcc.ID, "CREDIT", fee, reference, req.IdempotencyKey+":fee"); err != nil {
			if dbutil.IsUniqueViolation(err) {
				return nil, ErrIdempotencyKeyConflict
			}
			return nil, fmt.Errorf("transfers: credit fee: %w", err)
		}
	}

	const insertTx = `
		INSERT INTO wallet_transfers (sender_id, receiver_id, amount_kobo, fee_kobo, reference, status, idempotency_key)
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
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrIdempotencyKeyConflict
		}
		return nil, fmt.Errorf("transfers: insert wallet_transfers: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("transfers: commit: %w", err)
	}
	// fee == 0 (transfers ≤ ₦5,000) ⇒ nothing earned ⇒ record nothing.
	if fee > 0 {
		s.recordCommissionSafe(ctx, "Money Transfer", wt.AmountKobo, wt.FeeKobo, wt.ID, &wt.SenderID)
	}
	// Action-level audit event (E2E-X-029): actor = sender, target = recipient.
	// Best-effort; replays returned early above so a duplicate key cannot
	// double-emit.
	s.auditEvent(ctx, senderID, wt.RecipientID, "wallet.transfer.send", wt.ID, map[string]any{
		"amount_kobo": wt.AmountKobo,
		"fee_kobo":    wt.FeeKobo,
		"reference":   wt.Reference,
	})
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

	// Idempotency replay — CALLER-SCOPED: only this user's prior transfer
	// under the key short-circuits. Replaying on key alone would hand the
	// caller another user's bank transfer (account number, name, amount) on a
	// guessed key; a foreign key instead falls through and the unique
	// constraint on insert reports the clash as ErrIdempotencyKeyConflict.
	var existingID string
	const checkDup = `SELECT id FROM bank_transfers WHERE idempotency_key = $1 AND user_id = $2 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, req.IdempotencyKey, userID).Scan(&existingID)
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

	// Resolve BEFORE reserving funds: bank_transfers requires bank_name/
	// account_name/account_number_last4/paystack_recipient_code NOT NULL.
	// Read-only — no money moves yet.
	accName, _, _ := s.registry.ResolveAccountFailover(ctx, req.Provider, req.BankCode, req.AccountNumber)
	accountName := "UNRESOLVED"
	if accName != nil && accName.AccountName != "" {
		accountName = accName.AccountName
	}
	bankName := s.bankName(ctx, req.BankCode)

	// Resolve accounts BEFORE Begin — pooled GetOrCreate* calls must not run
	// while a tx conn is checked out holding advisory locks (#559 pattern).
	userAcc, err := s.ledger.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return nil, err
	}
	suspenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("bank_transfer: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const lock = `SELECT pg_advisory_xact_lock(hashtext($1))`
	if _, err := tx.Exec(ctx, lock, "wallet:"+userID); err != nil {
		return nil, fmt.Errorf("bank_transfer: advisory lock: %w", err)
	}

	// Cross-plane serialisation — same reasoning as InitiateWalletToWallet:
	// the SQL-RPC wallet plane locks hashtext(account_id), the Go plane locks
	// hashtext("wallet:"+uid). Holding both keys, in this order, makes the
	// in-tx balance projection below authoritative against either writer
	// with no lock cycle (the RPC plane takes the account key alone).
	if _, err := tx.Exec(ctx, lock, userAcc.ID); err != nil {
		return nil, fmt.Errorf("bank_transfer: account advisory lock: %w", err)
	}

	// Sufficiency check inside the tx — see InitiateWalletToWallet.
	balance, err := balanceTx(ctx, tx, userAcc.ID)
	if err != nil {
		return nil, err
	}
	if balance < total {
		return nil, ledger.ErrInsufficientFunds
	}

	const insertEntry = `INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key) VALUES ($1, $2, $3, $4, $5)`
	// 23505 on a leg or the row below = another user's transfer already claims
	// this key (the replay lookup above is caller-scoped) → 409, not 500.
	if _, err := tx.Exec(ctx, insertEntry, userAcc.ID, "DEBIT", total, reference, LegKey(req.IdempotencyKey, "debit")); err != nil {
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrIdempotencyKeyConflict
		}
		return nil, fmt.Errorf("bank_transfer: debit user: %w", err)
	}
	if _, err := tx.Exec(ctx, insertEntry, suspenseAcc.ID, "CREDIT", total, reference, LegKey(req.IdempotencyKey, "suspense")); err != nil {
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrIdempotencyKeyConflict
		}
		return nil, fmt.Errorf("bank_transfer: credit suspense: %w", err)
	}

	last4 := req.AccountNumber
	if len(last4) > 4 {
		last4 = last4[len(last4)-4:]
	}
	// account_number stores the FULL destination NUBAN (migration
	// 20271009000000) — the payout leg needs it: before the column existed the
	// under-lock re-read overwrote bt.AccountNumber with the 4-digit last4 and
	// the provider leg fired a malformed recipient.
	const insertBT = `
		INSERT INTO bank_transfers
			(user_id, amount_kobo, fee_kobo, bank_code, bank_name, account_number_last4, account_number, account_name,
			 paystack_recipient_code, reference, status, idempotency_key, source_type, provider)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'funds_reserved',$11,'wallet',$12)
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
		Provider:       strutil.Or(req.Provider, s.registry.Default()),
	}
	// paystack_recipient_code is still NOT NULL on the base table — seed with a
	// placeholder; the real provider recipient code lands on the disburse leg.
	if err := tx.QueryRow(ctx, insertBT,
		userID, req.AmountKobo, fee, req.BankCode, bankName, last4, req.AccountNumber, accountName,
		"pending", reference, req.IdempotencyKey, bt.Provider,
	).Scan(&bt.ID, &bt.CreatedAt); err != nil {
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrIdempotencyKeyConflict
		}
		return nil, fmt.Errorf("bank_transfer: insert: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("bank_transfer: commit: %w", err)
	}
	s.audit(ctx, userID, "transfer.bank.reserve", bt.ID, reference)

	// On any provider error we DO NOT roll back the reserve — funds stay parked in
	// suspense (status funds_reserved) for retry/reconciliation. Never double-spend.
	// A lost leg-lock claim (ErrPayoutLegInFlight) just means the leg is already
	// running elsewhere — the reserve stands either way, so the error is logged
	// and the initiated transfer is still returned. The guard is NOT optional: a
	// reversal/settle landing between this commit and the leg claim must stop
	// the provider call, or the leg pays out on an already-refunded row.
	if err := s.initiatePayoutLeg(ctx, bt, req.SaveBeneficiary, req.Provider, req.Narration, requirePayoutableStatus); err != nil {
		log.Printf("[transfers] payout leg claim transfer=%s: %v", bt.ID, err)
	}
	return bt, nil
}

// payoutLegTimeout bounds the WHOLE locked leg — re-read, guard, provider
// HTTP calls, status write. The leg lock is a session-scoped advisory lock on a
// pinned pooled conn; without a deadline a wedged provider call would pin
// `transfers:payout-leg:<id>` until the conn dies, blocking every other leg
// claimant (admin retry, webhook auto-leg) and squandering the conn.
// Two failover-capable providers at the client's 30s HTTP timeout fit inside
// 2 minutes with room to spare.
const payoutLegTimeout = 2 * time.Minute

// requirePayoutableStatus is the shared non-terminal guard every payout-leg
// call site passes: under the claim lock the row is re-read, and this refuses
// the provider call on any status that has no money to disburse — terminal
// outcomes (successful/failed/reversed) and, for bank→bank, awaiting_funding
// (the pay-in has not arrived). The race it closes: a reversal or settle
// landing between the caller's reserve/fund commit and the leg claim would
// otherwise pay out on an already-refunded row (refund + payout double spend).
func requirePayoutableStatus(fresh *BankTransfer) error {
	switch fresh.Status {
	case BankTransferFundsReserved, BankTransferFunded, BankTransferProviderInitiated:
		return nil
	default:
		return fmt.Errorf("transfers: payout leg refused on status %q", fresh.Status)
	}
}

// initiatePayoutLeg runs the provider payout leg under a per-transfer advisory
// lock (claim-then-act, audit finding: concurrent admin retries could
// double-call InitiatePayoutFailover relying only on provider-side dedup of
// bt.Reference). Every path that can fire a payout — initiate, the funding
// webhook's auto-leg, and admin retry — funnels through here, so at most ONE
// caller ever holds the leg at a time; a loser gets ErrPayoutLegInFlight and
// must not fire the provider itself.
//
// guard runs under the lock on a FRESHLY re-read row — the row the
// caller loaded may be stale by the time the claim lands (a webhook could have
// settled it). All call sites pass requirePayoutableStatus; AdminRetry's
// pre-check uses the same gate for its user-facing error.
func (s *Service) initiatePayoutLeg(ctx context.Context, bt *BankTransfer, saveBeneficiary bool, preferred, narration string, guard func(*BankTransfer) error) error {
	if s.registry == nil {
		return nil
	}
	// Claim-then-act: the session-scoped per-transfer lock serialises every
	// payout-leg claimant (initiate, the funding webhook's auto-leg, admin
	// retry — and AdminReverse, which holds the same lock while it settles).
	// A loser gets ErrPayoutLegInFlight and must not touch the provider or the
	// transfer's money itself.
	release, err := s.acquirePayoutLegLock(ctx, bt.ID)
	if err != nil {
		return err
	}
	defer release()

	// Bound the locked section so a wedged provider cannot pin the lock/conn
	// until connection death (LOW finding). The unlock above uses the outer ctx
	// (WithoutCancel), so expiry here never strands the lock.
	legCtx, legCancel := context.WithTimeout(ctx, payoutLegTimeout)
	defer legCancel()

	// Re-read under the lock: the caller's bt may predate a concurrent status
	// move; the leg and the guard must act on the freshest row. A failed
	// re-read is propagated — proceeding on the stale snapshot is exactly how
	// a leg fires on a row that already settled.
	fresh, err := s.getBankTransfer(legCtx, bt.ID)
	if err != nil {
		return fmt.Errorf("transfers: payout leg re-read transfer=%s: %w", bt.ID, err)
	}
	*bt = *fresh
	if guard != nil {
		if err := guard(bt); err != nil {
			return err
		}
	}
	// provider_initiated means a payout was ALREADY fired at the provider once
	// (provider_transfer_ref is the receipt). Providers do not dedupe on our
	// reference, so re-firing is a second real payout — reconcile the fired
	// payout's outcome instead of blind retry (MED-3).
	if bt.Status == BankTransferProviderInitiated {
		return s.reconcileFiredLeg(legCtx, bt)
	}
	return s.runPayoutLeg(legCtx, bt, saveBeneficiary, preferred, narration)
}

// reconcileFiredLeg handles a leg claimant that found the row already at
// provider_initiated — the payout was fired but the webhook hasn't settled it
// (or was lost). It queries the provider by provider_transfer_ref:
//
//   - provider reports failed/reversed → settle that terminal outcome (refund
//     to source). Only a REAL provider answer can produce failure: the
//     registry's liveWrap mock fallback always reports "successful".
//   - provider reports successful/pending/anything else, or cannot answer →
//     ErrPayoutAlreadyFired: never re-fire a second payout. A polled
//     "successful" is deliberately NOT settled — liveWrap degrades transport
//     errors to a fabricated mock "successful", so only a signed webhook may
//     sweep suspense → settlement. Residual: a transfer whose success webhook
//     was lost stays held at provider_initiated until manual reconciliation.
//   - no provider_transfer_ref → the fired payout is unverifiable; fail closed.
func (s *Service) reconcileFiredLeg(ctx context.Context, bt *BankTransfer) error {
	ref := ""
	if bt.ProviderTransferRef != nil {
		ref = *bt.ProviderTransferRef
	}
	if ref == "" {
		return fmt.Errorf("transfers: %s is provider_initiated but has no provider_transfer_ref — the fired payout is unverifiable; refusing to re-fire (reconcile with the provider, then reverse or retry)", bt.ID)
	}
	p, ok := s.registry.ByName(bt.Provider)
	if !ok {
		return fmt.Errorf("transfers: provider %q not registered — cannot verify fired payout %s for %s; refusing to re-fire", bt.Provider, ref, bt.ID)
	}
	st, err := p.GetTransferStatus(ctx, ref)
	if err == nil && st == nil {
		err = errors.New("provider returned an empty status")
	}
	if err != nil {
		return fmt.Errorf("transfers: provider status check failed for %s (ref %s): %w — refusing to re-fire an unverified payout", bt.ID, ref, err)
	}
	if next, _, known := ClassifyWebhookStatus(st.Status); known &&
		(next == BankTransferFailed || next == BankTransferReversed) {
		if err := s.settleTransfer(ctx, bt, next); err != nil {
			return fmt.Errorf("transfers: reconcile settle %s for %s: %w", next, bt.ID, err)
		}
		return nil
	}
	return ErrPayoutAlreadyFired
}

// runPayoutLeg is the lock-free inner leg — call ONLY via initiatePayoutLeg.
// It resolves a recipient (reusing cached codes), creates one with the provider
// when missing, calls the registry payout with failover, and on success
// persists the provider routing fields + advances to provider_initiated.
// On provider error the transfer is left in its reserved/funded hold state.
func (s *Service) runPayoutLeg(ctx context.Context, bt *BankTransfer, saveBeneficiary bool, preferred, narration string) error {
	if s.registry == nil {
		return nil
	}
	// Fail closed on a missing/malformed destination: rows written before
	// bank_transfers.account_number existed carry only the 4-digit last4 — the
	// defect that sent a truncated "account number" to the provider. A
	// non-NUBAN value holds the row for reconciliation instead of firing.
	if !looksLikeNUBAN(bt.AccountNumber) {
		s.audit(ctx, bt.UserID, "transfer.bank.payout_refused_missing_account_number", bt.ID, bt.Reference)
		return fmt.Errorf("transfers: transfer %s has no full account number on file: %w", bt.ID, ErrPayoutAccountMissing)
	}
	accName := bt.AccountName
	if accName == "" || accName == "UNRESOLVED" {
		if res, _, err := s.registry.ResolveAccountFailover(ctx, preferred, bt.BankCode, bt.AccountNumber); err == nil && res != nil {
			accName = res.AccountName
		}
	}
	// Recipient cache is keyed by the FULL account number — keyed by last4 it
	// collided across different NUBANs, letting a cached recipient code be
	// reused for a different destination.
	cached := s.cachedRecipients(ctx, bt.UserID, bt.BankCode, bt.AccountNumber)

	result, err := s.registry.InitiatePayoutFailover(ctx, preferred,
		provider.RecipientRequest{AccountName: accName, AccountNumber: bt.AccountNumber, BankCode: bt.BankCode, Currency: "NGN"},
		cached, bt.AmountKobo, bt.Reference, narration)
	if err != nil {
		// Hold funds; a later retry / admin retry resolves it.
		s.audit(ctx, bt.UserID, "transfer.bank.provider_error", bt.ID, err.Error())
		return nil
	}

	// Terminal-guarded status write: a settle webhook that landed while the
	// provider call was in flight must never be overwritten back to
	// provider_initiated — a terminal outcome is authoritative.
	const up = `
		UPDATE bank_transfers
		SET status='provider_initiated', provider=$2, provider_recipient_code=$3,
		    provider_transfer_ref=$4, provider_transfer_code=$4, failover_from=$5,
		    account_name=COALESCE(NULLIF($6,''), account_name)
		WHERE id=$1 AND status NOT IN ('successful','failed','reversed')`
	var failoverFrom *string
	if result.FailoverFrom != "" {
		failoverFrom = &result.FailoverFrom
	}
	tag, err := s.db.Exec(ctx, up, bt.ID, result.Provider, result.RecipientCode, result.Response.ProviderRef, failoverFrom, accName)
	if err != nil {
		// The provider ALREADY accepted real money but we failed to persist the
		// receipt (provider_transfer_ref) — without it, provider-ref webhook
		// routing wedges and a retry cannot verify the fired payout. Loud
		// critical audit + error surface; reconciliation keys on bt.Reference.
		log.Printf("[transfers] CRITICAL: provider payout accepted but persist failed transfer=%s provider=%s provider_ref=%s: %v",
			bt.ID, result.Provider, result.Response.ProviderRef, err)
		s.emitAudit(bt.UserID, "", "transfer.bank.provider_payout_unpersisted", bt.ID, map[string]any{
			"provider":     result.Provider,
			"provider_ref": result.Response.ProviderRef,
			"reference":    bt.Reference,
			"error":        err.Error(),
		}, "critical")
		return fmt.Errorf("transfers: persist provider_initiated transfer=%s (provider already paid out, ref=%s): %w",
			bt.ID, result.Response.ProviderRef, err)
	}
	if tag.RowsAffected() == 0 {
		// Settled (or removed) while the payout was in flight — leave the
		// terminal status and the in-memory view untouched.
		return nil
	}
	bt.Status = BankTransferProviderInitiated
	bt.Provider = result.Provider
	bt.ProviderRecipientCode = &result.RecipientCode
	pref := result.Response.ProviderRef
	bt.ProviderTransferRef = &pref
	bt.FailoverFrom = failoverFrom
	if accName != "" {
		bt.AccountName = accName
	}

	if accName != "" {
		s.cacheRecipient(ctx, bt.UserID, result.Provider, bt.BankCode, bt.AccountNumber, accName, result.RecipientCode)
	}
	if saveBeneficiary && accName != "" {
		s.saveBeneficiaryRow(ctx, bt.UserID, result.Provider, bt.BankCode, bt.AccountNumber, accName, result.RecipientCode)
	}
	s.audit(ctx, bt.UserID, "transfer.bank.provider_initiated", bt.ID, result.Provider)
	return nil
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
		return nil, ErrInvalidAccountNumber // malformed request → 400, not the 404 lookup sentinel
	}
	if s.registry == nil {
		return nil, ErrProviderUnavailable
	}

	// Idempotency replay — caller-scoped (same rule as the wallet→bank rail):
	// a key another user owns must never replay their transfer back; it falls
	// through and the unique constraint on insert reports the 409 clash.
	var existingID string
	const checkDup = `SELECT id FROM bank_transfers WHERE idempotency_key = $1 AND user_id = $2 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, req.IdempotencyKey, userID).Scan(&existingID)
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
			(user_id, amount_kobo, fee_kobo, bank_code, bank_name, account_number_last4, account_number, account_name,
			 paystack_recipient_code, reference, status, idempotency_key, source_type, provider,
			 funding_reference, funding_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'awaiting_funding',$11,'bank',$12,$13,'pending')
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
		Provider:       strutil.Or(req.Provider, s.registry.Default()),
	}
	fr := fundingRef
	bt.FundingReference = &fr
	if err := s.db.QueryRow(ctx, insertBT,
		userID, req.AmountKobo, fee, req.BankCode, bankName, last4, req.AccountNumber, accountName,
		"pending", reference, req.IdempotencyKey, bt.Provider, fundingRef,
	).Scan(&bt.ID, &bt.CreatedAt); err != nil {
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrIdempotencyKeyConflict
		}
		return nil, fmt.Errorf("bank_to_bank: insert: %w", err)
	}
	s.audit(ctx, userID, "transfer.bank_to_bank.awaiting_funding", bt.ID, fundingRef)
	return bt, nil
}

// markFunded handles a funding (collection) webhook for a bank→bank transfer:
// posts DR provider_clearing(amount+fee) → CR suspense, advances to funded, then
// auto-initiates the payout leg from suspense (same as wallet→bank). Idempotent.
//
// ATOMICITY: the funding journal and the status UPDATE share ONE transaction.
// The previous shape posted the journal in its own tx and flipped the status in
// a separate pooled exec — a crash between the two left the row at
// 'awaiting_funding' with the ledger already moved (self-healing on replay, but
// a real window). Now either both land or neither does. Replays still no-op:
// the leg inserts carry ON CONFLICT DO NOTHING and the UPDATE stays guarded by
// status='awaiting_funding'.
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

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("bank_to_bank funded: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// DR provider_clearing → CR suspense (the collected money is parked for payout).
	if err := insertJournalLegTx(ctx, tx, bt.Reference, LegKey(bt.IdempotencyKey, LegFund), total, clearingAcc.ID, suspenseAcc.ID); err != nil {
		return fmt.Errorf("bank_to_bank funded: post journal: %w", err)
	}
	const up = `UPDATE bank_transfers SET status='funded', funding_status='successful' WHERE id=$1 AND status='awaiting_funding'`
	tag, err := tx.Exec(ctx, up, bt.ID)
	if err != nil {
		return fmt.Errorf("bank_to_bank funded: update: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// A racing markFunded already committed (or the row moved on) — the
		// deferred rollback drops our duplicate leg inserts with it.
		return nil
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("bank_to_bank funded: commit: %w", err)
	}
	bt.Status = BankTransferFunded
	s.audit(ctx, bt.UserID, "transfer.bank_to_bank.funded", bt.ID, bt.Reference)
	// Auto-initiate the payout leg (mirrors wallet→bank disburse from suspense).
	// A lost leg-lock claim means the leg is already running elsewhere. The
	// non-terminal guard is required: a settle/reversal landing between the
	// funded commit and the leg claim must not pay out on a refunded row.
	if err := s.initiatePayoutLeg(ctx, bt, false, bt.Provider, "", requirePayoutableStatus); err != nil {
		log.Printf("[transfers] funded payout leg claim transfer=%s: %v", bt.ID, err)
	}
	return nil
}

func (s *Service) getWalletTransfer(ctx context.Context, id string) (*WalletTransfer, error) {
	const q = `SELECT id, sender_id, receiver_id, amount_kobo, fee_kobo, reference, status, idempotency_key, created_at FROM wallet_transfers WHERE id=$1`
	wt := &WalletTransfer{}
	var status string
	err := s.db.QueryRow(ctx, q, id).Scan(&wt.ID, &wt.SenderID, &wt.RecipientID, &wt.AmountKobo, &wt.FeeKobo, &wt.Reference, &status, &wt.IdempotencyKey, &wt.CreatedAt)
	wt.Status = WalletTransferStatus(status)
	return wt, err
}

// bankTransferCols is the column list every bank_transfers read shares — keep
// it in lockstep with scanBankTransfer's Scan targets. account_number (the FULL
// NUBAN, migration 20271009000000) feeds the payout leg; account_number_last4
// is the display field. account_number is NULL on pre-migration rows → the
// scan leaves BankTransfer.AccountNumber empty and the leg fails closed.
const bankTransferCols = `
	id, user_id, amount_kobo, fee_kobo, account_number_last4, account_number, account_name, bank_code,
	reference, status, idempotency_key, provider, source_type,
	provider_recipient_code, provider_transfer_ref, failover_from,
	funding_reference, funding_status, created_at`

func (s *Service) getBankTransfer(ctx context.Context, id string) (*BankTransfer, error) {
	const q = `SELECT ` + bankTransferCols + ` FROM bank_transfers WHERE id=$1`
	return s.scanBankTransfer(s.db.QueryRow(ctx, q, id))
}

func (s *Service) getBankTransferByRef(ctx context.Context, reference string) (*BankTransfer, error) {
	const q = `SELECT ` + bankTransferCols + ` FROM bank_transfers WHERE reference=$1 LIMIT 1`
	return s.scanBankTransfer(s.db.QueryRow(ctx, q, reference))
}

func (s *Service) getBankTransferByProviderRef(ctx context.Context, providerRef string) (*BankTransfer, error) {
	const q = `SELECT ` + bankTransferCols + ` FROM bank_transfers WHERE provider_transfer_ref=$1 LIMIT 1`
	return s.scanBankTransfer(s.db.QueryRow(ctx, q, providerRef))
}

func (s *Service) getBankTransferByFundingRef(ctx context.Context, fundingRef string) (*BankTransfer, error) {
	const q = `SELECT ` + bankTransferCols + ` FROM bank_transfers WHERE funding_reference=$1 LIMIT 1`
	return s.scanBankTransfer(s.db.QueryRow(ctx, q, fundingRef))
}

type rowScanner interface {
	Scan(dest ...any) error
}

func (s *Service) scanBankTransfer(row rowScanner) (*BankTransfer, error) {
	bt := &BankTransfer{}
	var status string
	// account_number is nullable (pre-migration rows) — scan into a pointer
	// and leave AccountNumber empty rather than aliasing it to last4.
	var acctNum *string
	err := row.Scan(&bt.ID, &bt.UserID, &bt.AmountKobo, &bt.FeeKobo, &bt.AccountNumberLast4, &acctNum, &bt.AccountName, &bt.BankCode,
		&bt.Reference, &status, &bt.IdempotencyKey, &bt.Provider, &bt.SourceType,
		&bt.ProviderRecipientCode, &bt.ProviderTransferRef, &bt.FailoverFrom,
		&bt.FundingReference, &bt.FundingStatus, &bt.CreatedAt)
	if acctNum != nil {
		bt.AccountNumber = *acctNum
	}
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
// ATOMICITY: every journal leg and the status flip commit in ONE transaction.
// The previous shape committed each journal in its own tx and then ran the
// status UPDATE on the pool — a crash between them left 'funds_reserved' with
// the ledger already moved, and two racing opposite webhooks (success + failed)
// could each post their legs before the last status write won. Now the CAS
// UPDATE (`status NOT IN terminal`) is the arbiter inside the same tx: a racing
// settle sees 0 rows and its duplicate leg inserts roll back with it.
// All legs keep per-leg idempotency keys (ON CONFLICT DO NOTHING inside the
// tx), so a duplicate webhook or a self-healing replay is still a no-op.
func (s *Service) settleTransfer(ctx context.Context, bt *BankTransfer, next BankTransferStatus) error {
	if bt.Status == next {
		return nil // duplicate — already applied
	}
	// Don't move backwards from a terminal state.
	if bt.Status == BankTransferSuccessful || bt.Status == BankTransferFailed || bt.Status == BankTransferReversed {
		return nil
	}
	if next != BankTransferSuccessful && next != BankTransferFailed && next != BankTransferReversed {
		return nil
	}

	suspenseAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		return fmt.Errorf("settle: suspense acct: %w", err)
	}

	// Resolve the remaining accounts up front (idempotent get-or-create reads)
	// so the tx below does inserts + the CAS update only.
	var settlementAcc, revenueAcc, restoreAcc *ledger.Account
	switch next {
	case BankTransferSuccessful:
		settlementAcc, err = s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
		if err != nil {
			return fmt.Errorf("settle: settlement acct: %w", err)
		}
		if bt.FeeKobo > 0 {
			revenueAcc, err = s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
			if err != nil {
				return fmt.Errorf("settle: revenue acct: %w", err)
			}
		}
	case BankTransferFailed, BankTransferReversed:
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
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("settle: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock + re-read the row INSIDE the tx. The leg choice depends on the row's
	// CURRENT state, not the caller's snapshot: a markFunded or a racing settle
	// can land between the two, and a bank-source row at awaiting_funding holds
	// NO money in suspense at all — settling that snapshot would mint ledger
	// entries with nothing behind them (a phantom refund crediting
	// provider_clearing, or a phantom payout sweep into settlement). FOR UPDATE
	// serialises against markFunded's status flip, the payout leg's
	// provider_initiated write, and any concurrent settle on the same row: a
	// blocked read resumes on the post-commit version.
	var freshStatus, freshSource string
	err = tx.QueryRow(ctx,
		`SELECT status, source_type FROM bank_transfers WHERE id=$1 FOR UPDATE`, bt.ID).
		Scan(&freshStatus, &freshSource)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // row vanished — nothing to settle, and legs must not post
	}
	if err != nil {
		return fmt.Errorf("settle: lock row %s: %w", bt.ID, err)
	}
	switch BankTransferStatus(freshStatus) {
	case BankTransferSuccessful, BankTransferFailed, BankTransferReversed:
		return nil // terminal already — duplicate settle, no-op
	case BankTransferFundsReserved, BankTransferAwaitingFunding, BankTransferFunded, BankTransferProviderInitiated:
		// non-terminal — fall through to the leg selection below
	default:
		return fmt.Errorf("settle: transfer %s has unknown status %q — refusing to post legs", bt.ID, freshStatus)
	}
	// unfunded: a bank→bank row still awaiting its collection. No fund leg has
	// posted, so suspense holds nothing for this transfer.
	unfunded := SourceType(freshSource) == SourceBank &&
		BankTransferStatus(freshStatus) == BankTransferAwaitingFunding

	switch next {
	case BankTransferSuccessful:
		if unfunded {
			// A 'successful' outcome here can only be a misrouted/forged webhook —
			// the payout leg refuses awaiting_funding, so no provider call ever
			// ran and there is nothing to sweep. Fail closed.
			return fmt.Errorf("transfers: cannot settle %s successful — pay-in never arrived (awaiting_funding)", bt.ID)
		}
		// Sweep the amount: DR suspense → CR settlement (money has left the building).
		if err := insertJournalLegTx(ctx, tx, bt.Reference, LegKey(bt.IdempotencyKey, LegSettle), bt.AmountKobo, suspenseAcc.ID, settlementAcc.ID); err != nil {
			return fmt.Errorf("settle: sweep amount: %w", err)
		}
		// Recognize the fee: DR suspense(fee) → CR paymax_revenue.
		if bt.FeeKobo > 0 {
			if err := insertJournalLegTx(ctx, tx, bt.Reference, LegKey(bt.IdempotencyKey, LegFeeRev), bt.FeeKobo, suspenseAcc.ID, revenueAcc.ID); err != nil {
				return fmt.Errorf("settle: recognize fee: %w", err)
			}
		}
	case BankTransferFailed, BankTransferReversed:
		if unfunded {
			// Bare cancellation: nothing was collected, so there is no hold to
			// refund — posting the reversal pair would mint amount+fee into the
			// restore account against a suspense hold that never existed. The
			// status flip below is the whole transition.
			break
		}
		// Reverse the hold back to the source: REVERSAL_DEBIT to the restore account,
		// REVERSAL_CREDIT draining suspense.
		rev := BuildReversalEntry(bt.Reference, restoreAcc.ID, suspenseAcc.ID, bt.AmountKobo+bt.FeeKobo, bt.IdempotencyKey, next)
		if err := insertReversalLegTx(ctx, tx, rev.Reference, rev.IdempotencyKey, rev.AmountKobo, rev.UserAccountID, rev.SuspenseAccountID); err != nil {
			return fmt.Errorf("settle: post reversal: %w", err)
		}
	}

	// CAS terminal claim: a concurrent settle that already committed leaves 0
	// rows here and our duplicate leg inserts roll back via the defer.
	const upQ = `UPDATE bank_transfers SET status=$1 WHERE id=$2 AND status NOT IN ('successful','failed','reversed')`
	tag, err := tx.Exec(ctx, upQ, string(next), bt.ID)
	if err != nil {
		return fmt.Errorf("settle: update status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil // racing settle won — nothing to commit
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("settle: commit: %w", err)
	}
	bt.Status = next
	s.audit(ctx, bt.UserID, "transfer.bank.settle."+string(next), bt.ID, bt.Reference)
	// Profit only on a SUCCESSFUL settlement with a charged fee — failed/reversed
	// settlements refund the fee.
	if next == BankTransferSuccessful && bt.FeeKobo > 0 {
		s.recordCommissionSafe(ctx, "Money Transfer", bt.AmountKobo, bt.FeeKobo, bt.ID, &bt.UserID)
	}
	return nil
}

// Transaction PIN — bcrypt-hashed second factor for money movement.
// Backed by user_transaction_pin (migration 20260819000000). bcrypt embeds its
// own salt, so the table needs only pin_hash (matches the locked schema). The
// raw PIN is never stored or logged. Lockout: maxPinFailures wrong attempts →
// locked for pinLockWindow. Every transfer initiate verifies the PIN
// fail-closed (a missing PIN, lock, or DB error all block the money path).

const (
	maxPinFailures = 5
	pinLockWindow  = 15 * time.Minute
)

// PinAttemptError carries how many tries remain before the lockout bites.
// Without it every wrong PIN looks identical to the customer, who then guesses
// their way into a 15-minute lock with no warning that they were one attempt
// away. errors.Is still matches the wrapped sentinel, so every existing status
// and code mapping is unaffected.
type PinAttemptError struct {
	Err       error
	Remaining int
}

func (e *PinAttemptError) Error() string { return e.Err.Error() }
func (e *PinAttemptError) Unwrap() error { return e.Err }

// pinStore wraps user_transaction_pin access.
type pinStore struct {
	db *pgxpool.Pool
}

func newPinStore(db *pgxpool.Pool) *pinStore { return &pinStore{db: db} }

func validPinFormat(pin string) bool {
	if len(pin) < 4 || len(pin) > 6 {
		return false
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

type pinRow struct {
	Hash           string
	FailedAttempts int
	LockedUntil    *time.Time
}

func (p *pinStore) get(ctx context.Context, userID string) (*pinRow, error) {
	var r pinRow
	err := p.db.QueryRow(ctx,
		`SELECT pin_hash, failed_attempts, locked_until FROM user_transaction_pin WHERE user_id=$1`, userID).
		Scan(&r.Hash, &r.FailedAttempts, &r.LockedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPinNotSet
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// Has reports whether a PIN exists for the user.
func (p *pinStore) Has(ctx context.Context, userID string) (bool, error) {
	_, err := p.get(ctx, userID)
	if errors.Is(err, ErrPinNotSet) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// Set creates or replaces the PIN (bcrypt) and resets lockout state.
func (p *pinStore) Set(ctx context.Context, userID, pin string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO user_transaction_pin (user_id, pin_hash, failed_attempts, locked_until)
		VALUES ($1, $2, 0, NULL)
		ON CONFLICT (user_id) DO UPDATE
		SET pin_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now()`
	_, err = p.db.Exec(ctx, q, userID, string(hash))
	return err
}

// Verify checks the PIN fail-closed: not set / locked / wrong all return a typed
// error. A correct PIN resets failed_attempts; a wrong one increments it and
// locks the account at the threshold.
func (p *pinStore) Verify(ctx context.Context, userID, pin string) error {
	row, err := p.get(ctx, userID)
	if err != nil {
		return err // ErrPinNotSet or DB error (fail closed)
	}
	if row.LockedUntil != nil && row.LockedUntil.After(time.Now()) {
		return ErrPinLocked
	}
	if bcrypt.CompareHashAndPassword([]byte(row.Hash), []byte(pin)) == nil {
		_, _ = p.db.Exec(ctx,
			`UPDATE user_transaction_pin SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`, userID)
		return nil
	}
	// Wrong PIN — record failure, lock at threshold.
	if row.FailedAttempts+1 >= maxPinFailures {
		_, _ = p.db.Exec(ctx,
			`UPDATE user_transaction_pin SET failed_attempts=$2, locked_until=$3, updated_at=now() WHERE user_id=$1`,
			userID, row.FailedAttempts+1, time.Now().Add(pinLockWindow))
		return ErrPinLocked
	}
	_, _ = p.db.Exec(ctx,
		`UPDATE user_transaction_pin SET failed_attempts=$2, updated_at=now() WHERE user_id=$1`, userID, row.FailedAttempts+1)
	return &PinAttemptError{Err: ErrPinInvalid, Remaining: maxPinFailures - (row.FailedAttempts + 1)}
}

// WalletTransferStatus tracks the lifecycle of a wallet-to-wallet transfer.
type WalletTransferStatus string

const (
	// WalletTransferSuccessful — Status values align with contracts/openapi.yaml WalletTransfer.status
	// enum: [successful, failed, reversed].
	WalletTransferSuccessful WalletTransferStatus = "successful"
	WalletTransferFailed     WalletTransferStatus = "failed"
	WalletTransferReversed   WalletTransferStatus = "reversed"
)

// BankTransferStatus tracks the lifecycle of a wallet-to-bank transfer.
type BankTransferStatus string

const (
	BankTransferFundsReserved     BankTransferStatus = "funds_reserved"     // wallet→bank: wallet debited, awaiting provider
	BankTransferAwaitingFunding   BankTransferStatus = "awaiting_funding"   // bank→bank: collection initiated, awaiting pay-in
	BankTransferFunded            BankTransferStatus = "funded"             // bank→bank: pay-in received into clearing
	BankTransferProviderInitiated BankTransferStatus = "provider_initiated" // payout accepted by the provider
	BankTransferSuccessful        BankTransferStatus = "successful"
	BankTransferFailed            BankTransferStatus = "failed"
	BankTransferReversed          BankTransferStatus = "reversed"
)

// SourceType distinguishes wallet→bank from bank→bank pass-through.
type SourceType string

const (
	SourceWallet SourceType = "wallet" // debit the user wallet
	SourceBank   SourceType = "bank"   // collect via provider into provider_clearing, then disburse
)

// WalletTransfer represents a wallet-to-wallet transfer.
type WalletTransfer struct {
	ID             string               `json:"id"`
	SenderID       string               `json:"sender_id"`
	RecipientID    string               `json:"recipient_id"`
	AmountKobo     int64                `json:"amount_kobo"`
	FeeKobo        int64                `json:"fee_kobo"`
	Reference      string               `json:"reference"`
	Status         WalletTransferStatus `json:"status"`
	IdempotencyKey string               `json:"idempotency_key"`
	CreatedAt      time.Time            `json:"created_at"`
	// AlreadyProcessed is true when this result was returned by an idempotent
	// replay (same Idempotency-Key seen before) rather than a fresh mutation.
	AlreadyProcessed bool `json:"already_processed,omitempty"`
}

// WalletTransferRequest is the body for POST /finance/transfers/paymax.
type WalletTransferRequest struct {
	RecipientPhone string `json:"recipient_phone" binding:"required"`
	AmountKobo     int64  `json:"amount_kobo" binding:"required,min=100"`
	Narration      string `json:"narration"`
	// Transaction PIN — the second factor every money movement requires. Not
	// binding-required because an absent PIN must fail closed via pins.Verify
	// (missing/invalid both surface as a typed PIN error, same as the bank
	// rails), not as a generic binding 400.
	PIN string `json:"pin"`
	// Not binding-required: the Idempotency-Key header supplies it for header-only
	// callers, and the handlers merge the header before validating non-empty.
	IdempotencyKey string `json:"idempotency_key"`
}

// WalletTransferResolveResponse is the response for GET /finance/transfers/paymax/resolve.
type WalletTransferResolveResponse struct {
	UserID      string `json:"user_id"`
	FullName    string `json:"full_name"`
	MaskedPhone string `json:"masked_phone"`
}

// BankTransfer represents a wallet-to-bank or bank-to-bank transfer.
type BankTransfer struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	AmountKobo int64  `json:"amount_kobo"`
	FeeKobo    int64  `json:"fee_kobo"`
	// AccountNumber is the FULL destination NUBAN (bank_transfers.account_number)
	// — it feeds the provider payout leg and the recipient/beneficiary cache
	// keys. Empty on rows written before migration 20271009000000; the leg
	// fails closed on those rather than send a truncated number.
	AccountNumber string `json:"account_number"`
	// AccountNumberLast4 is the display field (bank_transfers.account_number_last4).
	AccountNumberLast4 string             `json:"account_number_last4"`
	AccountName        string             `json:"account_name"`
	BankCode           string             `json:"bank_code"`
	Reference          string             `json:"reference"`
	Status             BankTransferStatus `json:"status"`
	TransferCode       *string            `json:"transfer_code,omitempty"`
	IdempotencyKey     string             `json:"idempotency_key"`
	CreatedAt          time.Time          `json:"created_at"`
	// Multi-provider + bank→bank fields (additive; mirror the migration columns).
	Provider              string  `json:"provider"`
	SourceType            string  `json:"source_type"`
	ProviderRecipientCode *string `json:"provider_recipient_code,omitempty"`
	ProviderTransferRef   *string `json:"provider_transfer_ref,omitempty"`
	FailoverFrom          *string `json:"failover_from,omitempty"`
	FundingReference      *string `json:"funding_reference,omitempty"`
	FundingStatus         *string `json:"funding_status,omitempty"`
	// AlreadyProcessed is true when returned by an idempotent replay.
	AlreadyProcessed bool `json:"already_processed,omitempty"`
}

// BankTransferRequest is the body for POST /finance/transfers/bank (wallet→bank).
type BankTransferRequest struct {
	AccountNumber   string `json:"account_number" binding:"required"`
	BankCode        string `json:"bank_code" binding:"required"`
	AmountKobo      int64  `json:"amount_kobo" binding:"required,min=100000"` // min ₦1000
	Narration       string `json:"narration"`
	SaveBeneficiary bool   `json:"save_beneficiary"`
	Provider        string `json:"provider"` // optional preferred provider; "" = registry default
	PIN             string `json:"pin" binding:"required"`
	IdempotencyKey  string `json:"idempotency_key"`
}

// BankToBankRequest is the body for POST /finance/transfers/bank-to-bank.
// The user funds the transfer FROM a bank through the provider (a collection into
// provider_clearing); once funded it is disbursed to the destination bank.
type BankToBankRequest struct {
	AccountNumber   string `json:"account_number" binding:"required"`
	BankCode        string `json:"bank_code" binding:"required"`
	AmountKobo      int64  `json:"amount_kobo" binding:"required,min=100000"`
	Narration       string `json:"narration"`
	SaveBeneficiary bool   `json:"save_beneficiary"`
	Provider        string `json:"provider"`
	PIN             string `json:"pin" binding:"required"`
	IdempotencyKey  string `json:"idempotency_key"`
}

// Beneficiary is a saved payout destination (generalized, multi-provider).
type Beneficiary struct {
	ID                    string    `json:"id"`
	UserID                string    `json:"user_id"`
	Provider              string    `json:"provider"`
	BankCode              string    `json:"bank_code"`
	AccountNumber         string    `json:"account_number"`
	AccountName           string    `json:"account_name"`
	ProviderRecipientCode *string   `json:"provider_recipient_code,omitempty"`
	CreatedAt             time.Time `json:"created_at"`
}

// SaveBeneficiaryRequest is the body for POST /finance/transfers/beneficiaries.
type SaveBeneficiaryRequest struct {
	AccountNumber string `json:"account_number" binding:"required"`
	BankCode      string `json:"bank_code" binding:"required"`
	Provider      string `json:"provider"`
}

// ResolveAccountRequest is the body for POST /finance/transfers/resolve-account.
type ResolveAccountRequest struct {
	AccountNumber string `json:"account_number" binding:"required"`
	BankCode      string `json:"bank_code" binding:"required"`
	Provider      string `json:"provider"`
}

// SetPinRequest is the body for POST /finance/transfers/pin.
type SetPinRequest struct {
	PIN        string `json:"pin" binding:"required"`
	CurrentPIN string `json:"current_pin"`
}

// VerifyPinRequest is the body for POST /finance/transfers/pin/verify.
type VerifyPinRequest struct {
	PIN string `json:"pin" binding:"required"`
}

// WalletTransferFee returns the wallet→wallet fee in kobo (banded schedule).
func WalletTransferFee(amountKobo int64) int64 {
	switch {
	case amountKobo <= 500_000:
		return 0
	case amountKobo <= 5_000_000:
		return 1_000
	default:
		return 2_500
	}
}

// BankTransferFee returns the wallet→bank fee in kobo (banded schedule).
func BankTransferFee(amountKobo int64) int64 {
	switch {
	case amountKobo <= 500_000:
		return 1_000
	case amountKobo <= 5_000_000:
		return 2_500
	default:
		return 5_000
	}
}

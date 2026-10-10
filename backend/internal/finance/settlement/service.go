package settlement

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// Service manages the escrow → settle lifecycle.
// It is the single place where all provider payouts are calculated and posted.
type Service struct {
	db     *pgxpool.Pool
	ledger *ledger.Service
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service) *Service {
	return &Service{db: db, ledger: ledger}
}

// walletDebit is the ledger debit primitive shape Escrow posts through
// (ledger.Service.Debit / DebitGated / DebitWithGuard all satisfy it).
type walletDebit func(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error

// Escrow holds funds when a payment is made, before the provider fulfils the order.
// Called by every marketplace vertical after a successful payment.
// ATOMICITY: the ledger API has no tx-aware Debit, so the money move and the
// settlements-row insert cannot share a tx. Both are idempotent on
// idempotencyKey (":escrow" leg key; UNIQUE(idempotency_key) ON CONFLICT row),
// so a retry converges to exactly one debit and one row — escrow is never
// stranded without a row, and money is never debited twice.
//
// UNGATED: the wallet debit posts via ledger.Debit — no in-tx tier cap. This
// variant remains for paths that intentionally run no user-facing daily-cap
// gate (telemedicine, stays); every gated caller uses EscrowGated (strict) or
// EscrowWithGuard (checkout allowance) so the cap is checked under the wallet
// lock inside the posting tx (F7).
func (s *Service) Escrow(ctx context.Context, payerID, reference, idempotencyKey, moduleType string, totalKobo int64) (*Settlement, error) {
	return s.escrow(ctx, payerID, reference, idempotencyKey, moduleType, totalKobo, s.ledger.Debit)
}

// EscrowGated is Escrow with the strict KYC-tier daily-debit cap evaluated
// inside the debit tx under the wallet advisory lock (ledger.DebitGated) —
// the serialized counterpart every strict-gated caller should use.
func (s *Service) EscrowGated(ctx context.Context, payerID, reference, idempotencyKey, moduleType string, totalKobo int64) (*Settlement, error) {
	return s.escrow(ctx, payerID, reference, idempotencyKey, moduleType, totalKobo, s.ledger.DebitGated)
}

// EscrowWithGuard is Escrow with a caller-chosen in-tx policy guard — the
// consumer-purchase variant: pass tiers.Service.EnforceCheckoutDebitLimitTx so
// a Tier-0 customer's capped checkout allowance (ADR-043) is enforced under
// the lock rather than refused by the strict gate.
func (s *Service) EscrowWithGuard(ctx context.Context, payerID, reference, idempotencyKey, moduleType string, totalKobo int64, guard ledger.DebitGuard) (*Settlement, error) {
	if guard == nil {
		return nil, ledger.ErrDebitGuardUnwired
	}
	return s.escrow(ctx, payerID, reference, idempotencyKey, moduleType, totalKobo,
		func(ctx context.Context, userID, ref, key, creditAcc string, amountKobo int64) error {
			return s.ledger.DebitWithGuard(ctx, userID, ref, key, creditAcc, amountKobo, guard)
		})
}

func (s *Service) escrow(ctx context.Context, payerID, reference, idempotencyKey, moduleType string, totalKobo int64, debit walletDebit) (*Settlement, error) {
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	// ErrDuplicate means the debit already ran on an earlier attempt — proceed
	// to (re)ensure the tracking row rather than erroring the retry.
	if err := debit(ctx, payerID, "escrow:"+reference, idempotencyKey+":escrow", escrowAcc.ID, totalKobo); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return nil, fmt.Errorf("settlement: escrow debit: %w", err)
	}
	now := time.Now()
	sett := &Settlement{
		ID:             uuid.New().String(),
		Reference:      reference,
		ModuleType:     moduleType,
		PayerID:        payerID,
		TotalKobo:      totalKobo,
		Status:         StatusEscrowed,
		EscrowedAt:     now,
		IdempotencyKey: idempotencyKey,
	}
	// ON CONFLICT keeps a retry a safe no-op; the canonical row is re-loaded
	// below so callers get the real settlement id, not the fresh uuid.
	const insert = `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
		VALUES ($1,$2,$3,$4,$5,'escrowed',$6,$7,'wallet')
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err = s.db.Exec(ctx, insert, sett.ID, sett.Reference, sett.ModuleType, sett.PayerID, sett.TotalKobo, sett.EscrowedAt, sett.IdempotencyKey); err != nil {
		return nil, fmt.Errorf("settlement: insert escrow row: %w", err)
	}
	// total_kobo is re-read, NOT echoed from the argument: on a replay the
	// existing row wins and may hold a DIFFERENT amount than this attempt
	// computed. Callers must compare the returned TotalKobo against intent and
	// fail closed on a mismatch.
	if err = s.db.QueryRow(ctx,
		`SELECT id, status, total_kobo FROM settlements WHERE idempotency_key=$1`, idempotencyKey,
	).Scan(&sett.ID, &sett.Status, &sett.TotalKobo); err != nil {
		return nil, fmt.Errorf("settlement: resolve escrow row: %w", err)
	}
	return sett, nil
}

// EscrowExternal holds funds ALREADY COLLECTED by an external payment rail (a
// verified Paystack charge) — the money never touches the payer's wallet, so
// no KYC-tier / daily-debit gate applies (see restaurant.PlaceOrderExternal).
// Posts DR AccountProviderClearing → CR AccountEscrow (externally-collected,
// unallocated money — the commission.postRevenue pattern); there is no wallet
// leg. Downstream (Settle, disputes, reconciliation) is source-agnostic.
// Idempotent exactly like Escrow — a retry converges to one journal + one row.
func (s *Service) EscrowExternal(ctx context.Context, payerID, reference, idempotencyKey, moduleType string, totalKobo int64) (*Settlement, error) {
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, err
	}
	err = s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "escrow:" + reference,
		IdempotencyKey:  idempotencyKey + ":escrow",
		AmountKobo:      totalKobo,
		DebitAccountID:  clearingAcc.ID,
		CreditAccountID: escrowAcc.ID,
		Description:     "Paystack-funded order escrow (external payment, no wallet debit)",
	})
	if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return nil, fmt.Errorf("settlement: external escrow post: %w", err)
	}
	now := time.Now()
	sett := &Settlement{
		ID:             uuid.New().String(),
		Reference:      reference,
		ModuleType:     moduleType,
		PayerID:        payerID,
		TotalKobo:      totalKobo,
		Status:         StatusEscrowed,
		EscrowedAt:     now,
		IdempotencyKey: idempotencyKey,
	}
	const insert = `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
		VALUES ($1,$2,$3,$4,$5,'escrowed',$6,$7,'external')
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err = s.db.Exec(ctx, insert, sett.ID, sett.Reference, sett.ModuleType, sett.PayerID, sett.TotalKobo, sett.EscrowedAt, sett.IdempotencyKey); err != nil {
		return nil, fmt.Errorf("settlement: insert external escrow row: %w", err)
	}
	// status / total / payer / funding source are all re-read, NOT echoed from
	// the arguments: on a replay the existing row wins and may be refunded,
	// held for a DIFFERENT payer, or wallet-funded. Callers MUST check the
	// returned row before building anything on it (transport.bookParcel does).
	if err = s.db.QueryRow(ctx,
		`SELECT id, status, total_kobo, payer_id, funding_source FROM settlements WHERE idempotency_key=$1`, idempotencyKey,
	).Scan(&sett.ID, &sett.Status, &sett.TotalKobo, &sett.PayerID, &sett.FundingSource); err != nil {
		return nil, fmt.Errorf("settlement: resolve external escrow row: %w", err)
	}
	return sett, nil
}

// GetByID loads one settlement (incl. funding source). pgx.ErrNoRows when absent.
func (s *Service) GetByID(ctx context.Context, settlementID string) (*Settlement, error) {
	var st Settlement
	err := s.db.QueryRow(ctx,
		`SELECT id, reference, module_type, payer_id, total_kobo, status, idempotency_key, funding_source
		   FROM settlements WHERE id=$1`, settlementID,
	).Scan(&st.ID, &st.Reference, &st.ModuleType, &st.PayerID, &st.TotalKobo, &st.Status, &st.IdempotencyKey, &st.FundingSource)
	if err != nil {
		return nil, fmt.Errorf("settlement: get %s: %w", settlementID, err)
	}
	return &st, nil
}

// RefundExternalByKey reverses, ledger-side, the EXTERNAL settlement escrowed
// under idempotencyKey (the namespaced card-direct reference). Idempotent and
// safe to call speculatively: no settlement under that key means nothing was
// escrowed, so there is nothing to reverse (nil); an already-refunded row is a
// no-op (RefundExternal's own contract); a wallet-funded row is refused
// (ErrWrongRefundMethod) — never reversed into a gateway-shaped ledger leg.
func (s *Service) RefundExternalByKey(ctx context.Context, idempotencyKey, reason string) error {
	var id string
	err := s.db.QueryRow(ctx, `SELECT id FROM settlements WHERE idempotency_key=$1`, idempotencyKey).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("settlement: resolve external settlement by key: %w", err)
	}
	return s.RefundExternal(ctx, id, reason)
}

// RefundExternalByKeyPrefix reverses, ledger-side, EVERY external settlement a
// single card charge funded: the one escrowed under idempotencyKey itself, plus
// any multi-settlement siblings keyed "<idempotencyKey>:<suffix>" (car hire:
// ":fare" and ":deposit"). RefundExternalByKey cannot do this — with two
// settlements neither key equals the charge's reference, so the order_failed
// unwind would silently find nothing and the gateway refund would leave escrow
// drift. The match is an exact key OR a literal string prefix of key+":" (never
// LIKE: '_' is a wildcard and legal in idempotency keys). Card-direct keys cannot
// contain ':' (engine idempotencyKeyRE), so "<ref>:" can never be a prefix of
// another reference's key. Idempotent; nothing under the prefix is a no-op; a
// wallet-funded row under the prefix is refused (ErrWrongRefundMethod) after
// the other rows were processed, so one bad row never blocks the rest.
func (s *Service) RefundExternalByKeyPrefix(ctx context.Context, idempotencyKey, reason string) error {
	rows, err := s.db.Query(ctx,
		`SELECT id FROM settlements WHERE idempotency_key = $1 OR starts_with(idempotency_key, $1 || ':') ORDER BY idempotency_key`,
		idempotencyKey)
	if err != nil {
		return fmt.Errorf("settlement: resolve external settlements by key prefix: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("settlement: scan settlement by key prefix: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("settlement: iterate settlements by key prefix: %w", err)
	}
	var firstErr error
	for _, id := range ids {
		if err := s.RefundExternal(ctx, id, reason); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// Settle releases the escrowed funds, applying the split and deducting commission.
// Called after service delivery is confirmed.
func (s *Service) Settle(ctx context.Context, settlementID string, split Split) error {
	// Fail-closed: the split must sum to exactly 1.0 before any money moves.
	if err := split.Validate(); err != nil {
		return err
	}
	// Account get-or-create runs BEFORE the tx, not inside it: these calls take
	// their own pool connection, and a goroutine that holds a tx conn while
	// acquiring a second one deadlocks the pool under concurrency (conn
	// starvation — every tx holder waits on a conn it already holds). Moves no
	// money, idempotent, so running before Begin is safe even if the settle
	// turns out not to apply.
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	revAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return err
	}
	providerWallet, err := s.ledger.GetOrCreateUserWallet(ctx, split.ProviderID)
	if err != nil {
		return fmt.Errorf("settlement: resolve provider wallet: %w", err)
	}
	var riderWallet *ledger.Account
	if split.RiderID != nil {
		riderWallet, err = s.ledger.GetOrCreateUserWallet(ctx, *split.RiderID)
		if err != nil {
			return fmt.Errorf("settlement: resolve rider wallet: %w", err)
		}
	}

	var sett Settlement
	const q = `SELECT id, reference, payer_id, total_kobo, status FROM settlements WHERE id=$1 FOR UPDATE`
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("settlement: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := tx.QueryRow(ctx, q, settlementID).Scan(
		&sett.ID, &sett.Reference, &sett.PayerID, &sett.TotalKobo, &sett.Status,
	); err != nil {
		return fmt.Errorf("settlement: fetch: %w", err)
	}
	if sett.Status != StatusEscrowed {
		return fmt.Errorf("settlement: cannot settle — current status is %s", sett.Status)
	}
	// ComputeLegs is the single definition of the split arithmetic — the tests
	// exercise the same expression that moves money.
	legs, err := ComputeLegs(sett.TotalKobo, split)
	if err != nil {
		return err
	}
	providerKobo, platformKobo, riderKobo := legs.ProviderKobo, legs.PlatformKobo, legs.RiderKobo

	// Atomicity (money invariant): the ledger API has no tx-aware Credit/Debit,
	// so every leg posts as a raw balanced pair on THIS tx — money movement and
	// the status flip commit atomically. ON CONFLICT (idempotency_key) makes
	// Settle re-triable.
	ref := "settle:" + sett.Reference
	idem := "settle:" + settlementID

	// Escrow → provider wallet: DEBIT escrow, CREDIT provider wallet (balanced pair).
	if providerKobo > 0 {
		if err := postPairTx(ctx, tx, escrowAcc.ID, providerWallet.ID, providerKobo,
			ref+":provider", idem+":provider"); err != nil {
			return fmt.Errorf("settlement: credit provider: %w", err)
		}
	}
	// Escrow → platform revenue (commission): DEBIT escrow, CREDIT revenue.
	if platformKobo > 0 {
		if err := postPairTx(ctx, tx, escrowAcc.ID, revAcc.ID, platformKobo,
			ref+":commission", idem+":commission"); err != nil {
			return fmt.Errorf("settlement: post commission: %w", err)
		}
	}
	// Escrow → rider wallet (if applicable): DEBIT escrow, CREDIT rider wallet.
	if riderWallet != nil && riderKobo > 0 {
		if err := postPairTx(ctx, tx, escrowAcc.ID, riderWallet.ID, riderKobo,
			ref+":rider", idem+":rider"); err != nil {
			return fmt.Errorf("settlement: credit rider: %w", err)
		}
	}

	now := time.Now()
	const updateStatus = `UPDATE settlements SET status='settled', settled_at=$2, provider_kobo=$3, fee_kobo=$4 WHERE id=$1`
	if _, err := tx.Exec(ctx, updateStatus, settlementID, now, providerKobo, platformKobo); err != nil {
		return fmt.Errorf("settlement: update status: %w", err)
	}
	return tx.Commit(ctx)
}

// SettleToStandingAccounts releases an escrowed settlement whose provider is a
// standing account, not a user wallet — e.g. a stays supplier's net parks in
// AccountProviderClearing until a later payout draws it down, and the platform
// cut lands on a module-chosen account (stays uses AccountCommission).
// Split.ProviderID is annotation-only; a rider leg still resolves a real wallet.
// Same mechanics as Settle — the status flip commits in the same tx as the legs.
func (s *Service) SettleToStandingAccounts(ctx context.Context, settlementID string, split Split, providerAccount, platformAccount ledger.AccountType) error {
	if providerAccount == "" || platformAccount == "" {
		return errors.New("settlement: standing-account settle requires provider and platform accounts")
	}
	if err := split.Validate(); err != nil {
		return err
	}
	// Account get-or-create before the money tx, matching Settle — a tx that
	// blocks acquiring a second pool conn while holding its own deadlocks the
	// pool under concurrency.
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	providerAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, providerAccount)
	if err != nil {
		return fmt.Errorf("settlement: resolve provider clearing account: %w", err)
	}
	platformAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, platformAccount)
	if err != nil {
		return fmt.Errorf("settlement: resolve platform account: %w", err)
	}
	var riderWallet *ledger.Account
	if split.RiderID != nil {
		riderWallet, err = s.ledger.GetOrCreateUserWallet(ctx, *split.RiderID)
		if err != nil {
			return fmt.Errorf("settlement: resolve rider wallet: %w", err)
		}
	}

	var sett Settlement
	const q = `SELECT id, reference, payer_id, total_kobo, status FROM settlements WHERE id=$1 FOR UPDATE`
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("settlement: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := tx.QueryRow(ctx, q, settlementID).Scan(
		&sett.ID, &sett.Reference, &sett.PayerID, &sett.TotalKobo, &sett.Status,
	); err != nil {
		return fmt.Errorf("settlement: fetch: %w", err)
	}
	if sett.Status != StatusEscrowed {
		return fmt.Errorf("settlement: cannot settle — current status is %s", sett.Status)
	}
	legs, err := ComputeLegs(sett.TotalKobo, split)
	if err != nil {
		return err
	}

	ref := "settle:" + sett.Reference
	idem := "settle:" + settlementID

	// Escrow → provider clearing (the net owed to a non-wallet counterparty).
	if legs.ProviderKobo > 0 {
		if err := postPairTx(ctx, tx, escrowAcc.ID, providerAcc.ID, legs.ProviderKobo,
			ref+":provider", idem+":provider"); err != nil {
			return fmt.Errorf("settlement: credit provider clearing: %w", err)
		}
	}
	// Escrow → platform standing account (commission/revenue).
	if legs.PlatformKobo > 0 {
		if err := postPairTx(ctx, tx, escrowAcc.ID, platformAcc.ID, legs.PlatformKobo,
			ref+":commission", idem+":commission"); err != nil {
			return fmt.Errorf("settlement: post platform leg: %w", err)
		}
	}
	// Escrow → rider wallet (a rider is always a wallet-holding user).
	if riderWallet != nil && legs.RiderKobo > 0 {
		if err := postPairTx(ctx, tx, escrowAcc.ID, riderWallet.ID, legs.RiderKobo,
			ref+":rider", idem+":rider"); err != nil {
			return fmt.Errorf("settlement: credit rider: %w", err)
		}
	}

	now := time.Now()
	const updateStatus = `UPDATE settlements SET status='settled', settled_at=$2, provider_kobo=$3, fee_kobo=$4 WHERE id=$1`
	if _, err := tx.Exec(ctx, updateStatus, settlementID, now, legs.ProviderKobo, legs.PlatformKobo); err != nil {
		return fmt.Errorf("settlement: update status: %w", err)
	}
	return tx.Commit(ctx)
}

// postPairTx posts a balanced DEBIT/CREDIT pair of equal magnitude on the
// caller's tx. Per-leg ":debit"/":credit" key suffixes + ON CONFLICT make a
// retried Settle a safe no-op rather than a UNIQUE-constraint failure.
func postPairTx(ctx context.Context, tx pgx.Tx, debitAccountID, creditAccountID string, amountKobo int64, reference, idempotencyKey string) error {
	const insertEntry = `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := tx.Exec(ctx, insertEntry, debitAccountID, "DEBIT", amountKobo, reference, idempotencyKey+":debit"); err != nil {
		return fmt.Errorf("settlement: post debit leg: %w", err)
	}
	if _, err := tx.Exec(ctx, insertEntry, creditAccountID, "CREDIT", amountKobo, reference, idempotencyKey+":credit"); err != nil {
		return fmt.Errorf("settlement: post credit leg: %w", err)
	}
	return nil
}

// ErrWrongRefundMethod guards the Refund/RefundExternal split: a wallet CREDIT
// on an externally-funded settlement (or the reverse) is refused. Crediting a
// wallet with EscrowExternal funds would hand a Tier-0 customer spendable
// balance funded by an external charge — the hazard EscrowExternal avoids.
var ErrWrongRefundMethod = errors.New("settlement: wrong refund method for this settlement's funding source")

// Refund releases a WALLET-funded escrow back to the payer's wallet. Refuses
// (ErrWrongRefundMethod) on an externally-funded (EscrowExternal) settlement
// — see RefundExternal for that case, and ErrWrongRefundMethod's doc comment
// for why this check exists.
func (s *Service) Refund(ctx context.Context, settlementID, reason string) error {
	// The row lock is taken BEFORE the status check and held until the status flip
	// commits: a Settle racing this refund (Settle locks the same row FOR UPDATE)
	// either finished first — we then see 'settled' and refuse — or waits for us.
	// Without it both could post their legs against the one escrow (double debit).
	//
	// Account resolution runs BEFORE Begin: every GetOrCreate takes its own pool
	// conn, and a goroutine holding a tx conn while waiting for a second one
	// starves the pool under concurrency. payer_id is immutable, so this pre-read
	// is safe — the FOR UPDATE read below still re-validates status/funding under
	// the row lock before any money moves.
	var payerID string
	if err := s.db.QueryRow(ctx, `SELECT payer_id FROM settlements WHERE id=$1`, settlementID).
		Scan(&payerID); err != nil {
		return fmt.Errorf("settlement: fetch payer for refund: %w", err)
	}
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	payerWallet, err := s.ledger.GetOrCreateUserWallet(ctx, payerID)
	if err != nil {
		return fmt.Errorf("settlement: resolve payer wallet: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("settlement: begin refund tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	var sett Settlement
	var fundingSource string
	const q = `SELECT id, reference, payer_id, total_kobo, status, funding_source FROM settlements WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, q, settlementID).Scan(
		&sett.ID, &sett.Reference, &sett.PayerID, &sett.TotalKobo, &sett.Status, &fundingSource,
	); err != nil {
		return fmt.Errorf("settlement: fetch for refund: %w", err)
	}
	if fundingSource == "external" {
		return ErrWrongRefundMethod
	}
	if sett.Status != StatusEscrowed && sett.Status != StatusDisputed {
		return fmt.Errorf("settlement: cannot refund — current status is %s", sett.Status)
	}

	// postPairTx's ON CONFLICT keeps a mid-flight-crash retry safe — the legs
	// replay as no-ops and the status flip completes.
	if err := postPairTx(ctx, tx, escrowAcc.ID, payerWallet.ID, sett.TotalKobo,
		"refund:"+sett.Reference, "refund:"+settlementID); err != nil {
		return fmt.Errorf("settlement: post refund legs: %w", err)
	}
	return s.flipRefunded(ctx, tx, settlementID)
}

// flipRefunded is the conditional status flip: it must still find the row
// escrowed/disputed (it does — the caller holds the row lock), and a row that
// moved anyway is an error, never a silent overwrite of 'settled'.
func (s *Service) flipRefunded(ctx context.Context, tx pgx.Tx, settlementID string) error {
	tag, err := tx.Exec(ctx, `UPDATE settlements SET status='refunded' WHERE id=$1 AND status IN ('escrowed','disputed')`, settlementID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("settlement: %s left escrowed/disputed while it was being refunded — needs manual reconciliation", settlementID)
	}
	return tx.Commit(ctx)
}

// RefundExternal reverses an EscrowExternal escrow — the internal-ledger
// counterpart of a real external refund (e.g. a Paystack reversal). It issues
// no gateway call; the caller (which holds the gateway reference) must ALSO
// reverse the actual charge. Posts the EXACT REVERSE of EscrowExternal
// (DR escrow / CR provider-clearing), never a wallet credit — see
// ErrWrongRefundMethod for the Tier-0 bypass hazard. Unlike Refund, a
// settlement outside {escrowed, disputed} is a safe no-op: callers are
// refund-loop cleanups over batches that may race concurrent resolutions.
// Holds the settlement row lock across check + post + flip (see Refund).
func (s *Service) RefundExternal(ctx context.Context, settlementID, reason string) error {
	// Account resolution before Begin — see Refund for the pool-starvation
	// hazard of acquiring a second conn while holding the tx conn.
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("settlement: begin external refund tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	var sett Settlement
	var fundingSource string
	// Same mechanics as Refund — lock the row on the tx so the journal and the
	// status flip commit atomically; a settlement outside {escrowed, disputed}
	// stays a safe no-op for the refund-loop callers.
	const q = `SELECT id, reference, payer_id, total_kobo, status, funding_source FROM settlements WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, q, settlementID).Scan(
		&sett.ID, &sett.Reference, &sett.PayerID, &sett.TotalKobo, &sett.Status, &fundingSource,
	); err != nil {
		return fmt.Errorf("settlement: fetch for external refund: %w", err)
	}
	if fundingSource != "external" {
		return ErrWrongRefundMethod
	}
	if sett.Status != StatusEscrowed && sett.Status != StatusDisputed {
		return nil
	}

	if err := postPairTx(ctx, tx, escrowAcc.ID, clearingAcc.ID, sett.TotalKobo,
		"refund:"+sett.Reference, "refund:"+settlementID); err != nil {
		return fmt.Errorf("settlement: post external refund: %w", err)
	}
	return s.flipRefunded(ctx, tx, settlementID)
}

// Status tracks a settlement's lifecycle.
type Status string

const (
	StatusEscrowed  Status = "escrowed"
	StatusReleasing Status = "releasing"
	StatusSettled   Status = "settled"
	StatusDisputed  Status = "disputed"
	StatusRefunded  Status = "refunded"
)

// Settlement represents a single escrowed amount that will be split on completion.
type Settlement struct {
	ID             string     `json:"id"`
	Reference      string     `json:"reference"`   // links to the originating order/event/appointment
	ModuleType     string     `json:"module_type"` // food | transport | events | telemedicine | crowdfunding
	PayerID        string     `json:"payer_id"`    // user who paid
	TotalKobo      int64      `json:"total_kobo"`
	FeeKobo        int64      `json:"fee_kobo"`      // Paymax platform commission
	ProviderKobo   int64      `json:"provider_kobo"` // amount destined to the provider (merchant/rider/doctor/etc.)
	Status         Status     `json:"status"`
	EscrowedAt     time.Time  `json:"escrowed_at"`
	SettledAt      *time.Time `json:"settled_at,omitempty"`
	IdempotencyKey string     `json:"idempotency_key"`
	// FundingSource is "wallet" (Escrow) or "external" (EscrowExternal). Only
	// populated by the readers that select it (EscrowExternal, GetByID).
	FundingSource string `json:"funding_source,omitempty"`
}

// Split defines how a settlement is divided. Validated: TotalKobo == sum of all parts.
type Split struct {
	ProviderID  string  `json:"provider_id"`  // merchant / driver / doctor user ID
	ProviderPct float64 `json:"provider_pct"` // e.g. 0.80 = 80%
	PlatformPct float64 `json:"platform_pct"` // e.g. 0.10 = 10%
	RiderID     *string `json:"rider_id,omitempty"`
	RiderPct    float64 `json:"rider_pct,omitempty"`
	// TipKobo is a fixed, whole-kobo amount paid 100% to the rider ON TOP of the
	// percentage split — it is NOT part of the percentages (those apply to the
	// non-tip base = total − tip). Defaults to 0, which reproduces the pure
	// percentage split exactly (backward-compatible for every non-tipping caller).
	// A tip requires a rider; Validate rejects a tip with no RiderID.
	TipKobo int64 `json:"tip_kobo,omitempty"`
	// DiscountKobo is a promo discount already reflected in the escrowed total (the
	// payer paid total = gross − discount [+ tip]). The percentages apply to the
	// PRE-discount gross, and the discount is borne entirely by ONE party:
	//   - DiscountFundedByPlatform == true  → subtracted from the platform leg
	//     (the marketplace ate it; provider + rider settle on the full gross).
	//   - DiscountFundedByPlatform == false → borne by the provider (it falls out of
	//     the provider remainder; platform + rider are unaffected).
	// The rider never funds a discount. Defaults to 0, reproducing the pure split.
	DiscountKobo             int64 `json:"discount_kobo,omitempty"`
	DiscountFundedByPlatform bool  `json:"discount_funded_by_platform,omitempty"`
	// ServiceFeeKobo is a fixed, whole-kobo platform service fee paid 100% to the
	// platform ON TOP of the percentage split — the mirror of TipKobo (which is 100%
	// rider). It is NOT part of the percentages (those apply to the pre-discount
	// gross = total − tip − serviceFee + discount). Defaults to 0, reproducing the
	// pure split. Non-negative; tip + serviceFee may not exceed the escrowed total.
	ServiceFeeKobo int64 `json:"service_fee_kobo,omitempty"`
	// ProviderFeeKobo is a fixed, whole-kobo amount paid 100% to the PROVIDER on top
	// of the percentage split — the provider-side mirror of ServiceFeeKobo (100%
	// platform) and TipKobo (100% rider). It is NOT part of the percentages (those
	// apply to gross = total − tip − serviceFee − providerFee + discount).
	// For a pass-through cost the provider actually bears, so that the platform and
	// the rider take no cut of it — the same reason a restaurant takes no cut of a
	// rider's tip. First caller: restaurant takeaway packaging, where the restaurant
	// buys the packs.
	// Defaults to 0, reproducing the pure split exactly for every existing caller.
	// Non-negative; tip + serviceFee + providerFee may not exceed the escrowed total.
	ProviderFeeKobo int64 `json:"provider_fee_kobo,omitempty"`
}

// SplitLegs is what each party receives from an escrowed total, in whole kobo.
type SplitLegs struct {
	ProviderKobo int64
	PlatformKobo int64
	RiderKobo    int64
}

// ComputeLegs divides an escrowed total between provider, platform and rider.
// This is the ONE definition of the split arithmetic — Settle moves money by
// it and the tests check money by it.
// The percentages apply to the pre-discount GROSS, not the escrowed total.
// Three fixed legs come out first and are handed whole to their party:
//
//	tip         → 100% rider
//	serviceFee  → 100% platform
//	providerFee → 100% provider
//	base  = total − tip − serviceFee − providerFee
//
// The provider's leg is the REMAINDER (total − platform − rider). A promo
// discount is borne by exactly one party — platform-funded off the platform
// leg, otherwise out of the provider remainder. The rider never funds a
// discount. With every fixed leg at 0 and no discount, gross == base == total
// and this is the pure percentage split.
func ComputeLegs(totalKobo int64, s Split) (SplitLegs, error) {
	if err := s.Validate(); err != nil {
		return SplitLegs{}, err
	}
	// Fixed legs larger than what was escrowed would drive the gross negative and
	// pay out money nobody put in. Fail closed.
	if s.TipKobo+s.ServiceFeeKobo+s.ProviderFeeKobo > totalKobo {
		return SplitLegs{}, fmt.Errorf(
			"settlement: tip %d + service fee %d + provider fee %d exceed escrowed total %d",
			s.TipKobo, s.ServiceFeeKobo, s.ProviderFeeKobo, totalKobo)
	}

	base := totalKobo - s.TipKobo - s.ServiceFeeKobo - s.ProviderFeeKobo
	gross := base + s.DiscountKobo

	platformKobo := int64(float64(gross)*s.PlatformPct) + s.ServiceFeeKobo
	if s.DiscountFundedByPlatform {
		platformKobo -= s.DiscountKobo
	}
	riderKobo := int64(0)
	if s.RiderID != nil {
		riderKobo = int64(float64(gross)*s.RiderPct) + s.TipKobo
	}
	providerKobo := totalKobo - platformKobo - riderKobo

	// A discount larger than its funder's gross share must never silently invert a
	// payout into a debt.
	if platformKobo < 0 || riderKobo < 0 || providerKobo < 0 {
		return SplitLegs{}, fmt.Errorf(
			"settlement: split produced a negative leg (provider=%d platform=%d rider=%d) — discount too large for the funder",
			providerKobo, platformKobo, riderKobo)
	}
	return SplitLegs{ProviderKobo: providerKobo, PlatformKobo: platformKobo, RiderKobo: riderKobo}, nil
}

// splitEpsilon tolerates float rounding (configs store pct as floats like 0.80).
const splitEpsilon = 1e-6

// Validate enforces the money invariant that the percentage split sums to exactly
// 1.0 (within float epsilon) at settlement time, and that no share is negative.
// The rider share only counts when a rider is present. Provider share is computed
// as the remainder in Settle (so kobo always balances), but a malformed split
// could otherwise drive the provider's kobo negative — this catches that up front.
func (s Split) Validate() error {
	if s.ProviderPct < 0 || s.PlatformPct < 0 || s.RiderPct < 0 {
		return errors.New("settlement: split percentages must be non-negative")
	}
	// The tip is a fixed rider leg: it must be non-negative and can only be paid when
	// a rider is present (there is no one else it may be attributed to). The tip ≤ total
	// bound is enforced in Settle, where the escrowed total is known.
	if s.TipKobo < 0 {
		return errors.New("settlement: tip must be non-negative")
	}
	if s.TipKobo > 0 && s.RiderID == nil {
		return errors.New("settlement: tip requires a rider")
	}
	// A promo discount is non-negative. That it does not drive any leg negative (a too-
	// large platform-funded discount, or a too-large provider-funded one) is enforced in
	// Settle, where the gross and each leg's kobo are known.
	if s.DiscountKobo < 0 {
		return errors.New("settlement: discount must be non-negative")
	}
	if s.ServiceFeeKobo < 0 {
		return errors.New("settlement: service fee must be non-negative")
	}
	// A negative provider fee would inflate the gross the percentages price and
	// quietly pay the platform and rider more than the order was worth.
	if s.ProviderFeeKobo < 0 {
		return errors.New("settlement: provider fee must be non-negative")
	}
	sum := s.ProviderPct + s.PlatformPct
	if s.RiderID != nil {
		sum += s.RiderPct
	}
	if sum < 1.0-splitEpsilon || sum > 1.0+splitEpsilon {
		return fmt.Errorf("settlement: split must sum to 1.0, got %.6f", sum)
	}
	return nil
}

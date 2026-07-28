package settlement

import (
	"context"
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

// Escrow holds funds when a payment is made, before the provider fulfils the order.
// Called by every marketplace vertical after a successful payment.
//
// ATOMICITY (money invariant): this posts TWO effects — a ledger DEBIT (the money
// move) and a settlements-row insert (the tracking record). The ledger API exposes
// no tx-aware Debit, so the debit runs on the ledger's own connection and cannot
// share a tx with the settlements insert here. We therefore make the pair
// crash-safe by (1) keying both effects idempotently on idempotencyKey and (2)
// ordering + retry-hardening them so a caller replay converges to exactly one
// debit and exactly one row:
//   - ledger Debit is idempotent on "<key>:escrow" (duplicate → ErrDuplicate).
//   - settlements.idempotency_key is UNIQUE; the insert is ON CONFLICT DO NOTHING.
// If the debit succeeds but the process dies before the insert, a retry with the
// SAME idempotencyKey sees ErrDuplicate from the ledger (funds already held) and
// falls through to ensure the tracking row exists — so escrow is never stranded
// without a row, and money is never debited twice.
func (s *Service) Escrow(ctx context.Context, payerID, reference, idempotencyKey, moduleType string, totalKobo int64) (*Settlement, error) {
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	// Post the money move first (funds-checked, idempotent). A duplicate means the
	// debit already happened on an earlier attempt — treat as success and proceed
	// to (re)ensure the tracking row below, rather than erroring the retry.
	if err := s.ledger.Debit(ctx, payerID, "escrow:"+reference, idempotencyKey+":escrow", escrowAcc.ID, totalKobo); err != nil && err != ledger.ErrDuplicate {
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
	// Idempotent insert: on a retry the row already exists (unique idempotency_key),
	// so DO NOTHING keeps this a safe no-op. We then re-load the canonical row so
	// callers always get the real settlement id (not the fresh uuid we just minted).
	const insert = `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,'escrowed',$6,$7)
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err = s.db.Exec(ctx, insert, sett.ID, sett.Reference, sett.ModuleType, sett.PayerID, sett.TotalKobo, sett.EscrowedAt, sett.IdempotencyKey); err != nil {
		return nil, fmt.Errorf("settlement: insert escrow row: %w", err)
	}
	// Resolve the authoritative id/status (handles the retry case where the row was
	// inserted by a prior attempt).
	if err = s.db.QueryRow(ctx,
		`SELECT id, status FROM settlements WHERE idempotency_key=$1`, idempotencyKey,
	).Scan(&sett.ID, &sett.Status); err != nil {
		return nil, fmt.Errorf("settlement: resolve escrow row: %w", err)
	}
	return sett, nil
}

// Settle releases the escrowed funds, applying the split and deducting commission.
// Called after service delivery is confirmed.
func (s *Service) Settle(ctx context.Context, settlementID string, split Split) error {
	// Fail-closed: the split must sum to exactly 1.0 before any money moves, so a
	// malformed split can never silently mis-pay a provider (or drive their share
	// negative via the remainder computation below).
	if err := split.Validate(); err != nil {
		return err
	}
	var sett Settlement
	const q = `SELECT id, reference, payer_id, total_kobo, status FROM settlements WHERE id=$1 FOR UPDATE`
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("settlement: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := tx.QueryRow(ctx, q, settlementID).Scan(
		&sett.ID, &sett.Reference, &sett.PayerID, &sett.TotalKobo, &sett.Status,
	); err != nil {
		return fmt.Errorf("settlement: fetch: %w", err)
	}
	if sett.Status != StatusEscrowed {
		return fmt.Errorf("settlement: cannot settle — current status is %s", sett.Status)
	}
	// A tip larger than what was escrowed would drive the non-tip base (and thus the
	// provider remainder) negative. Fail closed — the tip can never exceed the total.
	if split.TipKobo+split.ServiceFeeKobo > sett.TotalKobo {
		return fmt.Errorf("settlement: tip %d + service fee %d exceed escrowed total %d", split.TipKobo, split.ServiceFeeKobo, sett.TotalKobo)
	}

	// Compute splits. The percentages apply to the pre-discount GROSS (the item+delivery
	// value before any promo), NOT to the escrowed total. Two amounts already sit inside
	// the escrowed total: a tip (a fixed rider leg on top) and a promo discount (already
	// deducted from what the payer paid). Reconstructing the gross:
	//
	//	base  = total − tip            (escrow beyond the tip = gross − discount)
	//	gross = base + discount        (pre-discount base+delivery the percentages price)
	//
	// The discount is borne by exactly one party: platform-funded → subtracted from the
	// platform leg; otherwise it falls out of the provider remainder. The rider never
	// funds it and always gets its gross share + the full tip. With tip == 0 AND
	// discount == 0, gross == base == total and this is the pure percentage split —
	// unchanged for every caller that sets neither.
	base := sett.TotalKobo - split.TipKobo - split.ServiceFeeKobo
	gross := base + split.DiscountKobo
	platformKobo := int64(float64(gross)*split.PlatformPct) + split.ServiceFeeKobo
	if split.DiscountFundedByPlatform {
		platformKobo -= split.DiscountKobo
	}
	riderKobo := int64(0)
	if split.RiderID != nil {
		riderKobo = int64(float64(gross)*split.RiderPct) + split.TipKobo
	}
	providerKobo := sett.TotalKobo - platformKobo - riderKobo

	// Fail closed if any leg would go negative — a discount larger than the funder's
	// gross share must never silently invert a payout (platform-funded drives the
	// platform leg negative; provider-funded drives the provider remainder negative).
	if platformKobo < 0 || riderKobo < 0 || providerKobo < 0 {
		return fmt.Errorf("settlement: split produced a negative leg (provider=%d platform=%d rider=%d) — discount too large for the funder", providerKobo, platformKobo, riderKobo)
	}

	// ATOMICITY FIX (money invariant): previously the provider/rider credits went
	// through s.ledger.Credit (which posts on the ledger's OWN connection), while the
	// commission entries and the settlement-row status update ran on this tx. That
	// split meant a crash between the provider credit and tx.Commit could pay the
	// provider without ever marking the settlement 'settled' — and because the ledger
	// Credit is a plain INSERT (no ON CONFLICT), a retry then errored on the UNIQUE
	// idempotency_key, wedging the settlement.
	//
	// The ledger.Service still exposes no tx-aware Credit/Debit (documented gap — a
	// future refactor should add ledger.CreditTx(tx, ...) so wallet balance
	// projections and settlement rows commit as one unit). Until then, we post EVERY
	// leg of this settlement as raw balanced ledger_entries pairs on THIS tx, so all
	// money movement + the status flip commit atomically. Wallet account rows are
	// resolved (get-or-create) OUTSIDE the tx — that only ensures the account exists
	// and moves no money — then every posting is on the tx and idempotent via
	// ON CONFLICT (idempotency_key) DO NOTHING, making the whole Settle safe to retry.
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
	if split.RiderID != nil && riderKobo > 0 {
		riderWallet, err := s.ledger.GetOrCreateUserWallet(ctx, *split.RiderID)
		if err != nil {
			return fmt.Errorf("settlement: resolve rider wallet: %w", err)
		}
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

// postPairTx posts a balanced double-entry pair (DEBIT debitAccountID,
// CREDIT creditAccountID) for amountKobo on the given tx. Both legs share the
// reference and derive a distinct-but-stable idempotency key, and both use
// ON CONFLICT (idempotency_key) DO NOTHING so a retried Settle is a safe no-op
// rather than a UNIQUE-constraint failure. Money invariant: exactly one DEBIT and
// one CREDIT of equal magnitude, both inside the caller's transaction.
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

// Refund releases escrowed funds back to the payer.
func (s *Service) Refund(ctx context.Context, settlementID, reason string) error {
	var sett Settlement
	const q = `SELECT id, reference, payer_id, total_kobo, status FROM settlements WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, settlementID).Scan(
		&sett.ID, &sett.Reference, &sett.PayerID, &sett.TotalKobo, &sett.Status,
	); err != nil {
		return fmt.Errorf("settlement: fetch for refund: %w", err)
	}
	if sett.Status != StatusEscrowed && sett.Status != StatusDisputed {
		return fmt.Errorf("settlement: cannot refund — current status is %s", sett.Status)
	}

	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	if err := s.ledger.Credit(ctx, sett.PayerID,
		"refund:"+sett.Reference, "refund:"+settlementID, escrowAcc.ID, sett.TotalKobo,
	); err != nil {
		return fmt.Errorf("settlement: credit refund: %w", err)
	}
	const update = `UPDATE settlements SET status='refunded' WHERE id=$1`
	_, err = s.db.Exec(ctx, update, settlementID)
	return err
}

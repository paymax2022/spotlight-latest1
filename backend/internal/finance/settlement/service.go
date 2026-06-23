package settlement

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
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
func (s *Service) Escrow(ctx context.Context, payerID, reference, idempotencyKey, moduleType string, totalKobo int64) (*Settlement, error) {
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	if err := s.ledger.Debit(ctx, payerID, "escrow:"+reference, idempotencyKey+":escrow", escrowAcc.ID, totalKobo); err != nil {
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
	const insert = `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,'escrowed',$6,$7)`
	_, err = s.db.Exec(ctx, insert, sett.ID, sett.Reference, sett.ModuleType, sett.PayerID, sett.TotalKobo, sett.EscrowedAt, sett.IdempotencyKey)
	return sett, err
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

	// Compute splits.
	platformKobo := int64(float64(sett.TotalKobo) * split.PlatformPct)
	riderKobo := int64(0)
	if split.RiderID != nil {
		riderKobo = int64(float64(sett.TotalKobo) * split.RiderPct)
	}
	providerKobo := sett.TotalKobo - platformKobo - riderKobo

	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	revAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return err
	}

	ref := "settle:" + sett.Reference
	idem := "settle:" + settlementID

	// Escrow → provider wallet
	if err := s.ledger.Credit(ctx, split.ProviderID, ref+":provider", idem+":provider", escrowAcc.ID, providerKobo); err != nil {
		return fmt.Errorf("settlement: credit provider: %w", err)
	}
	// Escrow → platform revenue (commission)
	const insertCommEntry = `INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key) VALUES ($1,'DEBIT',$2,$3,$4)`
	if _, err := tx.Exec(ctx, insertCommEntry, escrowAcc.ID, platformKobo, ref+":commission", idem+":commission"); err != nil {
		return fmt.Errorf("settlement: debit escrow for commission: %w", err)
	}
	const insertRevEntry = `INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key) VALUES ($1,'CREDIT',$2,$3,$4)`
	if _, err := tx.Exec(ctx, insertRevEntry, revAcc.ID, platformKobo, ref+":commission", idem+":commission:credit"); err != nil {
		return fmt.Errorf("settlement: credit revenue: %w", err)
	}
	// Escrow → rider wallet (if applicable)
	if split.RiderID != nil && riderKobo > 0 {
		if err := s.ledger.Credit(ctx, *split.RiderID, ref+":rider", idem+":rider", escrowAcc.ID, riderKobo); err != nil {
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

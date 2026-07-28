package fractionalre

import (
	"context"
	"fmt"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// Watchlist / goals / auto-invest / documents are thin pass-throughs to the
// repository with audit on writes. Portfolio reads aggregate the cap table.

func (s *Service) AddWatch(ctx context.Context, userID, offeringID string) error {
	return s.repo.AddWatch(ctx, userID, offeringID)
}

func (s *Service) RemoveWatch(ctx context.Context, userID, offeringID string) error {
	return s.repo.RemoveWatch(ctx, userID, offeringID)
}

func (s *Service) ListWatch(ctx context.Context, userID string) ([]Watchlist, error) {
	return s.repo.ListWatch(ctx, userID)
}

func (s *Service) ListHoldings(ctx context.Context, userID string) ([]CapTableEntry, error) {
	return s.repo.ListHoldings(ctx, userID)
}

func (s *Service) GetHolding(ctx context.Context, assetID, userID string) (*CapTableEntry, error) {
	return s.repo.GetHolding(ctx, assetID, userID)
}

func (s *Service) ListPayouts(ctx context.Context, userID string, limit, offset int) ([]DistributionPayment, error) {
	return s.repo.ListPayoutsForUser(ctx, userID, limit, offset)
}

func (s *Service) CreateGoal(ctx context.Context, userID, name string, targetKobo int64, targetDate *time.Time) (*Goal, error) {
	g := &Goal{UserID: userID, Name: name, TargetKobo: targetKobo, TargetDate: targetDate}
	if err := s.repo.CreateGoal(ctx, g); err != nil {
		return nil, err
	}
	return g, nil
}

func (s *Service) ListGoals(ctx context.Context, userID string) ([]Goal, error) {
	return s.repo.ListGoals(ctx, userID)
}

func (s *Service) CreateAutoInvest(ctx context.Context, userID string, amountKobo int64, cadence string, assetType *string) (*AutoInvest, error) {
	if amountKobo <= 0 {
		return nil, fmt.Errorf("fractionalre: amount must be positive")
	}
	if cadence != "weekly" && cadence != "monthly" {
		return nil, fmt.Errorf("%w: cadence must be weekly or monthly", ErrValidation)
	}
	// First execution is one cadence period out (the runner picks it up then).
	firstRun := nextAutoInvestRun(s.now(), cadence)
	a := &AutoInvest{UserID: userID, AmountKobo: amountKobo, Cadence: cadence, AssetType: assetType, NextRunAt: &firstRun}
	if err := s.repo.CreateAutoInvest(ctx, a); err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, userID, "auto_invest.create", "auto_invest", a.ID, "", nil, a)
	return a, nil
}

func (s *Service) ListAutoInvest(ctx context.Context, userID string) ([]AutoInvest, error) {
	return s.repo.ListAutoInvest(ctx, userID)
}

func (s *Service) PauseAutoInvest(ctx context.Context, userID, id string) error {
	return s.repo.PauseAutoInvest(ctx, id, userID)
}

func (s *Service) ListDocuments(ctx context.Context, userID string) ([]Document, error) {
	return s.repo.ListDocuments(ctx, userID)
}

func (s *Service) GetCertificate(ctx context.Context, userID, investmentID string) (*Document, error) {
	return s.repo.GetCertificate(ctx, userID, investmentID)
}

// GetCapTable returns the cap table for an asset (admin).
func (s *Service) GetCapTable(ctx context.Context, assetID string) ([]CapTableEntry, error) {
	return s.repo.GetCapTable(ctx, assetID)
}

// TransferCapTable is an admin maker-checker-free correction (e.g. legal
// reassignment). It is audited; the units move atomically on the cap table.
func (s *Service) TransferCapTable(ctx context.Context, adminID, assetID, fromUser, toUser string, units int64) error {
	if err := s.repo.TransferUnits(ctx, assetID, fromUser, toUser, units, 0); err != nil {
		return err
	}
	_ = s.repo.RecomputeCapTablePct(ctx, assetID)
	_ = s.audit.log(ctx, adminID, "cap_table.transfer", "asset", assetID, "",
		map[string]string{"from": fromUser}, map[string]any{"to": toUser, "units": units})
	return nil
}

// PresignDocument issues an R2 presigned PUT URL for an admin document upload
// and records the document row. Returns the URL and object key.
func (s *Service) PresignDocument(ctx context.Context, adminID, assetID, docType, contentType string) (string, string, error) {
	key := fmt.Sprintf("fractionalre/docs/%s/%s/%d", assetID, docType, s.now().UnixNano())
	doc := &Document{DocType: docType, ObjectKey: key}
	if assetID != "" {
		doc.AssetID = &assetID
	}
	if err := s.repo.InsertDocument(ctx, doc); err != nil {
		return "", "", err
	}
	url := ""
	if s.presigner != nil {
		u, err := s.presigner.PresignPut(key, contentType, 15*time.Minute)
		if err != nil {
			return "", "", err
		}
		url = u
	}
	_ = s.audit.log(ctx, adminID, "document.presign", "document", doc.ID, docType, nil, nil)
	return url, key, nil
}

// EscrowBalance returns the platform escrow standing-account balance (admin
// finance read). Reuses the ledger projection — never a stored balance column.
// The balance is projected from ledger_entries over the shared pool.
func (s *Service) EscrowBalance(ctx context.Context) (int64, error) {
	acc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return 0, err
	}
	return s.repo.ProjectAccountBalance(ctx, acc.ID)
}

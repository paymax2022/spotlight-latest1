package fractionalre

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"spotlight/backend/go-common/ptr"
	"spotlight/backend/internal/finance/ledger"
)

// ScheduleDistributionRequest is the maker's distribution-run proposal.
type ScheduleDistributionRequest struct {
	AssetID         string  `json:"asset_id" binding:"required"`
	OfferingID      *string `json:"offering_id,omitempty"`
	PeriodLabel     string  `json:"period_label"`
	GrossKobo       int64   `json:"gross_kobo" binding:"required"`
	FeeKobo         int64   `json:"fee_kobo"`
	WithholdingKobo int64   `json:"withholding_kobo"`
}

// ScheduleDistribution is the MAKER step: it creates a distribution run and
// computes the per-investor pro-rata payment lines (net of fees + withholding
// tax). It does NOT move money — that happens only after a different CHECKER
// approves. The run-level Idempotency-Key is required (money path) and scoped
// to this module + maker; a replay of the same payload returns the existing
// run and the same key on a different asset/gross conflicts.
func (s *Service) ScheduleDistribution(ctx context.Context, makerID, idempotencyKey string, req ScheduleDistributionRequest) (*Distribution, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyKey
	}
	key := scopedIdemKey(makerID, idempotencyKey)
	if existing, replay, err := fetchReplay(func() (*Distribution, error) {
		return s.repo.GetDistributionByKey(ctx, key)
	}); err != nil {
		return nil, err
	} else if replay {
		if existing.AssetID != req.AssetID || existing.GrossKobo != req.GrossKobo ||
			existing.FeeKobo != req.FeeKobo || existing.WithholdingKobo != req.WithholdingKobo {
			return nil, ErrIdempotencyConflict
		}
		return existing, nil
	}
	if req.GrossKobo <= 0 {
		return nil, errors.New("fractionalre: gross_kobo must be positive")
	}
	if req.FeeKobo < 0 || req.WithholdingKobo < 0 {
		return nil, errors.New("fractionalre: fee/withholding must be non-negative")
	}
	if req.FeeKobo+req.WithholdingKobo < 0 || req.FeeKobo+req.WithholdingKobo >= req.GrossKobo {
		// fee+withholding can themselves overflow int64 in addition; the >=
		// gross comparison also catches a sum that merely wipes out the pool.
		return nil, errors.New("fractionalre: net distributable must be positive")
	}
	netPool := req.GrossKobo - req.FeeKobo - req.WithholdingKobo

	caps, err := s.repo.GetCapTable(ctx, req.AssetID)
	if err != nil {
		return nil, err
	}
	if len(caps) == 0 {
		return nil, ErrNoCapTable
	}
	var totalUnits int64
	for _, c := range caps {
		totalUnits += c.Units
	}
	if totalUnits <= 0 {
		return nil, errors.New("fractionalre: zero total units")
	}

	dist := &Distribution{
		AssetID:         req.AssetID,
		OfferingID:      req.OfferingID,
		PeriodLabel:     ptr.OrNil(req.PeriodLabel),
		GrossKobo:       req.GrossKobo,
		FeeKobo:         req.FeeKobo,
		WithholdingKobo: req.WithholdingKobo,
		NetKobo:         netPool,
		Status:          DistSubmitted,
		MakerID:         &makerID,
		IdempotencyKey:  key,
	}
	now := s.now()
	dist.SubmittedAt = &now
	if err := s.repo.InsertDistribution(ctx, dist); err != nil {
		if isUniqueViolation(err) {
			if existing, gerr := s.repo.GetDistributionByKey(ctx, key); gerr == nil {
				if existing.AssetID != req.AssetID || existing.GrossKobo != req.GrossKobo ||
					existing.FeeKobo != req.FeeKobo || existing.WithholdingKobo != req.WithholdingKobo {
					return nil, ErrIdempotencyConflict
				}
				return existing, nil
			}
			return nil, errors.New("fractionalre: distribution with this idempotency key already exists")
		}
		return nil, err
	}

	// Pro-rata per cap table (integer kobo; remainder goes to the largest holder
	// so the sum of net lines == netPool exactly — no kobo lost). All products
	// go through the checked helper: netPool*units can overflow int64 for a
	// large pool on a large cap table, and a wrapped product would silently
	// under-pay a line.
	var allocated int64
	var withheldGross int64
	// Per-line withholding is taken proportionally out of the gross share; the
	// net line is the post-withholding amount. For preview we distribute the
	// already-net pool pro-rata and the per-line gross/withholding are informational.
	for i, c := range caps {
		netLine, err := mulDivKobo(netPool, c.Units, totalUnits)
		if err != nil {
			return nil, err
		}
		if i == len(caps)-1 {
			netLine = netPool - allocated // remainder to last holder
		}
		allocated += netLine
		grossLine, err := mulDivKobo(req.GrossKobo, c.Units, totalUnits)
		if err != nil {
			return nil, err
		}
		whLine, err := mulDivKobo(req.WithholdingKobo, c.Units, totalUnits)
		if err != nil {
			return nil, err
		}
		withheldGross += whLine
		p := &DistributionPayment{
			DistributionID:  dist.ID,
			UserID:          c.UserID,
			Units:           c.Units,
			GrossKobo:       grossLine,
			WithholdingKobo: whLine,
			NetKobo:         netLine,
			Status:          "pending",
			IdempotencyKey:  fmt.Sprintf("%s:%s", key, c.UserID),
		}
		if err := s.repo.InsertDistributionPayment(ctx, p); err != nil {
			return nil, fmt.Errorf("fractionalre: payment line: %w", err)
		}
	}

	_ = s.audit.log(ctx, makerID, "distribution.schedule", "distribution", dist.ID, ptr.Deref(dist.PeriodLabel, ""),
		nil, map[string]any{"gross_kobo": req.GrossKobo, "net_kobo": netPool, "holders": len(caps)})
	return dist, nil
}

// PreviewDistribution returns the run and its computed per-investor lines,
// including an exception list (lines flagged excluded). No money moves.
func (s *Service) PreviewDistribution(ctx context.Context, distributionID string) (*Distribution, []DistributionPayment, error) {
	d, err := s.repo.GetDistribution(ctx, distributionID)
	if err != nil {
		return nil, nil, err
	}
	lines, err := s.repo.ListDistributionPayments(ctx, distributionID)
	if err != nil {
		return nil, nil, err
	}
	return d, lines, nil
}

// SubmitDistribution moves a draft run to submitted (if a separate submit step is
// desired). ScheduleDistribution already submits, so this is idempotent.
func (s *Service) SubmitDistribution(ctx context.Context, makerID, distributionID string) (*Distribution, error) {
	d, err := s.repo.GetDistribution(ctx, distributionID)
	if err != nil {
		return nil, err
	}
	if d.Status == DistDraft {
		_ = s.repo.SetDistributionStatus(ctx, distributionID, DistSubmitted)
		d.Status = DistSubmitted
	}
	_ = s.audit.log(ctx, makerID, "distribution.submit", "distribution", distributionID, "", nil, nil)
	return d, nil
}

// ApproveDistribution is the CHECKER step. SEPARATION OF DUTIES: the approver
// MUST differ from the maker. On approval it pays each pending line via the
// ledger (escrow account → investor wallet), idempotently and retryably: a line
// that already paid (duplicate idempotency key) is skipped; a line that fails is
// left pending so a retry of ApproveDistribution finishes it. The run is marked
// paid when all lines succeed, partial otherwise.
func (s *Service) ApproveDistribution(ctx context.Context, checkerID, distributionID string) (*Distribution, error) {
	d, err := s.repo.GetDistribution(ctx, distributionID)
	if err != nil {
		return nil, err
	}
	if d.Status != DistSubmitted && d.Status != DistApproved && d.Status != DistPartial {
		return nil, fmt.Errorf("fractionalre: distribution not in an approvable state (%s)", d.Status)
	}
	if d.MakerID == nil {
		return nil, errors.New("fractionalre: distribution has no maker")
	}
	if *d.MakerID == checkerID {
		return nil, ErrMakerChecker
	}

	// Record approval (idempotent — re-approve keeps checker).
	if d.Status == DistSubmitted {
		if err := s.repo.ApproveDistribution(ctx, distributionID, checkerID); err != nil {
			return nil, err
		}
	}

	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}

	lines, err := s.repo.ListDistributionPayments(ctx, distributionID)
	if err != nil {
		return nil, err
	}
	var paid, failed int
	for _, ln := range lines {
		if ln.Status == "paid" || ln.Status == "excluded" {
			continue
		}
		if ln.NetKobo <= 0 {
			_ = s.repo.MarkPaymentStatus(ctx, ln.ID, "excluded")
			continue
		}
		// Idempotent credit: escrow → investor wallet. A duplicate key (retry) is
		// caught as ledger.ErrDuplicate and treated as already-paid.
		ref := fmt.Sprintf("fre-distribution:%s:%s", distributionID, ln.UserID)
		err := s.ledger.Credit(ctx, ln.UserID, ref, ln.IdempotencyKey, escrowAcc.ID, ln.NetKobo)
		if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			_ = s.repo.MarkPaymentStatus(ctx, ln.ID, "failed")
			failed++
			continue
		}
		_ = s.repo.MarkPaymentStatus(ctx, ln.ID, "paid")
		paid++
		s.notify(ctx, ln.UserID, "Distribution paid", "A rental/profit distribution has been credited to your wallet.")
	}

	status := DistPaid
	if failed > 0 {
		status = DistPartial
	}
	_ = s.repo.MarkDistributionPaid(ctx, distributionID, status)
	_ = s.audit.log(ctx, checkerID, "distribution.approve", "distribution", distributionID, "",
		map[string]string{"maker": *d.MakerID}, map[string]any{"paid": paid, "failed": failed, "status": status})
	d.Status = status
	d.CheckerID = &checkerID
	return d, nil
}

func (s *Service) ListDistributions(ctx context.Context, limit, offset int) ([]Distribution, error) {
	return s.repo.ListDistributions(ctx, limit, offset)
}

package fractionalre

import (
	"context"
	"fmt"
	"time"
)

// ── Sponsors ──────────────────────────────────────────────────────────────────

func (s *Service) CreateSponsor(ctx context.Context, actorID string, sp *Sponsor) (*Sponsor, error) {
	sp.CreatedBy = &actorID
	if err := s.repo.CreateSponsor(ctx, sp); err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, actorID, "sponsor.create", "sponsor", sp.ID, "", nil, sp)
	return sp, nil
}

func (s *Service) ListSponsors(ctx context.Context) ([]Sponsor, error) {
	return s.repo.ListSponsors(ctx)
}

// ── Assets ────────────────────────────────────────────────────────────────────

func (s *Service) CreateAsset(ctx context.Context, actorID string, a *Asset) (*Asset, error) {
	switch a.AssetType {
	case TypeIncomeProperty, TypeDevelopmentDebt, TypeLand:
	default:
		return nil, fmt.Errorf("fractionalre: invalid asset_type %q", a.AssetType)
	}
	a.CreatedBy = &actorID
	if err := s.repo.CreateAsset(ctx, a); err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, actorID, "asset.create", "asset", a.ID, "", nil, a)
	return a, nil
}

func (s *Service) GetAsset(ctx context.Context, id string) (*Asset, error) {
	return s.repo.GetAsset(ctx, id)
}

func (s *Service) ListAssets(ctx context.Context, status string, limit, offset int) ([]Asset, error) {
	return s.repo.ListAssets(ctx, status, limit, offset)
}

func (s *Service) PatchAsset(ctx context.Context, actorID, id string, navKobo *int64, description, location *string) error {
	if err := s.repo.PatchAsset(ctx, id, navKobo, description, location); err != nil {
		return err
	}
	_ = s.audit.log(ctx, actorID, "asset.patch", "asset", id, "", nil, map[string]any{"nav_kobo": navKobo})
	return nil
}

// Transition moves an asset through its role-gated lifecycle. The RBAC
// permission required for the move is returned by CanTransition and enforced by
// the handler/route middleware; here we validate the transition is legal and
// enforce the title-verified precondition for approval.
func (s *Service) Transition(ctx context.Context, actorID, id string, to AssetStatus) (*Asset, error) {
	a, err := s.repo.GetAsset(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, ok := CanTransition(a.Status, to); !ok {
		return nil, fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, a.Status, to)
	}
	// Approval requires a verified title (independent verification, see TitleVerify).
	if to == AssetApproved && a.TitleStatus != TitleVerified {
		return nil, fmt.Errorf("%w: title not verified", ErrInvalidTransition)
	}
	if err := s.repo.UpdateAssetStatus(ctx, id, to); err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, actorID, "asset.transition", "asset", id, "",
		map[string]string{"status": string(a.Status)}, map[string]string{"status": string(to)})
	a.Status = to
	return a, nil
}

// TitleVerify records the independent title due-diligence outcome. SEPARATION OF
// DUTIES: the verifier MUST differ from the asset creator. This sits behind the
// fractionalre.title_verify permission, but the SoD check is also enforced here
// in code so a single actor cannot both create and verify even with both grants.
func (s *Service) TitleVerify(ctx context.Context, verifierID, assetID string, clear bool, ref string) (*Asset, error) {
	a, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	if a.CreatedBy != nil && *a.CreatedBy == verifierID {
		return nil, ErrTitleSoD
	}
	// Optionally consult the external provider (mock clears unless "disputed").
	loc := ""
	if a.Location != nil {
		loc = *a.Location
	}
	if providerClear, providerRef, perr := s.provider.VerifyTitle(ctx, assetID, loc); perr == nil {
		clear = clear && providerClear
		if ref == "" {
			ref = providerRef
		}
	}
	status := TitleVerified
	if !clear {
		status = TitleRejected
	}
	if err := s.repo.SetTitleVerification(ctx, assetID, status, verifierID); err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, verifierID, "asset.title_verify", "asset", assetID, ref,
		map[string]string{"title_status": string(a.TitleStatus)},
		map[string]string{"title_status": string(status)})
	a.TitleStatus = status
	return a, nil
}

// ── Offerings (funding rounds) ────────────────────────────────────────────────

func (s *Service) CreateOffering(ctx context.Context, actorID string, o *Offering) (*Offering, error) {
	// Validate ticket / threshold / window invariants (kobo math, no floats).
	if o.UnitPriceKobo <= 0 || o.ShareCount <= 0 {
		return nil, fmt.Errorf("fractionalre: unit_price_kobo and share_count must be positive")
	}
	if o.TargetKobo == 0 {
		o.TargetKobo = o.UnitPriceKobo * o.ShareCount
	}
	if o.MinThresholdKobo > o.TargetKobo {
		return nil, fmt.Errorf("fractionalre: min_threshold_kobo cannot exceed target_kobo")
	}
	now := s.now().UTC()
	if o.OpensAt == nil {
		o.OpensAt = &now
	}
	// Cap the window at 60 days from open.
	maxClose := o.OpensAt.Add(MaxOfferWindow)
	if o.ClosesAt == nil || o.ClosesAt.After(maxClose) {
		o.ClosesAt = &maxClose
	}
	o.Status = OfferingDraft
	o.CreatedBy = &actorID
	if o.EscrowReference == nil {
		ref := "fre-round:" + o.AssetID
		o.EscrowReference = &ref
	}
	if err := s.repo.CreateOffering(ctx, o); err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, actorID, "offering.create", "offering", o.ID, "", nil, o)
	return o, nil
}

func (s *Service) GetOffering(ctx context.Context, id string) (*Offering, error) {
	return s.repo.GetOffering(ctx, id)
}

func (s *Service) ListOfferings(ctx context.Context, status string, limit, offset int) ([]Offering, error) {
	return s.repo.ListOfferings(ctx, status, limit, offset)
}

// OpenOffering moves a draft round to open (mirrors an asset going Live).
func (s *Service) OpenOffering(ctx context.Context, actorID, id string) error {
	o, err := s.repo.GetOffering(ctx, id)
	if err != nil {
		return err
	}
	if o.Status != OfferingDraft {
		return fmt.Errorf("fractionalre: offering not in draft")
	}
	if err := s.repo.UpdateOfferingStatus(ctx, id, OfferingOpen); err != nil {
		return err
	}
	_ = s.audit.log(ctx, actorID, "offering.open", "offering", id, "", nil, nil)
	return nil
}

// ExtendOffering applies the one-time +30-day extension (SEC window rule).
func (s *Service) ExtendOffering(ctx context.Context, actorID, id string, extraDays int) (*Offering, error) {
	o, err := s.repo.GetOffering(ctx, id)
	if err != nil {
		return nil, err
	}
	if extraDays <= 0 || o.ExtensionDays+extraDays > MaxExtensionDays {
		return nil, fmt.Errorf("fractionalre: extension exceeds the %d-day cap", MaxExtensionDays)
	}
	if o.ClosesAt == nil {
		return nil, fmt.Errorf("fractionalre: offering has no close date")
	}
	newClose := o.ClosesAt.Add(time.Duration(extraDays) * 24 * time.Hour)
	if err := s.repo.ExtendOffering(ctx, id, newClose, extraDays); err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, actorID, "offering.extend", "offering", id, fmt.Sprintf("+%dd", extraDays), nil, nil)
	o.ClosesAt = &newClose
	o.ExtensionDays += extraDays
	return o, nil
}

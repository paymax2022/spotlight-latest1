package fractionalre

import (
	"context"
	"strings"
	"time"

	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
)

// AssetProvider abstracts an external real-estate broker / data feed (title
// registry lookups, valuation feeds). A MockAssetProvider ships first so the
// module runs without an external broker; a real HTTP adapter slots in behind
// the same interface later (mock-first, real-last — mirrors invest).
type AssetProvider interface {
	Name() string
	// VerifyTitle performs an external title-registry lookup for an asset.
	// Returns whether the title is clear and a human-readable reference.
	VerifyTitle(ctx context.Context, assetID, location string) (clear bool, ref string, err error)
	// Valuation returns the current NAV (kobo) for an asset, used to anchor the
	// secondary market unit price when no admin override is supplied.
	Valuation(ctx context.Context, assetID string) (navKobo int64, err error)
}

// MockAssetProvider is a deterministic in-memory provider. It clears any title
// whose location does not contain "disputed" and echoes the stored NAV.
type MockAssetProvider struct{}

func NewMockAssetProvider() *MockAssetProvider { return &MockAssetProvider{} }

func (m *MockAssetProvider) Name() string { return "mock-asset-provider" }

func (m *MockAssetProvider) VerifyTitle(_ context.Context, assetID, location string) (bool, string, error) {
	clear := !strings.Contains(strings.ToLower(location), "disputed")
	return clear, "mock-title:" + assetID, nil
}

func (m *MockAssetProvider) Valuation(_ context.Context, _ string) (int64, error) {
	return 0, nil // mock: NAV is admin-maintained; provider adds nothing
}

// Notifier delivers investor notifications. nil → no-op.
type Notifier interface {
	Notify(ctx context.Context, userID, title, body string) error
}

// NotifierFunc adapts a function to the Notifier interface (mirrors the invest
// module's NotifierFunc) so the route layer can wire the platform notifications
// queue without a bespoke type.
type NotifierFunc func(ctx context.Context, userID, title, body string) error

func (f NotifierFunc) Notify(ctx context.Context, userID, title, body string) error {
	return f(ctx, userID, title, body)
}

// Presigner abstracts the R2 presigner (so certificates/docs can be issued).
// Satisfied by *r2.Presigner. nil → certificate object keys recorded without a
// presigned URL.
type Presigner interface {
	PresignPut(key, contentType string, expiry time.Duration) (string, error)
	PresignGet(key string, expiry time.Duration) (string, error)
}

// Service is the fractionalre application service. It owns every money path and
// reuses the shared finance primitives — it never re-implements the ledger.
type Service struct {
	repo       *Repository
	ledger     *ledger.Service
	settlement *settlement.Service
	kyc        *kyc.Service
	tiers      *tiers.Service
	provider   AssetProvider
	notifier   Notifier
	presigner  Presigner
	referrals  ReferralSource // nil → GET /referrals returns {enabled:false}
	audit      *auditLogger
	now        func() time.Time
}

// NewService wires the service with the shared finance collaborators.
func NewService(
	repo *Repository,
	ledgerSvc *ledger.Service,
	settlementSvc *settlement.Service,
	kycSvc *kyc.Service,
	tiersSvc *tiers.Service,
	provider AssetProvider,
) *Service {
	if provider == nil {
		provider = NewMockAssetProvider()
	}
	return &Service{
		repo:       repo,
		ledger:     ledgerSvc,
		settlement: settlementSvc,
		kyc:        kycSvc,
		tiers:      tiersSvc,
		provider:   provider,
		audit:      newAuditLogger(repo.db),
		now:        time.Now,
	}
}

func (s *Service) WithNotifier(n Notifier) *Service   { s.notifier = n; return s }
func (s *Service) WithPresigner(p Presigner) *Service { s.presigner = p; return s }

const moduleType = "fractionalre"

// notify delivers a best-effort notification (never fails the caller).
func (s *Service) notify(ctx context.Context, userID, title, body string) {
	if s.notifier == nil {
		return
	}
	_ = s.notifier.Notify(ctx, userID, title, body)
}

// ── Investor onboarding / profile ─────────────────────────────────────────────

// Activate creates/activates the investor profile (idempotent).
func (s *Service) Activate(ctx context.Context, userID string) (*InvestorProfile, error) {
	p, err := s.repo.UpsertInvestorProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, userID, "investor.activate", "investor_profile", userID, "", nil, nil)
	return p, nil
}

// Me returns the investor profile, augmenting YTD with the live platform-wide sum.
func (s *Service) Me(ctx context.Context, userID string) (*InvestorProfile, error) {
	p, err := s.repo.GetInvestorProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	year := s.now().UTC().Year()
	if ytd, err := s.repo.SumYTDInvested(ctx, userID, year); err == nil {
		p.YTDInvestedKobo = ytd
		p.YTDYear = year
		_ = s.repo.CacheYTD(ctx, userID, year, ytd)
	}
	return p, nil
}

// SubmitSuitability records a suitability questionnaire result.
func (s *Service) SubmitSuitability(ctx context.Context, userID string, score int, answers []byte) error {
	if err := s.repo.SetSuitability(ctx, userID, score, answers); err != nil {
		return err
	}
	_ = s.audit.log(ctx, userID, "investor.suitability", "investor_profile", userID, "", nil, map[string]int{"score": score})
	return nil
}

// AckRisk records a master or per-offer risk acknowledgement (scroll-gated).
func (s *Service) AckRisk(ctx context.Context, userID string, offeringID *string, disclosureRef string, scrollCompleted bool) (*RiskAcknowledgement, error) {
	scope := "master"
	if offeringID != nil {
		scope = "offer"
	}
	ack := &RiskAcknowledgement{
		UserID:          userID,
		OfferingID:      offeringID,
		Scope:           scope,
		DisclosureRef:   ptrIfNotEmpty(disclosureRef),
		ScrollCompleted: scrollCompleted,
	}
	if err := s.repo.InsertRiskAck(ctx, ack); err != nil {
		return nil, err
	}
	if scope == "master" {
		_ = s.repo.SetMasterRiskAck(ctx, userID, ack.ID)
	}
	_ = s.audit.log(ctx, userID, "investor.risk_ack."+scope, "risk_ack", ack.ID, "", nil, nil)
	return ack, nil
}

func ptrIfNotEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

package fractionalre

import (
	"context"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"log"
	"net/http"
	"spotlight/backend/go-common/ptr"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strings"
	"time"
)

const (
	keyUnits      = "units"
	keyStatus     = "status"
	colAmountKobo = "amount_kobo"
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

// notify delivers a best-effort notification (never fails the caller). The
// error is logged rather than discarded (E2E-FR-051) — a failed enqueue must
// stay observable; the enqueue layer also logs per-channel and counts the
// paymax.notification.enqueue metric.
func (s *Service) notify(ctx context.Context, userID, title, body string) {
	if s.notifier == nil {
		return
	}
	if err := s.notifier.Notify(ctx, userID, title, body); err != nil {
		log.Printf("[fractionalre] notifier failed user=%s err=%v", userID, err)
	}
}

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
		DisclosureRef:   ptr.OrNil(disclosureRef),
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

// Escrow reconciliation (work order 5): a read-only, PermFinance-gated admin
// view comparing, per live offering, the escrowed/allocated subscription total
// (recomputed from source rows) against the offering's raised_kobo projection.
// Any non-zero delta is flagged — projections must always reconcile to source.

// reconcileDelta is the pure integer-kobo comparison (unit-testable, no DB).
func reconcileDelta(raisedKobo, subscribedKobo int64) (int64, bool) {
	var deltaKobo int64

	deltaKobo = raisedKobo - subscribedKobo
	return deltaKobo, deltaKobo != 0
}

// Reconciliation returns per-offering rows plus the count of mismatches.
func (s *Service) Reconciliation(ctx context.Context) ([]ReconciliationRow, int, error) {
	rows, err := s.repo.ListReconciliation(ctx)
	if err != nil {
		return nil, 0, err
	}
	mismatches := 0
	for _, r := range rows {
		if r.Mismatch {
			mismatches++
		}
	}
	return rows, mismatches, nil
}

// Reconciliation handles GET /admin/finance/reconciliation (PermFinance).
func (h *AdminHandler) Reconciliation(c *gin.Context) {
	rows, mismatches, err := h.svc.Reconciliation(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliation": rows, "mismatch_count": mismatches})
}

// GetMarketControls handles GET /admin/market/controls (work order 6) — the
// read companion to the existing PUT.
func (h *AdminHandler) GetMarketControls(c *gin.Context) {
	mc, err := h.svc.GetMarketControls(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, mc)
}

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
		return nil, errors.New("fractionalre: amount must be positive")
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
		map[string]string{"from": fromUser}, map[string]any{"to": toUser, keyUnits: units})
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

// LimitCheck evaluates the SEC retail 10%-of-declared-annual-income cap for a
// user, platform-wide, before a proposed investment of requestedKobo.
// Cap formula (all integer kobo, no floats):
//
//	ytd        = SUM(primary subscriptions escrowed|allocated this year)
//	             + SUM(secondary buys escrowed|settled this year)            // includes auto-invest executions, which run through subscribe
//
// HNI and qualified investors are EXEMPT (cap not applied). The check is
// fail-closed: any error, or a missing/unclassified profile treated as retail
// with zero declared income, yields a hard block (remaining 0) for retail.
func (s *Service) LimitCheck(ctx context.Context, userID string, requestedKobo int64) (*LimitCheck, error) {
	p, err := s.repo.GetInvestorProfile(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			// No profile → treat as retail with zero income → fail-closed block.
			return &LimitCheck{
				UserID:         userID,
				Classification: ClassRetail,
				RequestedKobo:  requestedKobo,
				CapKobo:        0,
				RemainingKobo:  0,
				Allowed:        requestedKobo <= 0,
				Reason:         "no investor profile — activate and declare income first",
			}, nil
		}
		return nil, err
	}

	res := &LimitCheck{
		UserID:           userID,
		Classification:   p.Classification,
		AnnualIncomeKobo: p.DeclaredAnnualIncomeKobo,
		RequestedKobo:    requestedKobo,
	}

	// HNI / qualified are exempt from the retail cap.
	if p.Classification == ClassHNI || p.Classification == ClassQualified {
		res.Exempt = true
		res.Allowed = true
		res.RemainingKobo = -1 // -1 sentinel = unlimited
		return res, nil
	}

	year := s.now().UTC().Year()
	ytd, err := s.repo.SumYTDInvested(ctx, userID, year)
	if err != nil {
		return nil, fmt.Errorf("fractionalre: ytd sum (fail closed): %w", err)
	}
	overrides, err := s.repo.SumActiveOverrides(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("fractionalre: overrides sum (fail closed): %w", err)
	}

	capKobo, remaining, allowed, softWarn := computeRetailCap(p.DeclaredAnnualIncomeKobo, overrides, ytd, requestedKobo)
	res.CapKobo = capKobo
	res.YTDInvestedKobo = ytd
	res.RemainingKobo = remaining
	res.Allowed = allowed
	res.SoftWarn = softWarn
	if !res.Allowed {
		res.Reason = fmt.Sprintf("exceeds 10%% annual-income cap: requested %d kobo, remaining %d kobo", requestedKobo, remaining)
	}
	return res, nil
}

// computeRetailCap is the pure, integer-kobo core of the retail 10%-income cap.
// Extracted so the arithmetic is unit-testable without a DB. All values are
// kobo. remaining is clamped at >= 0; allowed = requested <= remaining;
// softWarn fires when (ytd + requested) >= 80% of cap.
func computeRetailCap(annualIncomeKobo, overridesKobo, ytdKobo, requestedKobo int64) (int64, int64, bool, bool) {
	baseCap := annualIncomeKobo * RetailIncomeCapBps / 10000
	capKobo := baseCap + overridesKobo
	remainingKobo := max(capKobo-ytdKobo, 0)
	var allowed, softWarn bool
	allowed = requestedKobo <= remainingKobo
	if capKobo > 0 && (ytdKobo+requestedKobo) >= capKobo*SoftWarnBps/10000 {
		softWarn = true
	}
	return capKobo, remainingKobo, allowed, softWarn
}

// enforceLimit is the server-side fail-closed gate reused by Subscribe and the
// secondary-market Buy path. It HARD-BLOCKS when not allowed (returns
// ErrLimitExceeded); the soft-warn is surfaced to the client via LimitCheck but
// never blocks. Exempt (HNI/qualified) investors always pass.
func (s *Service) enforceLimit(ctx context.Context, userID string, amountKobo int64) error {
	chk, err := s.LimitCheck(ctx, userID, amountKobo)
	if err != nil {
		return err // fail closed
	}
	if chk.Exempt {
		return nil
	}
	if !chk.Allowed {
		return ErrLimitExceeded
	}
	return nil
}

// ClassifyInvestor sets a user's classification (retail|hni|qualified) and
// declared income. Logged to the immutable audit trail (compliance action).
func (s *Service) ClassifyInvestor(ctx context.Context, adminID, userID string, class Classification, incomeKobo int64) error {
	switch class {
	case ClassRetail, ClassHNI, ClassQualified:
	default:
		return fmt.Errorf("fractionalre: invalid classification %q", class)
	}
	if err := s.repo.SetClassification(ctx, userID, class, incomeKobo, adminID); err != nil {
		return err
	}
	_ = s.audit.log(ctx, adminID, "investor.classify", "investor_profile", userID, "",
		nil, map[string]any{"classification": class, "declared_annual_income_kobo": incomeKobo})
	return nil
}

// SetDeclaredIncome lets the investor self-declare annual income (drives the cap).
func (s *Service) SetDeclaredIncome(ctx context.Context, userID string, incomeKobo int64) error {
	if incomeKobo < 0 {
		return errors.New("fractionalre: income must be non-negative kobo")
	}
	if err := s.repo.SetDeclaredIncome(ctx, userID, incomeKobo); err != nil {
		return err
	}
	_ = s.audit.log(ctx, userID, "investor.declare_income", "investor_profile", userID, "",
		nil, map[string]int64{"declared_annual_income_kobo": incomeKobo})
	return nil
}

// OverrideLimit grants additional headroom above the 10% cap for a user. This is
// a compliance-only action and is ALWAYS logged with a mandatory reason plus a
// typed reason_code from the closed LimitOverrideReasonCodes vocabulary
// (empty → 'other'; unknown codes are rejected).
func (s *Service) OverrideLimit(ctx context.Context, adminID, userID string, overrideKobo int64, reason, reasonCode string, expires *time.Time) error {
	if reason == "" {
		return fmt.Errorf("%w: override reason is required", ErrValidation)
	}
	if reasonCode == "" {
		reasonCode = "other"
	}
	if !LimitOverrideReasonCodes[reasonCode] {
		return fmt.Errorf("%w: reason_code must be one of hni_upgrade|vip_waiver|error_correction|compliance_review|other", ErrValidation)
	}
	if overrideKobo <= 0 {
		return fmt.Errorf("%w: override must be positive kobo", ErrValidation)
	}
	if err := s.repo.InsertOverride(ctx, userID, overrideKobo, reason, reasonCode, adminID, expires); err != nil {
		return err
	}
	_ = s.audit.log(ctx, adminID, "compliance.limit_override", "investor_profile", userID, reason,
		nil, map[string]any{"override_kobo": overrideKobo, "reason_code": reasonCode})
	return nil
}

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
		map[string]string{keyStatus: string(a.Status)}, map[string]string{keyStatus: string(to)})
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

func (s *Service) CreateOffering(ctx context.Context, actorID string, o *Offering) (*Offering, error) {
	// Validate ticket / threshold / window invariants (kobo math, no floats).
	if o.UnitPriceKobo <= 0 || o.ShareCount <= 0 {
		return nil, errors.New("fractionalre: unit_price_kobo and share_count must be positive")
	}
	if o.TargetKobo == 0 {
		o.TargetKobo = o.UnitPriceKobo * o.ShareCount
	}
	if o.MinThresholdKobo > o.TargetKobo {
		return nil, errors.New("fractionalre: min_threshold_kobo cannot exceed target_kobo")
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
		return errors.New("fractionalre: offering not in draft")
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
		return nil, errors.New("fractionalre: offering has no close date")
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

// Auto-invest execution runs on a background ticker goroutine (the house
// pattern — the repo has no pg_cron or asynq scheduler). Every execution goes
// through the EXISTING Subscribe money path, so every iron rule (KYC, risk-ack,
// 10% cap, tier limit, escrow ledger, audit) applies unchanged. The idempotency
// key is DETERMINISTIC — autoinvest:{plan_id}:{scheduled_run_iso} — so a crash
// between subscribe and advancing next_run_at replays, never double-invests.
// Failures are FAIL-CLOSED: the plan is marked 'failed' and skipped, never
// retried in a loop.

// autoInvestStore is the narrow persistence surface the runner needs
// (satisfied by *Repository; faked in tests — no DB).
type autoInvestStore interface {
	ListDueAutoInvest(ctx context.Context, now time.Time, limit int) ([]AutoInvest, error)
	CompleteAutoInvestRun(ctx context.Context, id string, ranAt, nextRun time.Time) error
	FailAutoInvest(ctx context.Context, id, reason string) error
}

// autoInvestRunnerDeps injects the runner's collaborators so the core loop is
// unit-testable with fakes (no DB, no ledger).
type autoInvestRunnerDeps struct {
	store        autoInvestStore
	pickOffering func(ctx context.Context, assetType *string) (*Offering, error)
	subscribe    func(ctx context.Context, userID, idemKey, offeringID string, req SubscribeRequest) (*Subscription, error)
	audit        func(ctx context.Context, actorID, action, entityID, reason string, detail map[string]any)
	now          func() time.Time
}

// autoInvestIdemKey builds the deterministic per-scheduled-run idempotency key.
// scheduledRun is the plan's stored next_run_at (stable until advanced), so
// re-runs after a crash reuse the exact same key.
func autoInvestIdemKey(planID string, scheduledRun time.Time) string {
	return fmt.Sprintf("autoinvest:%s:%s", planID, scheduledRun.UTC().Format(time.RFC3339))
}

// nextAutoInvestRun advances a schedule by one cadence period (pure).
func nextAutoInvestRun(after time.Time, cadence string) time.Time {
	if cadence == "weekly" {
		return after.Add(7 * 24 * time.Hour)
	}
	return after.AddDate(0, 1, 0) // monthly (default)
}

// runAutoInvestOnce executes every due plan exactly once. Returns counts for
// observability. Per-plan failures never abort the sweep.
func runAutoInvestOnce(ctx context.Context, d autoInvestRunnerDeps) (int, int) {
	var executed, failed int
	now := d.now()
	plans, err := d.store.ListDueAutoInvest(ctx, now, 100)
	if err != nil {
		log.Printf("[fractionalre] auto-invest: list due plans: %v", err)
		return 0, 0
	}
	for _, plan := range plans {
		if plan.NextRunAt == nil {
			continue // never scheduled — not due by definition
		}
		scheduled := *plan.NextRunAt

		fail := func(reason string) {
			failed++
			if err := d.store.FailAutoInvest(ctx, plan.ID, reason); err != nil {
				log.Printf("[fractionalre] auto-invest: record failure for plan %s: %v", plan.ID, err)
			}
			d.audit(ctx, plan.UserID, "auto_invest.run.failed", plan.ID, reason,
				map[string]any{"scheduled_run": scheduled.UTC().Format(time.RFC3339)})
		}

		offering, err := d.pickOffering(ctx, plan.AssetType)
		if err != nil {
			fail("no open offering matches the plan preferences")
			continue
		}
		units := plan.AmountKobo / offering.UnitPriceKobo
		if units <= 0 {
			fail(fmt.Sprintf("plan amount %d kobo is below the unit price %d kobo", plan.AmountKobo, offering.UnitPriceKobo))
			continue
		}

		key := autoInvestIdemKey(plan.ID, scheduled)
		sub, err := d.subscribe(ctx, plan.UserID, key, offering.ID, SubscribeRequest{Units: units})
		if err != nil {
			// Fail-closed: KYC / risk-ack / cap / tier / funds — record and skip.
			fail(err.Error())
			continue
		}

		nextRun := nextAutoInvestRun(scheduled, plan.Cadence)
		if !nextRun.After(now) {
			// Catch up a long-overdue plan without a burst of immediate re-runs.
			nextRun = nextAutoInvestRun(now, plan.Cadence)
		}
		if err := d.store.CompleteAutoInvestRun(ctx, plan.ID, now, nextRun); err != nil {
			// The subscription is safe (deterministic key → replay); the schedule
			// advance will be retried on the next tick.
			log.Printf("[fractionalre] auto-invest: advance plan %s: %v", plan.ID, err)
		}
		executed++
		d.audit(ctx, plan.UserID, "auto_invest.run.executed", plan.ID, "",
			map[string]any{
				"subscription_id": sub.ID, "offering_id": offering.ID, keyUnits: units,
				colAmountKobo: sub.AmountKobo, "idempotency_key": key,
				"next_run_at": nextRun.UTC().Format(time.RFC3339),
			})
	}
	return executed, failed
}

// StartAutoInvestRunner starts the background ticker (default interval 1h).
// Wired from route registration behind FEATURE_FRACTIONAL_RE_ENABLED.
// Multi-instance safe: the deterministic idempotency key makes concurrent
// sweeps replay, not duplicate.
func StartAutoInvestRunner(ctx context.Context, svc *Service, interval time.Duration) {
	if svc == nil || svc.repo == nil {
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}
	deps := autoInvestRunnerDeps{
		store:        svc.repo,
		pickOffering: svc.repo.FindOpenOfferingForAutoInvest,
		subscribe:    svc.Subscribe,
		audit: func(ctx context.Context, actorID, action, entityID, reason string, detail map[string]any) {
			_ = svc.audit.log(ctx, actorID, action, "auto_invest", entityID, reason, nil, detail)
		},
		now: svc.now,
	}
	run := func() {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		if executed, failed := runAutoInvestOnce(cctx, deps); executed > 0 || failed > 0 {
			log.Printf("[fractionalre] auto-invest sweep: executed=%d failed=%d", executed, failed)
		}
	}
	go func() {
		run()
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				run()
			}
		}
	}()
	log.Printf("[fractionalre] auto-invest runner started (interval %s)", interval)
}

// Deps carries the collaborators needed to wire the fractionalre module. All are
// reused from the finance route setup (pool, ledger, settlement, kyc, tiers,
// rbac, r2, notifications) — this module never re-implements a finance primitive.
type Deps struct {
	DB         *pgxpool.Pool
	Supabase   *integrations.SupabaseRestClient
	RBAC       services.RBACService
	Ledger     *ledger.Service
	Settlement *settlement.Service
	KYC        *kyc.Service
	Tiers      *tiers.Service
	Provider   AssetProvider  // nil → MockAssetProvider
	Notifier   Notifier       // nil → no-op
	Presigner  Presigner      // nil → object keys recorded without presigned URL
	Referrals  ReferralSource // platform referral engine (nil → GET /referrals returns {enabled:false})
	Enabled    bool           // FEATURE_FRACTIONAL_RE_ENABLED
}

// Register mounts the investor routes under /api/finance/fractionalre and the
// admin control plane under /api/finance/fractionalre/admin (RBAC-gated).
// Returns the constructed *Service (nil when disabled), to allow workers later.
func Register(r *gin.Engine, d Deps) *Service {
	if !d.Enabled {
		log.Println("[fractionalre] FEATURE_FRACTIONAL_RE_ENABLED is false — skipping routes")
		return nil
	}
	if d.DB == nil {
		log.Println("[fractionalre] no database pool — skipping routes")
		return nil
	}

	repo := NewRepository(d.DB)
	svc := NewService(repo, d.Ledger, d.Settlement, d.KYC, d.Tiers, d.Provider)
	if d.Notifier != nil {
		svc.WithNotifier(d.Notifier)
	}
	if d.Presigner != nil {
		svc.WithPresigner(d.Presigner)
	}
	if d.Referrals != nil {
		svc.WithReferrals(d.Referrals)
	}
	h := NewHandler(svc)
	ah := NewAdminHandler(svc)

	// authn maps the authenticated user's id into the gin "user_id" key (matches
	// the finance/invest modules' convention).
	authn := func() gin.HandlerFunc {
		// RequireAuthContext validates the token and sets user_id/user_email before
		// it calls c.Next(); handlers read those directly, so no post-base mirror.
		return middleware.RequireAuthContext(d.Supabase, d.RBAC)
	}

	inv := r.Group("/api/finance/fractionalre")
	inv.Use(authn())
	{
		inv.POST("/activate", h.Activate)
		inv.GET("/me", h.Me)
		inv.POST("/suitability", h.Suitability)
		inv.POST("/risk-ack", h.RiskAck)

		inv.GET("/offerings", h.ListOfferings)
		inv.GET("/offerings/:id", h.GetOffering)
		inv.POST("/offerings/:id/watch", h.Watch)
		inv.DELETE("/offerings/:id/watch", h.Unwatch)
		inv.GET("/watchlist", h.Watchlist)
		inv.POST("/offerings/:id/limit-check", h.LimitCheck)
		inv.POST("/offerings/:id/subscribe", h.Subscribe)

		inv.GET("/portfolio", h.Portfolio)
		inv.GET("/portfolio/holdings", h.Holdings)
		inv.GET("/portfolio/holdings/:id", h.Holding)
		inv.GET("/portfolio/payouts", h.Payouts)
		inv.GET("/portfolio/statements", h.Statements)

		inv.GET("/auto-invest", h.ListAutoInvest)
		inv.POST("/auto-invest", h.CreateAutoInvest)
		inv.POST("/auto-invest/:id/pause", h.PauseAutoInvest)

		inv.GET("/market", h.Market)
		inv.POST("/market/list", h.MarketList)
		inv.POST("/market/listings/:id/buy", h.MarketBuy)
		inv.GET("/market/orders", h.MarketOrders)

		inv.GET("/documents", h.Documents)
		inv.GET("/certificates/:investmentId", h.Certificate)
		inv.GET("/goals", h.ListGoals)
		inv.POST("/goals", h.CreateGoal)

		// Beneficiaries (next-of-kin designations; own rows only).
		inv.GET("/beneficiaries", h.ListBeneficiaries)
		inv.POST("/beneficiaries", h.AddBeneficiary)
		inv.DELETE("/beneficiaries/:id", h.DeleteBeneficiary)

		// Referrals (thin proxy over the platform referral engine).
		inv.GET("/referrals", h.Referrals)
	}

	rp := func(perm string) gin.HandlerFunc { return middleware.RequirePermission(d.RBAC, perm) }
	admin := r.Group("/api/finance/fractionalre/admin")
	admin.Use(authn())
	{
		admin.GET("/dashboard", rp(PermSupport), ah.Dashboard)

		// Assets / sponsors / lifecycle.
		admin.GET("/assets", rp(PermSupport), ah.ListAssets)
		admin.POST("/assets", rp(PermAssetManage), ah.CreateAsset)
		admin.GET("/assets/:id", rp(PermSupport), ah.GetAsset)
		admin.PATCH("/assets/:id", rp(PermAssetManage), ah.PatchAsset)
		admin.POST("/assets/:id/title-verify", rp(PermTitleVerify), ah.TitleVerify)
		admin.POST("/assets/:id/transition", rp(PermAssetManage), ah.Transition)
		admin.POST("/assets/:id/rounds", rp(PermAssetManage), ah.CreateRound)
		admin.GET("/assets/:id/cap-table", rp(PermSupport), ah.CapTable)

		// Rounds.
		admin.GET("/rounds", rp(PermSupport), ah.ListRounds)
		admin.GET("/rounds/:id", rp(PermSupport), ah.GetRound)
		admin.POST("/rounds/:id/extend", rp(PermAssetManage), ah.ExtendRound)
		admin.POST("/rounds/:id/close", rp(PermFinance), ah.CloseRound)
		admin.POST("/rounds/:id/refund", rp(PermFinance), ah.RefundRound)
		admin.POST("/rounds/:id/allocate", rp(PermFinance), ah.AllocateRound)

		admin.POST("/cap-table/transfer", rp(PermAssetManage), ah.CapTableTransfer)

		// Investors / compliance.
		admin.GET("/investors", rp(PermSupport), ah.ListInvestors)
		admin.GET("/investors/:id", rp(PermSupport), ah.GetInvestor)
		admin.GET("/investors/:id/limit", rp(PermCompliance), ah.InvestorLimit)
		admin.POST("/investors/:id/limit-override", rp(PermCompliance), ah.LimitOverride)
		admin.POST("/investors/:id/classify", rp(PermCompliance), ah.Classify)
		admin.GET("/kyc/queue", rp(PermCompliance), ah.KYCQueue)
		admin.POST("/kyc/:userId/decision", rp(PermCompliance), ah.KYCDecision)
		admin.GET("/compliance/dashboard", rp(PermCompliance), ah.ComplianceDashboard)

		// Distributions (maker-checker).
		admin.POST("/distributions", rp(PermFinance), ah.ScheduleDistribution)
		admin.GET("/distributions", rp(PermSupport), ah.ListDistributions)
		admin.GET("/distributions/:id/preview", rp(PermSupport), ah.PreviewDistribution)
		admin.POST("/distributions/:id/submit", rp(PermFinance), ah.SubmitDistribution)
		admin.POST("/distributions/:id/approve", rp(PermDistributionApprove), ah.ApproveDistribution)

		// Secondary market controls.
		admin.GET("/market/listings", rp(PermSupport), ah.ListMarketListings)
		admin.POST("/market/listings/:id/halt", rp(PermCompliance), ah.HaltListing)
		admin.GET("/market/controls", rp(PermSupport), ah.GetMarketControls)
		admin.PUT("/market/controls", rp(PermFinance), ah.MarketControls)

		// Sponsors.
		admin.GET("/sponsors", rp(PermSponsor), ah.ListSponsors)
		admin.POST("/sponsors", rp(PermSponsor), ah.CreateSponsor)

		// Finance.
		admin.GET("/finance/escrow", rp(PermFinance), ah.Escrow)
		admin.GET("/finance/reconciliation", rp(PermFinance), ah.Reconciliation)
		admin.POST("/finance/refunds/:roundId", rp(PermFinance), ah.FinanceRefund)
		admin.GET("/finance/fees", rp(PermFinance), ah.Fees)

		// Documents.
		admin.GET("/documents", rp(PermSupport), ah.Documents)
		admin.POST("/documents/presign", rp(PermAssetManage), ah.PresignDocument)

		// Audit.
		admin.GET("/audit", rp(PermAudit), ah.Audit)
	}

	log.Println("[fractionalre] routes registered at /api/finance/fractionalre and /api/finance/fractionalre/admin (provider=" + svc.provider.Name() + ")")
	return svc
}

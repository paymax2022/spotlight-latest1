// Package fractionalre implements the Fractional Real Estate / Land
// Crowd-Investing module for the Paymax super app. It reuses the shared finance
// primitives (ledger, settlement, kyc, tiers, rbac) and never duplicates them.
//
// Iron rules honoured throughout this package:
//   - All money is integer kobo (int64). Never floats for math, never strings.
//   - Every money mutation requires an Idempotency-Key, posts a balanced
//     double-entry via the ledger/settlement primitives, emits an audit event,
//     and runs fail-closed KYC/limit checks BEFORE money moves.
//   - Wallet/escrow balances are ledger projections — never directly mutated.
//   - Maker != checker (SoD) on round close/refund and on distribution approval;
//     title verifier != asset creator. Enforced in the service layer.
package fractionalre

import (
	"errors"
	"time"
)

// ── RBAC permission slugs (mirror 20260705000100_fractionalre_rbac.sql) ───────
const (
	PermManage              = "fractionalre.manage"               // umbrella
	PermCompliance          = "fractionalre.compliance"           // compliance queues + cap overrides
	PermAssetManage         = "fractionalre.asset_manage"         // assets/sponsors/transitions
	PermTitleVerify         = "fractionalre.title_verify"         // independent title verification (SoD)
	PermDistributionApprove = "fractionalre.distribution_approve" // distribution checker
	PermFinance             = "fractionalre.finance"              // escrow/refunds/fees
	PermSponsor             = "fractionalre.sponsor"              // sponsor onboarding
	PermSupport             = "fractionalre.support"              // read-only support/dashboards
	PermAudit               = "fractionalre.audit"                // read audit log
)

// ── Asset lifecycle states (role-gated transitions) ───────────────────────────
type AssetStatus string

const (
	AssetDraft           AssetStatus = "draft"
	AssetDueDiligence    AssetStatus = "due_diligence"
	AssetTitleVerify     AssetStatus = "title_verify"
	AssetApproved        AssetStatus = "approved"
	AssetLive            AssetStatus = "live"
	AssetFunded          AssetStatus = "funded"
	AssetRefundClose     AssetStatus = "refund_close"
	AssetUnderManagement AssetStatus = "under_management"
	AssetDistributions   AssetStatus = "distributions"
	AssetExit            AssetStatus = "exit"
	AssetClosed          AssetStatus = "closed"
)

// TitleStatus tracks the independent title due-diligence outcome.
type TitleStatus string

const (
	TitleUnverified TitleStatus = "unverified"
	TitleVerifying  TitleStatus = "verifying"
	TitleVerified   TitleStatus = "verified"
	TitleRejected   TitleStatus = "rejected"
)

// AssetType is the instrument category for an asset.
type AssetType string

const (
	TypeIncomeProperty  AssetType = "income_property"
	TypeDevelopmentDebt AssetType = "development_debt"
	TypeLand            AssetType = "land"
)

// OfferingStatus tracks a funding round lifecycle.
type OfferingStatus string

const (
	OfferingDraft     OfferingStatus = "draft"
	OfferingOpen      OfferingStatus = "open"
	OfferingClosing   OfferingStatus = "closing"
	OfferingFunded    OfferingStatus = "funded"
	OfferingRefunding OfferingStatus = "refunding"
	OfferingRefunded  OfferingStatus = "refunded"
	OfferingClosed    OfferingStatus = "closed"
)

// SubscriptionStatus tracks an investor commitment.
type SubscriptionStatus string

const (
	SubEscrowed  SubscriptionStatus = "escrowed"
	SubAllocated SubscriptionStatus = "allocated"
	SubRefunded  SubscriptionStatus = "refunded"
)

// Classification drives the retail 10%-income cap exemption.
type Classification string

const (
	ClassRetail    Classification = "retail"
	ClassHNI       Classification = "hni"
	ClassQualified Classification = "qualified"
)

// DistributionStatus tracks a maker-checker payout run.
type DistributionStatus string

const (
	DistDraft     DistributionStatus = "draft"
	DistSubmitted DistributionStatus = "submitted"
	DistApproved  DistributionStatus = "approved"
	DistPaid      DistributionStatus = "paid"
	DistPartial   DistributionStatus = "partial"
	DistFailed    DistributionStatus = "failed"
)

// ── Window / cap constants ────────────────────────────────────────────────────
const (
	// MaxOfferWindow is the SEC-aligned maximum offer window.
	MaxOfferWindow = 60 * 24 * time.Hour
	// MaxExtension is the one-time extension cap.
	MaxExtensionDays = 30
	// RetailIncomeCapBps is the retail annual-income investment cap (10% = 1000 bps).
	RetailIncomeCapBps = 1000
	// SoftWarnBps is the headroom-usage threshold at which a soft warning fires (80%).
	SoftWarnBps = 8000
)

// ── Domain models ─────────────────────────────────────────────────────────────

type Sponsor struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	LegalName   *string   `json:"legal_name,omitempty"`
	TrusteeName *string   `json:"trustee_name,omitempty"`
	Description *string   `json:"description,omitempty"`
	Status      string    `json:"status"`
	CreatedBy   *string   `json:"created_by,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

type Asset struct {
	ID              string      `json:"id"`
	SponsorID       *string     `json:"sponsor_id,omitempty"`
	Name            string      `json:"name"`
	AssetType       AssetType   `json:"asset_type"`
	Description     *string     `json:"description,omitempty"`
	Location        *string     `json:"location,omitempty"`
	GeoLat          *float64    `json:"geo_lat,omitempty"`
	GeoLng          *float64    `json:"geo_lng,omitempty"`
	Status          AssetStatus `json:"status"`
	TitleStatus     TitleStatus `json:"title_status"`
	TitleVerifiedBy *string     `json:"title_verified_by,omitempty"`
	TitleVerifiedAt *time.Time  `json:"title_verified_at,omitempty"`
	NAVKobo         int64       `json:"nav_kobo"`
	CreatedBy       *string     `json:"created_by,omitempty"`
	CreatedAt       time.Time   `json:"created_at"`
}

type Offering struct {
	ID               string         `json:"id"`
	AssetID          string         `json:"asset_id"`
	Name             string         `json:"name"`
	UnitPriceKobo    int64          `json:"unit_price_kobo"`
	ShareCount       int64          `json:"share_count"`
	TargetKobo       int64          `json:"target_kobo"`
	MinThresholdKobo int64          `json:"min_threshold_kobo"`
	TicketMinKobo    int64          `json:"ticket_min_kobo"`
	TicketMaxKobo    int64          `json:"ticket_max_kobo"`
	Status           OfferingStatus `json:"status"`
	OpensAt          *time.Time     `json:"opens_at,omitempty"`
	ClosesAt         *time.Time     `json:"closes_at,omitempty"`
	ExtensionDays    int            `json:"extension_days"`
	RaisedKobo       int64          `json:"raised_kobo"`
	UnitsSold        int64          `json:"units_sold"`
	InvestorCount    int            `json:"investor_count"`
	EscrowReference  *string        `json:"escrow_reference,omitempty"`
	CloseProposedBy  *string        `json:"close_proposed_by,omitempty"`
	CloseApprovedBy  *string        `json:"close_approved_by,omitempty"`
	ClosedAt         *time.Time     `json:"closed_at,omitempty"`
	CreatedBy        *string        `json:"created_by,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
}

type Subscription struct {
	ID             string             `json:"id"`
	OfferingID     string             `json:"offering_id"`
	UserID         string             `json:"user_id"`
	Units          int64              `json:"units"`
	AmountKobo     int64              `json:"amount_kobo"`
	Status         SubscriptionStatus `json:"status"`
	SettlementID   *string            `json:"settlement_id,omitempty"`
	IdempotencyKey string             `json:"idempotency_key"`
	RiskAckID      *string            `json:"risk_ack_id,omitempty"`
	CreatedAt      time.Time          `json:"created_at"`
}

type CapTableEntry struct {
	ID         string    `json:"id"`
	AssetID    string    `json:"asset_id"`
	OfferingID *string   `json:"offering_id,omitempty"`
	UserID     string    `json:"user_id"`
	Units      int64     `json:"units"`
	CostKobo   int64     `json:"cost_kobo"`
	PctBps     int       `json:"pct_bps"`
	Source     string    `json:"source"` // primary|secondary
	CertRef    *string   `json:"cert_ref,omitempty"`
	AcquiredAt time.Time `json:"acquired_at"`
}

type InvestorProfile struct {
	ID                       string         `json:"id"`
	UserID                   string         `json:"user_id"`
	Classification           Classification `json:"classification"`
	DeclaredAnnualIncomeKobo int64          `json:"declared_annual_income_kobo"`
	YTDInvestedKobo          int64          `json:"ytd_invested_kobo"`
	YTDYear                  int            `json:"ytd_year"`
	SuitabilityScore         int            `json:"suitability_score"`
	SuitabilityCompletedAt   *time.Time     `json:"suitability_completed_at,omitempty"`
	MasterRiskAckID          *string        `json:"master_risk_ack_id,omitempty"`
	Status                   string         `json:"status"`
	ActivatedAt              *time.Time     `json:"activated_at,omitempty"`
	CreatedAt                time.Time      `json:"created_at"`
}

type RiskAcknowledgement struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	OfferingID      *string   `json:"offering_id,omitempty"`
	Scope           string    `json:"scope"` // master|offer
	DisclosureRef   *string   `json:"disclosure_ref,omitempty"`
	ScrollCompleted bool      `json:"scroll_completed"`
	AcknowledgedAt  time.Time `json:"acknowledged_at"`
}

type Distribution struct {
	ID              string             `json:"id"`
	AssetID         string             `json:"asset_id"`
	OfferingID      *string            `json:"offering_id,omitempty"`
	PeriodLabel     *string            `json:"period_label,omitempty"`
	GrossKobo       int64              `json:"gross_kobo"`
	FeeKobo         int64              `json:"fee_kobo"`
	WithholdingKobo int64              `json:"withholding_kobo"`
	NetKobo         int64              `json:"net_kobo"`
	Status          DistributionStatus `json:"status"`
	MakerID         *string            `json:"maker_id,omitempty"`
	CheckerID       *string            `json:"checker_id,omitempty"`
	SubmittedAt     *time.Time         `json:"submitted_at,omitempty"`
	ApprovedAt      *time.Time         `json:"approved_at,omitempty"`
	PaidAt          *time.Time         `json:"paid_at,omitempty"`
	IdempotencyKey  string             `json:"idempotency_key"`
	CreatedAt       time.Time          `json:"created_at"`
}

type DistributionPayment struct {
	ID              string     `json:"id"`
	DistributionID  string     `json:"distribution_id"`
	UserID          string     `json:"user_id"`
	Units           int64      `json:"units"`
	GrossKobo       int64      `json:"gross_kobo"`
	WithholdingKobo int64      `json:"withholding_kobo"`
	NetKobo         int64      `json:"net_kobo"`
	Status          string     `json:"status"`
	ExcludedReason  *string    `json:"excluded_reason,omitempty"`
	IdempotencyKey  string     `json:"idempotency_key"`
	PaidAt          *time.Time `json:"paid_at,omitempty"`
}

type SecondaryListing struct {
	ID             string    `json:"id"`
	AssetID        string    `json:"asset_id"`
	SellerID       string    `json:"seller_id"`
	Units          int64     `json:"units"`
	UnitsRemaining int64     `json:"units_remaining"`
	UnitPriceKobo  int64     `json:"unit_price_kobo"`
	NAVAtListKobo  int64     `json:"nav_at_list_kobo"`
	Status         string    `json:"status"`
	IdempotencyKey *string   `json:"idempotency_key,omitempty"` // nullable: pre-hardening rows have none
	CreatedAt      time.Time `json:"created_at"`
}

type SecondaryOrder struct {
	ID             string    `json:"id"`
	ListingID      string    `json:"listing_id"`
	AssetID        string    `json:"asset_id"`
	BuyerID        string    `json:"buyer_id"`
	SellerID       string    `json:"seller_id"`
	Units          int64     `json:"units"`
	AmountKobo     int64     `json:"amount_kobo"`
	FeeKobo        int64     `json:"fee_kobo"`
	Status         string    `json:"status"`
	SettlementID   *string   `json:"settlement_id,omitempty"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

type MarketControls struct {
	TradingEnabled bool    `json:"trading_enabled"`
	FeeBps         int     `json:"fee_bps"`
	UpdatedBy      *string `json:"updated_by,omitempty"`
}

type Watchlist struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	OfferingID string    `json:"offering_id"`
	CreatedAt  time.Time `json:"created_at"`
}

type Goal struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	Name       string     `json:"name"`
	TargetKobo int64      `json:"target_kobo"`
	SavedKobo  int64      `json:"saved_kobo"`
	TargetDate *time.Time `json:"target_date,omitempty"`
	Status     string     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
}

type AutoInvest struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	AmountKobo int64      `json:"amount_kobo"`
	Cadence    string     `json:"cadence"`
	AssetType  *string    `json:"asset_type,omitempty"`
	Status     string     `json:"status"` // active|paused|failed
	NextRunAt  *time.Time `json:"next_run_at,omitempty"`
	LastRunAt  *time.Time `json:"last_run_at,omitempty"`
	LastError  *string    `json:"last_error,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// Beneficiary is a next-of-kin designation on an investor's FRE holdings.
// Server-side rules (enforced in service + a guarded repository insert):
// per-user share_pct total <= 100 and at most MaxBeneficiaries rows.
type Beneficiary struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Name         string    `json:"name"`
	Relationship string    `json:"relationship"`
	SharePct     int       `json:"share_pct"`
	CreatedAt    time.Time `json:"created_at"`
}

// MaxBeneficiaries caps the number of beneficiary rows per investor.
const MaxBeneficiaries = 10

// ReconciliationRow is one live offering's escrow-vs-projection check: the
// raised_kobo projection must equal the sum of escrowed/allocated subscription
// amounts (both integer kobo). A non-zero delta flags a mismatch.
type ReconciliationRow struct {
	OfferingID     string         `json:"offering_id"`
	Name           string         `json:"name"`
	Status         OfferingStatus `json:"status"`
	RaisedKobo     int64          `json:"raised_kobo"`
	SubscribedKobo int64          `json:"subscribed_kobo"`
	DeltaKobo      int64          `json:"delta_kobo"`
	Mismatch       bool           `json:"mismatch"`
}

// ReferralView is the FRE investor-surface referral payload. It is a thin
// projection over the platform referral engine (finance/referrals) — REUSED,
// never re-implemented. Enabled=false renders a "coming soon" state.
type ReferralView struct {
	Enabled    bool   `json:"enabled"`
	Code       string `json:"code,omitempty"`
	Invited    int    `json:"invited"`
	Joined     int    `json:"joined"`
	EarnedKobo int64  `json:"earned_kobo"`
}

type Document struct {
	ID         string    `json:"id"`
	AssetID    *string   `json:"asset_id,omitempty"`
	OfferingID *string   `json:"offering_id,omitempty"`
	UserID     *string   `json:"user_id,omitempty"`
	DocType    string    `json:"doc_type"`
	ObjectKey  string    `json:"object_key"`
	Label      *string   `json:"label,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// LimitCheck is the result of a 10%-of-income cap evaluation (compliance engine).
type LimitCheck struct {
	UserID           string         `json:"user_id"`
	Classification   Classification `json:"classification"`
	Exempt           bool           `json:"exempt"` // HNI / qualified are exempt
	AnnualIncomeKobo int64          `json:"annual_income_kobo"`
	CapKobo          int64          `json:"cap_kobo"` // 10% of declared income (+overrides)
	YTDInvestedKobo  int64          `json:"ytd_invested_kobo"`
	RemainingKobo    int64          `json:"remaining_kobo"` // cap - ytd (>= 0)
	RequestedKobo    int64          `json:"requested_kobo"`
	Allowed          bool           `json:"allowed"`   // requested <= remaining
	SoftWarn         bool           `json:"soft_warn"` // >= 80% of cap after this investment
	Reason           string         `json:"reason,omitempty"`
}

// ── Sentinel errors ───────────────────────────────────────────────────────────
var (
	ErrFeatureDisabled    = errors.New("fractionalre: feature disabled")
	ErrIdempotencyKey     = errors.New("fractionalre: Idempotency-Key header required")
	ErrNotFound           = errors.New("fractionalre: not found")
	ErrInvalidTransition  = errors.New("fractionalre: invalid lifecycle transition")
	ErrTitleSoD           = errors.New("fractionalre: title verifier must differ from asset creator (separation of duties)")
	ErrMakerChecker       = errors.New("fractionalre: maker and checker must be different users (separation of duties)")
	ErrRiskAckRequired    = errors.New("fractionalre: a per-offer risk acknowledgement is required before subscribing")
	ErrMasterRiskRequired = errors.New("fractionalre: master risk acknowledgement is required")
	ErrKYCRequired        = errors.New("fractionalre: KYC verification required")
	ErrLimitExceeded      = errors.New("fractionalre: investment exceeds the 10% annual-income retail cap")
	ErrTicketRange        = errors.New("fractionalre: amount outside the offering ticket range")
	ErrOfferingNotOpen    = errors.New("fractionalre: offering is not open for subscription")
	ErrThresholdNotMet    = errors.New("fractionalre: minimum threshold not met")
	ErrMarketHalted       = errors.New("fractionalre: secondary market trading is halted")
	ErrInsufficientUnits  = errors.New("fractionalre: insufficient units")
	ErrProfileInactive    = errors.New("fractionalre: investor profile not activated")
	ErrBeneficiaryShare   = errors.New("fractionalre: total beneficiary share would exceed 100%")
	ErrBeneficiaryLimit   = errors.New("fractionalre: maximum of 10 beneficiaries per investor")
	ErrBeneficiaryInput   = errors.New("fractionalre: invalid beneficiary input")
	ErrValidation         = errors.New("fractionalre: invalid input")
)

// LimitOverrideReasonCodes is the closed vocabulary for compliance cap
// overrides (mirrors the reason_code CHECK in
// 20260831000000_fre_beneficiaries_hardening.sql).
var LimitOverrideReasonCodes = map[string]bool{
	"hni_upgrade":       true,
	"vip_waiver":        true,
	"error_correction":  true,
	"compliance_review": true,
	"other":             true,
}

// allowedTransitions maps each asset state to the set of states it can move to
// and the RBAC permission required for the transition. Title-verify is a
// distinct step handled by TitleVerify (independent verifier, SoD enforced).
var allowedTransitions = map[AssetStatus]map[AssetStatus]string{
	AssetDraft:           {AssetDueDiligence: PermAssetManage},
	AssetDueDiligence:    {AssetTitleVerify: PermAssetManage, AssetDraft: PermAssetManage},
	AssetTitleVerify:     {AssetApproved: PermAssetManage}, // requires title_status=verified (checked in code)
	AssetApproved:        {AssetLive: PermAssetManage},
	AssetLive:            {AssetFunded: PermAssetManage, AssetRefundClose: PermAssetManage},
	AssetFunded:          {AssetUnderManagement: PermAssetManage},
	AssetUnderManagement: {AssetDistributions: PermAssetManage, AssetExit: PermAssetManage},
	AssetDistributions:   {AssetUnderManagement: PermAssetManage, AssetExit: PermAssetManage},
	AssetExit:            {AssetClosed: PermAssetManage},
	AssetRefundClose:     {AssetClosed: PermAssetManage},
}

// CanTransition reports whether a state change is permitted and the RBAC slug
// required for it. Terminal/unknown states return ("", false).
func CanTransition(from, to AssetStatus) (string, bool) {
	targets, ok := allowedTransitions[from]
	if !ok {
		return "", false
	}
	perm, ok := targets[to]
	return perm, ok
}

// Package adminext implements the crowdfunding ADMIN domain slice:
// finance/refunds/settlement, disputes, withdrawal approval, fraud, KYC/KYB,
// compliance and user management.
//
// All DTOs are camelCase to match the admin web client TS shapes in
// frontend-admin/src/types/crowdfunding.ts exactly. All money is BIGINT kobo.
//
// Admin decisions are guarded transitions: reject/freeze REQUIRE a note, every
// mutation is transactional, and each writes an immutable audit row.
package adminext

// ─── Finance: refunds / settlement / summary ─────────────────────────────────

// RefundRequest matches CfRefundRequest.
type RefundRequest struct {
	ID              string `json:"id"`
	Reference       string `json:"reference"`
	CampaignTitle   string `json:"campaignTitle"`
	ContributorName string `json:"contributorName"`
	AmountKobo      int64  `json:"amountKobo"`
	Reason          string `json:"reason"`
	Status          string `json:"status"`
	RequestedAt     string `json:"requestedAt"`
	RefundEligible  bool   `json:"refundEligible"`
	// IsDemo marks a row created by the crowdfunding seed migration rather than
	// by a real refund. Nothing in the codebase inserts into cf_refunds outside
	// that seed, so today every row is a demo row; the console renders the flag
	// per row so real rows appear correctly the moment a pipeline creates them.
	IsDemo bool `json:"isDemo"`
}

// SettlementBatch matches CfSettlementBatch.
type SettlementBatch struct {
	ID          string `json:"id"`
	Reference   string `json:"reference"`
	PayoutCount int    `json:"payoutCount"`
	GrossKobo   int64  `json:"grossKobo"`
	FeeKobo     int64  `json:"feeKobo"`
	NetKobo     int64  `json:"netKobo"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	// IsDemo — see RefundRequest.IsDemo. cf_settlements has the same single
	// writer (the seed migration).
	IsDemo bool `json:"isDemo"`
}

// FinanceSummary matches CfFinanceSummary.
type FinanceSummary struct {
	GmvKobo int64 `json:"gmvKobo"`
	// PlatformRevenueKobo is REALIZED revenue read from commission_earnings
	// (source_module='crowdfunding'), not a percentage applied to GMV. It was
	// previously GmvKobo/40 — an assumed 2.5% — while the only authority for the
	// crowdfunding split, crowdfunding.PlatformFeePct, is 10%. The card therefore
	// understated booked revenue fourfold and would not have moved if the fee
	// changed.
	PlatformRevenueKobo  int64 `json:"platformRevenueKobo"`
	RefundsPendingKobo   int64 `json:"refundsPendingKobo"`
	RefundsPendingCount  int   `json:"refundsPendingCount"`
	ChargebacksKobo      int64 `json:"chargebacksKobo"`
	ChargebacksCount     int   `json:"chargebacksCount"`
	EscrowKobo           int64 `json:"escrowKobo"`
	SettledThisMonthKobo int64 `json:"settledThisMonthKobo"`
	// ReconciliationMismatches counts released contributions with no
	// commission_earnings row — money that moved without its revenue being
	// booked. It used to be the literal 0, so the one card an operator would read
	// as "the books balance" could never say anything else.
	ReconciliationMismatches int `json:"reconciliationMismatches"`
	// UnbookedGrossKobo is the gross contribution value behind those mismatches.
	// Gross, deliberately: the unbooked FEE would have to be assumed, and an
	// assumed number is what this change is removing.
	UnbookedGrossKobo int64 `json:"unbookedGrossKobo"`
	// DemoRefundRows / DemoSettlementRows let the console state how much of what
	// it is showing is seed data rather than leaving the operator to guess.
	DemoRefundRows     int `json:"demoRefundRows"`
	DemoSettlementRows int `json:"demoSettlementRows"`
}

// ─── Disputes ────────────────────────────────────────────────────────────────

// Dispute matches CfDispute.
type Dispute struct {
	ID            string  `json:"id"`
	Reference     string  `json:"reference"`
	Type          string  `json:"type"`
	Status        string  `json:"status"`
	CampaignTitle string  `json:"campaignTitle"`
	CampaignID    string  `json:"campaignId"`
	RaisedBy      string  `json:"raisedBy"`
	Description   string  `json:"description"`
	CreatedAt     string  `json:"createdAt"`
	SlaHoursLeft  int     `json:"slaHoursLeft"`
	Resolution    *string `json:"resolution"`
	AdminNote     *string `json:"adminNote"`
}

// ─── Withdrawals ─────────────────────────────────────────────────────────────

// Withdrawal matches CfWithdrawal.
type Withdrawal struct {
	ID                  string  `json:"id"`
	Reference           string  `json:"reference"`
	CampaignTitle       string  `json:"campaignTitle"`
	CreatorName         string  `json:"creatorName"`
	CreatorVerification string  `json:"creatorVerification"`
	AmountKobo          int64   `json:"amountKobo"`
	AvailableKobo       int64   `json:"availableKobo"`
	BankLabel           string  `json:"bankLabel"`
	Status              string  `json:"status"`
	RequestedAt         string  `json:"requestedAt"`
	RiskLevel           string  `json:"riskLevel"`
	Note                *string `json:"note"`
}

// ─── Fraud ───────────────────────────────────────────────────────────────────

// FraudAlert matches CfFraudAlert.
type FraudAlert struct {
	ID            string   `json:"id"`
	CampaignTitle string   `json:"campaignTitle"`
	CampaignID    string   `json:"campaignId"`
	CreatorName   string   `json:"creatorName"`
	RiskLevel     string   `json:"riskLevel"`
	Status        string   `json:"status"`
	Signals       []string `json:"signals"`
	RaisedKobo    int64    `json:"raisedKobo"`
	CreatedAt     string   `json:"createdAt"`
}

// ─── KYC / KYB ───────────────────────────────────────────────────────────────

// KycCase matches CfKycCase — the crowdfunding console's view onto the
// platform-wide finance/kyc queue (backend/internal/finance/kyc), scoped to
// identity verification. There is no crowdfunding-specific KYC dataset: this
// is real user_profiles.kyc_* state, not a bespoke case record.
type KycCase struct {
	ID            string  `json:"id"` // the user's id
	Status        string  `json:"status"`
	ApplicantName string  `json:"applicantName"`
	ApplicantType string  `json:"applicantType"` // always "Individual" — platform KYC has no business-entity tier
	Email         string  `json:"email"`
	Tier          int     `json:"tier"` // requested tier (1-3)
	DocumentType  *string `json:"documentType"`
	SubmittedAt   string  `json:"submittedAt"`
	VerifiedAt    *string `json:"verifiedAt"`
}

// ─── Compliance ──────────────────────────────────────────────────────────────

// AuditLog matches CfAuditLog.
type AuditLog struct {
	ID        string `json:"id"`
	Actor     string `json:"actor"`
	Action    string `json:"action"`
	Target    string `json:"target"`
	CreatedAt string `json:"createdAt"`
	IP        string `json:"ip"`
}

// DataRequest matches CfDataRequest.
type DataRequest struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	UserName    string `json:"userName"`
	Email       string `json:"email"`
	Status      string `json:"status"`
	RequestedAt string `json:"requestedAt"`
	DueBy       string `json:"dueBy"`
}

// ComplianceSummary matches CfComplianceSummary.
type ComplianceSummary struct {
	PendingKyc           int    `json:"pendingKyc"`
	PendingKyb           int    `json:"pendingKyb"`
	OpenDataRequests     int    `json:"openDataRequests"`
	InvestmentEnabled    bool   `json:"investmentEnabled"`
	RetentionPolicyDays  int    `json:"retentionPolicyDays"`
	LastRegulatoryExport string `json:"lastRegulatoryExport"`
	AuditEventsToday     int    `json:"auditEventsToday"`
}

// ─── Users ───────────────────────────────────────────────────────────────────

// UserActivity matches CfUserActivity.
type UserActivity struct {
	ID        string `json:"id"`
	Action    string `json:"action"`
	Detail    string `json:"detail"`
	CreatedAt string `json:"createdAt"`
}

// User matches CfUser.
type User struct {
	ID                   string         `json:"id"`
	Name                 string         `json:"name"`
	Email                string         `json:"email"`
	Role                 string         `json:"role"`
	Type                 string         `json:"type"`
	Verification         string         `json:"verification"`
	Status               string         `json:"status"`
	RiskLevel            string         `json:"riskLevel"`
	CampaignsCreated     int            `json:"campaignsCreated"`
	TotalRaisedKobo      int64          `json:"totalRaisedKobo"`
	TotalContributedKobo int64          `json:"totalContributedKobo"`
	JoinedAt             string         `json:"joinedAt"`
	LastActiveAt         string         `json:"lastActiveAt"`
	Activity             []UserActivity `json:"activity"`
}

// ─── Request bodies ──────────────────────────────────────────────────────────

// NoteRequest is the common {note} body for approve/reject/freeze decisions.
type NoteRequest struct {
	Note string `json:"note"`
}

// ResolveDisputeRequest is the body for POST /disputes/:id/resolve.
type ResolveDisputeRequest struct {
	Resolution string `json:"resolution" binding:"required"`
	Note       string `json:"note"`
}

// SetUserStatusRequest is the body for POST /users/:id/status.
type SetUserStatusRequest struct {
	Status string `json:"status" binding:"required"` // ACTIVE | SUSPENDED | RESTRICTED
	Note   string `json:"note"`
}

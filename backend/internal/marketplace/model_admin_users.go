package marketplace

import "time"

// model_admin_users.go — MKT-007 Users/Trust&Safety + Appeals + Fraud-signals
// admin surface. Field names/vocab mirror frontend-admin/src/types/
// marketplaceAdmin.ts (MktUserAdmin, MktAppeal, MktFraudSignal, and the
// request types) VERBATIM — that file, not the service-layer USE_FIXTURES
// blocks, is the authoritative contract; the fixtures in
// marketplaceAdminService.ts are a partial/older subset of these fields.

// UserModerationStatus mirrors mkt_user_moderation.status / MktUserStatus.
type UserModerationStatus string

const (
	UserStatusActive    UserModerationStatus = "active"
	UserStatusSuspended UserModerationStatus = "suspended"
	UserStatusBanned    UserModerationStatus = "banned"
)

// UserAction mirrors MktUserAction — the verb the admin proposes; status is the
// resulting noun (ban -> banned, suspend -> suspended, reinstate -> active).
type UserAction string

const (
	UserActionSuspend  UserAction = "suspend"
	UserActionBan      UserAction = "ban"
	UserActionReinstate UserAction = "reinstate"
)

// dualApprovalRequiredFor is the ONE place the severity split lives (PR note:
// mirrors ADR-005's amount threshold, translated from money to action
// severity). Only 'ban' can silently and severely cut off a real account's
// ability to transact — it requires a second, independent admin. 'suspend' and
// 'reinstate' execute immediately under a single admin, same posture as this
// module's existing single-admin flag/listing moderation actions.
func dualApprovalRequiredFor(action UserAction) bool {
	return action == UserActionBan
}

// resultingStatus maps a proposed action to the status it produces once applied.
func resultingStatus(action UserAction) UserModerationStatus {
	switch action {
	case UserActionBan:
		return UserStatusBanned
	case UserActionSuspend:
		return UserStatusSuspended
	default:
		return UserStatusActive
	}
}

// UserAdminView is the GET /admin/users/:id (and one row of GET /admin/users)
// response shape — matches MktUserAdmin field-for-field.
type UserAdminView struct {
	ID                     string     `json:"id"`
	DisplayName            string     `json:"display_name"`
	EmailMasked            string     `json:"email_masked"`
	PhoneMasked            string     `json:"phone_masked"`
	Status                 string     `json:"status"`
	KYCTier                string     `json:"kyc_tier"`
	KYCPending             bool       `json:"kyc_pending"`
	TrustScore             float64    `json:"trust_score"`
	VerifiedIDBadge        bool       `json:"verified_id_badge"`
	VerifiedBusinessBadge  bool       `json:"verified_business_badge"`
	ActiveListings         int        `json:"active_listings"`
	CompletedDeals         int        `json:"completed_deals"`
	OpenFlags              int        `json:"open_flags"`
	FraudScore             float64    `json:"fraud_score"`
	SuspensionReasonCode   *string    `json:"suspension_reason_code,omitempty"`
	PendingAction          *string    `json:"pending_action,omitempty"`
	PendingActionBy        *string    `json:"pending_action_by,omitempty"`
	RequiresDualApproval   bool       `json:"requires_dual_approval"`
	CreatedAt              time.Time  `json:"created_at"`
	LastActiveAt           *time.Time `json:"last_active_at,omitempty"`
}

// SetUserStatusInput is the POST /admin/users/:id/status body (propose/maker) —
// matches MktUserActionRequest.
type SetUserStatusInput struct {
	Action     string `json:"action"` // suspend|ban|reinstate
	ReasonCode string `json:"reason_code"`
}

// KycReviewInput matches MktKycReviewRequest.
type KycReviewInput struct {
	Decision   string  `json:"decision"` // approve|reject
	ReasonCode string  `json:"reason_code"`
	GrantTier  *string `json:"grant_tier,omitempty"`
}

// BlacklistInput matches MktBlacklistRequest.
type BlacklistInput struct {
	Type       string `json:"type"` // device|phone|ip|email
	Value      string `json:"value"`
	ReasonCode string `json:"reason_code"`
}

// UserModerationRow mirrors mkt_user_moderation exactly (repository scan target).
type UserModerationRow struct {
	UserID               string
	MarketID             string
	Status               string
	SuspensionReasonCode *string
	Blacklisted          bool
	BlacklistReasonCode  *string
	KYCTier              string
	KYCPending           bool
	PendingAction        *string
	PendingReasonCode    *string
	ProposedBy           *string
	ProposedAt           *time.Time
	RequiresDualApproval bool
	SecondApproverID     *string
	SecondApprovedAt     *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// AppealTargetType mirrors mkt_appeals.target_type / MktAppealTargetType.
type AppealTargetType string

const (
	AppealTargetListing AppealTargetType = "listing"
	AppealTargetBoost   AppealTargetType = "boost"
	AppealTargetUser    AppealTargetType = "user"
)

// Appeal mirrors mkt_appeals / MktAppeal field-for-field.
type Appeal struct {
	ID                   string     `json:"id"`
	MarketID             string     `json:"-"` // internal scoping only; not in MktAppeal
	TargetType           string     `json:"target_type"`
	TargetID              string    `json:"target_id"`
	AppellantID          string     `json:"appellant_id"`
	OriginalAction       string     `json:"original_action"`
	OriginalReasonCode   string     `json:"original_reason_code"`
	AppellantNote        string     `json:"appellant_note"`
	Status               string     `json:"status"`
	Decision             *string    `json:"decision,omitempty"`
	DecisionNotes        *string    `json:"decision_notes,omitempty"`
	DecidedBy            *string    `json:"decided_by,omitempty"`
	DecidedAt            *time.Time `json:"decided_at,omitempty"`
	SecondApproverID     *string    `json:"second_approver_id,omitempty"`
	SecondApprovedAt     *time.Time `json:"-"` // internal; not part of MktAppeal's wire shape
	RequiresDualApproval bool       `json:"requires_dual_approval"`
	ExecutedAt           *time.Time `json:"executed_at,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"-"` // internal; not part of MktAppeal's wire shape
}

// CreateAppealInput is the member-facing POST /appeals body.
type CreateAppealInput struct {
	TargetType         string `json:"target_type"`
	TargetID           string `json:"target_id"`
	OriginalAction     string `json:"original_action"`
	OriginalReasonCode string `json:"original_reason_code"`
	AppellantNote      string `json:"appellant_note"`
}

// DecideAppealInput is the POST /admin/appeals/:id/decide body (propose/maker) —
// matches MktAppealDecideRequest. NOTE the request vocab is 'uphold'/'overturn'
// (verb) while the STORED/rendered Appeal.Decision is 'upheld'/'overturned'
// (past participle) — the service maps one to the other; see decisionPastTense.
type DecideAppealInput struct {
	Decision   string `json:"decision"` // uphold|overturn
	ReasonCode string `json:"reason_code"`
	Notes      string `json:"notes"`
}

func decisionPastTense(verb string) (string, bool) {
	switch verb {
	case "uphold":
		return "upheld", true
	case "overturn":
		return "overturned", true
	default:
		return "", false
	}
}

// FraudSignal is one derived, read-only risk signal (GET /admin/fraud/signals) —
// matches MktFraudSignal. Every field is traceable to a real row; see
// service_admin_fraud.go for the exact queries backing each Kind.
type FraudSignal struct {
	ID               string    `json:"id"`
	Kind             string    `json:"kind"`
	UserID           string    `json:"user_id"`
	UserDisplayName  string    `json:"user_display_name"`
	Severity         string    `json:"severity"` // low|medium|high
	Detail           string    `json:"detail"`
	RelatedUserIDs   []string  `json:"related_user_ids"`
	CreatedAt        time.Time `json:"created_at"`
}

package onboarding

import "time"

// ─── Catalogue ───────────────────────────────────────────────────────────────

// Module is a super-app vertical that can accept merchant onboarding.
type Module struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	IconColor   string `json:"iconColor"`
	BgColor     string `json:"bgColor"`
	Status      string `json:"status"` // open | closed | coming_soon
	TypeCount   int    `json:"typeCount"`
}

// MerchantType is a role a user can apply for within a module.
type MerchantType struct {
	ID                  string   `json:"id"`
	ModuleID            string   `json:"moduleId"`
	ModuleName          string   `json:"moduleName"`
	Slug                string   `json:"slug"`
	Name                string   `json:"name"`
	Description         string   `json:"description"`
	Icon                string   `json:"icon"`
	RequirementsSummary []string `json:"requirementsSummary"`
	ExpectedReviewLabel string   `json:"expectedReviewLabel"`
	RequiredKycTier     int      `json:"requiredKycTier"`
	RoleToGrant         string   `json:"roleToGrant"`
	CurrentFormSchemaID string   `json:"currentFormSchemaId"`
	Status              string   `json:"status"`
	RequiresBusiness    bool     `json:"requiresBusiness"`
}

// ─── Form schema engine ──────────────────────────────────────────────────────

// FieldOption is a select/multiselect choice.
type FieldOption struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// VisibleWhen makes a field conditional on another field's value.
type VisibleWhen struct {
	Field  string      `json:"field"`
	Equals interface{} `json:"equals"`
}

// Field is a single input in a form step.
type Field struct {
	Key           string        `json:"key"`
	Type          string        `json:"type"` // text|textarea|number|email|phone|select|multiselect|date|address|currency|document|boolean
	Label         string        `json:"label"`
	Placeholder   string        `json:"placeholder,omitempty"`
	HelpText      string        `json:"helpText,omitempty"`
	Required      bool          `json:"required"`
	Options       []FieldOption `json:"options,omitempty"`
	Min           *float64      `json:"min,omitempty"`
	Max           *float64      `json:"max,omitempty"`
	MaxSelections *int          `json:"maxSelections,omitempty"`
	HasExpiry     bool          `json:"hasExpiry,omitempty"`
	VisibleWhen   *VisibleWhen  `json:"visibleWhen,omitempty"`
}

// Step is a group of fields shown as one page of the form.
type Step struct {
	Key         string  `json:"key"`
	Title       string  `json:"title"`
	Description string  `json:"description,omitempty"`
	Fields      []Field `json:"fields"`
}

// FormSchema is a versioned, multi-step form definition.
type FormSchema struct {
	ID             string `json:"id"`
	MerchantTypeID string `json:"merchantTypeId"`
	Version        int    `json:"version"`
	Status         string `json:"status"` // draft | published | retired
	Steps          []Step `json:"steps"`
}

// ─── Applications ────────────────────────────────────────────────────────────

// Check is a server-side verification result attached to an application.
type Check struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Status string `json:"status"` // pending | passed | failed
	Detail string `json:"detail,omitempty"`
}

// Application is a user's onboarding application for one merchant type.
type Application struct {
	ID                string                 `json:"id"`
	UserID            string                 `json:"userId"`
	MerchantTypeID    string                 `json:"merchantTypeId"`
	MerchantTypeName  string                 `json:"merchantTypeName"`
	ModuleID          string                 `json:"moduleId"`
	ModuleName        string                 `json:"moduleName"`
	FormSchemaID      string                 `json:"formSchemaId"`
	FormSchemaVersion int                    `json:"formSchemaVersion"`
	Status            string                 `json:"status"`
	Data              map[string]interface{} `json:"data"`
	Checks            []Check                `json:"checks"`
	DecisionReason    string                 `json:"decisionReason,omitempty"`
	InfoChecklist     []string               `json:"infoChecklist"`
	CreatedAt         time.Time              `json:"createdAt"`
	UpdatedAt         time.Time              `json:"updatedAt"`
	SubmittedAt       *time.Time             `json:"submittedAt,omitempty"`
	DecidedAt         *time.Time             `json:"decidedAt,omitempty"`
}

// MerchantProfile is the activated merchant identity created on approval.
type MerchantProfile struct {
	ID               string     `json:"id"`
	UserID           string     `json:"userId"`
	ModuleID         string     `json:"moduleId"`
	ModuleName       string     `json:"moduleName"`
	MerchantTypeID   string     `json:"merchantTypeId"`
	MerchantTypeName string     `json:"merchantTypeName"`
	Icon             string     `json:"icon"`
	RoleGranted      string     `json:"roleGranted"`
	Status           string     `json:"status"`
	ActivatedAt      *time.Time `json:"activatedAt,omitempty"`
	WorkspaceRoute   string     `json:"workspaceRoute,omitempty"`
}

// Capabilities is the aggregate view of a user's customer + merchant identities.
type Capabilities struct {
	UserID             string            `json:"userId"`
	DisplayName        string            `json:"displayName"`
	KycTier            int               `json:"kycTier"`
	Customer           bool              `json:"customer"`
	Merchants          []MerchantProfile `json:"merchants"`
	ActiveApplications []Application     `json:"activeApplications"`
}

// ─── Request bodies ──────────────────────────────────────────────────────────

type CreateApplicationRequest struct {
	MerchantTypeID string                 `json:"merchantTypeId" binding:"required"`
	Data           map[string]interface{} `json:"data"`
}

type SaveDraftRequest struct {
	Data map[string]interface{} `json:"data"`
}

type RejectRequest struct {
	Reason string `json:"reason" binding:"required"`
}

type RequestInfoRequest struct {
	Checklist []string `json:"checklist" binding:"required"`
}

type EscalateRequest struct {
	Note string `json:"note"`
}

type CreateModuleRequest struct {
	ID          string `json:"id" binding:"required"`
	Slug        string `json:"slug" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	IconColor   string `json:"iconColor"`
	BgColor     string `json:"bgColor"`
	Status      string `json:"status"`
}

type CreateMerchantTypeRequest struct {
	ID                  string   `json:"id" binding:"required"`
	ModuleID            string   `json:"moduleId" binding:"required"`
	Slug                string   `json:"slug" binding:"required"`
	Name                string   `json:"name" binding:"required"`
	Description         string   `json:"description"`
	Icon                string   `json:"icon"`
	RequirementsSummary []string `json:"requirementsSummary"`
	ExpectedReviewLabel string   `json:"expectedReviewLabel"`
	RequiredKycTier     int      `json:"requiredKycTier"`
	RoleToGrant         string   `json:"roleToGrant" binding:"required"`
	Status              string   `json:"status"`
}

type CreateFormSchemaRequest struct {
	ID      string `json:"id"`
	Version int    `json:"version" binding:"required"`
	Status  string `json:"status"`
	Steps   []Step `json:"steps" binding:"required"`
}

package onboarding

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

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

// FieldOption is a select/multiselect choice.
type FieldOption struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// VisibleWhen makes a field conditional on another field's value.
type VisibleWhen struct {
	Field  string `json:"field"`
	Equals any    `json:"equals"`
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

// Check is a server-side verification result attached to an application.
type Check struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Status string `json:"status"` // pending | passed | failed
	Detail string `json:"detail,omitempty"`
}

// Application is a user's onboarding application for one merchant type.
type Application struct {
	ID                string         `json:"id"`
	UserID            string         `json:"userId"`
	MerchantTypeID    string         `json:"merchantTypeId"`
	MerchantTypeName  string         `json:"merchantTypeName"`
	ModuleID          string         `json:"moduleId"`
	ModuleName        string         `json:"moduleName"`
	FormSchemaID      string         `json:"formSchemaId"`
	FormSchemaVersion int            `json:"formSchemaVersion"`
	Status            string         `json:"status"`
	Data              map[string]any `json:"data"`
	Checks            []Check        `json:"checks"`
	DecisionReason    string         `json:"decisionReason,omitempty"`
	InfoChecklist     []string       `json:"infoChecklist"`
	CreatedAt         time.Time      `json:"createdAt"`
	UpdatedAt         time.Time      `json:"updatedAt"`
	SubmittedAt       *time.Time     `json:"submittedAt,omitempty"`
	DecidedAt         *time.Time     `json:"decidedAt,omitempty"`
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

type CreateApplicationRequest struct {
	MerchantTypeID string         `json:"merchantTypeId" binding:"required"`
	Data           map[string]any `json:"data"`
}

type SaveDraftRequest struct {
	Data map[string]any `json:"data"`
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

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
var phoneRe = regexp.MustCompile(`^\+?[0-9][0-9\s\-]{6,18}$`)

// ValidateSubmission checks the submitted data against the form schema's field rules,
// honouring conditional visibility. It returns a *ValidationError when any rule fails.
func ValidateSubmission(schema *FormSchema, data map[string]any) error {
	if schema == nil {
		return ErrValidation
	}
	fieldErrs := map[string]string{}
	for _, step := range schema.Steps {
		for _, f := range step.Fields {
			if !fieldVisible(f, data) {
				continue
			}
			raw, present := data[f.Key]
			if isEmpty(raw) {
				if f.Required {
					fieldErrs[f.Key] = "required"
				}
				continue
			}
			if msg := validateField(f, raw); msg != "" {
				fieldErrs[f.Key] = msg
			}
			_ = present
		}
	}
	if len(fieldErrs) > 0 {
		return &ValidationError{Fields: fieldErrs}
	}
	return nil
}

// fieldVisible evaluates a field's visibleWhen condition against the data.
func fieldVisible(f Field, data map[string]any) bool {
	if f.VisibleWhen == nil {
		return true
	}
	got, ok := data[f.VisibleWhen.Field]
	if !ok {
		return false
	}
	return looseEqual(got, f.VisibleWhen.Equals)
}

func looseEqual(a, b any) bool {
	return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
}

func isEmpty(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(t) == ""
	case []any:
		return len(t) == 0
	case map[string]any:
		return len(t) == 0
	}
	return false
}

func validateField(f Field, raw any) string {
	switch f.Type {
	case "text", "textarea":
		if _, ok := raw.(string); !ok {
			return "must be text"
		}
	case "email":
		s, ok := raw.(string)
		if !ok || !emailRe.MatchString(s) {
			return "invalid email"
		}
	case "phone":
		s, ok := raw.(string)
		if !ok || !phoneRe.MatchString(strings.TrimSpace(s)) {
			return "invalid phone"
		}
	case "number", "currency":
		n, ok := toNumber(raw)
		if !ok {
			return "must be a number"
		}
		if f.Min != nil && n < *f.Min {
			return fmt.Sprintf("must be >= %v", *f.Min)
		}
		if f.Max != nil && n > *f.Max {
			return fmt.Sprintf("must be <= %v", *f.Max)
		}
	case "boolean":
		if _, ok := raw.(bool); !ok {
			return "must be true or false"
		}
	case "date":
		if _, ok := raw.(string); !ok {
			return "invalid date"
		}
	case "select":
		s, ok := raw.(string)
		if !ok {
			return "invalid selection"
		}
		if len(f.Options) > 0 && !optionExists(f.Options, s) {
			return "not an allowed option"
		}
	case "multiselect":
		arr, ok := raw.([]any)
		if !ok {
			return "must be a list"
		}
		if f.MaxSelections != nil && len(arr) > *f.MaxSelections {
			return fmt.Sprintf("select at most %d", *f.MaxSelections)
		}
		for _, item := range arr {
			s, ok := item.(string)
			if !ok || (len(f.Options) > 0 && !optionExists(f.Options, s)) {
				return "contains a disallowed option"
			}
		}
	case "address":
		// Accept an object or a non-empty string.
		switch raw.(type) {
		case string, map[string]any:
		default:
			return "invalid address"
		}
	case "document":
		// Document fields carry a URL/reference string once uploaded.
		if _, ok := raw.(string); !ok {
			if _, ok2 := raw.(map[string]any); !ok2 {
				return "invalid document reference"
			}
		}
	}
	return ""
}

func optionExists(opts []FieldOption, val string) bool {
	for _, o := range opts {
		if o.Value == val {
			return true
		}
	}
	return false
}

func toNumber(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	}
	return 0, false
}

// buildChecks derives the server-side verification checklist surfaced to reviewers.
// Each required document/credential field becomes a pending check.
func buildChecks(schema *FormSchema, data map[string]any) []Check {
	checks := []Check{}
	for _, step := range schema.Steps {
		for _, f := range step.Fields {
			if f.Type == "document" && fieldVisible(f, data) {
				status := "pending"
				if isEmpty(data[f.Key]) {
					status = "failed"
				}
				checks = append(checks, Check{
					Key:    f.Key,
					Label:  f.Label,
					Status: status,
					Detail: "awaiting manual verification",
				})
			}
		}
	}
	return checks
}

package onboarding

import (
	"fmt"
	"regexp"
	"strings"
)

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
var phoneRe = regexp.MustCompile(`^\+?[0-9][0-9\s\-]{6,18}$`)

// ValidateSubmission checks the submitted data against the form schema's field rules,
// honouring conditional visibility. It returns a *ValidationError when any rule fails.
func ValidateSubmission(schema *FormSchema, data map[string]interface{}) error {
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
func fieldVisible(f Field, data map[string]interface{}) bool {
	if f.VisibleWhen == nil {
		return true
	}
	got, ok := data[f.VisibleWhen.Field]
	if !ok {
		return false
	}
	return looseEqual(got, f.VisibleWhen.Equals)
}

func looseEqual(a, b interface{}) bool {
	return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
}

func isEmpty(v interface{}) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(t) == ""
	case []interface{}:
		return len(t) == 0
	case map[string]interface{}:
		return len(t) == 0
	}
	return false
}

func validateField(f Field, raw interface{}) string {
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
		arr, ok := raw.([]interface{})
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
		case string, map[string]interface{}:
		default:
			return "invalid address"
		}
	case "document":
		// Document fields carry a URL/reference string once uploaded.
		if _, ok := raw.(string); !ok {
			if _, ok2 := raw.(map[string]interface{}); !ok2 {
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

func toNumber(v interface{}) (float64, bool) {
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
func buildChecks(schema *FormSchema, data map[string]interface{}) []Check {
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

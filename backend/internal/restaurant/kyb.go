package restaurant

import (
	"errors"
	"fmt"
	"strings"
)

// ErrKYBIncomplete is returned when a KYB submission is missing required fields or
// documents. The handler maps it to HTTP 422.
var ErrKYBIncomplete = errors.New("restaurant: KYB submission is incomplete")

// KYBStatus is the merchant Know-Your-Business verification state.
type KYBStatus string

const (
	KYBDraft       KYBStatus = "draft"           // owner is still filling it in
	KYBSubmitted   KYBStatus = "submitted"       // owner submitted; awaiting review
	KYBUnderReview KYBStatus = "under_review"    // a reviewer picked it up
	KYBNeedsInfo   KYBStatus = "needs_more_info" // reviewer bounced it back for more info
	KYBApproved    KYBStatus = "approved"        // verified — restaurant may go live
	KYBRejected    KYBStatus = "rejected"        // declined (with a reason)
)

// Allowed business types (mirrors the DB CHECK).
var kybBusinessTypes = map[string]bool{
	"sole_proprietor": true,
	"limited_company": true,
	"partnership":     true,
	"ngo":             true,
}

// KYB is a restaurant's business-verification record. Bank fields are the merchant's
// OWN settlement (payout) account — business data they provide, not a credential.
type KYB struct {
	RestaurantID   string    `json:"restaurant_id"`
	LegalName      string    `json:"legal_name"`
	BusinessType   string    `json:"business_type"`
	RCNumber       string    `json:"rc_number,omitempty"` // CAC RC/BN number
	TIN            string    `json:"tin,omitempty"`
	ContactEmail   string    `json:"contact_email"`
	ContactPhone   string    `json:"contact_phone"`
	BankCode       string    `json:"bank_code"`
	AccountNumber  string    `json:"account_number"` // 10-digit NUBAN
	AccountName    string    `json:"account_name"`
	Status         KYBStatus `json:"status"`
	DecisionReason *string   `json:"decision_reason,omitempty"`
}

// kybCanTransition guards the KYB lifecycle. Owner-driven: draft/needs_more_info/
// rejected → submitted (submit or re-submit). Reviewer-driven: submitted →
// under_review, and submitted/under_review/needs_more_info → approved | rejected |
// needs_more_info. approved is terminal. Same-state and anything else is rejected.
func kybCanTransition(from, to KYBStatus) bool {
	if from == to {
		return false
	}
	switch from {
	case KYBDraft:
		return to == KYBSubmitted
	case KYBSubmitted:
		return to == KYBUnderReview || to == KYBApproved || to == KYBRejected || to == KYBNeedsInfo
	case KYBUnderReview:
		return to == KYBApproved || to == KYBRejected || to == KYBNeedsInfo
	case KYBNeedsInfo:
		return to == KYBSubmitted || to == KYBApproved || to == KYBRejected
	case KYBRejected:
		return to == KYBSubmitted // allow re-application
	default: // KYBApproved (terminal) or unknown
		return false
	}
}

// looksLikeEmail is a deliberately-minimal sanity check (exactly one '@', a '.' after
// it, no spaces) — full RFC validation is not the job of a submit gate.
func looksLikeEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	if at <= 0 || strings.ContainsAny(s, " \t") {
		return false
	}
	dot := strings.LastIndexByte(s, '.')
	return dot > at+1 && dot < len(s)-1
}

// isNUBAN reports whether s is a 10-digit Nigerian bank account number.
func isNUBAN(s string) bool {
	if len(s) != 10 {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// validateKYBForSubmit returns the list of problems that block submission (empty ⇒ OK).
// It is PURE (no DB): the required business fields, the business-type/RC rule (a
// registered entity needs its CAC RC number AND certificate), the settlement account
// format, and a basic contact-email check. `docTypes` is the set of document types the
// applicant has uploaded, so the "certificate required" rule is testable without a DB.
func validateKYBForSubmit(k KYB, docTypes map[string]bool) []string {
	var problems []string
	req := func(field, val string) {
		if strings.TrimSpace(val) == "" {
			problems = append(problems, "missing "+field)
		}
	}
	req("legal_name", k.LegalName)
	req("contact_phone", k.ContactPhone)
	req("bank_code", k.BankCode)
	req("account_name", k.AccountName)

	if !kybBusinessTypes[k.BusinessType] {
		problems = append(problems, "invalid business_type")
	}
	if strings.TrimSpace(k.ContactEmail) == "" || !looksLikeEmail(k.ContactEmail) {
		problems = append(problems, "invalid contact_email")
	}
	if !isNUBAN(k.AccountNumber) {
		problems = append(problems, "account_number must be a 10-digit NUBAN")
	}
	// A registered entity (anything other than a sole proprietor) must supply its CAC
	// RC/BN number and upload the certificate; a sole proprietor is exempt.
	if k.BusinessType != "sole_proprietor" && kybBusinessTypes[k.BusinessType] {
		if strings.TrimSpace(k.RCNumber) == "" {
			problems = append(problems, "rc_number is required for a registered business")
		}
		if !docTypes["cac_certificate"] {
			problems = append(problems, "cac_certificate document is required for a registered business")
		}
	}
	return problems
}

// kybIncompleteErr wraps the submit-validation problems into one ErrKYBIncomplete.
func kybIncompleteErr(problems []string) error {
	return fmt.Errorf("%w: %s", ErrKYBIncomplete, strings.Join(problems, "; "))
}

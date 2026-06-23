package connectonboarding

// AgeGateRequest is the body for POST /api/v1/connect/onboarding/age-gate.
// DOB is an ISO date string (YYYY-MM-DD).
type AgeGateRequest struct {
	DOB string `json:"dob" binding:"required"`
}

// AgeGateResult is the gate decision returned to the client.
type AgeGateResult struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason,omitempty"` // invalid_dob | under_18
	Age     int    `json:"age,omitempty"`
}

// RequiredConsents maps each required consent kind to its current version.
// Onboarding completes only when all are accepted at these versions.
var RequiredConsents = map[string]string{
	"terms":                "v1",
	"privacy":              "v1",
	"community_guidelines": "v1",
}

// ValidConsentKind reports whether k is a recognised consent kind.
func ValidConsentKind(k string) bool {
	_, ok := RequiredConsents[k]
	return ok
}

// ConsentRequest is the body for POST /api/v1/connect/onboarding/consent.
type ConsentRequest struct {
	Kind    string `json:"kind" binding:"required"`
	Version string `json:"version"`
}

// OnboardingStatus is the combined gate state for a user.
type OnboardingStatus struct {
	AgeVerified      bool     `json:"age_verified"`
	PhoneVerified    bool     `json:"phone_verified"`
	ConsentsAccepted bool     `json:"consents_accepted"`
	Status           string   `json:"status"` // pending | complete
	MissingConsents  []string `json:"missing_consents"`
}

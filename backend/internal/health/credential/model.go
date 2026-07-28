package credential

import "time"

// Status is the VerificationRecord lifecycle. It is distinct from the
// ProviderApplication state machine (which it drives): a record tracks the
// verification verdict, the application tracks discoverability/capability.
//
//	PENDING → VERIFIED | REJECTED
//	PENDING ↔ NEEDS_INFO   (reviewer asks for more; vet resubmits → PENDING)
//
// VERIFIED / REJECTED are terminal for the record. Any transition not in
// allowedStatus is rejected (guarded SM) — no raw status writes.
type Status string

const (
	StatusPending   Status = "PENDING"
	StatusVerified  Status = "VERIFIED"
	StatusNeedsInfo Status = "NEEDS_INFO"
	StatusRejected  Status = "REJECTED"
)

var allowedStatus = map[Status]map[Status]bool{
	StatusPending:   {StatusVerified: true, StatusNeedsInfo: true, StatusRejected: true},
	StatusNeedsInfo: {StatusPending: true, StatusRejected: true},
	StatusVerified:  {},
	StatusRejected:  {},
}

// canTransitionStatus guards the record SM (pure; unit-tested).
func canTransitionStatus(from, to Status) bool {
	if from == to {
		return false
	}
	nx, ok := allowedStatus[from]
	return ok && nx[to]
}

// VerificationRecord is the source-agnostic verification of a provider against a
// register (VCN today). NDPA: stores only the result + reference + signed-URL doc
// ids — never a copy of any external register.
type VerificationRecord struct {
	ID                    string            `json:"id"`
	ProviderApplicationID string            `json:"provider_application_id"`
	Capability            string            `json:"capability"` // vet
	Source                Source            `json:"source"`     // VCN
	Method                Method            `json:"method"`     // ASSISTED
	Status                Status            `json:"status"`
	RegNumber             string            `json:"reg_number"`
	MatchedFields         map[string]string `json:"matched_fields"` // field → match|mismatch|unverifiable
	LicenceExpiry         *time.Time        `json:"licence_expiry,omitempty"`
	ReviewerID            *string           `json:"reviewer_id,omitempty"`
	Notes                 string            `json:"notes,omitempty"`
	EvidenceDocIDs        []string          `json:"evidence_doc_ids"`
	ConsentAt             *time.Time        `json:"consent_at,omitempty"` // NDPA consent to verify
	CreatedAt             time.Time         `json:"created_at"`
	DecidedAt             *time.Time        `json:"decided_at,omitempty"`
}

// PublicStatus is the SANITISED, vet-facing view. It NEVER exposes VCN/register
// data, matched-field detail, reviewer identity, or notes — only the coarse
// state the vet is allowed to see (HL-8 minimisation, NDPA).
type PublicStatus struct {
	ApplicationID string `json:"application_id"`
	Capability    string `json:"capability"`
	// Stage ∈ pending_review | more_info_needed | verified | not_verified.
	Stage string `json:"stage"`
}

// publicStage maps the internal record status to the coarse vet-facing stage.
func publicStage(s Status) string {
	switch s {
	case StatusPending:
		return "pending_review"
	case StatusNeedsInfo:
		return "more_info_needed"
	case StatusVerified:
		return "verified"
	case StatusRejected:
		return "not_verified"
	default:
		return "pending_review"
	}
}

// Identity-match field keys + verdicts.
const (
	matchOK           = "match"
	matchMismatch     = "mismatch"
	matchUnverifiable = "unverifiable"
)

// Exported verdict constants so other capability modules (e.g. the doctor module
// reusing the assisted MDCN flow) share one vocabulary.
const (
	MatchOK           = matchOK
	MatchMismatch     = matchMismatch
	MatchUnverifiable = matchUnverifiable
)

// CrossCheckIdentity is the exported, reusable name/DOB↔KYC cross-check used by
// every assisted-verification capability (vet/VCN, doctor/MDCN, …). It does not
// block: a mismatch is surfaced as a reviewer flag (the human reviewer confirms
// out-of-band). See computeMatchedFields for semantics.
func CrossCheckIdentity(enteredName, enteredDOB string, snap IdentitySnapshot) map[string]string {
	return computeMatchedFields(enteredName, enteredDOB, snap)
}

// HasIdentityFlag reports whether any field is a hard mismatch (reviewer should
// scrutinise). Exported sibling of hasIdentityFlag.
func HasIdentityFlag(m map[string]string) bool { return hasIdentityFlag(m) }

// computeMatchedFields cross-checks the entered name/DOB against the Paymax KYC
// identity snapshot, producing reviewer-facing flags. It does NOT block: a
// mismatch is surfaced for the human reviewer (HL-1 marketplace; the reviewer
// confirms out-of-band). Name is normalised (case/space-insensitive, order-
// independent). DOB is compared when both are known; otherwise unverifiable.
func computeMatchedFields(enteredName, enteredDOB string, snap IdentitySnapshot) map[string]string {
	m := map[string]string{}

	if snap.FullName == "" {
		m["name"] = matchUnverifiable
	} else if normalizeName(enteredName) == normalizeName(snap.FullName) {
		m["name"] = matchOK
	} else {
		m["name"] = matchMismatch
	}

	switch {
	case enteredDOB == "" || snap.DOB == nil || *snap.DOB == "":
		m["dob"] = matchUnverifiable
	case enteredDOB == *snap.DOB:
		m["dob"] = matchOK
	default:
		m["dob"] = matchMismatch
	}

	// KYC tier surfaced so the reviewer sees identity assurance (NIN/BVN present).
	if snap.KYCTier >= 1 {
		m["kyc"] = matchOK
	} else {
		m["kyc"] = matchUnverifiable
	}
	return m
}

// hasIdentityFlag reports whether any field is a hard mismatch (reviewer should
// scrutinise). Unverifiable is informational, not a hard flag.
func hasIdentityFlag(m map[string]string) bool {
	for _, v := range m {
		if v == matchMismatch {
			return true
		}
	}
	return false
}

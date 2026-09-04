package extranet

import "time"

// VerificationItemStatus mirrors the frontend's VerificationItemStatus vocabulary
// exactly (frontend-admin/src/types/staysExtranet.ts) — reused for individual
// checklist items, the two KYB sub-statuses, and the overall verdict alike, so the
// Go layer needs no translation mapping to a different enum.
type VerificationItemStatus string

const (
	VerifPending      VerificationItemStatus = "pending"
	VerifInProgress   VerificationItemStatus = "in_progress"
	VerifSubmitted    VerificationItemStatus = "submitted"
	VerifApproved     VerificationItemStatus = "approved"
	VerifRejected     VerificationItemStatus = "rejected"
	VerifNeedsChanges VerificationItemStatus = "needs_changes"
)

// VerificationChecklistItem is one row of the go-live checklist.
type VerificationChecklistItem struct {
	Key      string                 `json:"key"`
	Label    string                 `json:"label"`
	Stage    string                 `json:"stage"`
	Status   VerificationItemStatus `json:"status"`
	Detail   string                 `json:"detail,omitempty"`
	Required bool                   `json:"required"`
}

// VerificationStatus is the go-live checklist + overall review verdict for a property.
type VerificationStatus struct {
	PropertyID           string                      `json:"property_id"`
	PropertyName         string                      `json:"property_name"`
	Overall              VerificationItemStatus      `json:"overall"`
	GoLiveEligible       bool                        `json:"go_live_eligible"`
	SubmittedForReviewAt *time.Time                  `json:"submitted_for_review_at,omitempty"`
	ReviewedAt           *time.Time                  `json:"reviewed_at,omitempty"`
	ReviewerNote         *string                     `json:"reviewer_note,omitempty"`
	Checklist            []VerificationChecklistItem `json:"checklist"`
}

// BusinessVerification is the hotelier's business/KYC record. DirectorBVNLast4 is
// the ONLY fragment of the director's BVN ever returned to the client — the full
// BVN never leaves the database.
type BusinessVerification struct {
	LegalName         string                 `json:"legal_name"`
	RCNumber          string                 `json:"rc_number"`
	TIN               string                 `json:"tin"`
	KYCStatus         VerificationItemStatus `json:"kyc_status"`
	BusinessDocStatus VerificationItemStatus `json:"business_doc_status"`
	DirectorName      string                 `json:"director_name"`
	DirectorBVNLast4  string                 `json:"director_bvn_last4"`
}

// kyb is the internal (full-fidelity) record read from stays_hotelier_kyb — it
// carries the full director BVN, which BusinessVerification must never expose.
type kyb struct {
	PropertyID           string
	LegalName            string
	BusinessType         string
	RCNumber             string
	TIN                  string
	DirectorName         string
	DirectorBVN          string
	ContactEmail         string
	ContactPhone         string
	KYCStatus            VerificationItemStatus
	BusinessDocStatus    VerificationItemStatus
	Status               VerificationItemStatus
	SubmittedForReviewAt *time.Time
	ReviewedAt           *time.Time
	ReviewedBy           *string
	ReviewerNote         *string
}

func bvnLast4(bvn string) string {
	if len(bvn) < 4 {
		return ""
	}
	return bvn[len(bvn)-4:]
}

// kybDecisionStatus maps an admin decision string to the resulting verdict.
func kybDecisionStatus(decision string) (VerificationItemStatus, bool) {
	switch decision {
	case "approve":
		return VerifApproved, true
	case "reject":
		return VerifRejected, true
	case "needs_changes":
		return VerifNeedsChanges, true
	default:
		return "", false
	}
}

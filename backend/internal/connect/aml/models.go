// Package connectaml implements Paymax Connect AML/CFT monitoring and the NFIU
// case scaffold. It scores money events (gifts, paid votes, payouts) against
// velocity / structuring / threshold rules, raises append-only alerts, and lets
// compliance open append-only STR/SAR cases for filing with the NFIU. It also
// exposes a sanctions/PEP screening stub interface.
//
// Compliance rules honoured (PRD §7 — CBN tiers + AML + NFIU STR/SAR):
//   - NEVER log raw PII: alerts/cases store user ids + REASON CODES + amounts,
//     never names, BVN/NIN, document contents, or message bodies;
//   - alerts and cases are APPEND-ONLY (immutable history); status changes are
//     new rows or guarded forward-only transitions, corrections are new entries;
//   - thresholds are kobo (BIGINT) and are backend-owned (not client input).
package connectaml

import "time"

// ReasonCode is a stable machine code describing why an event was flagged.
// Codes (never free-text PII) are the only human-meaningful payload stored.
type ReasonCode string

const (
	ReasonThresholdExceeded ReasonCode = "THRESHOLD_EXCEEDED" // single event >= reporting threshold
	ReasonVelocity          ReasonCode = "VELOCITY_BURST"     // too many events in a short window
	ReasonStructuring       ReasonCode = "STRUCTURING"        // many sub-threshold events aggregating high
	ReasonSanctionsHit      ReasonCode = "SANCTIONS_HIT"      // screening matched a sanctions/PEP list
)

// EventKind is the money-event source that triggered monitoring.
type EventKind string

const (
	EventGift     EventKind = "gift"
	EventPaidVote EventKind = "paid_vote"
	EventPayout   EventKind = "payout"
)

// Alert mirrors a row of public.connect_aml_alerts (append-only).
type Alert struct {
	ID          string     `json:"id"`
	SubjectID   string     `json:"subject_id"`
	EventKind   EventKind  `json:"event_kind"`
	ReasonCode  ReasonCode `json:"reason_code"`
	AmountKobo  int64      `json:"amount_kobo"`
	WindowCount int        `json:"window_count"`
	LedgerRef   *string    `json:"ledger_ref,omitempty"`
	CaseID      *string    `json:"case_id,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// Case mirrors a row of public.connect_aml_cases (append-only NFIU STR/SAR
// scaffold). report_type is 'str' (suspicious transaction) or 'sar' (suspicious
// activity). filed_at is set once the report is filed (forward-only).
type Case struct {
	ID          string     `json:"id"`
	SubjectID   string     `json:"subject_id"`
	ReportType  string     `json:"report_type"`
	Status      string     `json:"status"`
	ReasonCodes []string   `json:"reason_codes"`
	Narrative   *string    `json:"narrative,omitempty"` // compliance summary (NO raw counterpart PII)
	OpenedBy    *string    `json:"opened_by,omitempty"`
	FiledBy     *string    `json:"filed_by,omitempty"`
	FiledRef    *string    `json:"filed_ref,omitempty"` // NFIU acknowledgement reference
	FiledAt     *time.Time `json:"filed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// FileSTRRequest is the admin body for POST /aml/cases/:id/file-str.
type FileSTRRequest struct {
	FiledRef  string `json:"filedRef"`  // NFIU acknowledgement reference
	Narrative string `json:"narrative"` // compliance narrative (reason codes only, no raw PII)
}

// ScreenResult is the outcome of a sanctions/PEP screen.
type ScreenResult struct {
	Hit       bool   `json:"hit"`
	ListName  string `json:"list_name,omitempty"`
	MatchCode string `json:"match_code,omitempty"` // stable code, never a raw name
}

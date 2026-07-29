// Package controlled is a pure, deterministic controlled-substance aggregation
// engine (test plan EC-004 / RX-007): it detects over-prescription and
// doctor-shopping of a controlled drug ACROSS PROVIDERS within a rolling window,
// so a patient cannot accumulate excess quantity or collect the same controlled
// drug from multiple prescribers.
//
// No I/O. Controlled substances are excluded at MVP in rx.Issue (HL-4); this is the
// guard that activates when controlled prescribing is enabled — the caller supplies
// the patient's prior controlled-Rx history (across all providers) and the
// candidate prescription. `DefaultPolicy` is an illustrative golden ruleset, not a
// regulatory schedule — real jurisdiction limits replace it.
package controlled

import (
	"fmt"
	"strings"
	"time"
)

// Schedule is the controlled-substance schedule (higher risk = lower numeral).
// Schedule I has no accepted medical use and is never prescribable (not modeled).
type Schedule string

const (
	ScheduleII  Schedule = "II"
	ScheduleIII Schedule = "III"
	ScheduleIV  Schedule = "IV"
	ScheduleV   Schedule = "V"
)

// Rx is one controlled-substance prescription (historic or the candidate).
type Rx struct {
	DrugName     string
	Schedule     Schedule
	Quantity     int
	PrescriberID string
	IssuedAt     time.Time
}

// Policy is the aggregation policy: a rolling window with per-schedule quantity
// caps, a distinct-prescriber cap (doctor-shopping), and a fill-count cap.
type Policy struct {
	Window         time.Duration
	MaxQuantity    map[Schedule]int // max aggregate units of the SAME drug within the window
	MaxPrescribers int              // max DISTINCT prescribers for the same drug in the window
	MaxCount       int              // max fills of the same drug in the window
}

// DefaultPolicy returns an illustrative 30-day policy.
func DefaultPolicy() Policy {
	return Policy{
		Window:         30 * 24 * time.Hour,
		MaxQuantity:    map[Schedule]int{ScheduleII: 60, ScheduleIII: 90, ScheduleIV: 120, ScheduleV: 180},
		MaxPrescribers: 1, // a 2nd distinct prescriber for the same controlled drug is doctor-shopping
		MaxCount:       3,
	}
}

// FindingKind classifies an aggregation finding.
type FindingKind string

const (
	KindOverQuantity    FindingKind = "over_quantity"
	KindMultiPrescriber FindingKind = "multiple_prescribers"
	KindOverCount       FindingKind = "over_count"
)

// Finding is one aggregation result.
type Finding struct {
	Kind    FindingKind `json:"kind"`
	Drug    string      `json:"drug"`
	Message string      `json:"message"`
	Block   bool        `json:"block"`
}

// Result aggregates findings for a candidate prescription.
type Result struct {
	Findings []Finding `json:"findings"`
	Blocked  bool      `json:"blocked"`
}

// Aggregate evaluates whether issuing `candidate` would breach the policy given the
// patient's prior controlled-substance `history` (across all providers), within the
// rolling window ending at `now`. Only same-drug history counts; the candidate is
// always included in the totals.
func Aggregate(history []Rx, candidate Rx, now time.Time, policy Policy) Result {
	drug := normDrug(candidate.DrugName)
	cutoff := now.Add(-policy.Window)

	totalQty := candidate.Quantity
	count := 1
	prescribers := map[string]bool{strings.TrimSpace(candidate.PrescriberID): true}
	for _, h := range history {
		if normDrug(h.DrugName) != drug || !h.IssuedAt.After(cutoff) {
			continue
		}
		totalQty += h.Quantity
		count++
		prescribers[strings.TrimSpace(h.PrescriberID)] = true
	}

	var res Result
	add := func(f Finding) {
		if f.Block {
			res.Blocked = true
		}
		res.Findings = append(res.Findings, f)
	}

	if cap := policy.MaxQuantity[candidate.Schedule]; cap > 0 && totalQty > cap {
		add(Finding{Kind: KindOverQuantity, Drug: candidate.DrugName, Block: true,
			Message: fmt.Sprintf("Aggregate %d units of %s (Schedule %s) in the window exceeds the %d-unit cap.",
				totalQty, candidate.DrugName, candidate.Schedule, cap)})
	}
	if policy.MaxPrescribers > 0 && len(prescribers) > policy.MaxPrescribers {
		add(Finding{Kind: KindMultiPrescriber, Drug: candidate.DrugName, Block: true,
			Message: fmt.Sprintf("%s prescribed by %d different providers within the window (possible doctor-shopping).",
				candidate.DrugName, len(prescribers))})
	}
	if policy.MaxCount > 0 && count > policy.MaxCount {
		add(Finding{Kind: KindOverCount, Drug: candidate.DrugName, Block: true,
			Message: fmt.Sprintf("%d fills of %s within the window exceeds the %d-fill cap.",
				count, candidate.DrugName, policy.MaxCount)})
	}
	return res
}

func normDrug(name string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(name))), " ")
}

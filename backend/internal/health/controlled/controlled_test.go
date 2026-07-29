package controlled

import (
	"testing"
	"time"
)

// TS-18 EC-004 (+ RX-007): controlled-substance over-prescription / doctor-shopping
// aggregated ACROSS PROVIDERS within a rolling window. Pure, deterministic — no DB.
// (Controlled substances are excluded at MVP in rx.Issue; this is the detection
// engine that activates when they are enabled.)

func ct(daysAgo int) time.Time { return baseNow().Add(-time.Duration(daysAgo) * 24 * time.Hour) }
func baseNow() time.Time       { return time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC) }

func has(r Result, k FindingKind) bool {
	for _, f := range r.Findings {
		if f.Kind == k {
			return true
		}
	}
	return false
}

func TestWithinLimitsNotBlocked(t *testing.T) {
	hist := []Rx{{DrugName: "Oxycodone", Schedule: ScheduleII, Quantity: 30, PrescriberID: "drA", IssuedAt: ct(5)}}
	cand := Rx{DrugName: "Oxycodone", Schedule: ScheduleII, Quantity: 20, PrescriberID: "drA", IssuedAt: baseNow()}
	if r := Aggregate(hist, cand, baseNow(), DefaultPolicy()); r.Blocked {
		t.Fatalf("within limits should not block: %+v", r)
	}
}

// EC-004 over-quantity: aggregate same-drug quantity across the window exceeds the
// schedule cap.
func TestOverQuantityBlocks(t *testing.T) {
	hist := []Rx{{DrugName: "Oxycodone", Schedule: ScheduleII, Quantity: 50, PrescriberID: "drA", IssuedAt: ct(3)}}
	cand := Rx{DrugName: "Oxycodone", Schedule: ScheduleII, Quantity: 30, PrescriberID: "drA", IssuedAt: baseNow()}
	r := Aggregate(hist, cand, baseNow(), DefaultPolicy()) // 80 > 60 (Sched II cap)
	if !r.Blocked || !has(r, KindOverQuantity) {
		t.Fatalf("aggregate 80 units must exceed the Schedule II cap: %+v", r)
	}
}

// EC-004 doctor-shopping: the SAME controlled drug prescribed by a DIFFERENT
// provider within the window is flagged (across-provider detection).
func TestDoctorShoppingAcrossProvidersBlocks(t *testing.T) {
	hist := []Rx{{DrugName: "Oxycodone", Schedule: ScheduleII, Quantity: 20, PrescriberID: "drA", IssuedAt: ct(2)}}
	cand := Rx{DrugName: "Oxycodone", Schedule: ScheduleII, Quantity: 20, PrescriberID: "drB", IssuedAt: baseNow()}
	r := Aggregate(hist, cand, baseNow(), DefaultPolicy())
	if !r.Blocked || !has(r, KindMultiPrescriber) {
		t.Fatalf("a second provider for the same controlled drug must be flagged: %+v", r)
	}
}

// Prescriptions OUTSIDE the window do not aggregate.
func TestOutsideWindowIgnored(t *testing.T) {
	hist := []Rx{{DrugName: "Oxycodone", Schedule: ScheduleII, Quantity: 50, PrescriberID: "drB", IssuedAt: ct(45)}}
	cand := Rx{DrugName: "Oxycodone", Schedule: ScheduleII, Quantity: 30, PrescriberID: "drA", IssuedAt: baseNow()}
	if r := Aggregate(hist, cand, baseNow(), DefaultPolicy()); r.Blocked {
		t.Fatalf("a 45-day-old Rx is outside the 30-day window and must not aggregate: %+v", r)
	}
}

// A different controlled drug is aggregated independently (no cross-drug summing).
func TestDifferentDrugIndependent(t *testing.T) {
	hist := []Rx{{DrugName: "Oxycodone", Schedule: ScheduleII, Quantity: 55, PrescriberID: "drA", IssuedAt: ct(2)}}
	cand := Rx{DrugName: "Diazepam", Schedule: ScheduleIV, Quantity: 30, PrescriberID: "drA", IssuedAt: baseNow()}
	if r := Aggregate(hist, cand, baseNow(), DefaultPolicy()); r.Blocked {
		t.Fatalf("a different drug should not aggregate with oxycodone: %+v", r)
	}
}

// Too many fills of the same drug in the window trips the count cap.
func TestOverCountBlocks(t *testing.T) {
	hist := []Rx{
		{DrugName: "Alprazolam", Schedule: ScheduleIV, Quantity: 10, PrescriberID: "drA", IssuedAt: ct(20)},
		{DrugName: "Alprazolam", Schedule: ScheduleIV, Quantity: 10, PrescriberID: "drA", IssuedAt: ct(12)},
		{DrugName: "Alprazolam", Schedule: ScheduleIV, Quantity: 10, PrescriberID: "drA", IssuedAt: ct(4)},
	}
	cand := Rx{DrugName: "Alprazolam", Schedule: ScheduleIV, Quantity: 10, PrescriberID: "drA", IssuedAt: baseNow()}
	r := Aggregate(hist, cand, baseNow(), DefaultPolicy()) // 4th fill in 30d
	if !r.Blocked || !has(r, KindOverCount) {
		t.Fatalf("a 4th same-drug fill in the window must trip the count cap: %+v", r)
	}
}

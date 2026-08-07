package healthrx

import (
	"context"
	"strings"
	"testing"
)

// RX-007 / EC-004 (current control): controlled substances are excluded at MVP —
// Issue hard-rejects any controlled item BEFORE any write (HL-4). This is the
// fail-safe until controlled prescribing (with the aggregation guard in
// internal/health/controlled) is enabled. Executed against a nil-DB service — the
// rejection happens in validation, before the DB is touched.
func TestControlledSubstanceExcludedAtIssue(t *testing.T) {
	svc := NewService(nil, nil)
	_, err := svc.Issue(context.Background(), "prescriber", "patient", nil,
		[]Item{{DrugName: "Morphine", IsControlled: true, Quantity: 1}})
	if err == nil || !strings.Contains(err.Error(), "controlled") {
		t.Fatalf("a controlled item must be rejected at issue (HL-4), got %v", err)
	}
}

// A mix that includes a controlled item is rejected wholesale (no partial issue).
func TestControlledMixedItemsRejected(t *testing.T) {
	svc := NewService(nil, nil)
	_, err := svc.Issue(context.Background(), "prescriber", "patient", nil, []Item{
		{DrugName: "Amoxicillin", Quantity: 21},
		{DrugName: "Diazepam", IsControlled: true, Quantity: 10},
	})
	if err == nil || !strings.Contains(err.Error(), "controlled") {
		t.Fatalf("a prescription containing a controlled item must be rejected, got %v", err)
	}
}

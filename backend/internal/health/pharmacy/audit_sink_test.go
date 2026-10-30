package healthpharmacy

import "testing"

type recordingAuditor struct {
	actor, target, action, module, resourceType, resourceID string
	oldV, newV                                              map[string]any
	calls                                                   int
}

func (r *recordingAuditor) LogAction(actor, target, action, module, resourceType, resourceID string, oldV, newV map[string]any, _, _, _ string) {
	r.calls++
	r.actor, r.target, r.action, r.module, r.resourceType, r.resourceID = actor, target, action, module, resourceType, resourceID
	r.oldV, r.newV = oldV, newV
}

// Order transitions must reach the injected sink with the from/to states —
// previously the sink was hard-wired nil so nothing was ever recorded.
func TestAudited_ForwardsTransitionToSink(t *testing.T) {
	rec := &recordingAuditor{}
	s := &Service{audit: rec}
	s.audited("pharmacist-1", "patient-1", "health.pharmacy.order.confirm", "order-1",
		map[string]any{"state": "CREATED"}, map[string]any{"state": "CONFIRMED"})
	if rec.calls != 1 {
		t.Fatalf("want 1 audit call, got %d", rec.calls)
	}
	if rec.module != "health" || rec.resourceType != "pharmacy_order" || rec.resourceID != "order-1" {
		t.Fatalf("wrong audit envelope: %+v", rec)
	}
	if rec.oldV["state"] != "CREATED" || rec.newV["state"] != "CONFIRMED" {
		t.Fatalf("transition states not recorded: old=%v new=%v", rec.oldV, rec.newV)
	}
}

func TestAudited_NilSinkIsNoOp(t *testing.T) {
	(&Service{}).audited("a", "b", "c", "d", nil, nil)
}

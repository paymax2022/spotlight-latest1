package parent

import "testing"

// TestCanActOnMinor_FailsClosed pins the child-safety gate: a guardian may act on a
// minor ONLY when they hold an ACTIVE link. The gate is fail-closed — the single
// input that grants access is linkActive=true; everything else (no link, pending,
// revoked → linkActive=false) is denied.
func TestCanActOnMinor_FailsClosed(t *testing.T) {
	if !canActOnMinor(true) {
		t.Errorf("canActOnMinor(true) = false; want true (active link grants access)")
	}
	if canActOnMinor(false) {
		t.Errorf("canActOnMinor(false) = true; want false (no active link must fail closed)")
	}
}

// TestValidApprovalDecision covers the approve/reject decision normalisation.
func TestValidApprovalDecision(t *testing.T) {
	if to, ok := validApprovalDecision("approve"); !ok || to != ApprovalApproved {
		t.Errorf(`validApprovalDecision("approve") = (%q,%v); want (approved,true)`, to, ok)
	}
	if to, ok := validApprovalDecision("reject"); !ok || to != ApprovalRejected {
		t.Errorf(`validApprovalDecision("reject") = (%q,%v); want (rejected,true)`, to, ok)
	}
	for _, bad := range []string{"", "yes", "approved", "APPROVE", "cancel"} {
		if _, ok := validApprovalDecision(bad); ok {
			t.Errorf("validApprovalDecision(%q) ok=true; want false", bad)
		}
	}
}

// TestValidChannel covers the notification-channel guard.
func TestValidChannel(t *testing.T) {
	for _, ok := range []string{"push", "sms", "in_app", "email"} {
		if !validChannel(ok) {
			t.Errorf("validChannel(%q) = false; want true", ok)
		}
	}
	for _, bad := range []string{"", "whatsapp", "Push", "voice"} {
		if validChannel(bad) {
			t.Errorf("validChannel(%q) = true; want false", bad)
		}
	}
}

// TestAggregateMasteryBySubject checks the pure dashboard/report aggregation: rows
// fold per subject, "mastered" counts mastered+exam_ready, avg_score is the mean,
// mastery_ratio is mastered/objectives, and subject order is first-seen.
func TestAggregateMasteryBySubject(t *testing.T) {
	rows := []MasteryRow{
		{ObjectiveID: "o1", SubjectID: "math", SubjectCode: "MATH", SubjectName: "Mathematics", State: "mastered", Score: 0.9},
		{ObjectiveID: "o2", SubjectID: "math", SubjectCode: "MATH", SubjectName: "Mathematics", State: "in_progress", Score: 0.5},
		{ObjectiveID: "o3", SubjectID: "eng", SubjectCode: "ENG", SubjectName: "English", State: "exam_ready", Score: 1.0},
	}
	got := aggregateMasteryBySubject(rows)
	if len(got) != 2 {
		t.Fatalf("expected 2 subjects, got %d", len(got))
	}
	// Order is first-seen: math then eng.
	math := got[0]
	if math.SubjectID != "math" || math.Objectives != 2 || math.Mastered != 1 {
		t.Errorf("math summary wrong: %+v", math)
	}
	if math.AvgScore < 0.69 || math.AvgScore > 0.71 { // (0.9+0.5)/2 = 0.7
		t.Errorf("math avg_score = %v; want ~0.7", math.AvgScore)
	}
	if math.MasteryRatio != 0.5 { // 1/2
		t.Errorf("math mastery_ratio = %v; want 0.5", math.MasteryRatio)
	}
	eng := got[1]
	if eng.SubjectID != "eng" || eng.Mastered != 1 || eng.Objectives != 1 || eng.MasteryRatio != 1.0 {
		t.Errorf("eng summary wrong: %+v", eng)
	}

	// Empty input yields an empty (non-nil) slice.
	if out := aggregateMasteryBySubject(nil); out == nil || len(out) != 0 {
		t.Errorf("aggregateMasteryBySubject(nil) = %v; want empty slice", out)
	}
}

// TestBuildReportPayload checks the report aggregation totals + readiness handling.
func TestBuildReportPayload(t *testing.T) {
	subjects := []SubjectMastery{
		{SubjectID: "math", Objectives: 2, Mastered: 1, AvgScore: 0.7},
		{SubjectID: "eng", Objectives: 1, Mastered: 1, AvgScore: 1.0},
	}
	readiness := 0.82
	p := buildReportPayload("2026-W26", subjects, 5, &readiness)

	if p["period"] != "2026-W26" {
		t.Errorf("period = %v; want 2026-W26", p["period"])
	}
	if p["total_objectives"] != 3 {
		t.Errorf("total_objectives = %v; want 3", p["total_objectives"])
	}
	if p["total_mastered"] != 2 {
		t.Errorf("total_mastered = %v; want 2", p["total_mastered"])
	}
	if p["event_count"] != 5 {
		t.Errorf("event_count = %v; want 5", p["event_count"])
	}
	// overall_score = (0.7*2 + 1.0*1) / 3 = 0.8
	if got, _ := p["overall_score"].(float64); got < 0.79 || got > 0.81 {
		t.Errorf("overall_score = %v; want ~0.8", p["overall_score"])
	}
	if got, _ := p["exam_readiness"].(float64); got != readiness {
		t.Errorf("exam_readiness = %v; want %v", p["exam_readiness"], readiness)
	}

	// No readiness → key omitted.
	p2 := buildReportPayload("weekly", subjects, 0, nil)
	if _, present := p2["exam_readiness"]; present {
		t.Errorf("exam_readiness should be omitted when readiness is nil")
	}
}

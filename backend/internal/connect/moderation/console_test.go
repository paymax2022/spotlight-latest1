package connectmoderation

import (
	"strings"
	"testing"
	"time"
)

func TestParseCaseStatus(t *testing.T) {
	for in, want := range map[string]bool{"": true, "all": true, "open": true, "investigating": true, "actioned": true, "dismissed": true,
		"OPEN": false, "bogus": false, "open;drop": false} {
		if _, ok := parseCaseStatus(in); ok != want {
			t.Errorf("%q ok=%v want %v", in, ok, want)
		}
	}
}

func TestCaseLimit(t *testing.T) {
	for in, want := range map[string]int{"": 100, "x": 100, "-1": 100, "0": 100, "30": 30, "999": 200} {
		if got := caseLimit(in); got != want {
			t.Errorf("%q -> %d want %d", in, got, want)
		}
	}
}

func TestSummaryNeverCarriesMessageContent(t *testing.T) {
	r := caseRow{ID: "m1", SenderID: "u1", ReasonCodes: []string{"scam", "pii"}, CreatedAt: time.Now(), Status: "open"}
	s := summaryOf(r)
	if s.ContentType != "message" || s.SubjectID != "u1" || s.Reason != "scam, pii" || s.Severity != "unrated" || s.Status != "open" {
		t.Fatalf("summary = %+v", s)
	}
	if len(s.AIReasonCodes) != 2 {
		t.Fatalf("codes = %v", s.AIReasonCodes)
	}
	empty := summaryOf(caseRow{ID: "m2", SenderID: "u", Status: "open"})
	if empty.Reason != "flagged content" || empty.AIReasonCodes == nil {
		t.Fatalf("empty reason handling: %+v", empty)
	}
	if !strings.HasPrefix(detailOf(r, nil).EvidenceRef, "message:") {
		t.Fatal("evidence must be a pointer, never the content")
	}
}

func TestHistoryMapsDecisions(t *testing.T) {
	at := time.Date(2026, 10, 13, 10, 0, 0, 0, time.UTC)
	rev, model := "admin-1", "mod-v2"
	d := detailOf(caseRow{ID: "m1", SenderID: "u", Status: "actioned", CreatedAt: at}, []decisionRow{
		{Decision: "warned", ReasonCodes: []string{"abuse"}, ReviewerID: &rev, CreatedAt: at},
		{Decision: "flagged", ReasonCodes: nil, Model: &model, CreatedAt: at},
		{Decision: "removed", CreatedAt: at},
	})
	if len(d.History) != 3 {
		t.Fatalf("history = %v", d.History)
	}
	if d.History[0].Actor != "admin-1" || d.History[0].Action != "warned" || d.History[0].Note != "abuse" {
		t.Fatalf("h0 = %+v", d.History[0])
	}
	if d.History[1].Actor != "model:mod-v2" || d.History[2].Actor != "system" {
		t.Fatalf("actors = %q / %q", d.History[1].Actor, d.History[2].Actor)
	}
}

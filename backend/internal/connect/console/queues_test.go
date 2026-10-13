package connectconsole

import (
	"strings"
	"testing"
	"time"
)

func TestUnderageStatusAndSignalMapping(t *testing.T) {
	for in, want := range map[string]string{"queued": "open", "banned": "confirmed_minor", "cleared": "cleared"} {
		if got := underageState(in); got != want {
			t.Errorf("%s -> %q want %q", in, got, want)
		}
	}
	if underageState("weird") != "" {
		t.Error("an unknown status must be excluded")
	}
	for in, want := range map[string]string{"under_18_at_age_gate": "dob_under_18", "age_estimation": "age_estimation", "report": "report", "document_mismatch": "document_mismatch", "anything else": "report"} {
		if got := underageSignal(in); got != want {
			t.Errorf("signal %q -> %q want %q", in, got, want)
		}
	}
}

func TestMaskDOBKeepsOnlyCenturyAndDay(t *testing.T) {
	d := time.Date(2009, 3, 14, 0, 0, 0, 0, time.UTC)
	if got := maskDOB(&d); got != "20••-••-14" {
		t.Fatalf("mask = %q", got)
	}
	if maskDOB(nil) != "" {
		t.Fatal("nil dob must mask to empty")
	}
	for _, leak := range []string{"2009", "03", "-03-"} {
		if strings.Contains(maskDOB(&d), leak) {
			t.Errorf("mask leaks %q", leak)
		}
	}
}

func TestMediaMapping(t *testing.T) {
	for _, c := range []struct {
		kind string
		sort int
		want string
	}{{"photo", 0, "profile_photo"}, {"photo", 3, "gallery"}, {"clip", 0, "gallery"}} {
		if got := mediaKind(c.kind, c.sort); got != c.want {
			t.Errorf("mediaKind(%s,%d) = %q want %q", c.kind, c.sort, got, c.want)
		}
	}
	m := mediaItemOf(mediaRow{ID: "m1", UserID: "u1", Kind: "photo", Status: "pending", CreatedAt: time.Now()})
	if m.AIReasonCodes == nil || len(m.AIReasonCodes) != 0 || m.AIConfidence != 0 || m.Handle != "user u1" || m.State != "pending" {
		t.Fatalf("item = %+v", m)
	}
}

func TestQueueFilterParsing(t *testing.T) {
	for in, ok := range map[string]bool{"": true, "all": true, "open": true, "confirmed_minor": true, "cleared": true, "bogus": false, "queued": false} {
		if _, got := parseUnderageStatus(in); got != ok {
			t.Errorf("underage %q ok=%v want %v", in, got, ok)
		}
	}
	for in, ok := range map[string]bool{"": true, "all": true, "pending": true, "approved": true, "rejected": true, "bogus": false} {
		if _, got := parseMediaState(in); got != ok {
			t.Errorf("media %q ok=%v want %v", in, got, ok)
		}
	}
}

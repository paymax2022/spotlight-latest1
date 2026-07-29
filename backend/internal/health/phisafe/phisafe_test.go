package phisafe

import (
	"errors"
	"testing"
)

// TS-14 NT-002 (result-ready notification carries no PHI in the body) + TS-18
// EC-013 (no PHI in the notification body/URL; tokenized links). Pure, deterministic
// assertions — no I/O.

var samplePHI = []string{
	"John Doe",                             // patient name
	"7.5 mmol/L",                           // a result value
	"550e8400-e29b-41d4-a716-446655440000", // a record/patient id
	"1990-02-14",                           // date of birth
}

// NT-002/EC-013: a generic notification with a tokenized link leaks nothing.
func TestCleanNotificationPasses(t *testing.T) {
	err := GuardNotification(
		"Your lab result is ready",
		"Your result is ready to view. Open the app to see it.",
		"https://app.example/r/opq_9f8a7b6c5d",
		samplePHI,
	)
	if err != nil {
		t.Fatalf("a PHI-free notification with a tokenized link must pass, got %v", err)
	}
}

// The body must not embed the patient's name or a result value.
func TestBodyLeaksAreCaught(t *testing.T) {
	if err := GuardNotification("Result", "John Doe, your potassium is 7.5 mmol/L.", "", samplePHI); err == nil {
		t.Fatal("a body containing the patient name / result value must be rejected")
	} else {
		var le *LeakError
		if !errors.As(err, &le) || le.Field != "body" {
			t.Fatalf("expected a body LeakError, got %v", err)
		}
	}
	// Case-insensitive.
	if err := GuardNotification("", "hello john doe", "", samplePHI); err == nil {
		t.Fatal("PHI match must be case-insensitive")
	}
}

// The subject line is guarded too.
func TestSubjectLeakCaught(t *testing.T) {
	if err := GuardNotification("Potassium 7.5 mmol/L — critical", "tap to view", "", samplePHI); err == nil {
		t.Fatal("a subject embedding a result value must be rejected")
	}
}

// EC-013: a link must be tokenized — it must not carry the record/patient id or a
// name in its path/query.
func TestLinkLeakCaught(t *testing.T) {
	link := "https://app.example/results?record_id=550e8400-e29b-41d4-a716-446655440000&name=John%20Doe"
	if err := GuardNotification("Result ready", "tap to view", link, samplePHI); err == nil {
		t.Fatal("a link carrying the record id must be rejected (use a tokenized link)")
	}
}

// LeakedTerm returns the offending term, and ignores empty / too-short PHI terms so
// stray initials don't cause false positives.
func TestLeakedTermSemantics(t *testing.T) {
	if got := LeakedTerm("your result is ready", samplePHI); got != "" {
		t.Fatalf("clean text must report no leak, got %q", got)
	}
	if got := LeakedTerm("call John Doe now", samplePHI); got != "John Doe" {
		t.Fatalf("LeakedTerm should return the matched term, got %q", got)
	}
	// Empty/short terms are ignored (no false positive on a 1–2 char token).
	if got := LeakedTerm("a bo cd", []string{"", "a", "bo"}); got != "" {
		t.Fatalf("short/empty PHI terms must be ignored, got %q", got)
	}
}

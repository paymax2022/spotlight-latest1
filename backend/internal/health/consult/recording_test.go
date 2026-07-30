package healthconsult

import "testing"

// TS-5 TM-003 (consult recording consent). Pure, deterministic — no I/O. Two-party
// consent: recording may be enabled only when BOTH the patient and the provider have
// consented; fail-closed otherwise.

func TestRecordingConsentComplete(t *testing.T) {
	const patient, provider = "patient-1", "provider-1"

	// Both parties consented → complete.
	if !recordingConsentComplete([]string{patient, provider}, patient, provider) {
		t.Fatal("both parties consenting must complete the gate")
	}
	// Order-independent, tolerant of duplicates / irrelevant ids.
	if !recordingConsentComplete([]string{provider, "someone-else", patient, patient}, patient, provider) {
		t.Fatal("gate must be order/duplicate tolerant when both parties are present")
	}
	// Only the patient consented → not complete.
	if recordingConsentComplete([]string{patient}, patient, provider) {
		t.Fatal("patient-only consent must NOT enable recording")
	}
	// Only the provider consented → not complete.
	if recordingConsentComplete([]string{provider}, patient, provider) {
		t.Fatal("provider-only consent must NOT enable recording")
	}
	// Nobody consented → not complete.
	if recordingConsentComplete(nil, patient, provider) {
		t.Fatal("no consent must NOT enable recording")
	}
	// A third party's consent is irrelevant — the two required parties must consent.
	if recordingConsentComplete([]string{"x", "y"}, patient, provider) {
		t.Fatal("unrelated consents must NOT enable recording")
	}
}

func TestRecordingConsentFailClosedOnEmptyParty(t *testing.T) {
	// Missing/empty party ids can never satisfy the gate.
	if recordingConsentComplete([]string{""}, "", "provider-1") {
		t.Fatal("empty patient id must fail closed")
	}
	if recordingConsentComplete([]string{"provider-1"}, "patient-1", "") {
		t.Fatal("empty provider id must fail closed")
	}
}

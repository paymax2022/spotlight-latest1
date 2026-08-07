package healthconsult

import "testing"

// TS-5 TM-006 (only participants can access the session/notes). Pure, deterministic
// object-level authZ — fail-closed.

func TestAuthorizeConsultAccess(t *testing.T) {
	const patient, provider = "patient-1", "provider-owner-1"

	// Participants may read.
	if !authorizeConsultAccess(patient, patient, provider, false) {
		t.Error("the patient must be allowed to read their consult notes")
	}
	if !authorizeConsultAccess(provider, patient, provider, false) {
		t.Error("the provider owner must be allowed to read the consult notes")
	}
	// An admin may read (break-glass / support).
	if !authorizeConsultAccess("admin-x", patient, provider, true) {
		t.Error("an admin must be allowed to read")
	}
	// A stranger may not.
	if authorizeConsultAccess("stranger", patient, provider, false) {
		t.Error("a non-participant must be forbidden")
	}
}

func TestAuthorizeConsultAccess_FailClosed(t *testing.T) {
	const patient, provider = "patient-1", "provider-owner-1"

	// Empty requester is denied even if it would "match" an empty owner id.
	if authorizeConsultAccess("", patient, provider, false) {
		t.Error("empty requester must be denied (fail-closed)")
	}
	if authorizeConsultAccess("   ", patient, provider, false) {
		t.Error("whitespace requester must be denied (fail-closed)")
	}
	// An empty provider-owner id must not let an empty-owner match slip through.
	if authorizeConsultAccess("", patient, "", false) {
		t.Error("empty requester must be denied even when provider owner is empty")
	}
	// A non-empty requester must not match an EMPTY provider owner by accident.
	if authorizeConsultAccess("someone", patient, "", false) {
		t.Error("a requester must never match an empty provider-owner id")
	}
}

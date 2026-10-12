package kycverify

import "testing"

// A Dojah NIN/BVN data-match entity (flattened into ExtractedFields) carries the
// authoritative legal name + DOB. ExtractVerifiedIdentity is what lets the
// gateway persist those from the provider response instead of the user typing
// (and mis-typing) them. ISO DOB is passed straight through.
func TestExtractVerifiedIdentity_ISODate(t *testing.T) {
	got, ok := ExtractVerifiedIdentity(map[string]string{
		"first_name":    "JOHN",
		"last_name":     "DOE",
		"date_of_birth": "1990-05-02",
	})
	if !ok {
		t.Fatal("want ok for a complete identity")
	}
	if got.FirstName != "JOHN" || got.LastName != "DOE" {
		t.Fatalf("name wrong: %+v", got)
	}
	if got.FullName != "JOHN DOE" {
		t.Fatalf("full name should be derived when absent: %q", got.FullName)
	}
	if got.DOB != "1990-05-02" {
		t.Fatalf("ISO DOB should pass through: %q", got.DOB)
	}
}

// Dojah frequently returns DOB as DD-MM-YYYY; it must be normalized to the ISO
// form Postgres DATE accepts, never stored raw (an unnormalized value would be
// rejected or, worse, silently mis-parsed as MM-DD).
func TestExtractVerifiedIdentity_NormalizesDayFirstDate(t *testing.T) {
	got, ok := ExtractVerifiedIdentity(map[string]string{
		"first_name":    "AMAKA",
		"last_name":     "OKAFOR",
		"date_of_birth": "02-05-1990",
	})
	if !ok {
		t.Fatal("want ok")
	}
	if got.DOB != "1990-05-02" {
		t.Fatalf("DD-MM-YYYY should normalize to ISO: got %q", got.DOB)
	}
}

// An explicit full_name from the provider is authoritative and must win over a
// derived first+last join.
func TestExtractVerifiedIdentity_PrefersProvidedFullName(t *testing.T) {
	got, _ := ExtractVerifiedIdentity(map[string]string{
		"first_name": "JOHN",
		"last_name":  "DOE",
		"full_name":  "JOHN QUINCY DOE",
	})
	if got.FullName != "JOHN QUINCY DOE" {
		t.Fatalf("provider full_name should win: %q", got.FullName)
	}
}

// A name with no usable DOB still persists (ok=true) — we store what the
// provider confirmed; DOB absence must not throw away a verified name.
func TestExtractVerifiedIdentity_NameWithoutDOB(t *testing.T) {
	got, ok := ExtractVerifiedIdentity(map[string]string{
		"first_name": "NGOZI",
		"last_name":  "EZE",
	})
	if !ok {
		t.Fatal("want ok with a name even when DOB is absent")
	}
	if got.DOB != "" {
		t.Fatalf("no DOB field should yield empty DOB, got %q", got.DOB)
	}
}

// An unparseable DOB is dropped (DOB=""), not persisted raw, and does not block
// the name.
func TestExtractVerifiedIdentity_UnparseableDOBDropped(t *testing.T) {
	got, ok := ExtractVerifiedIdentity(map[string]string{
		"first_name":    "TUNDE",
		"last_name":     "BELLO",
		"date_of_birth": "not-a-date",
	})
	if !ok {
		t.Fatal("want ok")
	}
	if got.DOB != "" {
		t.Fatalf("unparseable DOB must be dropped, got %q", got.DOB)
	}
}

// No name at all → not ok: we never write an empty identity over whatever the
// profile already has.
func TestExtractVerifiedIdentity_NoNameNotOK(t *testing.T) {
	if _, ok := ExtractVerifiedIdentity(map[string]string{"date_of_birth": "1990-05-02"}); ok {
		t.Fatal("no name should be not-ok")
	}
	if _, ok := ExtractVerifiedIdentity(map[string]string{}); ok {
		t.Fatal("empty fields should be not-ok")
	}
	if _, ok := ExtractVerifiedIdentity(nil); ok {
		t.Fatal("nil fields should be not-ok")
	}
}

// camelCase / alternate keys some providers use are accepted as fallbacks so a
// field-name variant never silently drops verified data.
func TestExtractVerifiedIdentity_AlternateKeys(t *testing.T) {
	got, ok := ExtractVerifiedIdentity(map[string]string{
		"firstName": "KEMI",
		"lastName":  "ADEYEMI",
		"dob":       "1985-12-11",
	})
	if !ok || got.FirstName != "KEMI" || got.LastName != "ADEYEMI" || got.DOB != "1985-12-11" {
		t.Fatalf("alternate keys not honored: %+v ok=%v", got, ok)
	}
}

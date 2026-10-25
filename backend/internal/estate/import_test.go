package estate

// Unit tests for the legacy-import validator (import.go validateImport) — the
// pure row validation + in-batch dedupe. Planning/apply against the live
// estate is covered in import_live_db_test.go.

import (
	"encoding/json"
	"testing"
	"time"
)

func raw(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func exceptionCodes(v validated) map[string]bool {
	out := map[string]bool{}
	for _, e := range v.exceptions {
		out[e.Code] = true
	}
	return out
}

func TestValidateImport_ValidBatch(t *testing.T) {
	v := validateImport(ImportRequest{
		Units: []json.RawMessage{
			raw(t, ImportUnit{ExternalRef: "U1", UnitLabel: "A-101", Block: "A"}),
		},
		Residents: []json.RawMessage{
			raw(t, ImportResident{ExternalRef: "R1", Email: "ada@x.test", UnitRef: "U1", Relationship: "owner", ResidencyStart: "2020-01-01"}),
		},
		OpeningBalances: []json.RawMessage{
			raw(t, map[string]any{"external_ref": "B1", "resident_ref": "R1", "unit_ref": "U1", "category": "service_charge", "amount_kobo": 150000, "due_date": "2026-01-31"}),
		},
	}, time.Now())
	if len(v.exceptions) != 0 {
		t.Fatalf("valid batch produced exceptions: %+v", v.exceptions)
	}
	if len(v.units) != 1 || len(v.residents) != 1 || len(v.balances) != 1 {
		t.Fatalf("validated counts = %d/%d/%d, want 1/1/1", len(v.units), len(v.residents), len(v.balances))
	}
	if v.balances[0].amount != 150000 {
		t.Fatalf("amount = %d, want 150000", v.balances[0].amount)
	}
	// Defaults applied.
	if v.units[0].u.PropertyType != "apartment" || v.units[0].u.OccupancyStatus != occupancyVacant {
		t.Fatalf("unit defaults not applied: %+v", v.units[0].u)
	}
	if v.residents[0].r.Relationship != "owner" {
		t.Fatalf("relationship = %q, want owner", v.residents[0].r.Relationship)
	}
}

func TestValidateImport_RowExceptions(t *testing.T) {
	now := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	v := validateImport(ImportRequest{
		Units: []json.RawMessage{
			json.RawMessage(`"not an object"`),                                              // malformed
			raw(t, ImportUnit{ExternalRef: "", UnitLabel: "A-1"}),                           // missing ref
			raw(t, ImportUnit{ExternalRef: "U1", UnitLabel: "A-1", PropertyType: "castle"}), // bad type
			raw(t, ImportUnit{ExternalRef: "U2", UnitLabel: "A-1"}),                         // dup natural key... wait different block
			raw(t, ImportUnit{ExternalRef: "U2", UnitLabel: "A-1", Block: "B"}),             // dup ref with row above? ref U2 once
			raw(t, ImportUnit{ExternalRef: "U2", UnitLabel: "A-2"}),                         // dup ref
		},
		Residents: []json.RawMessage{
			raw(t, ImportResident{ExternalRef: "R1"}), // no identity
			raw(t, ImportResident{ExternalRef: "R2", Email: "a@x.test", ResidencyStart: "2021-06-01", ResidencyEnd: "2021-01-01"}), // end<start
			raw(t, ImportResident{ExternalRef: "R3", Email: "b@x.test", ResidencyEnd: "2020-01-01"}),                               // ended residency
			raw(t, ImportResident{ExternalRef: "R4", Email: "a@x.test"}),                                                           // dup identity (R2 also a@x.test but R2 already dropped? no—R2 is dropped, R4 vs R5)
			raw(t, ImportResident{ExternalRef: "R5", Email: "a@x.test"}),                                                           // dup identity with R4
			raw(t, ImportResident{ExternalRef: "R6", Phone: "0803", Relationship: "squatter"}),                                     // bad relationship
		},
		OpeningBalances: []json.RawMessage{
			raw(t, map[string]any{"external_ref": "B1", "resident_ref": "R1", "amount_kobo": -500, "due_date": "2026-01-01"}),                     // credit
			raw(t, map[string]any{"external_ref": "B2", "resident_ref": "R1", "amount_kobo": 0, "due_date": "2026-01-01"}),                        // zero
			raw(t, map[string]any{"external_ref": "B3", "resident_ref": "R1", "amount_kobo": 10.5, "due_date": "2026-01-01"}),                     // non-integer
			raw(t, map[string]any{"external_ref": "B4", "resident_ref": "R1", "amount_kobo": 100, "due_date": "not-a-date"}),                      // bad date
			raw(t, map[string]any{"external_ref": "B5", "resident_ref": "", "amount_kobo": 100, "due_date": "2026-01-01"}),                        // no resident_ref
			raw(t, map[string]any{"external_ref": "B6", "resident_ref": "R1", "amount_kobo": 100, "category": "lunch", "due_date": "2026-01-01"}), // bad category
		},
	}, now)
	codes := exceptionCodes(v)
	want := []string{
		"malformed_row", "missing_external_ref", "invalid_property_type", "duplicate_in_batch",
		"missing_identity", "invalid_residency_dates", "historical_residency_out_of_scope",
		"duplicate_identity_in_batch", "invalid_relationship",
		"credit_balance_unsupported", "zero_balance", "invalid_amount", "invalid_due_date",
		"missing_resident_ref", "invalid_category",
	}
	for _, c := range want {
		if !codes[c] {
			t.Errorf("missing expected exception code %q; got %v", c, codes)
		}
	}
	// The valid rows that survived: U2 (A-1/B) from units; R4 from residents.
	// Everything else dropped.
	if len(v.units) != 1 {
		t.Errorf("surviving units = %d, want 1 (%+v)", len(v.units), v.units)
	}
	if len(v.residents) != 1 {
		t.Errorf("surviving residents = %d, want 1", len(v.residents))
	}
	if len(v.balances) != 0 {
		t.Errorf("surviving balances = %d, want 0", len(v.balances))
	}
}

func TestValidateImport_DuplicateUnitNaturalKey(t *testing.T) {
	v := validateImport(ImportRequest{
		Units: []json.RawMessage{
			raw(t, ImportUnit{ExternalRef: "U1", UnitLabel: "A-1", Block: "A"}),
			raw(t, ImportUnit{ExternalRef: "U2", UnitLabel: " a-1 ", Block: "a"}), // same key, normalised
		},
	}, time.Now())
	codes := exceptionCodes(v)
	if !codes["duplicate_unit_in_batch"] || len(v.units) != 1 {
		t.Fatalf("natural-key dedupe failed: codes=%v units=%d", codes, len(v.units))
	}
}

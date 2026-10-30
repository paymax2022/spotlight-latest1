package owner

import "testing"

// LIVE-DB: the owner can request labs on their own completed appointment; a
// stranger cannot; validation runs before the write. Rolled back (newLiveWorld).
func TestLiveDB_OwnerRequestLab(t *testing.T) {
	w := newLiveWorld(t)
	body := `{"appointmentId":"` + w.appt + `","petId":"` + w.pet + `","testNames":["CBC"," Urinalysis "],"note":"fasted"}`

	var out struct {
		OK         bool   `json:"ok"`
		LabOrderID string `json:"labOrderId"`
	}
	if code := w.call(t, w.h.RequestLab, "POST", "/lab-requests", "/lab-requests", w.owner, body, &out); code != 201 || !out.OK || out.LabOrderID == "" {
		t.Fatalf("owner request: %d %+v", code, out)
	}
	var tests []string
	var orderedBy string
	if err := w.tx.QueryRow(t.Context(), `SELECT test_names, ordered_by::text FROM vet_lab_orders WHERE id=$1`, out.LabOrderID).Scan(&tests, &orderedBy); err != nil {
		t.Fatal(err)
	}
	if len(tests) != 2 || tests[1] != "Urinalysis" || orderedBy != w.owner {
		t.Fatalf("row: %v %s", tests, orderedBy)
	}

	if code := w.call(t, w.h.RequestLab, "POST", "/lab-requests", "/lab-requests", w.stranger, body, nil); code != 404 {
		t.Fatalf("stranger: %d, want 404", code)
	}
	wrongPet := `{"appointmentId":"` + w.appt + `","petId":"` + w.provider + `","testNames":["CBC"]}`
	if code := w.call(t, w.h.RequestLab, "POST", "/lab-requests", "/lab-requests", w.owner, wrongPet, nil); code != 400 {
		t.Fatalf("pet mismatch: %d, want 400", code)
	}
	for _, bad := range []string{`{"appointmentId":"x","testNames":["CBC"]}`, `{"appointmentId":"` + w.appt + `","testNames":[]}`} {
		if code := w.call(t, w.h.RequestLab, "POST", "/lab-requests", "/lab-requests", w.owner, bad, nil); code != 400 {
			t.Fatalf("%s: %d, want 400", bad, code)
		}
	}
	if code := w.call(t, w.h.RequestLab, "POST", "/lab-requests", "/lab-requests", "", body, nil); code != 401 {
		t.Fatalf("anonymous: %d, want 401", code)
	}
}

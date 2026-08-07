package clinicalsafety

import "testing"

// TS-6 e-Prescription safety (RX-002/003/004/005) + TS-9 Veterinary (VT-002/003/004)
// + TS-18 (EC-010). Deterministic, executed assertions on the pure safety engine —
// no DB, no live drug database. These are P0 patient/animal-safety cases.

func hardStops(r Result) int {
	n := 0
	for _, f := range r.Findings {
		if f.HardStop {
			n++
		}
	}
	return n
}

func hasKind(r Result, k FindingKind) bool {
	for _, f := range r.Findings {
		if f.Kind == k {
			return true
		}
	}
	return false
}

// RX-002: a drug the patient is allergic to (incl. cross-class) is a hard stop.
func TestAllergyHardStop(t *testing.T) {
	pc := PatientContext{Species: "human", Allergies: []string{"Penicillin"}}
	// amoxicillin is a penicillin-class antibiotic → cross-allergy.
	r := Check(pc, []RxItem{{DrugName: "Amoxicillin", Quantity: 1}})
	if !r.Blocked || !hasKind(r, KindAllergy) {
		t.Fatalf("penicillin allergy + amoxicillin must hard-stop: %+v", r)
	}
	// A non-cross-reacting antibiotic is fine.
	if r2 := Check(pc, []RxItem{{DrugName: "Azithromycin", Quantity: 1}}); r2.Blocked || hasKind(r2, KindAllergy) {
		t.Fatalf("azithromycin should not trip penicillin allergy: %+v", r2)
	}
}

// RX-003: drug–drug interactions flag per severity; contraindicated/major hard-stop.
func TestDrugInteraction(t *testing.T) {
	// Warfarin (current) + aspirin (new) → major bleeding-risk interaction.
	pc := PatientContext{Species: "human", CurrentMeds: []string{"Warfarin"}}
	r := Check(pc, []RxItem{{DrugName: "Aspirin", Quantity: 1}})
	if !hasKind(r, KindInteraction) || !r.Blocked {
		t.Fatalf("warfarin+aspirin must flag a blocking interaction: %+v", r)
	}
	// Nitrate + sildenafil → contraindicated.
	pc2 := PatientContext{Species: "human", CurrentMeds: []string{"Isosorbide dinitrate"}}
	r2 := Check(pc2, []RxItem{{DrugName: "Sildenafil", Quantity: 1}})
	if !r2.Blocked {
		t.Fatalf("nitrate+sildenafil must be contraindicated (blocked): %+v", r2)
	}
	// Unrelated pair → no interaction.
	if r3 := Check(PatientContext{Species: "human", CurrentMeds: []string{"Amoxicillin"}}, []RxItem{{DrugName: "Loratadine", Quantity: 1}}); hasKind(r3, KindInteraction) {
		t.Fatalf("amoxicillin+loratadine should not interact: %+v", r3)
	}
}

// RX-004: dose-range / weight-based dosing — out-of-range blocks.
func TestDoseRange(t *testing.T) {
	// Paracetamol adult single dose 6000mg exceeds the max single dose → block.
	r := Check(PatientContext{Species: "human", WeightKg: 70}, []RxItem{{DrugName: "Paracetamol", DoseMg: 6000, Quantity: 1}})
	if !r.Blocked || !hasKind(r, KindDose) {
		t.Fatalf("6000mg paracetamol single dose must be out-of-range: %+v", r)
	}
	// A normal 1000mg dose is fine.
	if r2 := Check(PatientContext{Species: "human", WeightKg: 70}, []RxItem{{DrugName: "Paracetamol", DoseMg: 1000, Quantity: 1}}); r2.Blocked || hasKind(r2, KindDose) {
		t.Fatalf("1000mg paracetamol should be in range: %+v", r2)
	}
	// Weight-based: a 15kg child at an adult 1000mg paracetamol dose exceeds mg/kg cap.
	r3 := Check(PatientContext{Species: "human", WeightKg: 15, AgeYears: 4}, []RxItem{{DrugName: "Paracetamol", DoseMg: 1000, Quantity: 1}})
	if !r3.Blocked || !hasKind(r3, KindDose) {
		t.Fatalf("1000mg for a 15kg child must exceed weight-based cap: %+v", r3)
	}
}

// RX-005: duplicate therapy (same class already active) is flagged.
func TestDuplicateTherapy(t *testing.T) {
	// Ibuprofen (current NSAID) + naproxen (new NSAID) → duplicate therapy.
	pc := PatientContext{Species: "human", CurrentMeds: []string{"Ibuprofen"}}
	r := Check(pc, []RxItem{{DrugName: "Naproxen", Quantity: 1}})
	if !hasKind(r, KindDuplicate) {
		t.Fatalf("two NSAIDs must flag duplicate therapy: %+v", r)
	}
}

// VT-003 / EC-010: species-toxic substance is a hard block (paracetamol in cats,
// xylitol in dogs), while the same drug can be valid for another species.
func TestSpeciesToxic(t *testing.T) {
	// Paracetamol is toxic to cats → hard block.
	rCat := Check(PatientContext{Species: "cat", WeightKg: 4}, []RxItem{{DrugName: "Paracetamol", DoseMg: 50, Quantity: 1}})
	if !rCat.Blocked || !hasKind(rCat, KindSpeciesToxic) {
		t.Fatalf("paracetamol must be blocked for cats: %+v", rCat)
	}
	// Xylitol is toxic to dogs → hard block.
	rDog := Check(PatientContext{Species: "dog", WeightKg: 12}, []RxItem{{DrugName: "Xylitol", Quantity: 1}})
	if !rDog.Blocked || !hasKind(rDog, KindSpeciesToxic) {
		t.Fatalf("xylitol must be blocked for dogs: %+v", rDog)
	}
	// EC-010: a drug valid for a dog can be toxic for a cat (same substance).
	rDogOk := Check(PatientContext{Species: "dog", WeightKg: 20}, []RxItem{{DrugName: "Paracetamol", DoseMg: 100, Quantity: 1}})
	if hasKind(rDogOk, KindSpeciesToxic) {
		t.Fatalf("paracetamol (careful dose) should not be flagged species-toxic for dogs: %+v", rDogOk)
	}
}

// VT-004: a human-only drug is blocked for animals per policy.
func TestHumanOnlyDrugBlockedForAnimals(t *testing.T) {
	r := Check(PatientContext{Species: "dog", WeightKg: 20}, []RxItem{{DrugName: "Ibuprofen", Quantity: 1}})
	// Ibuprofen is both human-only-for-pets AND toxic to dogs; must be blocked.
	if !r.Blocked {
		t.Fatalf("ibuprofen must be blocked for a dog: %+v", r)
	}
}

// Clean prescription → no findings, not blocked.
func TestCleanPrescription(t *testing.T) {
	pc := PatientContext{Species: "human", WeightKg: 70, Allergies: []string{"Sulfa"}, CurrentMeds: []string{"Lisinopril"}}
	r := Check(pc, []RxItem{{DrugName: "Amoxicillin", DoseMg: 500, Quantity: 21}})
	if r.Blocked || len(r.Findings) != 0 {
		t.Fatalf("clean prescription should have no findings: %+v", r)
	}
}

// A hard-stop must be marked overridable-with-reason (RX-011 is enforced at the
// service layer); the engine flags HardStop but never itself silently drops it.
func TestHardStopFlaggedNotDropped(t *testing.T) {
	r := Check(PatientContext{Species: "human", Allergies: []string{"penicillin"}}, []RxItem{{DrugName: "amoxicillin", Quantity: 1}})
	if hardStops(r) == 0 {
		t.Fatalf("expected a hard-stop finding to be present for override handling: %+v", r)
	}
}

package app

import (
	"context"

	"spotlight/backend/internal/health/clinicalsafety"
	healthpreconsult "spotlight/backend/internal/health/preconsult"
)

// preconsultClinicalContext adapts the preconsult health profile (documented
// allergies + current medications) into the rx engine's ClinicalContextProvider,
// so the pre-issue drug-allergy / drug-drug-interaction screen (RX-002/003) runs
// against the patient's real profile. Best-effort: a missing or unreadable profile
// yields (empty, ok=false) so the screen runs against no data rather than failing
// the prescription — safety findings only ever gate on data we actually have.
type preconsultClinicalContext struct{ pc *healthpreconsult.Service }

func (a preconsultClinicalContext) ClinicalContext(ctx context.Context, patientID string) (clinicalsafety.PatientContext, bool, error) {
	if a.pc == nil {
		return clinicalsafety.PatientContext{}, false, nil
	}
	hp, err := a.pc.HealthProfileFor(ctx, patientID)
	if err != nil || hp == nil {
		return clinicalsafety.PatientContext{}, false, nil
	}
	return clinicalsafety.PatientContext{
		Species:     "human",
		Allergies:   clinicalsafety.ParseTerms(hp.Allergies),
		CurrentMeds: clinicalsafety.ParseTerms(hp.CurrentMedications),
	}, true, nil
}

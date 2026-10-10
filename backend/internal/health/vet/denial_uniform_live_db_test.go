package healthvet

// LIVE-DB pin for the w12 denial-semantics contract decision on the vet
// module: "unauthorized for an existing object" and "object does not exist"
// must answer the SAME thing — no existence oracle.
//
//   - ScheduleVaccination / Book denial: ownsPet is an EXISTS() probe, so a
//     foreign pet and a nonexistent pet already produce the identical
//     "forbidden — not the pet owner" refusal. The 422 status the handler
//     maps onto it is the vet write-path refusal convention (Book returns
//     the identical denial at the identical status), so the status stays —
//     what matters is the text is already uniform, pinned here.
//   - Get / Cancel denial: was "vet: forbidden" on an existing foreign
//     appointment vs "vet: appointment not found" on a missing one — an
//     oracle. Both now answer "vet: appointment not found".
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLiveDB_ScheduleVaccination_DenialIsUniform(t *testing.T) {
	pool := listAppointmentsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	owner := uuid.New().String()
	attacker := uuid.New().String()
	seedVetTestUser(t, ctx, pool, owner)
	seedVetTestUser(t, ctx, pool, attacker)
	foreignPet := seedVetPet(t, ctx, pool, owner)

	dueAt := time.Now().Add(48 * time.Hour)
	_, foreignErr := svc.ScheduleVaccination(ctx, attacker, foreignPet, "rabies", dueAt)
	_, missingErr := svc.ScheduleVaccination(ctx, attacker, uuid.New().String(), "rabies", dueAt)
	if foreignErr == nil || missingErr == nil {
		t.Fatalf("both foreign-pet and missing-pet must be refused, got %v / %v", foreignErr, missingErr)
	}
	if foreignErr.Error() != missingErr.Error() {
		t.Fatalf("denial must be uniform — foreign pet %q vs missing pet %q would oracle existence",
			foreignErr.Error(), missingErr.Error())
	}
}

func TestLiveDB_Get_DeniedReadsAsNotFound(t *testing.T) {
	pool := listAppointmentsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	patient := uuid.New().String()
	attacker := uuid.New().String()
	vetOwner := uuid.New().String()
	seedVetTestUser(t, ctx, pool, patient)
	seedVetTestUser(t, ctx, pool, attacker)
	seedVetTestUser(t, ctx, pool, vetOwner)
	providerID := seedVetProvider(t, ctx, pool, vetOwner)
	serviceID := seedVetService(t, ctx, pool, providerID)
	petID := seedVetPet(t, ctx, pool, patient)
	apptID := seedVetAppointment(t, ctx, pool, patient, providerID, petID, serviceID)

	_, foreignErr := svc.Get(ctx, attacker, apptID, false)
	_, missingErr := svc.Get(ctx, attacker, uuid.New().String(), false)
	if foreignErr == nil || missingErr == nil {
		t.Fatalf("both foreign and missing appointments must fail, got %v / %v", foreignErr, missingErr)
	}
	if foreignErr.Error() != missingErr.Error() {
		t.Fatalf("denial must be uniform — foreign %q vs missing %q would oracle existence",
			foreignErr.Error(), missingErr.Error())
	}
}

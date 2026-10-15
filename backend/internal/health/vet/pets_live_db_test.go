package healthvet

// LIVE-DB tests for the pet profile: create (with replay), owner-scoped read,
// owner-scoped update, and the birth-date rule against the real pets table.
// Skip unless TEST_DATABASE_URL is set.

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func petsLiveService(t *testing.T) *Service {
	t.Helper()
	return NewService(listAppointmentsLivePool(t), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
}

func TestLiveDB_PetCreateReplayReadUpdate(t *testing.T) {
	ctx := t.Context()
	svc := petsLiveService(t)
	owner := uuid.NewString()
	other := uuid.NewString()
	seedVetTestUser(t, ctx, svc.db, owner)
	seedVetTestUser(t, ctx, svc.db, other)

	weight := 48.5
	birth := "2021-06-15"
	in := Pet{Name: "Bella", Species: "dog", Breed: "Boerboel", Sex: "female", BirthDate: &birth, WeightKg: &weight}
	key := "pet-create-" + uuid.NewString()

	created, err := svc.CreatePet(ctx, owner, withKey(in, key))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Species != "DOG" || created.Sex != "FEMALE" {
		t.Fatalf("not stored canonically: species=%q sex=%q", created.Species, created.Sex)
	}
	if created.BirthDate == nil || *created.BirthDate != "2021-06-15" {
		t.Fatalf("birth date round-trip: %v", created.BirthDate)
	}

	// Replay with the same key returns the original row, not a second pet.
	replay, err := svc.CreatePet(ctx, owner, withKey(in, key))
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replay.ID != created.ID {
		t.Fatalf("replay created a second pet: %s vs %s", replay.ID, created.ID)
	}

	got, err := svc.GetPet(ctx, owner, created.ID)
	if err != nil || got.Name != "Bella" {
		t.Fatalf("owner read: %v %+v", err, got)
	}
	if _, err := svc.GetPet(ctx, other, created.ID); !errors.Is(err, ErrPetNotFound) {
		t.Fatalf("a stranger must see ErrPetNotFound, got %v", err)
	}

	newBirth := "2022-01-02"
	edited := Pet{Name: "Bella B.", Species: "DOG", Breed: "Boerboel", Sex: "FEMALE", BirthDate: &newBirth}
	up, err := svc.UpdatePet(ctx, owner, created.ID, edited)
	if err != nil {
		t.Fatalf("owner update: %v", err)
	}
	if up.Name != "Bella B." || up.BirthDate == nil || *up.BirthDate != "2022-01-02" || up.WeightKg != nil {
		t.Fatalf("update not applied (weight should be cleared when omitted): %+v", up)
	}
	if _, err := svc.UpdatePet(ctx, other, created.ID, edited); !errors.Is(err, ErrPetNotFound) {
		t.Fatalf("a stranger must not update the pet, got %v", err)
	}
}

func TestLiveDB_PetFutureBirthDateIsRefusedBeforeAnyWrite(t *testing.T) {
	ctx := t.Context()
	svc := petsLiveService(t)
	owner := uuid.NewString()
	seedVetTestUser(t, ctx, svc.db, owner)

	future := time.Now().AddDate(1, 0, 0).Format("2006-01-02")
	_, err := svc.CreatePet(ctx, owner, withKey(Pet{Name: "Ghost", Species: "CAT", Breed: "Mix", BirthDate: &future}, "pet-future-"+uuid.NewString()))
	if err == nil {
		t.Fatal("a future birth date must be refused")
	}
	var n int
	if err := svc.db.QueryRow(ctx, `SELECT count(*) FROM pets WHERE owner_user_id=$1`, owner).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("a refused pet was written (%d rows)", n)
	}
}

func withKey(p Pet, key string) Pet {
	p.IdempotencyKey = key
	return p
}

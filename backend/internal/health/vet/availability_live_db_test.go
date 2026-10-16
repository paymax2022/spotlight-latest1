package healthvet

// LIVE-DB tests for vet availability: saving and replacing a vet's hours, slots
// removed by a booking and by time off, and ownership. Skip unless
// TEST_DATABASE_URL is set.

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func everyDayTele(start, end string) []HoursWindow {
	days := []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}
	out := make([]HoursWindow, 0, len(days))
	for _, d := range days {
		out = append(out, HoursWindow{Day: d, Start: start, End: end, Type: "tele", Enabled: true})
	}
	return out
}

func TestLiveDB_AvailabilitySaveReadAndReplace(t *testing.T) {
	ctx := t.Context()
	svc := petsLiveService(t)
	owner := uuid.NewString()
	listed := seedVetListing(t, ctx, svc.db, owner, "Avail", true, "APPROVED", "approved", true)

	saved, err := svc.SaveProviderHours(ctx, owner, everyDayTele("09:00", "11:00"))
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if len(saved) != 7 || saved[0].ID == "" || saved[0].Type != "tele" {
		t.Fatalf("saved windows = %+v", saved)
	}
	read, err := svc.ProviderHours(ctx, owner)
	if err != nil || len(read) != 7 {
		t.Fatalf("read back: %v %+v", err, read)
	}

	// Replacing is all-or-nothing and removes the old windows.
	one := []HoursWindow{{Day: "Fri", Start: "10:00", End: "12:00", Type: "home", Enabled: true}}
	if _, err := svc.SaveProviderHours(ctx, owner, one); err != nil {
		t.Fatalf("replace: %v", err)
	}
	read, _ = svc.ProviderHours(ctx, owner)
	if len(read) != 1 || read[0].Day != "Fri" || read[0].Type != "home" {
		t.Fatalf("after replace: %+v", read)
	}

	// A refused save leaves the saved hours untouched.
	bad := []HoursWindow{{Day: "Mon", Start: "09:00", End: "08:00", Type: "tele", Enabled: true}}
	if _, err := svc.SaveProviderHours(ctx, owner, bad); err == nil {
		t.Fatal("an invalid save must be refused")
	}
	read, _ = svc.ProviderHours(ctx, owner)
	if len(read) != 1 {
		t.Fatalf("a refused save must not change the hours, have %d", len(read))
	}

	// Recurring hours produce slots; the owner's own bookings and time off remove them.
	if _, err := svc.SaveProviderHours(ctx, owner, everyDayTele("09:00", "11:00")); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	days, err := svc.VetAvailability(ctx, listed, 7, now)
	if err != nil {
		t.Fatalf("availability: %v", err)
	}
	if len(days) == 0 || len(days[0].Slots) == 0 {
		t.Fatalf("expected open slots, got %+v", days)
	}
	first := days[0].Slots[0]
	firstStart, _ := time.Parse(time.RFC3339, first.Start)

	patient := uuid.NewString()
	seedVetTestUser(t, ctx, svc.db, patient)
	if _, err := svc.db.Exec(ctx, `
		INSERT INTO health_appointments (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
		VALUES ($1, $2, $3, 'PET', 'TELE', 'CONFIRMED', $4, $5)`,
		uuid.NewString(), listed, patient, firstStart, firstStart.Add(30*time.Minute)); err != nil {
		t.Fatalf("booking: %v", err)
	}
	days, _ = svc.VetAvailability(ctx, listed, 7, now)
	for _, d := range days {
		for _, s := range d.Slots {
			if s.ID == first.ID {
				t.Fatal("a booked slot must no longer be offered")
			}
		}
	}

	// Time off removes the next slot too.
	second := days[0].Slots[0]
	secondStart, _ := time.Parse(time.RFC3339, second.Start)
	if _, err := svc.db.Exec(ctx, `
		INSERT INTO vet_availability_blocks (provider_id, starts_at, ends_at, reason)
		VALUES ($1, $2, $3, 'test leave')`, listed, secondStart, secondStart.Add(30*time.Minute)); err != nil {
		t.Fatalf("block: %v", err)
	}
	days, _ = svc.VetAvailability(ctx, listed, 7, now)
	for _, d := range days {
		for _, s := range d.Slots {
			if s.ID == second.ID {
				t.Fatal("a slot under time off must no longer be offered")
			}
		}
	}
}

func TestLiveDB_AvailabilityOwnershipAndListing(t *testing.T) {
	ctx := t.Context()
	svc := petsLiveService(t)
	owner := uuid.NewString()
	stranger := uuid.NewString()
	hidden := seedVetListing(t, ctx, svc.db, owner, "Unpublished", true, "APPROVED", "approved", false)
	seedVetTestUser(t, ctx, svc.db, stranger)

	// An unlisted vet has no availability, the same as a missing one.
	if _, err := svc.VetAvailability(ctx, hidden, 7, time.Now()); !errors.Is(err, ErrVetNotFound) {
		t.Fatalf("unlisted vet: err = %v, want ErrVetNotFound", err)
	}
	if _, err := svc.VetAvailability(ctx, uuid.NewString(), 7, time.Now()); !errors.Is(err, ErrVetNotFound) {
		t.Fatalf("missing vet: err = %v, want ErrVetNotFound", err)
	}

	// A user with no vet profile cannot read or write any hours.
	if _, err := svc.ProviderHours(ctx, stranger); !errors.Is(err, ErrNoVetProfile) {
		t.Fatalf("read by a non-vet: err = %v, want ErrNoVetProfile", err)
	}
	if _, err := svc.SaveProviderHours(ctx, stranger, everyDayTele("09:00", "10:00")); !errors.Is(err, ErrNoVetProfile) {
		t.Fatalf("write by a non-vet: err = %v, want ErrNoVetProfile", err)
	}
	// The vet's hours are not visible to another vet.
	if _, err := svc.SaveProviderHours(ctx, owner, everyDayTele("09:00", "10:00")); err != nil {
		t.Fatal(err)
	}
	if got, _ := svc.ProviderHours(ctx, stranger); len(got) != 0 {
		t.Fatalf("a stranger must not see another vet's hours: %+v", got)
	}
}

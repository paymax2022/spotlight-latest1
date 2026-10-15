package healthvet

import (
	"strings"
	"testing"
	"time"
)

func strp(s string) *string   { return &s }
func fltp(f float64) *float64 { return &f }

// The clock is pinned to a Lagos afternoon so the future-date rule is exact.
var testToday = time.Date(2026, 10, 12, 15, 0, 0, 0, petLocal)

func validPet() Pet {
	return Pet{Name: "  Bella ", Species: "dog", Breed: "Boerboel", Sex: "female"}
}

func TestNormalizePetInput_CanonicalisesAValidPet(t *testing.T) {
	p := validPet()
	p.BirthDate = strp(" 2024-03-05 ")
	p.WeightKg = fltp(48)
	p.Notes = "  calm  "
	if err := NormalizePetInput(&p, testToday); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Name != "Bella" || p.Species != "DOG" || p.Sex != "FEMALE" || p.Notes != "calm" {
		t.Fatalf("not canonicalised: %+v", p)
	}
	if p.BirthDate == nil || *p.BirthDate != "2024-03-05" {
		t.Fatalf("birth date not normalised: %v", p.BirthDate)
	}
}

func TestNormalizePetInput_RejectsWithOwnerFacingMessages(t *testing.T) {
	cases := map[string]struct {
		mutate func(*Pet)
		want   string
	}{
		"blank name":      {func(p *Pet) { p.Name = "   " }, "Pet name is required"},
		"unknown species": {func(p *Pet) { p.Species = "DRAGON" }, "Choose a species for your pet"},
		"blank breed":     {func(p *Pet) { p.Breed = "" }, "Choose a breed for your pet"},
		"bad sex":         {func(p *Pet) { p.Sex = "maybe" }, "Choose a sex for your pet"},
		"future birth":    {func(p *Pet) { p.BirthDate = strp("2026-10-13") }, "Date of birth cannot be in the future"},
		"bad date":        {func(p *Pet) { p.BirthDate = strp("12/03/2024") }, "Date of birth must be a valid date"},
		"ancient birth":   {func(p *Pet) { p.BirthDate = strp("1850-01-01") }, "Date of birth is too far in the past"},
		"zero weight":     {func(p *Pet) { p.WeightKg = fltp(0) }, "Weight must be more than 0 and no more than 200 kg"},
		"heavy":           {func(p *Pet) { p.WeightKg = fltp(500) }, "Weight must be more than 0 and no more than 200 kg"},
		"long notes":      {func(p *Pet) { p.Notes = strings.Repeat("x", petNotesMax+1) }, "Notes are too long"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			p := validPet()
			tc.mutate(&p)
			err := NormalizePetInput(&p, testToday)
			if err == nil || err.Error() != tc.want {
				t.Fatalf("err = %v, want %q", err, tc.want)
			}
		})
	}
}

// A birth date of today (Lagos) is allowed even though UTC is still yesterday.
func TestNormalizePetInput_TodayInLagosIsNotFuture(t *testing.T) {
	justAfterMidnightLagos := time.Date(2026, 10, 12, 0, 30, 0, 0, petLocal)
	p := validPet()
	p.BirthDate = strp("2026-10-12")
	if err := NormalizePetInput(&p, justAfterMidnightLagos); err != nil {
		t.Fatalf("a pet born today must be accepted: %v", err)
	}
}

func TestNormalizePetInput_EmptyDateAndSexDefault(t *testing.T) {
	p := validPet()
	p.Sex = ""
	p.BirthDate = strp("   ")
	if err := NormalizePetInput(&p, testToday); err != nil {
		t.Fatal(err)
	}
	if p.Sex != "UNKNOWN" || p.BirthDate != nil {
		t.Fatalf("sex=%q birth=%v, want UNKNOWN and nil", p.Sex, p.BirthDate)
	}
}

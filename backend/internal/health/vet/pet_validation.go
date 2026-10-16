package healthvet

import (
	"errors"
	"strings"
	"time"
)

// Pet input rules, enforced on create and update before anything is written.
// The mobile form is the usual source of bad values (a date picked in the
// future, a species typed in lower case), so the server holds the same line
// rather than trusting the client.

// petLocal is the clinic's calendar (Nigeria, UTC+1, no DST). "Today" for the
// future-date rule is taken here, so an owner registering a pet at 00:30 on
// their own day is not told their birth date is in the future.
var petLocal = time.FixedZone("WAT", 60*60)

// PetToday is the current date in the platform's calendar.
func PetToday(now time.Time) time.Time { return now.In(petLocal) }

var (
	petSpecies = map[string]bool{"DOG": true, "CAT": true, "BIRD": true, "RABBIT": true, "REPTILE": true, "OTHER": true}
	petSex     = map[string]bool{"MALE": true, "FEMALE": true, "UNKNOWN": true}
)

const (
	petNameMax   = 80
	petBreedMax  = 80
	petNotesMax  = 2000
	petWeightMax = 200.0 // kg; a bullmastiff is ~60, an elephant is not a vet-app pet
)

// NormalizePetInput trims and canonicalises a pet payload in place (species and
// sex to their stored upper-case codes, dates to YYYY-MM-DD) and returns the
// first rule it breaks. Messages are written for the owner: they are shown as-is.
func NormalizePetInput(p *Pet, today time.Time) error {
	p.Name = strings.TrimSpace(p.Name)
	p.Species = strings.ToUpper(strings.TrimSpace(p.Species))
	p.Breed = strings.TrimSpace(p.Breed)
	p.Sex = strings.ToUpper(strings.TrimSpace(p.Sex))
	p.Notes = strings.TrimSpace(p.Notes)

	if p.Name == "" {
		return errors.New("Pet name is required")
	}
	if len(p.Name) > petNameMax {
		return errors.New("Pet name is too long")
	}
	if !petSpecies[p.Species] {
		return errors.New("Choose a species for your pet")
	}
	if p.Breed == "" {
		return errors.New("Choose a breed for your pet")
	}
	if len(p.Breed) > petBreedMax {
		return errors.New("Breed is too long")
	}
	if p.Sex == "" {
		p.Sex = "UNKNOWN"
	}
	if !petSex[p.Sex] {
		return errors.New("Choose a sex for your pet")
	}
	if len(p.Notes) > petNotesMax {
		return errors.New("Notes are too long")
	}
	if p.WeightKg != nil && (*p.WeightKg <= 0 || *p.WeightKg > petWeightMax) {
		return errors.New("Weight must be more than 0 and no more than 200 kg")
	}
	if p.BirthDate != nil {
		raw := strings.TrimSpace(*p.BirthDate)
		if raw == "" {
			p.BirthDate = nil
		} else {
			d, err := time.Parse("2006-01-02", raw)
			if err != nil {
				return errors.New("Date of birth must be a valid date")
			}
			if d.After(time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)) {
				return errors.New("Date of birth cannot be in the future")
			}
			if d.Year() < 1900 {
				return errors.New("Date of birth is too far in the past")
			}
			norm := d.Format("2006-01-02")
			p.BirthDate = &norm
		}
	}
	return nil
}

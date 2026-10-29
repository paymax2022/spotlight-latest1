package provider

import (
	"fmt"
	"strings"
	"time"
	"unicode"
)

// Wire shapes — camelCase, exactly the types in
// mobile-app/reactnative/src/features/health/vet/types.ts.

type wireCredential struct {
	Authority string `json:"authority"`
	LicenseNo string `json:"licenseNo"`
	Status    string `json:"status"` // verified | pending | expired
	ExpiresAt string `json:"expiresAt,omitempty"`
}

type wireProfile struct {
	Status           string         `json:"status"` // draft | submitted | under_review | needs_info | approved
	ApplicationID    string         `json:"applicationId,omitempty"`
	DisplayName      string         `json:"displayName"`
	VcnLicenseNo     string         `json:"vcnLicenseNo"`
	ClinicName       string         `json:"clinicName"`
	Bio              string         `json:"bio"`
	ConsultFeeKobo   int64          `json:"consultFeeKobo"`
	HomeVisitFeeKobo int64          `json:"homeVisitFeeKobo"`
	Types            []string       `json:"types"`
	Species          []string       `json:"species"`
	Credential       wireCredential `json:"credential"`
	// Clinic location: address parts live in the profile draft (what the public
	// listing reads); the map point is health_providers.geo (null until set).
	ClinicAddress string   `json:"clinicAddress"`
	ClinicCity    string   `json:"clinicCity"`
	ClinicState   string   `json:"clinicState"`
	ClinicLat     *float64 `json:"clinicLat"`
	ClinicLng     *float64 `json:"clinicLng"`
}

type wireApptRow struct {
	AppointmentID string `json:"appointmentId"`
	OwnerName     string `json:"ownerName"`
	PetName       string `json:"petName"`
	Species       string `json:"species"`
	Type          string `json:"type"`
	Status        string `json:"status"`
	ScheduledFor  string `json:"scheduledFor"`
	Reason        string `json:"reason"`
}

type wirePet struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Species     string   `json:"species"`
	Breed       string   `json:"breed"`
	Sex         string   `json:"sex"`
	Dob         string   `json:"dob,omitempty"`
	AgeLabel    string   `json:"ageLabel"`
	WeightKg    *float64 `json:"weightKg,omitempty"`
	AvatarColor string   `json:"avatarColor"`
	Notes       string   `json:"notes,omitempty"`
}

type wireVaccination struct {
	ID          string `json:"id"`
	PetID       string `json:"petId"`
	Vaccine     string `json:"vaccine"`
	Status      string `json:"status"` // up_to_date | due_soon | overdue | scheduled
	LastGivenAt string `json:"lastGivenAt,omitempty"`
	DueAt       string `json:"dueAt"`
	Notes       string `json:"notes,omitempty"`
}

type wireRecord struct {
	ID           string `json:"id"`
	PetID        string `json:"petId"`
	Kind         string `json:"kind"`
	Title        string `json:"title"`
	Summary      string `json:"summary"`
	At           string `json:"at"`
	ProviderName string `json:"providerName,omitempty"`
	Sensitive    bool   `json:"sensitive,omitempty"`
}

type wireWeightPoint struct {
	At string  `json:"at"`
	Kg float64 `json:"kg"`
}

type wireChart struct {
	Pet          wirePet           `json:"pet"`
	OwnerName    string            `json:"ownerName"`
	Vaccinations []wireVaccination `json:"vaccinations"`
	Records      []wireRecord      `json:"records"`
	WeightSeries []wireWeightPoint `json:"weightSeries"`
}

type wireRxItem struct {
	ID           string `json:"id"`
	DrugName     string `json:"drugName"`
	Form         string `json:"form"`
	Dosage       string `json:"dosage"`
	Frequency    string `json:"frequency"`
	DurationDays int    `json:"durationDays"`
	Quantity     int    `json:"quantity"`
	POM          bool   `json:"pom"`
	Instructions string `json:"instructions,omitempty"`
}

type wireRx struct {
	ID            string         `json:"id"`
	AppointmentID string         `json:"appointmentId,omitempty"`
	PetID         string         `json:"petId"`
	PetName       string         `json:"petName"`
	VetID         string         `json:"vetId"`
	VetName       string         `json:"vetName"`
	VetCredential wireCredential `json:"vetCredential"`
	Status        string         `json:"status"`
	IssuedAt      string         `json:"issuedAt"`
	ExpiresAt     string         `json:"expiresAt"`
	Items         []wireRxItem   `json:"items"`
	Notes         string         `json:"notes,omitempty"`
	Sensitive     bool           `json:"sensitive"`
}

type wireEarnings struct {
	AvailableKobo int64        `json:"availableKobo"`
	PendingKobo   int64        `json:"pendingKobo"`
	HeldKobo      int64        `json:"heldKobo"`
	Payouts       []wirePayout `json:"payouts"`
}

type wirePayout struct {
	ID         string `json:"id"`
	AmountKobo int64  `json:"amountKobo"`
	At         string `json:"at"`
	Status     string `json:"status"` // paid | processing
}

type wireReview struct {
	ID     string `json:"id"`
	Author string `json:"author"`
	Rating int    `json:"rating"`
	Body   string `json:"body"`
	At     string `json:"at"`
}

type wireNav struct {
	AppointmentID string  `json:"appointmentId"`
	OwnerName     string  `json:"ownerName"`
	PetName       string  `json:"petName"`
	Address       string  `json:"address"`
	DestLat       float64 `json:"destLat"`
	DestLng       float64 `json:"destLng"`
	VetLat        float64 `json:"vetLat"`
	VetLng        float64 `json:"vetLng"`
	EtaLabel      string  `json:"etaLabel"`
	DistanceLabel string  `json:"distanceLabel"`
	Phone         string  `json:"phone"`
}

// speciesToWire folds the stored upper-case code into the app's lower-case set.
func speciesToWire(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "dog", "cat", "bird", "rabbit", "reptile":
		return strings.ToLower(strings.TrimSpace(s))
	}
	return "other"
}

func sexToWire(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "male":
		return "male"
	case "female":
		return "female"
	}
	return "unknown"
}

// shortName renders "Chioma Eze" as "Chioma E." — the vet needs a human to
// address, not the owner's full legal name.
func shortName(full, fallback string) string {
	parts := strings.Fields(full)
	switch len(parts) {
	case 0:
		return fallback
	case 1:
		return parts[0]
	}
	last := []rune(parts[len(parts)-1])
	if len(last) == 0 || !unicode.IsLetter(last[0]) {
		return parts[0]
	}
	return fmt.Sprintf("%s %c.", parts[0], unicode.ToUpper(last[0]))
}

func ageLabel(dob *time.Time, now time.Time) string {
	if dob == nil {
		return "Unknown age"
	}
	years := now.Sub(*dob).Hours() / (24 * 365)
	if years < 1 {
		m := int(years*12 + 0.5)
		if m < 1 {
			m = 1
		}
		return fmt.Sprintf("%d mos", m)
	}
	y := int(years)
	if y == 1 {
		return "1 yr"
	}
	return fmt.Sprintf("%d yrs", y)
}

var petColors = []string{"rgba(0, 81, 213, 0.08)", "rgba(52, 0, 117, 0.08)", "rgba(72, 184, 172, 0.10)", "rgba(234, 179, 8, 0.12)"}

// petColor is stable per pet so the avatar does not change colour between loads.
func petColor(id string) string {
	sum := 0
	for _, r := range id {
		sum += int(r)
	}
	return petColors[sum%len(petColors)]
}

func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func lowerAll(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		out = append(out, strings.ToLower(s))
	}
	return out
}

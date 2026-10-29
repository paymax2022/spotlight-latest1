// Package owner serves the pet-owner side of the Veterinary API in exactly the
// wire shape the mobile app (mobile-app/reactnative/src/features/health/vet) reads:
// camelCase JSON, lower-case enums, bare arrays for list endpoints.
//
// Everything is read from / written to Postgres. The money legs (booking hold,
// cancel refund) are NOT reimplemented here: the appointment adapters call the
// existing healthvet.Service, which owns the escrow rail, and only reshape the
// request and response.
package owner

import (
	"strings"
	"time"
)

// ---- wire types (mirror mobile-app/.../vet/types.ts) ----

type wireCredential struct {
	Authority string `json:"authority"`
	LicenseNo string `json:"licenseNo"`
	Status    string `json:"status"`
}

type wireAppointment struct {
	ID               string  `json:"id"`
	PetID            string  `json:"petId"`
	PetName          string  `json:"petName"`
	VetID            string  `json:"vetId"`
	VetName          string  `json:"vetName"`
	Type             string  `json:"type"`
	Status           string  `json:"status"`
	ScheduledFor     string  `json:"scheduledFor"`
	Reason           string  `json:"reason"`
	FeeKobo          int64   `json:"feeKobo"`
	HomeVisitFeeKobo int64   `json:"homeVisitFeeKobo"`
	TotalKobo        int64   `json:"totalKobo"`
	PaymentHeld      bool    `json:"paymentHeld"`
	CreatedAt        string  `json:"createdAt"`
	Location         *string `json:"location,omitempty"`
	ConsultID        *string `json:"consultId,omitempty"`
	SummaryID        *string `json:"summaryId,omitempty"`
	PrescriptionID   *string `json:"prescriptionId,omitempty"`
}

type wireRecord struct {
	ID           string  `json:"id"`
	PetID        string  `json:"petId"`
	Kind         string  `json:"kind"`
	Title        string  `json:"title"`
	Summary      string  `json:"summary"`
	At           string  `json:"at"`
	ProviderName *string `json:"providerName,omitempty"`
	Sensitive    bool    `json:"sensitive"`
	Flagged      bool    `json:"flagged"`
}

type wireVaccination struct {
	ID          string  `json:"id"`
	PetID       string  `json:"petId"`
	Vaccine     string  `json:"vaccine"`
	Status      string  `json:"status"`
	LastGivenAt *string `json:"lastGivenAt,omitempty"`
	DueAt       string  `json:"dueAt"`
	Notes       *string `json:"notes,omitempty"`
}

type wireReview struct {
	ID     string `json:"id"`
	Author string `json:"author"`
	Rating int    `json:"rating"`
	Body   string `json:"body"`
	At     string `json:"at"`
}

type wireConsultMessage struct {
	ID           string `json:"id"`
	AuthorName   string `json:"authorName"`
	FromProvider bool   `json:"fromProvider"`
	Body         string `json:"body"`
	SentAt       string `json:"sentAt"`
}

type wireConsult struct {
	ID            string               `json:"id"`
	AppointmentID string               `json:"appointmentId"`
	VetID         string               `json:"vetId"`
	VetName       string               `json:"vetName"`
	PetID         string               `json:"petId"`
	PetName       string               `json:"petName"`
	Mode          string               `json:"mode"`
	Status        string               `json:"status"`
	ScheduledAt   string               `json:"scheduledAt"`
	ProviderReady bool                 `json:"providerReady"`
	Messages      []wireConsultMessage `json:"messages"`
}

type wireSoap struct {
	Subjective string `json:"subjective"`
	Objective  string `json:"objective"`
	Assessment string `json:"assessment"`
	Plan       string `json:"plan"`
}

type wireSummary struct {
	ID                  string   `json:"id"`
	AppointmentID       string   `json:"appointmentId"`
	PetID               string   `json:"petId"`
	PetName             string   `json:"petName"`
	VetID               string   `json:"vetId"`
	VetName             string   `json:"vetName"`
	CompletedAt         string   `json:"completedAt"`
	Soap                wireSoap `json:"soap"`
	Diagnosis           string   `json:"diagnosis"`
	FollowUpRecommended bool     `json:"followUpRecommended"`
	FollowUpNote        *string  `json:"followUpNote,omitempty"`
	PrescriptionID      *string  `json:"prescriptionId,omitempty"`
	LabOrderID          *string  `json:"labOrderId,omitempty"`
}

type wireRxItem struct {
	ID           string  `json:"id"`
	DrugName     string  `json:"drugName"`
	Form         string  `json:"form"`
	Dosage       string  `json:"dosage"`
	Frequency    string  `json:"frequency"`
	DurationDays int     `json:"durationDays"`
	Quantity     int     `json:"quantity"`
	POM          bool    `json:"pom"`
	Instructions *string `json:"instructions,omitempty"`
}

type wirePrescription struct {
	ID            string         `json:"id"`
	AppointmentID *string        `json:"appointmentId,omitempty"`
	PetID         string         `json:"petId"`
	PetName       string         `json:"petName"`
	VetID         string         `json:"vetId"`
	VetName       string         `json:"vetName"`
	VetCredential wireCredential `json:"vetCredential"`
	Status        string         `json:"status"`
	IssuedAt      string         `json:"issuedAt"`
	ExpiresAt     string         `json:"expiresAt"`
	Items         []wireRxItem   `json:"items"`
	Notes         *string        `json:"notes,omitempty"`
	Sensitive     bool           `json:"sensitive"`
}

type wireMedication struct {
	ID               string  `json:"id"`
	PetID            string  `json:"petId"`
	PetName          string  `json:"petName"`
	DrugName         string  `json:"drugName"`
	Dosage           string  `json:"dosage"`
	Frequency        string  `json:"frequency"`
	NextRefillAt     string  `json:"nextRefillAt"`
	RefillsRemaining int     `json:"refillsRemaining"`
	PrescriptionID   *string `json:"prescriptionId,omitempty"`
	Active           bool    `json:"active"`
}

type wireTracking struct {
	AppointmentID string  `json:"appointmentId"`
	VetName       string  `json:"vetName"`
	VetPhone      string  `json:"vetPhone"`
	Vehicle       string  `json:"vehicle"`
	Stage         string  `json:"stage"`
	EtaLabel      string  `json:"etaLabel"`
	VetLat        float64 `json:"vetLat"`
	VetLng        float64 `json:"vetLng"`
	DestLat       float64 `json:"destLat"`
	DestLng       float64 `json:"destLng"`
	Address       string  `json:"address"`
}

type wireEmergencyVet struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Address       string  `json:"address"`
	DistanceLabel string  `json:"distanceLabel"`
	Phone         string  `json:"phone"`
	Open24h       bool    `json:"open24h"`
	Lat           float64 `json:"lat"`
	Lng           float64 `json:"lng"`
}

// ---- pure mapping helpers (unit-tested) ----

var visitToWire = map[string]string{"TELE": "tele", "HOME": "home", "CLINIC": "clinic"}
var wireToVisit = map[string]string{"tele": "TELE", "home": "HOME", "clinic": "CLINIC"}

func visitWire(v string) string {
	if w, ok := visitToWire[strings.ToUpper(v)]; ok {
		return w
	}
	return strings.ToLower(v)
}

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// feeSplit splits an appointment total into the consult fee and the home-visit fee
// the app shows. The server prices one service per visit type, so a HOME visit's
// whole price is the home-visit fee and the two always add up to the total.
func feeSplit(visitType string, total int64) (fee, home int64) {
	if strings.EqualFold(visitType, "HOME") {
		return 0, total
	}
	return total, 0
}

// vaccinationStatus derives the app's status from the stored dates.
func vaccinationStatus(now time.Time, dueAt time.Time, administeredAt, scheduledFor *time.Time) (status string, shownDue time.Time) {
	switch {
	case administeredAt != nil:
		return "up_to_date", dueAt
	case scheduledFor != nil:
		return "scheduled", *scheduledFor
	case dueAt.Before(now):
		return "overdue", dueAt
	case dueAt.Before(now.AddDate(0, 0, 30)):
		return "due_soon", dueAt
	default:
		return "up_to_date", dueAt
	}
}

// rxStatus maps the rx engine's states onto the app's four.
func rxStatus(state string, createdAt, now time.Time) string {
	switch state {
	case "ISSUED":
		if now.After(rxExpiry(createdAt)) {
			return "EXPIRED"
		}
		return "ISSUED"
	case "SENT_TO_PHARMACY", "VERIFYING", "VERIFIED":
		return "SENT_TO_PHARMACY"
	case "DISPENSED", "FULFILLED":
		return "DISPENSED"
	default: // REJECTED and anything unknown cannot be dispensed
		return "EXPIRED"
	}
}

// rxExpiry is how long an issued e-prescription stays valid for sending to a pharmacy.
func rxExpiry(issued time.Time) time.Time { return issued.AddDate(0, 0, 30) }

// homeVisitStage maps the appointment state (and whether a dispatch was created)
// onto the tracker's stages.
func homeVisitStage(state string, dispatched bool) string {
	switch state {
	case "IN_PROGRESS":
		return "in_progress"
	case "COMPLETED":
		return "completed"
	case "CONFIRMED", "RESCHEDULED":
		if dispatched {
			return "en_route"
		}
		return "assigned"
	default:
		return "assigned"
	}
}

// consultStatus maps the consult engine's state onto the app's three.
func consultStatus(state string) string {
	switch state {
	case "IN_PROGRESS":
		return "in_progress"
	case "COMPLETED":
		return "completed"
	default:
		return "scheduled"
	}
}

// recordKind maps a health_records.record_type onto the app's record kinds.
func recordKind(recordType string) string {
	t := strings.ToUpper(recordType)
	switch {
	case strings.Contains(t, "WEIGHT"):
		return "weight"
	case strings.Contains(t, "LAB"):
		return "lab_result"
	case strings.Contains(t, "VACC"):
		return "vaccination"
	case strings.Contains(t, "RX") || strings.Contains(t, "PRESC"):
		return "prescription"
	case strings.Contains(t, "NOTE") || strings.Contains(t, "CONSULT"):
		return "consult_note"
	default:
		return "document"
	}
}

// snippet is the one-line summary of a body.
func snippet(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

// normaliseRecordRef turns the client's reference into the stored one: the pet screen
// sends "pet_<uuid>", the e-Rx screen the prescription id.
func normaliseRecordRef(ref string) string {
	return strings.TrimPrefix(strings.TrimSpace(ref), "pet_")
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

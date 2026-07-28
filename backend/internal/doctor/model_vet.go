package doctor

import (
	"encoding/json"
	"time"
)

// model_vet.go — Wave 3b (VETERINARY / PET-side) request & response shapes.
//
// As with model_clinical.go / model_account.go, the OpenAPI (contracts/doctor.openapi.yaml)
// types these endpoints as the free-form `Generic` schema, so request bodies are captured
// as json.RawMessage and merged/stored into the doctor_pet_* JSONB columns, while responses
// mirror the underlying tables (camelCase JSON to match the mobile contracts in
// mobile-app/reactnative/src/types/doctor.phase3.ts / doctor.batch5.ts).
//
// None of these are money movements — they are clinical / document writes for the vet's
// pet patients. Monetary columns (price_kobo / total_kobo) surface as int64 kobo only
// (no floats, no stored balances). All reads are scoped to the authenticated vet's user_id;
// child rows are joined through a pet (doctor_pets) that the vet owns.

// ── Vet profile ──────────────────────────────────────────────────────────────

// VetProfile mirrors public.doctor_vet_profiles.
type VetProfile struct {
	ID             string          `json:"id"`
	UserID         string          `json:"userId"`
	VetModeEnabled bool            `json:"vetModeEnabled"`
	LicenceNumber  *string         `json:"licenceNumber,omitempty"`
	Verification   string          `json:"verification"`
	IsPublished    bool            `json:"isPublished"`
	ProfileDraft   json.RawMessage `json:"profileDraft,omitempty"`
	Detail         json.RawMessage `json:"detail,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

// VetDashboard is the composite projection for GET /vet/dashboard.
type VetDashboard struct {
	Vet  *VetProfile `json:"vet"`
	Pets []Pet       `json:"pets"`
}

// ── Pet ──────────────────────────────────────────────────────────────────────

// Pet mirrors public.doctor_pets.
type Pet struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	OwnerRef      *string         `json:"ownerRef,omitempty"`
	Name          *string         `json:"name,omitempty"`
	Species       *string         `json:"species,omitempty"`
	Breed         *string         `json:"breed,omitempty"`
	Profile       json.RawMessage `json:"profile,omitempty"`
	GrowthHistory json.RawMessage `json:"growthHistory,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// PetHealthRecord is the composite read for GET /vet/pets/{petId}/health-record.
type PetHealthRecord struct {
	Pet           *Pet              `json:"pet"`
	Vaccinations  []PetVaccination  `json:"vaccinations"`
	Prescriptions []PetPrescription `json:"prescriptions"`
	LabOrders     []PetLabOrder     `json:"labOrders"`
}

// PetGrowth is the projection for GET /vet/pets/{petId}/growth.
type PetGrowth struct {
	PetID         string          `json:"petId"`
	GrowthHistory json.RawMessage `json:"growthHistory"`
}

// ── Pet vaccinations ─────────────────────────────────────────────────────────

// PetVaccination mirrors public.doctor_pet_vaccinations.
type PetVaccination struct {
	ID             string          `json:"id"`
	PetID          string          `json:"petId"`
	UserID         string          `json:"userId"`
	Vaccine        *string         `json:"vaccine,omitempty"`
	DueAt          *time.Time      `json:"dueAt,omitempty"`
	AdministeredAt *time.Time      `json:"administeredAt,omitempty"`
	ReminderSet    bool            `json:"reminderSet"`
	Detail         json.RawMessage `json:"detail,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
}

// ── Pet prescriptions ────────────────────────────────────────────────────────

// PetPrescription mirrors public.doctor_pet_prescriptions.
type PetPrescription struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	PetID     *string         `json:"petId,omitempty"`
	Ref       *string         `json:"ref,omitempty"`
	Status    string          `json:"status"` // draft|issued|dispensed|cancelled
	Items     json.RawMessage `json:"items,omitempty"`
	IssuedAt  *time.Time      `json:"issuedAt,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// ── Pet lab orders / results ─────────────────────────────────────────────────

// PetLabOrder mirrors public.doctor_pet_lab_orders.
type PetLabOrder struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	PetID     *string         `json:"petId,omitempty"`
	Ref       *string         `json:"ref,omitempty"`
	Status    string          `json:"status"`
	Tests     json.RawMessage `json:"tests,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// PetLabResult mirrors public.doctor_pet_lab_results.
type PetLabResult struct {
	ID             string          `json:"id"`
	UserID         string          `json:"userId"`
	OrderID        *string         `json:"orderId,omitempty"`
	Reviewed       bool            `json:"reviewed"`
	ReviewedAt     *time.Time      `json:"reviewedAt,omitempty"`
	Values         json.RawMessage `json:"values,omitempty"`
	Interpretation *string         `json:"interpretation,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

// ── Pet store ────────────────────────────────────────────────────────────────

// PetProduct mirrors public.doctor_pet_products.
type PetProduct struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	Name      *string         `json:"name,omitempty"`
	Category  *string         `json:"category,omitempty"`
	PriceKobo int64           `json:"priceKobo"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
}

// PetRecommendation mirrors public.doctor_pet_recommendations.
type PetRecommendation struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	PetID     *string         `json:"petId,omitempty"`
	ProductID *string         `json:"productId,omitempty"`
	Status    string          `json:"status"` // recommended|shared
	SharedAt  *time.Time      `json:"sharedAt,omitempty"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
}

// PetFulfilment mirrors public.doctor_pet_fulfilments.
type PetFulfilment struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	ProductID *string         `json:"productId,omitempty"`
	PetID     *string         `json:"petId,omitempty"`
	Status    string          `json:"status"`
	TotalKobo int64           `json:"totalKobo"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

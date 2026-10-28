package prescriptions

import "time"

const (
	sourceDoctor       = "doctor"
	sourceTelemedicine = "telemedicine"

	actionFlag   = "admin_flagged"
	actionUnflag = "admin_unflagged"

	defaultLimit = 20
	maxLimit     = 200
	maxQueryLen  = 100
)

// Summary is the KPI strip.
type Summary struct {
	Issued30d            int `json:"issued_30d"`
	PendingFulfilment    int `json:"pending_fulfilment"`
	Flagged              int `json:"flagged"`
	RefillsPending       int `json:"refills_pending"`
	SubstitutionsPending int `json:"substitutions_pending"`
}

// ListQuery is the validated filter set for the prescription list.
type ListQuery struct {
	Status   string `form:"status"`
	DoctorID string `form:"doctor_id"`
	From     string `form:"from"`
	To       string `form:"to"`
	Flagged  *bool  `form:"flagged"`
	Q        string `form:"q"`
	Limit    int    `form:"limit"`
	Offset   int    `form:"offset"`
}

// PageQuery is the filter set for the fulfilment and refill queues.
type PageQuery struct {
	Status string `form:"status"`
	Limit  int    `form:"limit"`
	Offset int    `form:"offset"`
}

// PrescriptionRow is one row of the list. The patient is masked.
type PrescriptionRow struct {
	ID            string     `json:"id"`
	Source        string     `json:"source"`
	Ref           string     `json:"ref"`
	DoctorID      string     `json:"doctor_id"`
	DoctorName    string     `json:"doctor_name"`
	PatientMasked string     `json:"patient_masked"`
	Diagnosis     string     `json:"diagnosis"`
	Status        string     `json:"status"`
	ItemCount     int        `json:"item_count"`
	Flagged       bool       `json:"flagged"`
	IssuedAt      *time.Time `json:"issued_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

type FulfilmentRow struct {
	ID                   string    `json:"id"`
	PrescriptionID       *string   `json:"prescription_id"`
	PrescriptionRef      string    `json:"prescription_ref"`
	PharmacyName         string    `json:"pharmacy_name"`
	Status               string    `json:"status"`
	TotalKobo            int64     `json:"total_kobo"`
	PendingSubstitutions int       `json:"pending_substitutions"`
	DeliveryStatus       string    `json:"delivery_status"`
	CreatedAt            time.Time `json:"created_at"`
}

type RefillRow struct {
	ID              string     `json:"id"`
	PrescriptionID  *string    `json:"prescription_id"`
	PrescriptionRef string     `json:"prescription_ref"`
	DoctorName      string     `json:"doctor_name"`
	PatientMasked   string     `json:"patient_masked"`
	Status          string     `json:"status"`
	CreatedAt       time.Time  `json:"created_at"`
	ReviewedAt      *time.Time `json:"reviewed_at"`
}

type Item struct {
	Name      string `json:"name"`
	Dosage    string `json:"dosage"`
	Route     string `json:"route"`
	Frequency string `json:"frequency"`
	Duration  string `json:"duration"`
	Notes     string `json:"notes"`
}

type AuditEntry struct {
	Action     string         `json:"action"`
	Actor      string         `json:"actor"`
	PrevStatus string         `json:"prev_status"`
	NewStatus  string         `json:"new_status"`
	Detail     map[string]any `json:"detail"`
	CreatedAt  time.Time      `json:"created_at"`
}

type Delivery struct {
	Status      string     `json:"status"`
	Courier     string     `json:"courier"`
	TrackingRef string     `json:"tracking_ref"`
	ETA         *time.Time `json:"eta"`
	DeliveredAt *time.Time `json:"delivered_at"`
}

type Substitute struct {
	OriginalDrug   string `json:"original_drug"`
	SubstituteDrug string `json:"substitute_drug"`
	Status         string `json:"status"`
	PriceKobo      int64  `json:"price_kobo"`
}

type FulfilmentDetail struct {
	ID           string       `json:"id"`
	PharmacyName string       `json:"pharmacy_name"`
	Status       string       `json:"status"`
	TotalKobo    int64        `json:"total_kobo"`
	Deliveries   []Delivery   `json:"deliveries"`
	Substitutes  []Substitute `json:"substitutes"`
}

type RefillDetail struct {
	ID         string     `json:"id"`
	Status     string     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	ReviewedAt *time.Time `json:"reviewed_at"`
}

// Detail is the unmasked single-prescription view.
type Detail struct {
	PrescriptionRow
	PatientID       string             `json:"patient_id"`
	Patient         map[string]any     `json:"patient"`
	MedicationsText string             `json:"medications_text,omitempty"`
	Instructions    string             `json:"instructions,omitempty"`
	Items           []Item             `json:"items"`
	Audit           []AuditEntry       `json:"audit"`
	Fulfilments     []FulfilmentDetail `json:"fulfilments"`
	Refills         []RefillDetail     `json:"refills"`
}

type FlagState struct {
	ID      string `json:"id"`
	Flagged bool   `json:"flagged"`
}

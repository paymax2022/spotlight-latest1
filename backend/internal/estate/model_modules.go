package estate

import (
	"errors"
	"time"
)

// ── Money-path sentinel errors (Block 29) ────────────────────────────────────

// ErrIdempotencyRequired is returned when a money mutation is attempted without
// an Idempotency-Key (iron rule: money mutations fail closed without one).
var ErrIdempotencyRequired = errors.New("estate: Idempotency-Key required")

// ErrLedgerUnavailable is returned when a money-path method is called on a
// Service that was not wired with a ledger (defence-in-depth).
var ErrLedgerUnavailable = errors.New("estate: ledger not configured")

// ErrDocumentNotFound is returned when a document does not exist in the estate.
var ErrDocumentNotFound = errors.New("estate: document not found in this estate")

// ErrDocumentForbidden is returned when the caller may not access a (restricted)
// document.
var ErrDocumentForbidden = errors.New("estate: not authorised to access this document")

// ── Block 29: Dues / Rent / Subscriptions ────────────────────────────────────

// DuesInvoice is a billed obligation against a resident (service charge, rent…).
type DuesInvoice struct {
	ID         string    `json:"id"`
	EstateID   string    `json:"estate_id"`
	PropertyID *string   `json:"property_id,omitempty"`
	ResidentID string    `json:"resident_id"`
	Category   string    `json:"category"`
	AmountKobo int64     `json:"amount_kobo"`
	DueDate    time.Time `json:"due_date"`
	Status     string    `json:"status"` // pending|paid|overdue|waived
	CreatedAt  time.Time `json:"created_at"`
}

// DuesPayment is the immutable receipt for a settled (or attempted) dues payment.
type DuesPayment struct {
	ID         string    `json:"id"`
	EstateID   string    `json:"estate_id"`
	InvoiceID  *string   `json:"invoice_id,omitempty"`
	PayerID    string    `json:"payer_id"`
	AmountKobo int64     `json:"amount_kobo"`
	Method     string    `json:"method"`    // wallet|card|transfer|ussd
	Status     string    `json:"status"`    // pending|successful|failed|refunded
	Reference  string    `json:"reference"` // ledger reference (= receipt id)
	CreatedAt  time.Time `json:"created_at"`
}

// DuesRestriction is a soft/hard service restriction applied to a defaulting
// resident, lifted on payment.
type DuesRestriction struct {
	ID         string     `json:"id"`
	EstateID   string     `json:"estate_id"`
	ResidentID string     `json:"resident_id"`
	InvoiceID  *string    `json:"invoice_id,omitempty"`
	Level      string     `json:"level"` // soft|hard
	Reason     string     `json:"reason,omitempty"`
	Active     bool       `json:"active"`
	LiftedAt   *time.Time `json:"lifted_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// CreateInvoiceRequest is the body for POST /estate/:id/dues/invoices (admin).
type CreateInvoiceRequest struct {
	ResidentID string    `json:"resident_id" binding:"required"`
	PropertyID string    `json:"property_id"`
	Category   string    `json:"category" binding:"required"`
	AmountKobo int64     `json:"amount_kobo" binding:"required,gt=0"`
	DueDate    time.Time `json:"due_date" binding:"required"`
}

// PayDuesRequest is the body for POST /estate/:id/dues/invoices/:invoiceId/pay.
// IdempotencyKey is populated from the Idempotency-Key header by the handler.
type PayDuesRequest struct {
	InvoiceID      string `json:"-"`
	IdempotencyKey string `json:"-"`
	Method         string `json:"method"`      // defaults to "wallet"
	AmountKobo     int64  `json:"amount_kobo"` // optional override; 0 => use invoice amount
}

// ApplyRestrictionRequest is the body for POST /estate/:id/dues/restrictions.
type ApplyRestrictionRequest struct {
	ResidentID string `json:"resident_id" binding:"required"`
	InvoiceID  string `json:"invoice_id"`
	Level      string `json:"level" binding:"required,oneof=soft hard"`
	Reason     string `json:"reason"`
}

// ── Block 31: Tasks ──────────────────────────────────────────────────────────

// Task is a committee/operations task within an estate.
type Task struct {
	ID          string     `json:"id"`
	EstateID    string     `json:"estate_id"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	AssigneeID  *string    `json:"assignee_id,omitempty"`
	CreatedBy   string     `json:"created_by"`
	DueDate     *time.Time `json:"due_date,omitempty"`
	Priority    string     `json:"priority"` // low|medium|high
	Status      string     `json:"status"`   // todo|in_progress|done
	CreatedAt   time.Time  `json:"created_at"`
}

// CreateTaskRequest is the body for POST /estate/:id/tasks.
type CreateTaskRequest struct {
	Title       string     `json:"title" binding:"required,min=2,max=200"`
	Description string     `json:"description"`
	AssigneeID  string     `json:"assignee_id"`
	DueDate     *time.Time `json:"due_date"`
	Priority    string     `json:"priority"`
}

// UpdateTaskStatusRequest is the body for PATCH /estate/:id/tasks/:taskId/status.
type UpdateTaskStatusRequest struct {
	Status string `json:"status" binding:"required,oneof=todo in_progress done"`
}

// ── Block 32: Maintenance / Repairs ──────────────────────────────────────────

// RepairRequest is a maintenance ticket raised by a resident.
type RepairRequest struct {
	ID               string  `json:"id"`
	EstateID         string  `json:"estate_id"`
	PropertyID       *string `json:"property_id,omitempty"`
	ReporterID       string  `json:"reporter_id"`
	Category         string  `json:"category"`
	Description      string  `json:"description"`
	Urgency          string  `json:"urgency"`
	Status           string  `json:"status"`
	VendorID         *string `json:"vendor_id,omitempty"`
	CostEstimateKobo *int64  `json:"cost_estimate_kobo,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

// RepairUpdate is a status/note appended to a repair request.
type RepairUpdate struct {
	ID        string    `json:"id"`
	RequestID string    `json:"request_id"`
	Status    string    `json:"status"`
	Note      string    `json:"note,omitempty"`
	ByUser    *string   `json:"by_user,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// CreateRepairRequest is the body for POST /estate/:id/repairs.
type CreateRepairRequest struct {
	PropertyID  string `json:"property_id"`
	Category    string `json:"category" binding:"required"`
	Description string `json:"description" binding:"required,min=5"`
	Urgency     string `json:"urgency"`
}

// AddRepairUpdateRequest is the body for POST /estate/:id/repairs/:repairId/updates.
type AddRepairUpdateRequest struct {
	Status string `json:"status" binding:"required"`
	Note   string `json:"note"`
}

// ── Block 33: Facilities / Amenities ─────────────────────────────────────────

// Facility is a bookable amenity (hall, pool, court…).
type Facility struct {
	ID        string    `json:"id"`
	EstateID  string    `json:"estate_id"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Capacity  *int      `json:"capacity,omitempty"`
	FeeKobo   int64     `json:"fee_kobo"`
	CreatedAt time.Time `json:"created_at"`
}

// FacilityBooking is a reservation of a facility for a time window.
type FacilityBooking struct {
	ID         string    `json:"id"`
	EstateID   string    `json:"estate_id"`
	FacilityID string    `json:"facility_id"`
	ResidentID string    `json:"resident_id"`
	StartsAt   time.Time `json:"starts_at"`
	EndsAt     time.Time `json:"ends_at"`
	Status     string    `json:"status"`
	AmountKobo int64     `json:"amount_kobo"`
	CreatedAt  time.Time `json:"created_at"`
}

// CreateFacilityRequest is the body for POST /estate/:id/facilities (admin).
type CreateFacilityRequest struct {
	Name     string `json:"name" binding:"required,min=2,max=200"`
	Kind     string `json:"kind"`
	Capacity *int   `json:"capacity"`
	FeeKobo  int64  `json:"fee_kobo"`
}

// BookFacilityRequest is the body for POST /estate/:id/facilities/:facilityId/book.
type BookFacilityRequest struct {
	StartsAt time.Time `json:"starts_at" binding:"required"`
	EndsAt   time.Time `json:"ends_at" binding:"required"`
}

// ── Block 34: Announcements / Communication ──────────────────────────────────

// Announcement is a community notice posted by an estate admin.
type Announcement struct {
	ID        string    `json:"id"`
	EstateID  string    `json:"estate_id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Kind      string    `json:"kind"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	Read      bool      `json:"read"` // for the calling resident
}

// CreateAnnouncementRequest is the body for POST /estate/:id/announcements (admin).
type CreateAnnouncementRequest struct {
	Title string `json:"title" binding:"required,min=2,max=200"`
	Body  string `json:"body" binding:"required,min=1"`
	Kind  string `json:"kind"`
}

// ── Block 35: Emergencies / Incidents ────────────────────────────────────────

// EmergencyAlert is a panic/emergency raised by a resident.
type EmergencyAlert struct {
	ID          string    `json:"id"`
	EstateID    string    `json:"estate_id"`
	ReporterID  string    `json:"reporter_id"`
	Kind        string    `json:"kind"`
	Description string    `json:"description,omitempty"`
	Location    string    `json:"location,omitempty"`
	Status      string    `json:"status"` // open|responding|resolved
	CreatedAt   time.Time `json:"created_at"`
}

// RaiseEmergencyRequest is the body for POST /estate/:id/emergencies.
type RaiseEmergencyRequest struct {
	Kind        string `json:"kind" binding:"required,oneof=panic medical fire security noise theft domestic other"`
	Description string `json:"description"`
	Location    string `json:"location"`
}

// UpdateEmergencyStatusRequest is the body for PATCH .../emergencies/:id/status.
type UpdateEmergencyStatusRequest struct {
	Status string `json:"status" binding:"required,oneof=open responding resolved"`
}

// ── Block 36: Documents ──────────────────────────────────────────────────────

// Document is an estate document record (file lives in R2 behind a signed URL).
type Document struct {
	ID         string    `json:"id"`
	EstateID   string    `json:"estate_id"`
	Title      string    `json:"title"`
	Category   string    `json:"category"`
	FileURL    string    `json:"file_url"`
	ObjectKey  string    `json:"object_key,omitempty"` // server-controlled R2 key (presigned downloads)
	UploadedBy string    `json:"uploaded_by"`
	Restricted bool      `json:"restricted"`
	CreatedAt  time.Time `json:"created_at"`
}

// Upload guard rails for presigned R2 uploads (Block 36/37 doc flows).
const MaxDocumentBytes int64 = 25 * 1024 * 1024 // 25 MiB

// AllowedDocumentTypes restricts presigned-upload content types.
var AllowedDocumentTypes = []string{
	"application/pdf",
	"image/png",
	"image/jpeg",
	"image/webp",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

// CreateDocumentRequest is the body for POST /estate/:id/documents (admin).
// file_url is the R2 object URL produced by a prior presigned-upload step.
type CreateDocumentRequest struct {
	Title       string `json:"title" binding:"required,min=2,max=200"`
	Category    string `json:"category"`
	FileURL     string `json:"file_url" binding:"required,url"`
	ObjectKey   string `json:"object_key"` // optional: server-chosen R2 key from the presign step (enables presigned GET downloads)
	Restricted  bool   `json:"restricted"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
}

// ── Block 37: Vendors / Artisans ─────────────────────────────────────────────

// Vendor is a registered artisan/service provider for an estate.
type Vendor struct {
	ID        string    `json:"id"`
	EstateID  string    `json:"estate_id"`
	UserID    *string   `json:"user_id,omitempty"`
	Name      string    `json:"name"`
	Category  string    `json:"category"`
	Phone     string    `json:"phone,omitempty"`
	Status    string    `json:"status"` // pending|verified|suspended
	Rating    float64   `json:"rating"`
	CreatedAt time.Time `json:"created_at"`
}

// CreateVendorRequest is the body for POST /estate/:id/vendors (admin).
type CreateVendorRequest struct {
	Name     string `json:"name" binding:"required,min=2,max=200"`
	Category string `json:"category"`
	Phone    string `json:"phone"`
	UserID   string `json:"user_id"`
}

// ── Block 40/43/44: aggregate / cross-cut payloads ───────────────────────────

// FinanceDashboard (Block 40) is the estate operator's money summary.
type FinanceDashboard struct {
	EstateID            string `json:"estate_id"`
	TotalCollectedKobo  int64  `json:"total_collected_kobo"`
	OutstandingDuesKobo int64  `json:"outstanding_dues_kobo"`
	PendingInvoices     int    `json:"pending_invoices"`
	OverdueInvoices     int    `json:"overdue_invoices"`
	PaymentsThisMonth   int    `json:"payments_this_month"`
	ActiveRestrictions  int    `json:"active_restrictions"`
}

// Notification (Block 43) is a unified feed item for a resident.
type Notification struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`  // announcement|emergency|dues|repair
	Title     string    `json:"title"`
	Body      string    `json:"body,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// EstateReport (Block 44) is a derived analytics snapshot.
type EstateReport struct {
	EstateID         string `json:"estate_id"`
	Residents        int    `json:"residents"`
	OpenRepairs      int    `json:"open_repairs"`
	OpenEmergencies  int    `json:"open_emergencies"`
	Announcements30d int    `json:"announcements_30d"`
	FacilitiesCount  int    `json:"facilities_count"`
	VendorsVerified  int    `json:"vendors_verified"`
}

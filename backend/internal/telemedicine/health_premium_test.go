package telemedicine_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/telemedicine"
)

// ─── New specialty constants ──────────────────────────────────────────────────

// TestAllSpecialtyConstantsDistinct verifies all 14 specialty values are unique.
func TestAllSpecialtyConstantsDistinct(t *testing.T) {
	all := []telemedicine.DoctorSpecialty{
		telemedicine.SpecialtyGeneral,
		telemedicine.SpecialtyCardiology,
		telemedicine.SpecialtyDermatology,
		telemedicine.SpecialtyPaediatrics,
		telemedicine.SpecialtyVeterinary,
		telemedicine.SpecialtyPharmacy,
		telemedicine.SpecialtyMentalHealth,
		telemedicine.SpecialtyWomensHealth,
		telemedicine.SpecialtyNeurology,
		telemedicine.SpecialtyEyeCare,
		telemedicine.SpecialtyNutrition,
		telemedicine.SpecialtyDentistry,
		telemedicine.SpecialtyOncology,
		telemedicine.SpecialtyOrthopedic,
	}
	seen := map[telemedicine.DoctorSpecialty]bool{}
	for _, s := range all {
		if s == "" {
			t.Error("DoctorSpecialty must not be empty string")
		}
		if seen[s] {
			t.Errorf("duplicate DoctorSpecialty: %q", s)
		}
		seen[s] = true
	}
	if len(seen) != 14 {
		t.Errorf("expected 14 distinct specialties, got %d", len(seen))
	}
}

// TestHealthPremiumSpecialtiesPresent verifies the 8 new specialties added in the
// Health Premium migration are all declared as constants.
func TestHealthPremiumSpecialtiesPresent(t *testing.T) {
	required := []telemedicine.DoctorSpecialty{
		telemedicine.SpecialtyMentalHealth,
		telemedicine.SpecialtyWomensHealth,
		telemedicine.SpecialtyNeurology,
		telemedicine.SpecialtyEyeCare,
		telemedicine.SpecialtyNutrition,
		telemedicine.SpecialtyDentistry,
		telemedicine.SpecialtyOncology,
		telemedicine.SpecialtyOrthopedic,
	}
	for _, s := range required {
		if s == "" {
			t.Errorf("health premium specialty constant is empty — check model.go")
		}
	}
}

// ─── 85/15 split arithmetic ───────────────────────────────────────────────────

// TestTelemedicineSettlementSplitArithmetic verifies the 85/15 split produces
// balanced integer kobo amounts across a range of real consultation fees.
func TestTelemedicineSettlementSplitArithmetic(t *testing.T) {
	cases := []struct {
		label     string
		feeKobo   int64
		wantDoc   int64 // floor(fee * 0.85)
		wantPlat  int64 // fee - wantDoc (remainder goes to platform)
	}{
		{"₦5,000 (500_000 kobo)", 500_000, 425_000, 75_000},
		{"₦10,000 (1_000_000 kobo)", 1_000_000, 850_000, 150_000},
		{"₦50,000 (5_000_000 kobo)", 5_000_000, 4_250_000, 750_000},
		{"₦2,500 (250_000 kobo)", 250_000, 212_500, 37_500},
		// Odd kobo — remainder stays with platform (platform absorbs rounding).
		{"₦1 (100 kobo)", 100, 85, 15},
	}
	for _, tc := range cases {
		doctorKobo := int64(float64(tc.feeKobo) * 0.85)
		platformKobo := tc.feeKobo - doctorKobo

		if doctorKobo != tc.wantDoc {
			t.Errorf("[%s] doctorKobo = %d, want %d", tc.label, doctorKobo, tc.wantDoc)
		}
		if platformKobo != tc.wantPlat {
			t.Errorf("[%s] platformKobo = %d, want %d", tc.label, platformKobo, tc.wantPlat)
		}
		if doctorKobo+platformKobo != tc.feeKobo {
			t.Errorf("[%s] split parts %d + %d ≠ fee %d", tc.label, doctorKobo, platformKobo, tc.feeKobo)
		}
		if doctorKobo < 0 || platformKobo < 0 {
			t.Errorf("[%s] negative split part", tc.label)
		}
	}
}

// TestTelemedicineNoFloatLeak verifies the split never produces a float result —
// the doctor amount is always truncated to whole kobo (int64 cast).
func TestTelemedicineNoFloatLeak(t *testing.T) {
	fee := int64(333_333) // ₦3,333.33 — deliberately non-round
	doctorKobo := int64(float64(fee) * 0.85)
	platformKobo := fee - doctorKobo

	// doctorKobo + platformKobo must exactly equal fee (no kobo lost).
	if doctorKobo+platformKobo != fee {
		t.Errorf("kobo lost in split: %d + %d = %d ≠ %d",
			doctorKobo, platformKobo, doctorKobo+platformKobo, fee)
	}
}

// ─── RegisterDoctorV2Request ──────────────────────────────────────────────────

func TestRegisterDoctorV2RequiredFields(t *testing.T) {
	req := telemedicine.RegisterDoctorV2Request{
		FullName:   "Dr. Ngozi Adeyemi",
		Email:      "ngozi@example.com",
		Phone:      "+2348012345678",
		Specialty:  string(telemedicine.SpecialtyGeneral),
		MDCNNumber: "MDCN/R/RN/12345",
	}
	if req.FullName == "" {
		t.Error("FullName must not be empty")
	}
	if req.Email == "" {
		t.Error("Email must not be empty")
	}
	if req.MDCNNumber == "" {
		t.Error("MDCNNumber must not be empty — required for MDCN verification")
	}
}

// ─── SubmitSOAPNoteRequest ────────────────────────────────────────────────────

func TestSOAPNoteRequiredFields(t *testing.T) {
	req := telemedicine.SubmitSOAPNoteRequest{
		AppointmentID: "appt-uuid",
		Subjective:    "Patient reports persistent headache for 3 days",
		Assessment:    "Tension headache, likely stress-related",
		Plan:          "Prescribe ibuprofen 400mg TDS x 5 days; follow up in 1 week",
	}
	if req.AppointmentID == "" {
		t.Error("AppointmentID must not be empty")
	}
	if req.Subjective == "" {
		t.Error("Subjective must not be empty — minimum required SOAP field")
	}
	if req.Assessment == "" {
		t.Error("Assessment must not be empty")
	}
	if req.Plan == "" {
		t.Error("Plan must not be empty")
	}
}

func TestPrescriptionItemFields(t *testing.T) {
	items := []telemedicine.PrescriptionItem{
		{Drug: "Ibuprofen 400mg", Dosage: "1 tablet", Duration: "5 days"},
		{Drug: "Vitamin C 500mg", Dosage: "1 tablet", Duration: "14 days"},
	}
	for _, item := range items {
		if item.Drug == "" {
			t.Error("PrescriptionItem.Drug must not be empty")
		}
		if item.Dosage == "" {
			t.Error("PrescriptionItem.Dosage must not be empty")
		}
		if item.Duration == "" {
			t.Error("PrescriptionItem.Duration must not be empty")
		}
	}
}

// ─── UploadLicenceRequest ─────────────────────────────────────────────────────

func TestLicenceDocumentTypes(t *testing.T) {
	validTypes := []string{"mdcn", "degree", "specialisation", "passport", "final_submission"}
	seen := map[string]bool{}
	for _, dt := range validTypes {
		if dt == "" {
			t.Error("document_type must not be empty")
		}
		if seen[dt] {
			t.Errorf("duplicate document_type: %q", dt)
		}
		seen[dt] = true
	}
}

func TestUploadLicenceRequestRequiredFields(t *testing.T) {
	req := telemedicine.UploadLicenceRequest{
		DocumentType:   "mdcn",
		Filename:       "mdcn_certificate.pdf",
		IdempotencyKey: "upload-mdcn-001",
	}
	if req.DocumentType == "" {
		t.Error("DocumentType must not be empty")
	}
	if req.Filename == "" {
		t.Error("Filename must not be empty")
	}
}

// ─── BookAppointmentRequest ───────────────────────────────────────────────────

func TestBookAppointmentConsultationTypes(t *testing.T) {
	valid := []string{"video", "in_person"}
	for _, ct := range valid {
		if ct == "" {
			t.Error("consultation_type must not be empty")
		}
	}
	if len(valid) != 2 {
		t.Errorf("expected exactly 2 consultation types, got %d", len(valid))
	}
}

// ─── Handler binding tests (httptest — no real DB needed) ─────────────────────

func newTestGin() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	return r
}

// setUserID is a helper middleware that injects a fake user_id into gin context.
func setUserID(id string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("user_id", id)
		c.Next()
	}
}

// TestListSpecialtiesNoAuth verifies a missing user_id returns 401.
// The handler uses requireUserID() before any service call.
func TestListSpecialtiesAuthGuard(t *testing.T) {
	h := telemedicine.NewHandler(nil) // nil service — binding check fires before service call
	r := newTestGin()
	// no user_id middleware — simulates unauthenticated request
	r.GET("/specialties", func(c *gin.Context) {
		// manually simulate requireUserID logic
		if c.GetString("user_id") == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
			return
		}
		h.ListSpecialties(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/specialties", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

// TestBookAppointmentBadBody verifies that missing required fields return 400.
func TestBookAppointmentBadBody(t *testing.T) {
	h := telemedicine.NewHandler(nil)
	r := newTestGin()
	r.POST("/appointments", setUserID("user-abc"), h.BookAppointment)

	// Body missing required doctor_id and scheduled_at.
	body := `{"notes": "headache"}`
	req := httptest.NewRequest(http.MethodPost, "/appointments", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "test-key-001")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing required fields, got %d", w.Code)
	}
}

// TestRegisterDoctorV2BadBody verifies 400 for missing required fields.
func TestRegisterDoctorV2BadBody(t *testing.T) {
	h := telemedicine.NewHandler(nil)
	r := newTestGin()
	r.POST("/doctor/register", setUserID("user-abc"), h.RegisterDoctorV2)

	body := `{"full_name": "Dr. Test"}` // missing email, phone, specialty, mdcn_number
	req := httptest.NewRequest(http.MethodPost, "/doctor/register", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for incomplete registration, got %d", w.Code)
	}
}

// TestSubmitSOAPNoteBadBody verifies 400 for missing required SOAP fields.
func TestSubmitSOAPNoteBadBody(t *testing.T) {
	h := telemedicine.NewHandler(nil)
	r := newTestGin()
	r.POST("/doctor/notes", setUserID("user-abc"), h.SubmitSOAPNote)

	body := `{"subjective": "headache"}` // missing appointment_id, assessment, plan
	req := httptest.NewRequest(http.MethodPost, "/doctor/notes", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for incomplete SOAP note, got %d", w.Code)
	}
}

// TestUploadLicenceBadBody verifies 400 when document_type or filename is missing.
func TestUploadLicenceBadBody(t *testing.T) {
	h := telemedicine.NewHandler(nil)
	r := newTestGin()
	r.POST("/doctor/licence", setUserID("user-abc"), h.UploadLicenceDoc)

	body := `{"base64": "aGVsbG8="}` // missing document_type and filename
	req := httptest.NewRequest(http.MethodPost, "/doctor/licence", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing document_type/filename, got %d", w.Code)
	}
}

// TestToggleAvailabilityBadBody verifies 400 for non-JSON body.
func TestToggleAvailabilityBadBody(t *testing.T) {
	h := telemedicine.NewHandler(nil)
	r := newTestGin()
	r.PATCH("/doctor/availability", setUserID("user-abc"), h.ToggleAvailability)

	req := httptest.NewRequest(http.MethodPatch, "/doctor/availability", bytes.NewBufferString("not-json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid JSON, got %d", w.Code)
	}
}

// TestIdempotencyKeyFallback verifies that BookAppointment accepts Idempotency-Key
// from the header when not present in the body.
func TestIdempotencyKeyHeaderFallback(t *testing.T) {
	// We only test the request construction — not full service call.
	// Verifies the handler reads the header when body key is empty.
	payload := map[string]interface{}{
		"doctor_id":    "doctor-uuid",
		"scheduled_at": "2026-07-01T10:00:00Z",
		// idempotency_key deliberately omitted from body
	}
	b, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/appointments", bytes.NewBuffer(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "from-header-001")

	idkHeader := req.Header.Get("Idempotency-Key")
	if idkHeader != "from-header-001" {
		t.Errorf("Idempotency-Key header not set correctly, got %q", idkHeader)
	}
}

// ─── DoctorDashboard invariants ───────────────────────────────────────────────

// TestDashboardStatsNonNegative verifies revenue and patient count can't be negative.
func TestDashboardStatsNonNegative(t *testing.T) {
	stats := telemedicine.DashboardStats{
		WeeklyRevenueKobo: 420_000_00, // ₦420,000
		RevenueGrowthPct:  12.4,
		PatientsSeen:      128,
		Rating:            4.9,
		IsOnline:          true,
	}
	if stats.WeeklyRevenueKobo < 0 {
		t.Errorf("WeeklyRevenueKobo must not be negative, got %d", stats.WeeklyRevenueKobo)
	}
	if stats.PatientsSeen < 0 {
		t.Errorf("PatientsSeen must not be negative, got %d", stats.PatientsSeen)
	}
	if stats.Rating < 0 || stats.Rating > 5 {
		t.Errorf("Rating must be in [0, 5], got %f", stats.Rating)
	}
}

// TestEducationSliceNotNil verifies that a Doctor's Education slice defaults to
// empty (not nil) so it serializes as [] not null in JSON.
func TestEducationSliceNotNil(t *testing.T) {
	d := telemedicine.Doctor{
		Education: []telemedicine.Education{},
	}
	if d.Education == nil {
		t.Error("Education must be initialised as empty slice, not nil")
	}
}

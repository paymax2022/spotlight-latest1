package doctor

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	platformRedis "spotlight/backend/internal/platform/redis"
)

// service_vet.go — Wave 3b (VETERINARY / PET-side) business logic.
//
// Mirrors service_clinical.go: reads delegate to the repository scoped to the
// authenticated vet; mutations that target a table with a UNIQUE idempotency_key,
// or that transition an existing row, require the Idempotency-Key header
// (ErrIdempotencyRequired) and rely on the repository's ON CONFLICT replay /
// status-guarded UPDATE. None of these touch the money ledger — they are clinical /
// document writes for pet patients. Monetary fields stay int64 kobo (no floats).
//
// The free-form `Generic` request bodies are passed through as json.RawMessage and the
// few typed knobs implied by the OpenAPI summaries are pulled out of the raw patch via
// the shared parseClinicalPatch / strOrDefault / derefStr helpers (defined in
// service_clinical.go / repository.go / service.go — reused, not redefined).
//
// Reference / inventory paths with NO backing table in the migration return an empty
// projection ([]json.RawMessage{} or json.RawMessage("{}")) without querying a phantom
// table; no-table writes echo the merged request body (no persistence target exists).
// Those paths are enumerated in the Wave 3b report.

// vetEcho returns the request body as the response projection for no-table writes,
// guaranteeing valid JSON when the body is empty.
func vetEcho(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return raw
}

// ══ VET CONSULT ═════════════════════════════════════════════════════════════

// GetVetDashboard composites the vet profile + the vet's pets.
func (s *Service) GetVetDashboard(ctx context.Context, userID string) (*VetDashboard, error) {
	vet, err := s.repo.GetVetProfile(ctx, userID)
	if err != nil && err != ErrNotFound {
		return nil, err
	}
	pets, err := s.repo.ListPets(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &VetDashboard{Vet: vet, Pets: pets}, nil
}

// ToggleVetMode enables/disables vet mode (status="enabled"|"disabled" or vetModeEnabled bool).
func (s *Service) ToggleVetMode(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*VetProfile, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	var p struct {
		Status         *string `json:"status,omitempty"`
		Enabled        *bool   `json:"enabled,omitempty"`
		VetModeEnabled *bool   `json:"vetModeEnabled,omitempty"`
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &p)
	}
	enabled := true
	switch {
	case p.VetModeEnabled != nil:
		enabled = *p.VetModeEnabled
	case p.Enabled != nil:
		enabled = *p.Enabled
	case p.Status != nil:
		enabled = (*p.Status == "enabled" || *p.Status == "on" || *p.Status == "active")
	}
	return s.repo.UpsertVetMode(ctx, userID, enabled, raw)
}

// ListVetAppointments — no backing table → empty projection.
func (s *Service) ListVetAppointments(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

// ListPetOwnerRequests — no backing table → empty projection.
func (s *Service) ListPetOwnerRequests(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

// RespondToOwnerRequest — no backing table; echoes the merged response (Idempotency-Key required).
func (s *Service) RespondToOwnerRequest(ctx context.Context, userID, requestID, idemKey string, raw json.RawMessage) (json.RawMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return vetEcho(raw), nil
}

// GetPetChatThread — no backing table → empty object projection.
func (s *Service) GetPetChatThread(ctx context.Context, userID, petID string) (json.RawMessage, error) {
	if _, err := s.repo.GetPet(ctx, userID, petID); err != nil {
		return nil, err
	}
	return json.RawMessage(`{}`), nil
}

// GetPetCallSession — no backing table → empty object projection (confirms pet ownership).
func (s *Service) GetPetCallSession(ctx context.Context, userID, petID string) (json.RawMessage, error) {
	if _, err := s.repo.GetPet(ctx, userID, petID); err != nil {
		return nil, err
	}
	return json.RawMessage(`{}`), nil
}

// GetPetSoapNote — no backing table → empty object projection (confirms pet ownership).
func (s *Service) GetPetSoapNote(ctx context.Context, userID, petID string) (json.RawMessage, error) {
	if _, err := s.repo.GetPet(ctx, userID, petID); err != nil {
		return nil, err
	}
	return json.RawMessage(`{}`), nil
}

// SaveVetSoapNote — no backing table; echoes the merged note (Idempotency-Key required).
func (s *Service) SaveVetSoapNote(ctx context.Context, userID, idemKey string, raw json.RawMessage) (json.RawMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return vetEcho(raw), nil
}

// ListPetEmergencyWarnings — no backing table → empty projection (confirms pet ownership).
func (s *Service) ListPetEmergencyWarnings(ctx context.Context, userID, petID string) ([]json.RawMessage, error) {
	if _, err := s.repo.GetPet(ctx, userID, petID); err != nil {
		return nil, err
	}
	return []json.RawMessage{}, nil
}

// ListVetSpecialists — no backing table → empty directory.
func (s *Service) ListVetSpecialists(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

// ListPetReferrals — no backing table → empty projection (confirms pet ownership).
func (s *Service) ListPetReferrals(ctx context.Context, userID, petID string) ([]json.RawMessage, error) {
	if _, err := s.repo.GetPet(ctx, userID, petID); err != nil {
		return nil, err
	}
	return []json.RawMessage{}, nil
}

// CreateVetReferral — no backing table; echoes the merged referral (Idempotency-Key required).
func (s *Service) CreateVetReferral(ctx context.Context, userID, idemKey string, raw json.RawMessage) (json.RawMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return vetEcho(raw), nil
}

// GetVetConsultSummary — no backing table → empty object projection.
func (s *Service) GetVetConsultSummary(ctx context.Context, userID, consultID string) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

// ListVetConsultHistory — no backing table → empty projection.
func (s *Service) ListVetConsultHistory(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

// ══ PET PROFILE ═════════════════════════════════════════════════════════════

func (s *Service) GetPet(ctx context.Context, userID, petID string) (*Pet, error) {
	return s.repo.GetPet(ctx, userID, petID)
}

func (s *Service) ListPetVaccinations(ctx context.Context, userID, petID string) ([]PetVaccination, error) {
	return s.repo.ListPetVaccinations(ctx, userID, petID)
}

// GetPetHealthRecord composites the pet with its vaccinations, prescriptions, lab orders.
func (s *Service) GetPetHealthRecord(ctx context.Context, userID, petID string) (*PetHealthRecord, error) {
	pet, err := s.repo.GetPet(ctx, userID, petID)
	if err != nil {
		return nil, err
	}
	vaccs, err := s.repo.ListPetVaccinations(ctx, userID, petID)
	if err != nil {
		return nil, err
	}
	allRx, err := s.repo.ListPetPrescriptions(ctx, userID)
	if err != nil {
		return nil, err
	}
	rx := []PetPrescription{}
	for _, p := range allRx {
		if p.PetID != nil && *p.PetID == petID {
			rx = append(rx, p)
		}
	}
	allOrders, err := s.repo.ListPetLabOrders(ctx, userID)
	if err != nil {
		return nil, err
	}
	orders := []PetLabOrder{}
	for _, o := range allOrders {
		if o.PetID != nil && *o.PetID == petID {
			orders = append(orders, o)
		}
	}
	return &PetHealthRecord{Pet: pet, Vaccinations: vaccs, Prescriptions: rx, LabOrders: orders}, nil
}

// GetPetGrowth returns the pet's growth_history (confirms pet ownership).
func (s *Service) GetPetGrowth(ctx context.Context, userID, petID string) (*PetGrowth, error) {
	pet, err := s.repo.GetPet(ctx, userID, petID)
	if err != nil {
		return nil, err
	}
	gh := pet.GrowthHistory
	if len(gh) == 0 {
		gh = json.RawMessage(`[]`)
	}
	return &PetGrowth{PetID: pet.ID, GrowthHistory: gh}, nil
}

// RecordPetGrowth appends a growth measurement to the pet (Idempotency-Key required;
// the measurement is wrapped in a single-element array for the jsonb || append).
//
// IDEMPOTENCY: doctor_pets.growth_history is a JSONB-append column with no per-point
// idempotency_key, so a naive retry would double-append the same measurement. We
// dedupe with a Redis SETNX claim on the idem key (scoped to user+pet, 24h TTL)
// BEFORE the append: the first request claims the key and appends; a retry finds
// the key already set and returns the current pet state WITHOUT a second append.
// If Redis is unavailable we fall back to a content-hash claim is not possible
// (no store), so we proceed with the append — matching the pre-existing behaviour
// and never blocking a legitimate first write on a limiter outage.
func (s *Service) RecordPetGrowth(ctx context.Context, userID, petID, idemKey string, raw json.RawMessage) (*Pet, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	measurement := raw
	if len(measurement) == 0 {
		measurement = json.RawMessage(`{}`)
	}

	// Dedupe replays via a Redis SETNX claim (24h) when Redis is configured.
	if s.redis != nil {
		claimKey := fmt.Sprintf("doctor:pet-growth:%s:%s:%s", userID, petID, idemKey)
		ok, err := platformRedis.SetNX(ctx, s.redis, claimKey, "1", 24*time.Hour)
		if err == nil && !ok {
			// Replay: the measurement was already appended on the original request.
			// Return the current pet state without appending again.
			return s.repo.GetPet(ctx, userID, petID)
		}
		// err != nil → fail open (proceed with append); ok==true → first request.
	}

	wrapped, _ := json.Marshal([]json.RawMessage{measurement})
	return s.repo.AppendPetGrowth(ctx, userID, petID, wrapped)
}

// ══ PET E-PRESCRIPTION ══════════════════════════════════════════════════════

func (s *Service) ListPetPrescriptions(ctx context.Context, userID string) ([]PetPrescription, error) {
	return s.repo.ListPetPrescriptions(ctx, userID)
}

func (s *Service) GetIssuedPetPrescription(ctx context.Context, userID, id string) (*PetPrescription, error) {
	return s.repo.GetPetPrescription(ctx, userID, id)
}

// CreatePetPrescription creates a draft pet prescription (Idempotency-Key required).
func (s *Service) CreatePetPrescription(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*PetPrescription, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	var p struct {
		PetID *string         `json:"petId,omitempty"`
		Ref   *string         `json:"ref,omitempty"`
		Items json.RawMessage `json:"items,omitempty"`
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &p)
	}
	return s.repo.InsertPetPrescription(ctx, userID, p.PetID, p.Ref, p.Items, idemKey)
}

// GetPetPrescriptionForPet returns the most recent prescription for a pet.
func (s *Service) GetPetPrescriptionForPet(ctx context.Context, userID, petID string) (*PetPrescription, error) {
	return s.repo.GetPetPrescriptionForPet(ctx, userID, petID)
}

// IssuePetPrescription transitions a draft → issued (Idempotency-Key required).
func (s *Service) IssuePetPrescription(ctx context.Context, userID, prescriptionID, idemKey string, raw json.RawMessage) (*PetPrescription, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.IssuePetPrescription(ctx, userID, prescriptionID)
}

// SendPetPrescription transitions an issued prescription → dispensed / sent (Idempotency-Key required).
func (s *Service) SendPetPrescription(ctx context.Context, userID, prescriptionID, idemKey string, raw json.RawMessage) (*PetPrescription, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.SendPetPrescription(ctx, userID, prescriptionID)
}

// ListPetRefills — no backing table → empty projection.
func (s *Service) ListPetRefills(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

// RequestPetRefill — no backing table; echoes the merged request (Idempotency-Key required).
func (s *Service) RequestPetRefill(ctx context.Context, userID, idemKey string, raw json.RawMessage) (json.RawMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return vetEcho(raw), nil
}

// ReviewPetRefill — no backing table; echoes the merged decision (Idempotency-Key required).
func (s *Service) ReviewPetRefill(ctx context.Context, userID, refillID, idemKey string, raw json.RawMessage) (json.RawMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return vetEcho(raw), nil
}

// ListPetPharmacies — no backing table → empty directory.
func (s *Service) ListPetPharmacies(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

// ══ PET LABS ════════════════════════════════════════════════════════════════

func (s *Service) ListPetLabOrders(ctx context.Context, userID string) ([]PetLabOrder, error) {
	return s.repo.ListPetLabOrders(ctx, userID)
}

// CreatePetLabOrder creates a pet lab order (Idempotency-Key required).
func (s *Service) CreatePetLabOrder(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*PetLabOrder, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	var p struct {
		PetID *string         `json:"petId,omitempty"`
		Ref   *string         `json:"ref,omitempty"`
		Tests json.RawMessage `json:"tests,omitempty"`
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &p)
	}
	return s.repo.InsertPetLabOrder(ctx, userID, p.PetID, p.Ref, p.Tests, idemKey)
}

// GetPetLabResultForOrder returns the result tied to a pet lab order.
func (s *Service) GetPetLabResultForOrder(ctx context.Context, userID, orderID string) (*PetLabResult, error) {
	return s.repo.GetPetLabResultForOrder(ctx, userID, orderID)
}

// ListPetLabCatalogue — no backing table → empty catalogue.
func (s *Service) ListPetLabCatalogue(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

func (s *Service) ListPetLabResultInbox(ctx context.Context, userID string) ([]PetLabResult, error) {
	return s.repo.ListPetLabResultInbox(ctx, userID)
}

// ReviewPetLabResult marks a pet lab result reviewed (Idempotency-Key required).
func (s *Service) ReviewPetLabResult(ctx context.Context, userID, resultID, idemKey string) (*PetLabResult, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.ReviewPetLabResult(ctx, userID, resultID)
}

// AddPetLabInterpretation writes an interpretation onto a pet lab result (Idempotency-Key required).
func (s *Service) AddPetLabInterpretation(ctx context.Context, userID, resultID, idemKey string, raw json.RawMessage) (*PetLabResult, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	interp := strOrDefault(p.Interpretation, strOrDefault(p.Body, ""))
	return s.repo.SetPetLabInterpretation(ctx, userID, resultID, interp)
}

// ListPetVaccinationRecommendations returns the pet's vaccinations (recommendation view).
func (s *Service) ListPetVaccinationRecommendations(ctx context.Context, userID, petID string) ([]PetVaccination, error) {
	return s.repo.ListPetVaccinations(ctx, userID, petID)
}

// ListPetVaccinationReminders returns the pet's vaccinations with a reminder set.
func (s *Service) ListPetVaccinationReminders(ctx context.Context, userID, petID string) ([]PetVaccination, error) {
	return s.repo.ListPetVaccinationReminders(ctx, userID, petID)
}

// SetPetVaccinationReminder records a vaccination reminder (Idempotency-Key required).
func (s *Service) SetPetVaccinationReminder(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*PetVaccination, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	var p struct {
		PetID   *string         `json:"petId,omitempty"`
		Vaccine *string         `json:"vaccine,omitempty"`
		DueAt   *time.Time      `json:"dueAt,omitempty"`
		Detail  json.RawMessage `json:"detail,omitempty"`
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &p)
	}
	petID := derefStr(p.PetID)
	return s.repo.InsertPetVaccinationReminder(ctx, userID, petID, p.Vaccine, p.DueAt, raw, idemKey)
}

// GetPetHealthRecord composite is defined in the PET PROFILE section above.

// ══ PET STORE ═══════════════════════════════════════════════════════════════

func (s *Service) ListPetProducts(ctx context.Context, userID string) ([]PetProduct, error) {
	return s.repo.ListPetProducts(ctx, userID)
}

func (s *Service) GetPetProduct(ctx context.Context, userID, id string) (*PetProduct, error) {
	return s.repo.GetPetProduct(ctx, userID, id)
}

func (s *Service) ListPetRecommendations(ctx context.Context, userID string) ([]PetRecommendation, error) {
	return s.repo.ListPetRecommendations(ctx, userID)
}

func (s *Service) ListPetRecommendationsForPet(ctx context.Context, userID, petID string) ([]PetRecommendation, error) {
	return s.repo.ListPetRecommendationsForPet(ctx, userID, petID)
}

// RecommendPetProducts recommends a product for a pet (Idempotency-Key required).
func (s *Service) RecommendPetProducts(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*PetRecommendation, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	var p struct {
		PetID     *string `json:"petId,omitempty"`
		ProductID *string `json:"productId,omitempty"`
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &p)
	}
	return s.repo.InsertPetRecommendation(ctx, userID, p.PetID, p.ProductID, raw, idemKey)
}

// SharePetRecommendation transitions a recommendation → shared (Idempotency-Key required).
func (s *Service) SharePetRecommendation(ctx context.Context, userID, recommendationID, idemKey string, raw json.RawMessage) (*PetRecommendation, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.SharePetRecommendation(ctx, userID, recommendationID, raw)
}

func (s *Service) ListPetFulfilments(ctx context.Context, userID string) ([]PetFulfilment, error) {
	return s.repo.ListPetFulfilments(ctx, userID)
}

func (s *Service) GetPetFulfilment(ctx context.Context, userID, id string) (*PetFulfilment, error) {
	return s.repo.GetPetFulfilment(ctx, userID, id)
}

// ── Pet chronic monitoring (no pet-specific backing table → empty / echo) ─────

// ListPetChronicMonitoring — no doctor_pet_chronic_monitoring table → empty projection
// (confirms pet ownership). The human-side doctor_chronic_monitoring table is patient-
// scoped and is NOT reused here to avoid mixing pet/human records.
func (s *Service) ListPetChronicMonitoring(ctx context.Context, userID, petID string) ([]json.RawMessage, error) {
	if _, err := s.repo.GetPet(ctx, userID, petID); err != nil {
		return nil, err
	}
	return []json.RawMessage{}, nil
}

// SavePetChronicMonitoring — no backing table; echoes the merged entry (Idempotency-Key required).
func (s *Service) SavePetChronicMonitoring(ctx context.Context, userID, petID, idemKey string, raw json.RawMessage) (json.RawMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if _, err := s.repo.GetPet(ctx, userID, petID); err != nil {
		return nil, err
	}
	return vetEcho(raw), nil
}

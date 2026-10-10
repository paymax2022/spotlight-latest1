package healthvet

import (
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/strutil"
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/tiers"
	healthrx "spotlight/backend/internal/health/rx"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Handler exposes the HEALTH-BUILD §6 Veterinary API. AuthN is the finance auth
// chain (user_id mirrored onto the gin context); per-route RBAC + object-level
// authZ is applied here and in the service. isAdmin reports the caller's health
// vet admin permission (drives admin-basis reads).
type Handler struct {
	svc     *Service
	isAdmin func(c *gin.Context) bool
}

func NewHandler(svc *Service, isAdmin func(c *gin.Context) bool) *Handler {
	if isAdmin == nil {
		isAdmin = func(c *gin.Context) bool { return false }
	}
	return &Handler{svc: svc, isAdmin: isAdmin}
}

// uuidPathID gates a uuid-typed :id path param before it can reach a
// WHERE id=$1 object load — a malformed value is a 400 naming the field,
// never a driver error → 4xx/500 (w11 covered input params; this is the
// object-load side of the same shape-gate). Returns the param value and true
// on success; on failure the response is already written and the caller must
// return early.
func uuidPathID(c *gin.Context, field string) (string, bool) {
	v := c.Param("id")
	if _, err := uuid.Parse(v); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, field+" must be a uuid")
		return "", false
	}
	return v, true
}

// uuidQueryID gates an optional uuid-typed query param ("" = no filter) the
// same way — malformed → 400 naming the field.
func uuidQueryID(c *gin.Context, field string) (string, bool) {
	v := c.Query(field)
	if v != "" {
		if _, err := uuid.Parse(v); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, field+" must be a uuid")
			return "", false
		}
	}
	return v, true
}

// failErr writes a service failure through the sanitiser: module-authored
// domain text passes verbatim at 4xx, but Postgres/pgx/driver strings are
// replaced by the status's generic message — raw driver text never reaches a
// client at any status.
func failErr(c *gin.Context, status int, err error) {
	ginutil.FailOK(c, status, httperr.Sanitize(c, status, err.Error()))
}

// failVet is failErr plus the appointment-scoped uniform denial: the service
// returns ErrAppointmentNotFound for a missing appointment AND for "exists but
// the caller is neither patient nor vet" (same fold as social #602 /
// association #606 / aicare — no existence oracle), so both are 404 here,
// not the domain-refusal fallback status.
func failVet(c *gin.Context, fallback int, err error) {
	if errors.Is(err, ErrAppointmentNotFound) {
		failErr(c, http.StatusNotFound, err)
		return
	}
	failErr(c, fallback, err)
}

// CreatePet — POST /pets  (owner; seeds vault PET record, HL-8)
// Requires Idempotency-Key (header, or the body's idempotency_key fallback like
// Book): a replay returns the original pet rather than writing a duplicate.
func (h *Handler) CreatePet(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Pet
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// Header wins; the body field is the module's established alternate spelling
	// (same convention as Book). Missing either is a client error — a mutation
	// that cannot dedupe itself must not run (HL-9 convention).
	req.Pet.IdempotencyKey = strutil.FirstNonEmpty(ginutil.IdempotencyKey(c), req.IdempotencyKey)
	if req.Pet.IdempotencyKey == "" {
		ginutil.FailOK(c, http.StatusBadRequest, "Idempotency-Key required")
		return
	}
	out, err := h.svc.CreatePet(c.Request.Context(), id, req.Pet)
	if err != nil {
		status := http.StatusUnprocessableEntity
		if errors.Is(err, ErrPetMissingIdem) {
			status = http.StatusBadRequest
		}
		failErr(c, status, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "pet": out})
}

// ListPets — GET /pets  (owner reads own pets only, HL-8)
func (h *Handler) ListPets(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	// Anything ListPets returns past the auth check is an internal failure
	// (e.g. a DB error), not an auth one — mapping it to 401 would make a query
	// bug indistinguishable from a bad/missing token.
	pets, err := h.svc.ListPets(c.Request.Context(), id)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "pets": pets})
}

// DiscoverVets — GET /vets?lat=&lng=&radius_m=  (map/list discovery, HL-2)
func (h *Handler) DiscoverVets(c *gin.Context) {
	var lat, lng *float64
	if v := c.Query("lat"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			lat = &f
		}
	}
	if v := c.Query("lng"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			lng = &f
		}
	}
	radius := 0.0
	if v := c.Query("radius_m"); v != "" {
		radius, _ = strconv.ParseFloat(v, 64)
	}
	vets, err := h.svc.DiscoverVets(c.Request.Context(), lat, lng, radius)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "vets": vets})
}

// UpsertService — POST /services  (verified vet owner; fee governance, HL-2)
func (h *Handler) UpsertService(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		ID         string `json:"id"`
		ProviderID string `json:"provider_id"`
		Code       string `json:"code"`
		Name       string `json:"name"`
		VisitType  string `json:"visit_type"`
		PriceKobo  int64  `json:"price_kobo"`
		Active     bool   `json:"active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// provider_id feeds the HL-2 provider-gate lookup (WHERE id=$1::uuid); an
	// empty/malformed value must be a 400, never a driver error → 422/500.
	if _, err := uuid.Parse(req.ProviderID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "provider_id must be a uuid")
		return
	}
	// A caller-pinned id feeds the vet_services PK (uuid); malformed → 400,
	// never a driver error → 422/500. Empty is fine — the service mints one.
	if req.ID != "" {
		if _, err := uuid.Parse(req.ID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "id must be a uuid")
			return
		}
	}
	out, err := h.svc.UpsertService(c.Request.Context(), id, VetService{
		ID: req.ID, ProviderID: req.ProviderID, Code: req.Code, Name: req.Name,
		VisitType: VisitType(req.VisitType), PriceKobo: req.PriceKobo, Active: req.Active,
	})
	if err != nil {
		failErr(c, http.StatusUnprocessableEntity, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "service": out})
}

// Book — POST /appointments  (owner; tele/home/clinic; payment HELD, HL-9)
func (h *Handler) Book(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		ProviderID     string `json:"provider_id"`
		PetID          string `json:"pet_id"`
		ServiceID      string `json:"service_id"`
		VisitType      string `json:"visit_type"`
		SlotStart      string `json:"slot_start"`
		SlotEnd        string `json:"slot_end"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// provider_id feeds the HL-2 provider-gate lookup (WHERE id=$1::uuid); an
	// empty/malformed value must be a 400, never a driver error → 422/500.
	if _, err := uuid.Parse(req.ProviderID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "provider_id must be a uuid")
		return
	}
	// pet_id/service_id feed uuid columns (pets.id ownership check, the
	// vet_services price lookup) — a malformed value must be a 400, never a
	// driver error → 422/500.
	if _, err := uuid.Parse(req.PetID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "pet_id must be a uuid")
		return
	}
	if _, err := uuid.Parse(req.ServiceID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "service_id must be a uuid")
		return
	}
	start, err := time.Parse(time.RFC3339, req.SlotStart)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid slot_start (RFC3339)")
		return
	}
	end, err := time.Parse(time.RFC3339, req.SlotEnd)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid slot_end (RFC3339)")
		return
	}
	in := BookInput{
		ProviderID: req.ProviderID, PetID: req.PetID, ServiceID: req.ServiceID,
		VisitType: VisitType(req.VisitType), SlotStart: start, SlotEnd: end,
		IdempotencyKey: strutil.FirstNonEmpty(ginutil.IdempotencyKey(c), req.IdempotencyKey),
	}
	a, err := h.svc.Book(c.Request.Context(), id, in)
	if err != nil {
		// Tier-limit refusals → 403 (same mapping the transfer rail uses); an
		// unwired escrow gate is a dependency failure → 503 (E2E-FIN-046).
		switch {
		case errors.Is(err, tiers.ErrWalletDisabled), errors.Is(err, tiers.ErrDailyLimitExceeded):
			failErr(c, http.StatusForbidden, err)
		case errors.Is(err, escrow.ErrTierGateUnwired):
			failErr(c, http.StatusServiceUnavailable, err)
		default:
			failErr(c, http.StatusUnprocessableEntity, err)
		}
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "appointment": a})
}

// Accept — POST /appointments/:id/accept  (verified vet, HL-2)
func (h *Handler) Accept(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	apptID, ok := uuidPathID(c, "appointment id")
	if !ok {
		return
	}
	a, err := h.svc.Accept(c.Request.Context(), id, apptID)
	if err != nil {
		failVet(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// Confirm — POST /appointments/:id/confirm
func (h *Handler) Confirm(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	apptID, ok := uuidPathID(c, "appointment id")
	if !ok {
		return
	}
	a, err := h.svc.Confirm(c.Request.Context(), id, apptID)
	if err != nil {
		failVet(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// Cancel — POST /appointments/:id/cancel  (owner/vet; refund HELD, HL-9)
func (h *Handler) Cancel(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	apptID, ok := uuidPathID(c, "appointment id")
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	a, err := h.svc.Cancel(c.Request.Context(), id, apptID, req.Reason)
	if err != nil {
		failVet(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// Dispatch — POST /appointments/:id/dispatch  (home visit on transport rail)
func (h *Handler) Dispatch(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	apptID, ok := uuidPathID(c, "appointment id")
	if !ok {
		return
	}
	a, err := h.svc.Dispatch(c.Request.Context(), id, apptID)
	if err != nil {
		failVet(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// StartConsult — POST /consults/:id/start  (verified vet; :id is appointment id)
func (h *Handler) StartConsult(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	apptID, ok := uuidPathID(c, "appointment id")
	if !ok {
		return
	}
	a, err := h.svc.StartConsult(c.Request.Context(), id, apptID)
	if err != nil {
		failVet(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// CompleteConsult — POST /consults/:id/complete  (verified vet; SOAP + care loop)
func (h *Handler) CompleteConsult(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Subjective string `json:"subjective"`
		Objective  string `json:"objective"`
		Assessment string `json:"assessment"`
		Plan       string `json:"plan"`
		RxItems    []struct {
			DrugName  string `json:"drug_name"`
			NAFDACRef string `json:"nafdac_ref"`
			IsPOM     bool   `json:"is_pom"`
			Dosage    string `json:"dosage"`
			Quantity  int    `json:"quantity"`
		} `json:"rx_items"`
		PharmacyProviderID string   `json:"pharmacy_provider_id"`
		LabProviderID      string   `json:"lab_provider_id"`
		LabTestIDs         []string `json:"lab_test_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	items := make([]healthrx.Item, 0, len(req.RxItems))
	for _, it := range req.RxItems {
		items = append(items, healthrx.Item{
			DrugName: it.DrugName, NAFDACRef: it.NAFDACRef, IsPOM: it.IsPOM,
			Dosage: it.Dosage, Quantity: it.Quantity,
		})
	}
	// The optional handoff ids feed uuid columns on the rx/lab referral rails —
	// when present a malformed value must be a 400, never a driver error.
	if req.PharmacyProviderID != "" {
		if _, err := uuid.Parse(req.PharmacyProviderID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "pharmacy_provider_id must be a uuid")
			return
		}
	}
	if req.LabProviderID != "" {
		if _, err := uuid.Parse(req.LabProviderID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "lab_provider_id must be a uuid")
			return
		}
	}
	// Every lab_test_ids entry feeds vet_lab_referrals.test_ids (uuid[]) —
	// malformed → 400, never a driver error.
	for _, testID := range req.LabTestIDs {
		if _, err := uuid.Parse(testID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "lab_test_ids must be uuids")
			return
		}
	}
	in := CompleteInput{
		Subjective: req.Subjective, Objective: req.Objective,
		Assessment: req.Assessment, Plan: req.Plan,
		RxItems: items, PharmacyProviderID: req.PharmacyProviderID,
		LabProviderID: req.LabProviderID, LabTestIDs: req.LabTestIDs,
	}
	apptID, ok := uuidPathID(c, "appointment id")
	if !ok {
		return
	}
	res, err := h.svc.CompleteConsult(c.Request.Context(), id, apptID, in)
	if err != nil {
		failVet(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": res})
}

// ScheduleVaccination — POST /pets/:id/vaccinations  (owner; reminder via scheduler)
func (h *Handler) ScheduleVaccination(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Vaccine string `json:"vaccine"`
		DueAt   string `json:"due_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// :id feeds the pets.id ownership check (WHERE id=$1::uuid) — malformed →
	// 400, never a driver error → 422/500.
	if _, err := uuid.Parse(c.Param("id")); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "pet id must be a uuid")
		return
	}
	dueAt, err := time.Parse(time.RFC3339, req.DueAt)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid due_at (RFC3339)")
		return
	}
	v, err := h.svc.ScheduleVaccination(c.Request.Context(), id, c.Param("id"), req.Vaccine, dueAt)
	if err != nil {
		failErr(c, http.StatusUnprocessableEntity, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "vaccination": v})
}

// EmergencySOS — POST /sos  (HL-11: routes to nearest in-person vet + disclaimer)
func (h *Handler) EmergencySOS(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	res, err := h.svc.EmergencySOS(c.Request.Context(), id, req.Lat, req.Lng)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sos": res})
}

// ListMyAppointments — GET /appointments  (owner reads own appointment history)
func (h *Handler) ListMyAppointments(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	appts, err := h.svc.ListAppointmentsForPatient(c.Request.Context(), id)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointments": appts})
}

// Get — GET /appointments/:id  (object-level authZ: owner / vet / admin)
func (h *Handler) Get(c *gin.Context) {
	apptID, ok := uuidPathID(c, "appointment id")
	if !ok {
		return
	}
	a, err := h.svc.Get(c.Request.Context(), ginutil.UserID(c), apptID, h.isAdmin(c))
	if err != nil {
		// Missing-or-denied is the sentinel → uniform 404; anything else is an
		// internal failure (the old blanket-403 misreported DB errors).
		failVet(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// Admin handlers — RBAC health.vet.* applied at route registration. These are
// admin-basis oversight reads/controls (VCN audit, appointment oversight, e-Rx
// audit, service/fee governance). PII is never surfaced (ids/state only).

// AdminListAppointments — GET /admin/appointments?state=&provider_id=
func (h *Handler) AdminListAppointments(c *gin.Context) {
	provID, ok := uuidQueryID(c, "provider_id")
	if !ok {
		return
	}
	rows, err := h.svc.AdminListAppointments(c.Request.Context(), c.Query("state"), provID)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointments": rows})
}

// AdminVCNAudit — GET /admin/vcn-audit  (VCN credential audit, HL-2/HL-12)
func (h *Handler) AdminVCNAudit(c *gin.Context) {
	rows, err := h.svc.AdminVCNAudit(c.Request.Context())
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "providers": rows})
}

// AdminERxAudit — GET /admin/erx-audit?provider_id=  (e-prescription audit, HL-3/HL-12)
func (h *Handler) AdminERxAudit(c *gin.Context) {
	provID, ok := uuidQueryID(c, "provider_id")
	if !ok {
		return
	}
	rows, err := h.svc.AdminERxAudit(c.Request.Context(), provID)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "prescriptions": rows})
}

// AdminDeactivateService — POST /admin/services/:id/deactivate  (fee governance)
func (h *Handler) AdminDeactivateService(c *gin.Context) {
	serviceID, ok := uuidPathID(c, "service id")
	if !ok {
		return
	}
	if err := h.svc.AdminDeactivateService(c.Request.Context(), ginutil.UserID(c), serviceID); err != nil {
		failVet(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminDashboard — GET /admin/dashboard  platform-wide KPI aggregate. See
// Service.AdminDashboard / AdminDashboard (service.go) for exactly what is
// computed and why fields this batch cannot honestly compute are left off the
// shape entirely rather than fabricated.
func (h *Handler) AdminDashboard(c *gin.Context) {
	d, err := h.svc.AdminDashboard(c.Request.Context())
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": d})
}

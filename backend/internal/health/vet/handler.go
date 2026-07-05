package healthvet

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	healthrx "spotlight/backend/internal/health/rx"
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

func uid(c *gin.Context) string { return c.GetString("user_id") }

func fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

func idemKey(c *gin.Context, body string) string {
	if hk := c.GetHeader("Idempotency-Key"); hk != "" {
		return hk
	}
	return body
}

// CreatePet — POST /pets  (owner; seeds vault PET record, HL-8)
func (h *Handler) CreatePet(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var p Pet
	if err := c.ShouldBindJSON(&p); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.CreatePet(c.Request.Context(), id, p)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "pet": out})
}

// ListPets — GET /pets  (owner reads own pets only, HL-8)
func (h *Handler) ListPets(c *gin.Context) {
	pets, err := h.svc.ListPets(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, http.StatusUnauthorized, err.Error())
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
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "vets": vets})
}

// UpsertService — POST /services  (verified vet owner; fee governance, HL-2)
func (h *Handler) UpsertService(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
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
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.UpsertService(c.Request.Context(), id, VetService{
		ID: req.ID, ProviderID: req.ProviderID, Code: req.Code, Name: req.Name,
		VisitType: VisitType(req.VisitType), PriceKobo: req.PriceKobo, Active: req.Active,
	})
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "service": out})
}

// Book — POST /appointments  (owner; tele/home/clinic; payment HELD, HL-9)
func (h *Handler) Book(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
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
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	start, err := time.Parse(time.RFC3339, req.SlotStart)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid slot_start (RFC3339)")
		return
	}
	end, err := time.Parse(time.RFC3339, req.SlotEnd)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid slot_end (RFC3339)")
		return
	}
	in := BookInput{
		ProviderID: req.ProviderID, PetID: req.PetID, ServiceID: req.ServiceID,
		VisitType: VisitType(req.VisitType), SlotStart: start, SlotEnd: end,
		IdempotencyKey: idemKey(c, req.IdempotencyKey),
	}
	a, err := h.svc.Book(c.Request.Context(), id, in)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "appointment": a})
}

// Accept — POST /appointments/:id/accept  (verified vet, HL-2)
func (h *Handler) Accept(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	a, err := h.svc.Accept(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// Confirm — POST /appointments/:id/confirm
func (h *Handler) Confirm(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	a, err := h.svc.Confirm(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// Cancel — POST /appointments/:id/cancel  (owner/vet; refund HELD, HL-9)
func (h *Handler) Cancel(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	a, err := h.svc.Cancel(c.Request.Context(), id, c.Param("id"), req.Reason)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// Dispatch — POST /appointments/:id/dispatch  (home visit on transport rail)
func (h *Handler) Dispatch(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	a, err := h.svc.Dispatch(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// StartConsult — POST /consults/:id/start  (verified vet; :id is appointment id)
func (h *Handler) StartConsult(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	a, err := h.svc.StartConsult(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

// CompleteConsult — POST /consults/:id/complete  (verified vet; SOAP + care loop)
func (h *Handler) CompleteConsult(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
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
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	items := make([]healthrx.Item, 0, len(req.RxItems))
	for _, it := range req.RxItems {
		items = append(items, healthrx.Item{
			DrugName: it.DrugName, NAFDACRef: it.NAFDACRef, IsPOM: it.IsPOM,
			Dosage: it.Dosage, Quantity: it.Quantity,
		})
	}
	in := CompleteInput{
		Subjective: req.Subjective, Objective: req.Objective,
		Assessment: req.Assessment, Plan: req.Plan,
		RxItems: items, PharmacyProviderID: req.PharmacyProviderID,
		LabProviderID: req.LabProviderID, LabTestIDs: req.LabTestIDs,
	}
	res, err := h.svc.CompleteConsult(c.Request.Context(), id, c.Param("id"), in)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": res})
}

// ScheduleVaccination — POST /pets/:id/vaccinations  (owner; reminder via scheduler)
func (h *Handler) ScheduleVaccination(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Vaccine string `json:"vaccine"`
		DueAt   string `json:"due_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	dueAt, err := time.Parse(time.RFC3339, req.DueAt)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid due_at (RFC3339)")
		return
	}
	v, err := h.svc.ScheduleVaccination(c.Request.Context(), id, c.Param("id"), req.Vaccine, dueAt)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "vaccination": v})
}

// EmergencySOS — POST /sos  (HL-11: routes to nearest in-person vet + disclaimer)
func (h *Handler) EmergencySOS(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	res, err := h.svc.EmergencySOS(c.Request.Context(), id, req.Lat, req.Lng)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sos": res})
}

// Get — GET /appointments/:id  (object-level authZ: owner / vet / admin)
func (h *Handler) Get(c *gin.Context) {
	a, err := h.svc.Get(c.Request.Context(), uid(c), c.Param("id"), h.isAdmin(c))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointment": a})
}

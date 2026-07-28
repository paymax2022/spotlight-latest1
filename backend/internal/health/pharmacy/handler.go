package healthpharmacy

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the HEALTH-BUILD §6 Pharmacy API. AuthN is the finance auth
// chain (user_id mirrored onto the gin context); per-route RBAC + object-level
// authZ is applied here and in the service. isAdmin reports the caller's health
// pharmacy admin permission (drives admin-basis reads).
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

// VerifyPrescription — POST /prescriptions/:id/verify  (pharmacist, HL-3)
// body: { begin, approve, reason }. Reuses healthrx via the service verifier.
func (h *Handler) VerifyPrescription(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Begin   bool   `json:"begin"`
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.VerifyPrescription(c.Request.Context(), id, c.Param("id"), req.Begin, req.Approve, req.Reason); err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ListProducts — GET /products?pharmacy_provider_id=&q=  (NAFDAC-gated, Rx flag, HL-5)
// q is an optional case-insensitive search on the medicine name or owning pharmacy name.
func (h *Handler) ListProducts(c *gin.Context) {
	products, err := h.svc.ListProducts(c.Request.Context(), c.Query("pharmacy_provider_id"), c.Query("q"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "products": products})
}

// GetProduct — GET /products/:id  (single catalog product + owning pharmacy name)
func (h *Handler) GetProduct(c *gin.Context) {
	p, err := h.svc.GetProduct(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "product not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "product": p})
}

// UpsertProduct — POST /products  (pharmacy owner, HL-5 NAFDAC write-time gate)
func (h *Handler) UpsertProduct(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var p Product
	if err := c.ShouldBindJSON(&p); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.UpsertProduct(c.Request.Context(), id, p)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "product": out})
}

// CreateOrder — POST /orders  (patient, payment HELD, HL-9)
func (h *Handler) CreateOrder(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		PharmacyProviderID string  `json:"pharmacy_provider_id"`
		PrescriptionID     *string `json:"prescription_id"`
		FulfilmentMethod   string  `json:"fulfilment_method"`
		IdempotencyKey     string  `json:"idempotency_key"`
		SearchEventID      *string `json:"search_event_id"` // optional symptom-search link (PRD §10)
		Lines              []struct {
			ProductID string `json:"product_id"`
			Quantity  int    `json:"quantity"`
		} `json:"lines"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	idem := req.IdempotencyKey
	if hk := c.GetHeader("Idempotency-Key"); hk != "" {
		idem = hk
	}
	in := CreateOrderInput{
		PharmacyProviderID: req.PharmacyProviderID,
		PrescriptionID:     req.PrescriptionID,
		FulfilmentMethod:   FulfilmentMethod(req.FulfilmentMethod),
		IdempotencyKey:     idem,
		SearchEventID:      req.SearchEventID,
	}
	for _, l := range req.Lines {
		in.Lines = append(in.Lines, OrderLineInput{ProductID: l.ProductID, Quantity: l.Quantity})
	}
	o, err := h.svc.CreateOrder(c.Request.Context(), id, in)
	if err != nil {
		// failCreateOrder gives quantity-cap rejections their structured 422
		// shape (code QTY_CAP_EXCEEDED + remaining); everything else keeps the
		// plain envelope.
		failCreateOrder(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "order": o})
}

// Confirm — POST /orders/:id/confirm  (HL-3 verified e-Rx gate for Rx orders)
func (h *Handler) Confirm(c *gin.Context) {
	o, err := h.svc.Confirm(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Dispense — POST /orders/:id/dispense  (pharmacist, HL-1 clinical action, HL-3 dispense-once)
func (h *Handler) Dispense(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	o, err := h.svc.Dispense(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Dispatch — POST /orders/:id/dispatch  (transport last-mile rail / pickup code)
func (h *Handler) Dispatch(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	o, err := h.svc.Dispatch(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Complete — POST /orders/:id/complete  (release payment, HL-9)
// body: { pickup_code } (required only for PICKUP completion).
func (h *Handler) Complete(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		PickupCode string `json:"pickup_code"`
	}
	_ = c.ShouldBindJSON(&req)
	o, err := h.svc.Complete(c.Request.Context(), id, c.Param("id"), req.PickupCode)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Cancel — POST /orders/:id/cancel  (patient, pre-DISPENSED → refund, HL-9)
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
	o, err := h.svc.Cancel(c.Request.Context(), id, c.Param("id"), req.Reason)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Get — GET /orders/:id  (object-level authZ: patient / pharmacy / admin)
func (h *Handler) Get(c *gin.Context) {
	o, err := h.svc.Get(c.Request.Context(), uid(c), c.Param("id"), h.isAdmin(c))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// ─── Multi-pharmacy discovery + ratings (HL-2 gated) ─────────────────────────

// DiscoverPharmacies — GET /pharmacies?lat=&lng=&radius_m=&sort=distance|rating|name&q=
// Browse ALL discoverable pharmacies (HL-2); lat/lng are optional query params
// (float64), radius_m defaults to 25km server-side when omitted/invalid. q is an
// optional case-insensitive search on the pharmacy name.
func (h *Handler) DiscoverPharmacies(c *gin.Context) {
	lat := parseOptionalFloat(c.Query("lat"))
	lng := parseOptionalFloat(c.Query("lng"))
	radiusM, _ := strconv.ParseFloat(c.Query("radius_m"), 64)
	rows, err := h.svc.DiscoverPharmacies(c.Request.Context(), lat, lng, radiusM, c.Query("sort"), c.Query("q"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "pharmacies": rows})
}

// GetPharmacy — GET /pharmacies/:id  discoverable pharmacy detail (HL-2).
func (h *Handler) GetPharmacy(c *gin.Context) {
	p, err := h.svc.GetPharmacyProfile(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "pharmacy": p})
}

// ListPharmacyReviews — GET /pharmacies/:id/reviews  public rating feed.
func (h *Handler) ListPharmacyReviews(c *gin.Context) {
	rows, err := h.svc.ListReviews(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "reviews": rows})
}

// UpsertPharmacyProfile — POST /pharmacies/:id/profile  (verified owner, HL-2)
func (h *Handler) UpsertPharmacyProfile(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req UpsertPharmacyProfileInput
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	p, err := h.svc.UpsertPharmacyProfile(c.Request.Context(), id, c.Param("id"), req)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "pharmacy": p})
}

// SubmitReview — POST /orders/:id/reviews  (patient, order must be completed)
func (h *Handler) SubmitReview(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Rating int    `json:"rating"`
		Body   string `json:"body"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	r, err := h.svc.SubmitReview(c.Request.Context(), id, c.Param("id"), req.Rating, req.Body)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "review": r})
}

func parseOptionalFloat(s string) *float64 {
	if s == "" {
		return nil
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return &v
}

// ─── Admin handlers (RBAC health.pharmacy.* applied at route registration) ───

// AdminListOrders — GET /admin/orders  order/delivery oversight.
func (h *Handler) AdminListOrders(c *gin.Context) {
	rows, err := h.svc.AdminListOrders(c.Request.Context(), c.Query("state"), c.Query("pharmacy_provider_id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": rows})
}

// AdminDispenseAudit — GET /admin/dispense-audit  Rx/controlled dispense audit (HL-12).
func (h *Handler) AdminDispenseAudit(c *gin.Context) {
	rows, err := h.svc.AdminDispenseAudit(c.Request.Context(), c.Query("pharmacy_provider_id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "records": rows})
}

// AdminRecallProduct — POST /admin/products/:id/recall  pharmacovigilance/recall.
func (h *Handler) AdminRecallProduct(c *gin.Context) {
	if err := h.svc.AdminRecallProduct(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

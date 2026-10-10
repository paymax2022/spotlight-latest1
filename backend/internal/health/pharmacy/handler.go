package healthpharmacy

import (
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/strutil"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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

// failOrder is failErr plus the order-scoped uniform denial: the service
// returns ErrOrderNotFound for a missing order AND for "exists but the caller
// has no access" (same fold as social #602 / association #606 / aicare / vet /
// lab — no existence oracle), so both are 404, not the domain-refusal
// fallback.
func failOrder(c *gin.Context, fallback int, err error) {
	if errors.Is(err, ErrOrderNotFound) {
		failErr(c, http.StatusNotFound, err)
		return
	}
	failErr(c, fallback, err)
}

// VerifyPrescription — POST /prescriptions/:id/verify  (pharmacist, HL-3)
// body: { begin, approve, reason }. Reuses healthrx via the service verifier.
func (h *Handler) VerifyPrescription(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Begin   bool   `json:"begin"`
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	rxID, ok := uuidPathID(c, "prescription id")
	if !ok {
		return
	}
	if err := h.svc.VerifyPrescription(c.Request.Context(), id, rxID, req.Begin, req.Approve, req.Reason); err != nil {
		failErr(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ListMyPrescriptions — GET /prescriptions  (patient's own list)
func (h *Handler) ListMyPrescriptions(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	rx, err := h.svc.MyPrescriptions(c.Request.Context(), id)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "prescriptions": rx})
}

// ListProducts — GET /products?pharmacy_provider_id=&q=  (NAFDAC-gated, Rx flag, HL-5)
// q is an optional case-insensitive search on the medicine name or owning pharmacy name.
func (h *Handler) ListProducts(c *gin.Context) {
	// pharmacy_provider_id is optional, but once supplied it feeds a
	// uuid-column filter — a malformed value must be a 400, never a driver
	// error → 500.
	provID := c.Query("pharmacy_provider_id")
	if provID != "" {
		if _, err := uuid.Parse(provID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "pharmacy_provider_id must be a uuid")
			return
		}
	}
	products, err := h.svc.ListProducts(c.Request.Context(), provID, c.Query("q"))
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "products": products})
}

// GetProduct — GET /products/:id  (single catalog product + owning pharmacy name)
func (h *Handler) GetProduct(c *gin.Context) {
	productID, ok := uuidPathID(c, "product id")
	if !ok {
		return
	}
	p, err := h.svc.GetProduct(c.Request.Context(), productID)
	if err != nil {
		ginutil.FailOK(c, http.StatusNotFound, "product not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "product": p})
}

// UpsertProduct — POST /products  (pharmacy owner, HL-5 NAFDAC write-time gate)
func (h *Handler) UpsertProduct(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var p Product
	if err := c.ShouldBindJSON(&p); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// pharmacy_provider_id feeds the HL-2 provider-gate lookup (WHERE id=$1::uuid);
	// an empty/malformed value must be a 400, never a driver error → 422/500.
	if _, err := uuid.Parse(p.PharmacyProviderID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "pharmacy_provider_id must be a uuid")
		return
	}
	// A caller-pinned id feeds the pharmacy_products PK (uuid); malformed → 400.
	if p.ID != "" {
		if _, err := uuid.Parse(p.ID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "id must be a uuid")
			return
		}
	}
	out, err := h.svc.UpsertProduct(c.Request.Context(), id, p)
	if err != nil {
		failErr(c, http.StatusUnprocessableEntity, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "product": out})
}

// MyProducts — GET /products/mine
// The owner's own shelf, including lines customers cannot see (deactivated, or
// pending NAFDAC). Scoped by ownership server-side.
// Registered BEFORE /products/:id so Gin does not read "mine" as an id.
func (h *Handler) MyProducts(c *gin.Context) {
	list, err := h.svc.ListProductsForOwner(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "products": list})
}

// CreateOrder — POST /orders  (patient, payment HELD, HL-9)
func (h *Handler) CreateOrder(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		PharmacyProviderID string   `json:"pharmacy_provider_id"`
		PrescriptionID     *string  `json:"prescription_id"`
		FulfilmentMethod   string   `json:"fulfilment_method"`
		IdempotencyKey     string   `json:"idempotency_key"`
		SearchEventID      *string  `json:"search_event_id"`  // optional symptom-search link (PRD §10)
		DeliveryAddress    string   `json:"delivery_address"` // required when fulfilment_method=DELIVERY
		DeliveryLat        *float64 `json:"delivery_lat"`
		DeliveryLng        *float64 `json:"delivery_lng"`
		Lines              []struct {
			ProductID string `json:"product_id"`
			Quantity  int    `json:"quantity"`
		} `json:"lines"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// pharmacy_provider_id feeds the HL-2 provider-gate lookup (WHERE id=$1::uuid);
	// an empty/malformed value must be a 400, never a driver error → 422/500.
	if _, err := uuid.Parse(req.PharmacyProviderID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "pharmacy_provider_id must be a uuid")
		return
	}
	// The optional link ids and every line's product_id feed uuid columns
	// (health_prescriptions.id, symptom_search_events.id, pharmacy_products.id) —
	// when present a malformed value must be a 400, never a driver error.
	if req.PrescriptionID != nil && *req.PrescriptionID != "" {
		if _, err := uuid.Parse(*req.PrescriptionID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "prescription_id must be a uuid")
			return
		}
	}
	if req.SearchEventID != nil && *req.SearchEventID != "" {
		if _, err := uuid.Parse(*req.SearchEventID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "search_event_id must be a uuid")
			return
		}
	}
	for _, l := range req.Lines {
		if _, err := uuid.Parse(l.ProductID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "lines.product_id must be a uuid")
			return
		}
	}
	idem := strutil.FirstNonEmpty(ginutil.IdempotencyKey(c), req.IdempotencyKey)
	in := CreateOrderInput{
		PharmacyProviderID: req.PharmacyProviderID,
		PrescriptionID:     req.PrescriptionID,
		FulfilmentMethod:   FulfilmentMethod(req.FulfilmentMethod),
		IdempotencyKey:     idem,
		SearchEventID:      req.SearchEventID,
		DeliveryAddress:    req.DeliveryAddress,
		DeliveryLat:        req.DeliveryLat,
		DeliveryLng:        req.DeliveryLng,
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
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	o, err := h.svc.Confirm(c.Request.Context(), ginutil.UserID(c), orderID)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Dispense — POST /orders/:id/dispense  (pharmacist, HL-1 clinical action, HL-3 dispense-once)
func (h *Handler) Dispense(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	o, err := h.svc.Dispense(c.Request.Context(), id, orderID)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Dispatch — POST /orders/:id/dispatch  (transport last-mile rail / pickup code)
func (h *Handler) Dispatch(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	o, err := h.svc.Dispatch(c.Request.Context(), id, orderID)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Complete — POST /orders/:id/complete  (release payment, HL-9)
// body: { pickup_code } (required only for PICKUP completion).
func (h *Handler) Complete(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	var req struct {
		PickupCode string `json:"pickup_code"`
	}
	_ = c.ShouldBindJSON(&req)
	o, err := h.svc.Complete(c.Request.Context(), id, orderID, req.PickupCode)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Cancel — POST /orders/:id/cancel  (patient, pre-DISPENSED → refund, HL-9)
func (h *Handler) Cancel(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	o, err := h.svc.Cancel(c.Request.Context(), id, orderID, req.Reason)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Get — GET /orders/:id  (object-level authZ: patient / pharmacy / admin)
func (h *Handler) Get(c *gin.Context) {
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	o, err := h.svc.Get(c.Request.Context(), ginutil.UserID(c), orderID, h.isAdmin(c))
	if err != nil {
		// Missing-or-denied is the sentinel → uniform 404; anything else is an
		// internal failure (the old blanket-403 misreported DB errors).
		failOrder(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// ListMine — GET /orders?state=&limit=&offset=
// The pharmacist's inbox: orders belonging to the pharmacies the CALLER owns.
// Scoping is derived server-side from ownership — the caller never names a
// pharmacy — so there is no id to tamper with, and a user who owns none gets an
// empty list.
// Registered BEFORE /orders/:id so Gin does not treat "orders" as an :id.
func (h *Handler) ListMine(c *gin.Context) {
	limit, offset := ginutil.LimitOffset(c)
	orders, err := h.svc.ListForOwner(
		c.Request.Context(), ginutil.UserID(c), c.Query("state"), limit, offset,
	)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": orders})
}

// ListMyOrders — GET /orders/mine?state=&limit=&offset=
// The patient's own order history: orders the CALLER placed. Counterpart to
// ListMine (the pharmacist inbox at GET /orders) — kept on a distinct path so
// the two never collide. Registered BEFORE /orders/:id for the same reason
// ListMine is: Gin must not bind "mine" as :id.
func (h *Handler) ListMyOrders(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	limit, offset := ginutil.LimitOffset(c)
	orders, err := h.svc.ListForPatient(
		c.Request.Context(), id, c.Query("state"), limit, offset,
	)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": orders})
}

// Earnings — GET /earnings
// What the caller's pharmacies have been paid, and what is still held for them.
// Scoped by ownership server-side; an owner of nothing sees zeros.
func (h *Handler) Earnings(c *gin.Context) {
	e, err := h.svc.EarningsForOwner(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "earnings": e})
}

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
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "pharmacies": rows})
}

// GetPharmacy — GET /pharmacies/:id  discoverable pharmacy detail (HL-2).
func (h *Handler) GetPharmacy(c *gin.Context) {
	providerID, ok := uuidPathID(c, "pharmacy id")
	if !ok {
		return
	}
	p, err := h.svc.GetPharmacyProfile(c.Request.Context(), providerID)
	if err != nil {
		// Constant text — never service error text (a driver error must not
		// reach the body even at 404).
		ginutil.FailOK(c, http.StatusNotFound, "pharmacy not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "pharmacy": p})
}

// ListPharmacyReviews — GET /pharmacies/:id/reviews  public rating feed.
func (h *Handler) ListPharmacyReviews(c *gin.Context) {
	// :id feeds a uuid-column filter (pharmacy_provider_id=$1) — malformed →
	// 400, never a driver error → 500.
	if _, err := uuid.Parse(c.Param("id")); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "pharmacy id must be a uuid")
		return
	}
	rows, err := h.svc.ListReviews(c.Request.Context(), c.Param("id"))
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "reviews": rows})
}

// UpsertPharmacyProfile — POST /pharmacies/:id/profile  (verified owner, HL-2)
func (h *Handler) UpsertPharmacyProfile(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req UpsertPharmacyProfileInput
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// :id feeds the HL-2 provider-gate lookup (WHERE id=$1::uuid) — malformed →
	// 400, never a driver error → 422/500.
	if _, err := uuid.Parse(c.Param("id")); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "pharmacy id must be a uuid")
		return
	}
	p, err := h.svc.UpsertPharmacyProfile(c.Request.Context(), id, c.Param("id"), req)
	if err != nil {
		failErr(c, http.StatusUnprocessableEntity, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "pharmacy": p})
}

// SubmitReview — POST /orders/:id/reviews  (patient, order must be completed)
func (h *Handler) SubmitReview(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Rating int    `json:"rating"`
		Body   string `json:"body"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	r, err := h.svc.SubmitReview(c.Request.Context(), id, orderID, req.Rating, req.Body)
	if err != nil {
		failOrder(c, http.StatusUnprocessableEntity, err)
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

// AdminListOrders — GET /admin/orders  order/delivery oversight.
// Accepts the admin frontend's `status` + `fulfilment` param names
// (healthPharmacyAdminService.ts listOrders) and aliases the older
// `state`/`fulfilment_method` names for back-compat. Values are upper-cased
// before the query since pharmacy_orders.state/fulfilment_method store
// upper-case enum values (OrderState/FulfilmentMethod, model.go) while the
// frontend's status vocabulary is lower-case.
func (h *Handler) AdminListOrders(c *gin.Context) {
	state := strings.ToUpper(strings.TrimSpace(strutil.FirstNonEmpty(c.Query("status"), c.Query("state"))))
	fulfilment := strings.ToUpper(strings.TrimSpace(strutil.FirstNonEmpty(c.Query("fulfilment"), c.Query("fulfilment_method"))))
	provID, ok := uuidQueryID(c, "pharmacy_provider_id")
	if !ok {
		return
	}
	rows, err := h.svc.AdminListOrders(c.Request.Context(), state, fulfilment, provID)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows, "orders": rows})
}

// AdminGetOrder — GET /admin/orders/:id  single admin-scoped order detail read
// (PHARMACY-001). Only a list existed before; the admin console's order-detail
// drawer (healthPharmacyAdminService.ts getOrder) had nothing to call and 404'd.
func (h *Handler) AdminGetOrder(c *gin.Context) {
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	o, err := h.svc.AdminGetOrder(c.Request.Context(), orderID)
	if err != nil {
		ginutil.FailOK(c, http.StatusNotFound, "order not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": o, "order": o})
}

// AdminDashboard — GET /admin/dashboard  platform-wide KPI aggregate
// (PHARMACY-001). See Service.AdminDashboard / AdminDashboard (admin.go) for
// exactly what is computed and why fields this batch cannot honestly compute
// are left off the shape entirely rather than fabricated.
func (h *Handler) AdminDashboard(c *gin.Context) {
	d, err := h.svc.AdminDashboard(c.Request.Context())
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": d})
}

// AdminDispenseAudit — GET /admin/dispense-audit  Rx/controlled dispense audit (HL-12).
func (h *Handler) AdminDispenseAudit(c *gin.Context) {
	provID, ok := uuidQueryID(c, "pharmacy_provider_id")
	if !ok {
		return
	}
	rows, err := h.svc.AdminDispenseAudit(c.Request.Context(), provID)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "records": rows})
}

// AdminRecallProduct — POST /admin/products/:id/recall  pharmacovigilance/recall.
func (h *Handler) AdminRecallProduct(c *gin.Context) {
	productID, ok := uuidPathID(c, "product id")
	if !ok {
		return
	}
	if err := h.svc.AdminRecallProduct(c.Request.Context(), ginutil.UserID(c), productID); err != nil {
		failErr(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

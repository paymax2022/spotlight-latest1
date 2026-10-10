package healthlab

import (
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/strutil"
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/tiers"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Handler exposes the HEALTH-BUILD §6 Laboratory API. AuthN is the finance auth
// chain (user_id mirrored onto the gin context); per-route RBAC + object-level
// authZ is applied here and in the service. isAdmin reports the caller's health
// lab admin permission (drives admin-basis reads).
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
// has no access" (same fold as social #602 / association #606 / aicare / vet —
// no existence oracle), so both are 404, not the domain-refusal fallback.
func failOrder(c *gin.Context, fallback int, err error) {
	if errors.Is(err, ErrOrderNotFound) || errors.Is(err, ErrSampleNotFound) {
		failErr(c, http.StatusNotFound, err)
		return
	}
	failErr(c, fallback, err)
}

// ListTests — GET /tests?lab_provider_id=  (catalog: prep, TAT, price)
func (h *Handler) ListTests(c *gin.Context) {
	// lab_provider_id is optional, but once supplied it feeds a uuid-column
	// filter — a malformed value must be a 400, never a driver error → 500.
	provID := c.Query("lab_provider_id")
	if provID != "" {
		if _, err := uuid.Parse(provID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "lab_provider_id must be a uuid")
			return
		}
	}
	tests, err := h.svc.ListTests(c.Request.Context(), provID)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "tests": tests})
}

// ListPackages — GET /packages?lab_provider_id=  (bundle catalog, same shape as ListTests)
func (h *Handler) ListPackages(c *gin.Context) {
	// Same uuid-column filter guard as ListTests.
	provID := c.Query("lab_provider_id")
	if provID != "" {
		if _, err := uuid.Parse(provID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "lab_provider_id must be a uuid")
			return
		}
	}
	packages, err := h.svc.ListPackages(c.Request.Context(), provID)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "packages": packages})
}

// ListMyOrders — GET /orders  (patient's own order history + active-order card)
func (h *Handler) ListMyOrders(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	orders, err := h.svc.ListOrdersForPatient(c.Request.Context(), id)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": orders})
}

// UpsertTest — POST /tests  (lab owner, HL-2 catalog governance)
func (h *Handler) UpsertTest(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var t Test
	if err := c.ShouldBindJSON(&t); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// lab_provider_id feeds the HL-2 provider-gate lookup (WHERE id=$1::uuid);
	// an empty/malformed value must be a 400, never a driver error → 422/500.
	if _, err := uuid.Parse(t.LabProviderID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "lab_provider_id must be a uuid")
		return
	}
	// A caller-pinned id feeds the lab_tests PK (uuid); malformed → 400, never a
	// driver error → 422/500. Empty is fine — the service mints one.
	if t.ID != "" {
		if _, err := uuid.Parse(t.ID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "id must be a uuid")
			return
		}
	}
	out, err := h.svc.UpsertTest(c.Request.Context(), id, t)
	if err != nil {
		failErr(c, http.StatusUnprocessableEntity, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "test": out})
}

// ListProviderOrders — GET /provider/orders?lab_provider_id=  (lab staff order list)
func (h *Handler) ListProviderOrders(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	// lab_provider_id feeds the HL-2 provider-gate lookup (WHERE id=$1::uuid);
	// an empty/malformed value must be a 400, never a driver error.
	provID := c.Query("lab_provider_id")
	if _, err := uuid.Parse(provID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "lab_provider_id must be a uuid")
		return
	}
	rows, err := h.svc.ListProviderOrders(c.Request.Context(), id, provID)
	if err != nil {
		// Provider-ownership denial — a scope refusal, not an object oracle:
		// provider ids are public catalogue data, so 403 is correct here.
		failErr(c, http.StatusForbidden, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": rows})
}

// UpsertStaff — POST /staff  (lab owner registers/suspends staff, HL-2
// affiliation ADR-PR640). The grant is what lets an affiliated scientist or
// phlebotomist act on THIS lab's orders; only the verified owner writes it.
func (h *Handler) UpsertStaff(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		LabProviderID string `json:"lab_provider_id"`
		UserID        string `json:"user_id"`
		Role          string `json:"role"`
		Status        string `json:"status"` // optional — defaults to ACTIVE
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// Both ids feed uuid columns — malformed values must be 400s, never driver
	// errors → 500.
	if _, err := uuid.Parse(req.LabProviderID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "lab_provider_id must be a uuid")
		return
	}
	if _, err := uuid.Parse(req.UserID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "user_id must be a uuid")
		return
	}
	if err := h.svc.UpsertStaff(c.Request.Context(), id, req.LabProviderID, req.UserID, req.Role, req.Status); err != nil {
		ginutil.FailOK(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// CreateOrder — POST /orders  (patient, payment HELD, HL-9)
func (h *Handler) CreateOrder(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		LabProviderID    string   `json:"lab_provider_id"`
		CollectionMethod string   `json:"collection_method"`
		IdempotencyKey   string   `json:"idempotency_key"`
		TestIDs          []string `json:"test_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// lab_provider_id feeds the HL-2 provider-gate lookup (WHERE id=$1::uuid);
	// an empty/malformed value must be a 400, never a driver error → 422/500.
	if _, err := uuid.Parse(req.LabProviderID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "lab_provider_id must be a uuid")
		return
	}
	// Every test id feeds the catalog price lookup (WHERE id=$1::uuid) — a
	// malformed entry must be a 400, never a driver error → 422/500.
	for _, testID := range req.TestIDs {
		if _, err := uuid.Parse(testID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "test_ids must be uuids")
			return
		}
	}
	idem := strutil.FirstNonEmpty(ginutil.IdempotencyKey(c), req.IdempotencyKey)
	in := CreateOrderInput{
		LabProviderID:    req.LabProviderID,
		CollectionMethod: CollectionMethod(req.CollectionMethod),
		IdempotencyKey:   idem,
		TestIDs:          req.TestIDs,
	}
	o, err := h.svc.CreateOrder(c.Request.Context(), id, in)
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
	c.JSON(http.StatusCreated, gin.H{"success": true, "order": o})
}

// Schedule — POST /orders/:id/schedule  (lab owner/admin; phlebotomist dispatch for HOME)
func (h *Handler) Schedule(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	o, err := h.svc.Schedule(c.Request.Context(), id, orderID, h.isAdmin(c))
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Collect — POST /orders/:id/collect  (phlebotomist: sample + custody, HL-6)
func (h *Handler) Collect(c *gin.Context) {
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
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.Collect(c.Request.Context(), id, orderID, req.Note)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "sample": sample})
}

// Handover — POST /samples/:id/handover  (custody transfer, HL-6)
func (h *Handler) Handover(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	sampleID, ok := uuidPathID(c, "sample id")
	if !ok {
		return
	}
	var req struct {
		ToCustodianID string `json:"to_custodian_id"`
		Note          string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	// to_custodian_id feeds lab_samples.custodian_id / lab_custody_events
	// .to_custodian (uuid columns) — when present a malformed value must be a
	// 400, never a driver error.
	if req.ToCustodianID != "" {
		if _, err := uuid.Parse(req.ToCustodianID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "to_custodian_id must be a uuid")
			return
		}
	}
	sample, err := h.svc.Handover(c.Request.Context(), id, sampleID, req.ToCustodianID, req.Note)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sample": sample})
}

// FlagBreach — POST /samples/:id/breach  (chain break → recollect, HL-6)
func (h *Handler) FlagBreach(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	sampleID, ok := uuidPathID(c, "sample id")
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.FlagBreach(c.Request.Context(), id, sampleID, req.Reason)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sample": sample})
}

// Accession — POST /samples/:id/accession  (lab intake, HL-6 chain gate)
func (h *Handler) Accession(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	sampleID, ok := uuidPathID(c, "sample id")
	if !ok {
		return
	}
	var req struct {
		Note           string `json:"note"`
		ScannedBarcode string `json:"scanned_barcode"` // EC-001: verified against the sample's minted barcode
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.Accession(c.Request.Context(), id, sampleID, req.ScannedBarcode, req.Note)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sample": sample})
}

// EnterResults — POST /orders/:id/results  (scientist enter + validate, HL-7)
func (h *Handler) EnterResults(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		ScannedBarcode string `json:"scanned_barcode"` // LR-001: verified against this order's sample
		Results        []struct {
			TestID   string `json:"test_id"`
			Value    string `json:"value"`
			Unit     string `json:"unit"`
			RefRange string `json:"ref_range"`
			Status   string `json:"status"`
		} `json:"results"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	in := make([]EnterResultInput, 0, len(req.Results))
	for _, r := range req.Results {
		// Each test_id feeds lab_order_lines.test_id / lab_results.test_id
		// (uuid columns) — malformed → 400, never a driver error.
		if _, err := uuid.Parse(r.TestID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "results.test_id must be a uuid")
			return
		}
		in = append(in, EnterResultInput{
			TestID: r.TestID, Value: r.Value, Unit: r.Unit, RefRange: r.RefRange, Status: ResultStatus(r.Status),
		})
	}
	o, err := h.svc.EnterResults(c.Request.Context(), id, orderID, req.ScannedBarcode, in)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Release — POST /orders/:id/release  (scientist sign-off → vault; release payment, HL-7/8/9)
func (h *Handler) Release(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	o, err := h.svc.Release(c.Request.Context(), id, orderID)
	if err != nil {
		failOrder(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Cancel — POST /orders/:id/cancel  (patient, pre-collection → refund, HL-9)
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

// Get — GET /orders/:id  (object-level authZ: patient / lab / admin)
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

// Results — GET /orders/:id/results  (object-level authZ, HL-8)
func (h *Handler) Results(c *gin.Context) {
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	rows, err := h.svc.Results(c.Request.Context(), ginutil.UserID(c), orderID, h.isAdmin(c))
	if err != nil {
		failOrder(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "results": rows})
}

// Custody — GET /orders/:id/custody  (chain-of-custody trail, HL-6/12)
func (h *Handler) Custody(c *gin.Context) {
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	rows, err := h.svc.CustodyTrail(c.Request.Context(), ginutil.UserID(c), orderID, h.isAdmin(c))
	if err != nil {
		failOrder(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "custody": rows})
}

// AdminListOrders — GET /admin/orders  order/results oversight.
func (h *Handler) AdminListOrders(c *gin.Context) {
	provID, ok := uuidQueryID(c, "lab_provider_id")
	if !ok {
		return
	}
	rows, err := h.svc.AdminListOrders(c.Request.Context(), c.Query("state"), provID)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": rows})
}

// AdminCustodyAudit — GET /admin/custody-audit  chain-of-custody oversight (HL-6/12).
// AdminCustodyAudit — GET /custody-audit?lab_provider_id=&sample_id=
// sample_id is a thin additive filter (see Service.AdminCustodyAudit's doc
// comment) so the admin console's per-sample custody-chain drawer can reuse
// this one route instead of a second custody read path.
func (h *Handler) AdminCustodyAudit(c *gin.Context) {
	provID, ok := uuidQueryID(c, "lab_provider_id")
	if !ok {
		return
	}
	sampleID, ok := uuidQueryID(c, "sample_id")
	if !ok {
		return
	}
	rows, err := h.svc.AdminCustodyAudit(c.Request.Context(), provID, sampleID)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "events": rows})
}

// AdminDashboard — GET /admin/dashboard  platform-wide KPI aggregate. See
// Service.AdminDashboard / AdminDashboard (admin.go) for exactly what is
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

// AdminEscalations — GET /admin/escalations  critical-result escalation oversight (HL-7).
func (h *Handler) AdminEscalations(c *gin.Context) {
	provID, ok := uuidQueryID(c, "lab_provider_id")
	if !ok {
		return
	}
	rows, err := h.svc.AdminEscalations(c.Request.Context(), provID)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "escalations": rows})
}

// AdminDeactivateTest — POST /admin/tests/:id/deactivate  catalog governance.
func (h *Handler) AdminDeactivateTest(c *gin.Context) {
	testID, ok := uuidPathID(c, "test id")
	if !ok {
		return
	}
	if err := h.svc.AdminDeactivateTest(c.Request.Context(), ginutil.UserID(c), testID); err != nil {
		failErr(c, http.StatusConflict, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

package healthlab

import (
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
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
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
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
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
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
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
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
		ginutil.FailOK(c, http.StatusUnprocessableEntity, err.Error())
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
		ginutil.FailOK(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "orders": rows})
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
			ginutil.FailOK(c, http.StatusForbidden, err.Error())
		case errors.Is(err, escrow.ErrTierGateUnwired):
			ginutil.FailOK(c, http.StatusServiceUnavailable, err.Error())
		default:
			ginutil.FailOK(c, http.StatusUnprocessableEntity, err.Error())
		}
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "order": o})
}

// failOrderMutation maps the not-found sentinel to a uniform 404 and keeps
// every other service error at the historical 409.
func failOrderMutation(c *gin.Context, err error) {
	if errors.Is(err, ErrOrderNotFound) {
		ginutil.FailOK(c, http.StatusNotFound, ErrOrderNotFound.Error())
		return
	}
	ginutil.FailOK(c, http.StatusConflict, err.Error())
}

// Schedule — POST /orders/:id/schedule  (lab owner/admin; phlebotomist dispatch for HOME)
func (h *Handler) Schedule(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	o, err := h.svc.Schedule(c.Request.Context(), id, c.Param("id"), h.isAdmin(c))
	if err != nil {
		failOrderMutation(c, err)
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
	var req struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.Collect(c.Request.Context(), id, c.Param("id"), req.Note)
	if err != nil {
		failOrderMutation(c, err)
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
	var req struct {
		ToCustodianID string `json:"to_custodian_id"`
		Note          string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.Handover(c.Request.Context(), id, c.Param("id"), req.ToCustodianID, req.Note)
	if err != nil {
		failOrderMutation(c, err)
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
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.FlagBreach(c.Request.Context(), id, c.Param("id"), req.Reason)
	if err != nil {
		failOrderMutation(c, err)
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
	var req struct {
		Note           string `json:"note"`
		ScannedBarcode string `json:"scanned_barcode"` // EC-001: verified against the sample's minted barcode
	}
	_ = c.ShouldBindJSON(&req)
	sample, err := h.svc.Accession(c.Request.Context(), id, c.Param("id"), req.ScannedBarcode, req.Note)
	if err != nil {
		failOrderMutation(c, err)
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
	in := make([]EnterResultInput, 0, len(req.Results))
	for _, r := range req.Results {
		in = append(in, EnterResultInput{
			TestID: r.TestID, Value: r.Value, Unit: r.Unit, RefRange: r.RefRange, Status: ResultStatus(r.Status),
		})
	}
	o, err := h.svc.EnterResults(c.Request.Context(), id, c.Param("id"), req.ScannedBarcode, in)
	if err != nil {
		failOrderMutation(c, err)
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
	o, err := h.svc.Release(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		failOrderMutation(c, err)
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
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	o, err := h.svc.Cancel(c.Request.Context(), id, c.Param("id"), req.Reason)
	if err != nil {
		failOrderMutation(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// failOrderRead maps the not-found/unauthorized sentinel to a uniform 404 —
// a foreign order is indistinguishable from a missing one — and reports any
// other failure as a real server error (a pool error is not a 403).
func failOrderRead(c *gin.Context, err error) {
	if errors.Is(err, ErrOrderNotFound) {
		ginutil.FailOK(c, http.StatusNotFound, ErrOrderNotFound.Error())
		return
	}
	ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
}

// Get — GET /orders/:id  (object-level authZ: patient / lab / admin)
func (h *Handler) Get(c *gin.Context) {
	o, err := h.svc.Get(c.Request.Context(), ginutil.UserID(c), c.Param("id"), h.isAdmin(c))
	if err != nil {
		failOrderRead(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "order": o})
}

// Results — GET /orders/:id/results  (object-level authZ, HL-8)
func (h *Handler) Results(c *gin.Context) {
	rows, err := h.svc.Results(c.Request.Context(), ginutil.UserID(c), c.Param("id"), h.isAdmin(c))
	if err != nil {
		failOrderRead(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "results": rows})
}

// Custody — GET /orders/:id/custody  (chain-of-custody trail, HL-6/12)
func (h *Handler) Custody(c *gin.Context) {
	rows, err := h.svc.CustodyTrail(c.Request.Context(), ginutil.UserID(c), c.Param("id"), h.isAdmin(c))
	if err != nil {
		failOrderRead(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "custody": rows})
}

// AdminListOrders — GET /admin/orders  order/results oversight.
func (h *Handler) AdminListOrders(c *gin.Context) {
	rows, err := h.svc.AdminListOrders(c.Request.Context(), c.Query("state"), c.Query("lab_provider_id"))
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
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
	rows, err := h.svc.AdminCustodyAudit(c.Request.Context(), c.Query("lab_provider_id"), c.Query("sample_id"))
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
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
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": d})
}

// AdminEscalations — GET /admin/escalations  critical-result escalation oversight (HL-7).
func (h *Handler) AdminEscalations(c *gin.Context) {
	rows, err := h.svc.AdminEscalations(c.Request.Context(), c.Query("lab_provider_id"))
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "escalations": rows})
}

// AdminDeactivateTest — POST /admin/tests/:id/deactivate  catalog governance.
func (h *Handler) AdminDeactivateTest(c *gin.Context) {
	if err := h.svc.AdminDeactivateTest(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		ginutil.FailOK(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

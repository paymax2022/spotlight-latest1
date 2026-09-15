package utilitybills

// admin_handler.go holds the Phase 4 admin handlers. Same rules as handler.go:
// bind, delegate, map errors — no business logic, no validation that the service
// does not also enforce (a rule that lives only in a handler can be bypassed by
// a job or a test that reaches the service another way).
//
// ── The one thing here that is not boilerplate: PATCH binding ───────────────
// A partial update has THREE states per field, not two: absent (leave it),
// present-with-a-value (set it), and present-and-null (clear it). Go's usual
// bind-into-a-pointer-struct collapses the last two — both produce a nil
// pointer — so a PATCH could never distinguish "don't touch max_amount_kobo"
// from "this product no longer has a maximum".
//
// So PATCH bodies are decoded into map[string]json.RawMessage first (`patchBody`
// below), which preserves key PRESENCE, and each field is pulled out
// individually into the repository's Patch structs and their Clear* flags.

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// adminActor resolves the acting admin's user id for the audit trail.
//
// Reads the SAME context key as requireUser: RequireAuthContext populates
// "user_id" identically for the member and admin route groups (utilitybills_routes.go
// mounts authMW then requireUserID on both), so there is no separate admin
// identity to look up.
//
// Unlike requireUser it does NOT write a 401 on a miss — the admin group's
// middleware chain has already rejected an unauthenticated caller by the time a
// handler runs, so an empty value here means a middleware wiring bug, which the
// service logs as an unattributed action rather than failing the operation.
func adminActor(c *gin.Context) string { return c.GetString("user_id") }

// ── PATCH body binding ───────────────────────────────────────────────────────

// patchBody is a decoded JSON object that remembers which keys were PRESENT.
type patchBody map[string]json.RawMessage

// bindPatch decodes the request body as a JSON object, preserving key presence.
func bindPatch(c *gin.Context) (patchBody, bool) {
	var body patchBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return nil, false
	}
	return body, true
}

// isNull reports whether the key was present with an explicit JSON null — the
// "clear this column" signal.
func (p patchBody) isNull(key string) bool {
	raw, ok := p[key]
	return ok && string(raw) == "null"
}

// str extracts a string field, or nil when absent/null.
func (p patchBody) str(key string) (*string, error) {
	raw, ok := p[key]
	if !ok || string(raw) == "null" {
		return nil, nil
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("%w: %s must be a string", ErrFieldRequired, key)
	}
	return &v, nil
}

// i64 extracts an integer field, or nil when absent/null.
//
// Two money-path rules are enforced here rather than left to encoding/json's
// defaults, because both defaults are wrong for kobo:
//
//   - Decoding goes through json.Number, never float64. A kobo value above 2^53
//     round-tripped through a float is a silently wrong amount of money.
//   - A QUOTED number is REJECTED. Unmarshalling into a json.Number accepts
//     `"500"` as readily as `500` — it validates the digits, not the JSON type —
//     so without the explicit check below, a string-typed amount would bind
//     silently. On a surface that sets prices, a caller who sent the wrong type
//     should be told so, not guessed at.
func (p patchBody) i64(key string) (*int64, error) {
	raw, ok := p[key]
	if !ok || string(raw) == "null" {
		return nil, nil
	}
	if trimmed := bytes.TrimSpace(raw); len(trimmed) == 0 || trimmed[0] == '"' {
		return nil, fmt.Errorf("%w: %s must be a JSON number, not a string", ErrInvalidAmount, key)
	}
	var n json.Number
	if err := json.Unmarshal(raw, &n); err != nil {
		return nil, fmt.Errorf("%w: %s must be a number", ErrInvalidAmount, key)
	}
	v, err := n.Int64()
	if err != nil {
		return nil, fmt.Errorf("%w: %s must be a whole number (minor units)", ErrInvalidAmount, key)
	}
	return &v, nil
}

// i extracts an int field, or nil when absent/null.
func (p patchBody) i(key string) (*int, error) {
	v, err := p.i64(key)
	if err != nil || v == nil {
		return nil, err
	}
	n := int(*v)
	return &n, nil
}

// boolean extracts a bool field, or nil when absent/null.
func (p patchBody) boolean(key string) (*bool, error) {
	raw, ok := p[key]
	if !ok || string(raw) == "null" {
		return nil, nil
	}
	var v bool
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("%w: %s must be a boolean", ErrFieldRequired, key)
	}
	return &v, nil
}

// strSlice extracts a string-array field, or nil when absent/null.
func (p patchBody) strSlice(key string) (*[]string, error) {
	raw, ok := p[key]
	if !ok || string(raw) == "null" {
		return nil, nil
	}
	var v []string
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("%w: %s must be an array of strings", ErrFieldRequired, key)
	}
	return &v, nil
}

// rawJSON returns a raw JSON sub-object, or nil when absent/null.
func (p patchBody) rawJSON(key string) json.RawMessage {
	raw, ok := p[key]
	if !ok || string(raw) == "null" {
		return nil
	}
	return raw
}

// adminPage reads the admin pagination query params. Defaults 50, cap 200 —
// ported from _utils.ts's adminPagination, NOT the member-facing 20/100.
// The service re-applies the same bounds; this is only so the echoed `meta`
// reflects what was actually used.
func adminPage(c *gin.Context) (int, int) {
	return adminListBounds(intQuery(c, "limit", 50), intQuery(c, "offset", 0))
}

// ── Providers ────────────────────────────────────────────────────────────────

// AdminListProviders handles GET /api/finance/admin/utilitybills/providers
func (h *Handler) AdminListProviders(c *gin.Context) {
	limit, offset := adminPage(c)
	rows, err := h.svc.AdminListProviders(c.Request.Context(), limit, offset)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"providers": rows, "meta": pageMeta(limit, offset, len(rows))})
}

// AdminCreateProvider handles POST /api/finance/admin/utilitybills/providers
func (h *Handler) AdminCreateProvider(c *gin.Context) {
	var in ProviderInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	row, err := h.svc.CreateProvider(c.Request.Context(), adminActor(c), in)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"provider": row})
}

// AdminUpdateProvider handles PATCH /api/finance/admin/utilitybills/providers/:id
func (h *Handler) AdminUpdateProvider(c *gin.Context) {
	body, ok := bindPatch(c)
	if !ok {
		return
	}
	// Credentials never travel through the generic patch — they have their own
	// encrypting endpoint. Rejected rather than ignored (see ErrCredentialsNotPatchable).
	if _, present := body["credentials"]; present {
		writeErr(c, ErrCredentialsNotPatchable)
		return
	}

	var patch ProviderPatch
	err := firstErr(
		func() (err error) { patch.Name, err = body.str("name"); return },
		func() (err error) { patch.Code, err = body.str("code"); return },
		func() (err error) { patch.AdapterCode, err = body.str("adapter_code"); return },
		func() (err error) { patch.Status, err = body.str("status"); return },
		func() (err error) { patch.SupportedCategories, err = body.strSlice("supported_categories"); return },
		func() (err error) { patch.Priority, err = body.i("priority"); return },
		func() (err error) { patch.HealthStatus, err = body.str("health_status"); return },
	)
	if err != nil {
		writeErr(c, err)
		return
	}
	patch.Config = body.rawJSON("config")

	row, uerr := h.svc.UpdateProvider(c.Request.Context(), adminActor(c), c.Param("id"), patch)
	if uerr != nil {
		writeErr(c, uerr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"provider": row})
}

// AdminRotateProviderCredentials handles
// PUT /api/finance/admin/utilitybills/providers/:id/credentials
//
// Accepts BOTH body shapes: the TS contract's {"credentials": {...}} wrapper
// (what app/api/admin/utility/providers/[id]/credentials/route.ts sends) and a
// bare {"api_key": "..."} object. The wrapper wins when present; a bare body is
// treated as the credential map itself. Accepting both means neither an existing
// admin client nor a hand-rolled curl can silently rotate nothing — the failure
// mode here is an admin who believes a secret was replaced when it was not.
//
// The request body is NEVER logged, here or anywhere below it — not on the
// success path, not in an error, not in the audit row.
func (h *Handler) AdminRotateProviderCredentials(c *gin.Context) {
	var raw map[string]any
	if err := c.ShouldBindJSON(&raw); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	credentials := raw
	if wrapped, ok := raw["credentials"]; ok {
		nested, isObject := wrapped.(map[string]any)
		if !isObject {
			writeErr(c, ErrCredentialsRequired)
			return
		}
		credentials = nested
	}

	row, err := h.svc.RotateProviderCredentials(c.Request.Context(), adminActor(c), c.Param("id"), credentials)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"provider": row})
}

// AdminHealthCheckProvider handles
// POST /api/finance/admin/utilitybills/providers/:id/health-check
func (h *Handler) AdminHealthCheckProvider(c *gin.Context) {
	result, row, err := h.svc.HealthCheckProvider(c.Request.Context(), adminActor(c), c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	// A 'down' provider is a SUCCESSFUL health check with a bad answer — 200, not
	// 503. The caller asked what the health is, and got a true answer.
	c.JSON(http.StatusOK, gin.H{
		"health":   gin.H{"status": result.Status, "message": result.Message},
		"provider": row,
	})
}

// ── Billers ──────────────────────────────────────────────────────────────────

// AdminListBillers handles GET /api/finance/admin/utilitybills/billers
func (h *Handler) AdminListBillers(c *gin.Context) {
	limit, offset := adminPage(c)
	rows, err := h.svc.AdminListBillers(c.Request.Context(), limit, offset)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"billers": rows, "meta": pageMeta(limit, offset, len(rows))})
}

// AdminCreateBiller handles POST /api/finance/admin/utilitybills/billers
func (h *Handler) AdminCreateBiller(c *gin.Context) {
	var in BillerInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	row, err := h.svc.CreateBiller(c.Request.Context(), adminActor(c), in)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"biller": row})
}

// AdminUpdateBiller handles PATCH /api/finance/admin/utilitybills/billers/:id
func (h *Handler) AdminUpdateBiller(c *gin.Context) {
	body, ok := bindPatch(c)
	if !ok {
		return
	}
	var patch BillerPatch
	err := firstErr(
		func() (err error) { patch.Category, err = body.str("category"); return },
		func() (err error) { patch.Name, err = body.str("name"); return },
		func() (err error) { patch.Code, err = body.str("code"); return },
		func() (err error) { patch.Country, err = body.str("country"); return },
		func() (err error) { patch.Status, err = body.str("status"); return },
		func() (err error) { patch.RequiresValidation, err = body.boolean("requires_validation"); return },
		func() (err error) {
			patch.CustomerReferenceLabel, err = body.str("customer_reference_label")
			return
		},
	)
	if err != nil {
		writeErr(c, err)
		return
	}
	row, uerr := h.svc.UpdateBiller(c.Request.Context(), adminActor(c), c.Param("id"), patch)
	if uerr != nil {
		writeErr(c, uerr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"biller": row})
}

// ── Products ─────────────────────────────────────────────────────────────────

// AdminListProducts handles GET /api/finance/admin/utilitybills/products
func (h *Handler) AdminListProducts(c *gin.Context) {
	limit, offset := adminPage(c)
	rows, err := h.svc.AdminListProducts(c.Request.Context(), limit, offset)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"products": rows, "meta": pageMeta(limit, offset, len(rows))})
}

// AdminCreateProduct handles POST /api/finance/admin/utilitybills/products
func (h *Handler) AdminCreateProduct(c *gin.Context) {
	var in ProductInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	row, err := h.svc.CreateProduct(c.Request.Context(), adminActor(c), in)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"product": row})
}

// AdminUpdateProduct handles PATCH /api/finance/admin/utilitybills/products/:id
func (h *Handler) AdminUpdateProduct(c *gin.Context) {
	body, ok := bindPatch(c)
	if !ok {
		return
	}
	var patch ProductPatch
	err := firstErr(
		func() (err error) { patch.BillerID, err = body.str("biller_id"); return },
		func() (err error) { patch.Category, err = body.str("category"); return },
		func() (err error) { patch.Name, err = body.str("name"); return },
		func() (err error) { patch.Code, err = body.str("code"); return },
		func() (err error) { patch.AmountType, err = body.str("amount_type"); return },
		func() (err error) { patch.AmountKobo, err = body.i64("amount_kobo"); return },
		func() (err error) { patch.MinAmountKobo, err = body.i64("min_amount_kobo"); return },
		func() (err error) { patch.MaxAmountKobo, err = body.i64("max_amount_kobo"); return },
		func() (err error) { patch.ConvenienceFeeKobo, err = body.i64("convenience_fee_kobo"); return },
		func() (err error) { patch.MarkupBps, err = body.i64("markup_bps"); return },
		func() (err error) { patch.ProviderDiscountBps, err = body.i64("provider_discount_bps"); return },
		func() (err error) { patch.Status, err = body.str("status"); return },
	)
	if err != nil {
		writeErr(c, err)
		return
	}
	patch.ClearAmountKobo = body.isNull("amount_kobo")
	patch.ClearMinAmountKobo = body.isNull("min_amount_kobo")
	patch.ClearMaxAmountKobo = body.isNull("max_amount_kobo")

	row, uerr := h.svc.UpdateProduct(c.Request.Context(), adminActor(c), c.Param("id"), patch)
	if uerr != nil {
		writeErr(c, uerr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"product": row})
}

// importBody is the product-import request.
//
// Accepts BOTH shapes, for the same reason credentialsBody does: the TS route
// sends {"products": [...]}, while a bare JSON array is the obvious hand-rolled
// form. An import that silently imported nothing would be the worst failure mode
// for this endpoint.
type importBody struct {
	Products []ProductInput `json:"products"`
}

// AdminImportProducts handles POST /api/finance/admin/utilitybills/products/import
func (h *Handler) AdminImportProducts(c *gin.Context) {
	raw, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	var products []ProductInput
	if arrErr := json.Unmarshal(raw, &products); arrErr != nil {
		var wrapped importBody
		if objErr := json.Unmarshal(raw, &wrapped); objErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: expected a product array or {\"products\": [...]}"})
			return
		}
		products = wrapped.Products
	}

	rows, ierr := h.svc.ImportProducts(c.Request.Context(), adminActor(c), products)
	if ierr != nil {
		writeErr(c, ierr)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"products": rows, "count": len(rows)})
}

// ── Provider/product mappings ────────────────────────────────────────────────

// AdminListMappings handles GET /api/finance/admin/utilitybills/provider-products
func (h *Handler) AdminListMappings(c *gin.Context) {
	limit, offset := adminPage(c)
	rows, err := h.svc.AdminListMappings(c.Request.Context(), limit, offset)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"provider_products": rows, "meta": pageMeta(limit, offset, len(rows))})
}

// AdminCreateMapping handles POST /api/finance/admin/utilitybills/provider-products
func (h *Handler) AdminCreateMapping(c *gin.Context) {
	var in MappingInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	row, err := h.svc.CreateMapping(c.Request.Context(), adminActor(c), in)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"provider_product": row})
}

// AdminUpdateMapping handles PATCH /api/finance/admin/utilitybills/provider-products/:id
func (h *Handler) AdminUpdateMapping(c *gin.Context) {
	body, ok := bindPatch(c)
	if !ok {
		return
	}
	var patch MappingPatch
	err := firstErr(
		func() (err error) { patch.ProviderID, err = body.str("provider_id"); return },
		func() (err error) { patch.ProductID, err = body.str("product_id"); return },
		func() (err error) { patch.ProviderProductCode, err = body.str("provider_product_code"); return },
		func() (err error) { patch.ProviderBillerCode, err = body.str("provider_biller_code"); return },
		func() (err error) { patch.ProviderCostKobo, err = body.i64("provider_cost_kobo"); return },
		func() (err error) { patch.ProviderDiscountBps, err = body.i64("provider_discount_bps"); return },
		func() (err error) { patch.Status, err = body.str("status"); return },
	)
	if err != nil {
		writeErr(c, err)
		return
	}
	patch.ClearProviderCostKobo = body.isNull("provider_cost_kobo")

	row, uerr := h.svc.UpdateMapping(c.Request.Context(), adminActor(c), c.Param("id"), patch)
	if uerr != nil {
		writeErr(c, uerr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"provider_product": row})
}

// ── Routing rules ────────────────────────────────────────────────────────────

// AdminListRoutingRules handles GET /api/finance/admin/utilitybills/routing-rules
func (h *Handler) AdminListRoutingRules(c *gin.Context) {
	limit, offset := adminPage(c)
	rows, err := h.svc.AdminListRoutingRules(c.Request.Context(), limit, offset)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"routing_rules": rows, "meta": pageMeta(limit, offset, len(rows))})
}

// AdminCreateRoutingRule handles POST /api/finance/admin/utilitybills/routing-rules
func (h *Handler) AdminCreateRoutingRule(c *gin.Context) {
	var in RoutingRuleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	row, err := h.svc.CreateRoutingRule(c.Request.Context(), adminActor(c), in)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"routing_rule": row})
}

// AdminUpdateRoutingRule handles PATCH /api/finance/admin/utilitybills/routing-rules/:id
func (h *Handler) AdminUpdateRoutingRule(c *gin.Context) {
	body, ok := bindPatch(c)
	if !ok {
		return
	}
	var patch RoutingRulePatch
	err := firstErr(
		func() (err error) { patch.Category, err = body.str("category"); return },
		func() (err error) { patch.BillerID, err = body.str("biller_id"); return },
		func() (err error) { patch.ProductID, err = body.str("product_id"); return },
		func() (err error) { patch.ProviderID, err = body.str("provider_id"); return },
		func() (err error) { patch.Priority, err = body.i("priority"); return },
		func() (err error) { patch.MinAmountKobo, err = body.i64("min_amount_kobo"); return },
		func() (err error) { patch.MaxAmountKobo, err = body.i64("max_amount_kobo"); return },
		func() (err error) { patch.Status, err = body.str("status"); return },
	)
	if err != nil {
		writeErr(c, err)
		return
	}
	patch.ClearCategory = body.isNull("category")
	patch.ClearBillerID = body.isNull("biller_id")
	patch.ClearProductID = body.isNull("product_id")
	patch.ClearMinAmountKobo = body.isNull("min_amount_kobo")
	patch.ClearMaxAmountKobo = body.isNull("max_amount_kobo")

	row, uerr := h.svc.UpdateRoutingRule(c.Request.Context(), adminActor(c), c.Param("id"), patch)
	if uerr != nil {
		writeErr(c, uerr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"routing_rule": row})
}

// ── Category settings ────────────────────────────────────────────────────────

// AdminListCategorySettings handles GET /api/finance/admin/utilitybills/categories
func (h *Handler) AdminListCategorySettings(c *gin.Context) {
	rows, err := h.svc.AdminListCategorySettings(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"categories": rows})
}

// AdminCreateCategorySetting handles POST /api/finance/admin/utilitybills/categories
func (h *Handler) AdminCreateCategorySetting(c *gin.Context) {
	var in CategorySettingInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	row, err := h.svc.CreateCategorySetting(c.Request.Context(), adminActor(c), in)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"category": row})
}

// AdminUpdateCategorySetting handles
// PATCH /api/finance/admin/utilitybills/categories/:category
//
// Keyed on the category TEXT column, not a uuid — utility_category_settings's
// primary key IS the category.
func (h *Handler) AdminUpdateCategorySetting(c *gin.Context) {
	body, ok := bindPatch(c)
	if !ok {
		return
	}
	var patch CategorySettingPatch
	err := firstErr(
		func() (err error) { patch.Enabled, err = body.boolean("enabled"); return },
		func() (err error) { patch.AvailabilityMessage, err = body.str("availability_message"); return },
		func() (err error) { patch.DailyLimitKobo, err = body.i64("daily_limit_kobo"); return },
		func() (err error) { patch.MinAmountKobo, err = body.i64("min_amount_kobo"); return },
		func() (err error) { patch.MaxAmountKobo, err = body.i64("max_amount_kobo"); return },
	)
	if err != nil {
		writeErr(c, err)
		return
	}
	patch.ClearAvailabilityMessage = body.isNull("availability_message")
	patch.ClearDailyLimitKobo = body.isNull("daily_limit_kobo")
	patch.ClearMinAmountKobo = body.isNull("min_amount_kobo")
	patch.ClearMaxAmountKobo = body.isNull("max_amount_kobo")

	row, uerr := h.svc.UpdateCategorySetting(c.Request.Context(), adminActor(c), c.Param("category"), patch)
	if uerr != nil {
		writeErr(c, uerr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"category": row})
}

// ── Transactions / disputes / sweep ──────────────────────────────────────────

// AdminListTransactions handles
// GET /api/finance/admin/utilitybills/transactions?status=&limit=&offset=
func (h *Handler) AdminListTransactions(c *gin.Context) {
	limit, offset := adminPage(c)
	rows, err := h.svc.AdminListTransactions(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"transactions": rows, "meta": pageMeta(limit, offset, len(rows))})
}

type resolveDisputeBody struct {
	Status string `json:"status"`
	// Both spellings are accepted because the TS route accepted both
	// (`body.resolution_note ?? body.resolutionNote`).
	ResolutionNote     string `json:"resolution_note"`
	ResolutionNoteCaml string `json:"resolutionNote"`
}

// AdminResolveDispute handles
// POST /api/finance/admin/utilitybills/transactions/:id/resolve
func (h *Handler) AdminResolveDispute(c *gin.Context) {
	var body resolveDisputeBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	note := body.ResolutionNote
	if note == "" {
		note = body.ResolutionNoteCaml
	}
	dispute, err := h.svc.ResolveDispute(c.Request.Context(), adminActor(c), c.Param("id"), body.Status, note)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"dispute": dispute})
}

// AdminRequeryPending handles
// POST /api/finance/admin/utilitybills/workers/requery-pending?limit=
//
// A thin wrapper over the Phase 3 sweep — no sweep logic is reimplemented here.
// The default of 25 is defaultSweepLimit from jobs.go, and the cap of 100 is
// ListPending's own.
func (h *Handler) AdminRequeryPending(c *gin.Context) {
	limit := intQuery(c, "limit", defaultSweepLimit)
	if limit <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be positive"})
		return
	}
	res, err := h.svc.TriggerSweep(c.Request.Context(), adminActor(c), limit)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"processed": res.Processed,
		"succeeded": res.Succeeded,
		"failed":    res.Failed,
		"results":   res.Results,
	})
}

// ── Reports ──────────────────────────────────────────────────────────────────

// AdminReconciliationReport handles
// GET /api/finance/admin/utilitybills/reports/reconciliation?format=csv
func (h *Handler) AdminReconciliationReport(c *gin.Context) {
	rows, err := h.svc.ReconciliationReport(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	if wantsCSV(c) {
		writeCSV(c, "utility-reconciliation.csv", rows)
		return
	}
	c.JSON(http.StatusOK, gin.H{"report": rows})
}

// AdminProfitabilityReport handles
// GET /api/finance/admin/utilitybills/reports/profitability?format=csv
//
// The report is a SINGLE summary object, not a list — see ProfitabilityReport.
// The CSV form wraps it in a one-element array, exactly as the TS route does
// (`toCsv([report])`).
func (h *Handler) AdminProfitabilityReport(c *gin.Context) {
	report, err := h.svc.ProfitabilityReport(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	if wantsCSV(c) {
		writeCSV(c, "utility-profitability.csv", []*ProfitabilityReport{report})
		return
	}
	c.JSON(http.StatusOK, gin.H{"report": report})
}

// AdminProviderPerformanceReport handles
// GET /api/finance/admin/utilitybills/reports/provider-performance?format=csv
func (h *Handler) AdminProviderPerformanceReport(c *gin.Context) {
	rows, err := h.svc.ProviderPerformanceReport(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	if wantsCSV(c) {
		writeCSV(c, "utility-provider-performance.csv", rows)
		return
	}
	c.JSON(http.StatusOK, gin.H{"report": rows})
}

// ── CSV export ───────────────────────────────────────────────────────────────

func wantsCSV(c *gin.Context) bool { return c.Query("format") == "csv" }

// writeCSV renders any slice of JSON-tagged structs as CSV.
//
// The column set and ordering come from the values' own JSON representation, so
// the CSV columns always match the JSON field names byte-for-byte — which is
// what makes the two response formats the same report rather than two reports
// that drift apart. This mirrors the TS toCsv(), which also derived its columns
// from the object keys.
//
// Round-tripping through JSON (rather than reflecting over struct tags) also
// gets the value formatting right for free: a *int64 nil becomes an empty cell,
// a time.Time becomes its RFC3339 string, and a large kobo value never touches
// a float, because json.Number preserves the literal digits.
func writeCSV(c *gin.Context, filename string, payload any) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		writeErr(c, fmt.Errorf("utilitybills: encode report for csv: %w", err))
		return
	}
	var elements []json.RawMessage
	if err := json.Unmarshal(encoded, &elements); err != nil {
		writeErr(c, fmt.Errorf("utilitybills: decode report for csv: %w", err))
		return
	}

	columns := csvColumns(elements)
	records := make([]map[string]any, 0, len(elements))
	for _, element := range elements {
		decoder := json.NewDecoder(bytes.NewReader(element))
		decoder.UseNumber() // kobo must never round-trip through a float
		var record map[string]any
		if err := decoder.Decode(&record); err != nil {
			writeErr(c, fmt.Errorf("utilitybills: decode report row for csv: %w", err))
			return
		}
		records = append(records, record)
	}

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Status(http.StatusOK)

	// An empty report is an empty body, matching toCsv()'s
	// `if (rows.length === 0) return ''` — a lone header row would imply a shape
	// the caller cannot rely on.
	if len(records) == 0 {
		return
	}

	w := csv.NewWriter(c.Writer)
	w.UseCRLF = true // toCsv joins with \r\n
	defer w.Flush()

	if err := w.Write(columns); err != nil {
		return // the response is already committed; nothing useful left to say
	}
	for _, record := range records {
		row := make([]string, len(columns))
		for i, col := range columns {
			row[i] = csvCell(record[col])
		}
		if err := w.Write(row); err != nil {
			return
		}
	}
}

// csvColumns collects the union of keys across every record, in first-seen
// order, porting toCsv()'s Set-based column derivation (JS Sets preserve
// insertion order).
//
// It reads the keys off the raw JSON with a TOKEN scan rather than from a
// decoded map, because a Go map has no ordering at all — ranging one would emit
// the CSV columns in a different order on every single request, which is
// unusable for anything downstream that expects a stable header.
func csvColumns(elements []json.RawMessage) []string {
	seen := map[string]bool{}
	columns := []string{}
	for _, element := range elements {
		for _, k := range jsonObjectKeys(element) {
			if !seen[k] {
				seen[k] = true
				columns = append(columns, k)
			}
		}
	}
	return columns
}

// jsonObjectKeys returns a JSON object's keys in document order. Nested objects
// and arrays are skipped over wholesale, so only top-level keys are collected.
func jsonObjectKeys(raw json.RawMessage) []string {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	// Consume the opening '{'. Anything that is not an object contributes no
	// columns (the reports are all arrays of objects, so this is defensive only).
	if tok, err := decoder.Token(); err != nil || tok != json.Delim('{') {
		return nil
	}
	keys := []string{}
	for decoder.More() {
		tok, err := decoder.Token()
		if err != nil {
			return keys
		}
		key, ok := tok.(string)
		if !ok {
			return keys
		}
		keys = append(keys, key)
		// Skip the value. Token() walks into composites, so a nested object or
		// array has to be consumed to its matching delimiter or its inner keys
		// would be mistaken for columns.
		if err := skipJSONValue(decoder); err != nil {
			return keys
		}
	}
	return keys
}

// skipJSONValue consumes exactly one value from the decoder, descending through
// nested objects and arrays.
func skipJSONValue(decoder *json.Decoder) error {
	tok, err := decoder.Token()
	if err != nil {
		return err
	}
	delim, isDelim := tok.(json.Delim)
	if !isDelim {
		return nil // a scalar is one token
	}
	depth := 1
	if delim != '{' && delim != '[' {
		return nil
	}
	for depth > 0 {
		next, err := decoder.Token()
		if err != nil {
			return err
		}
		switch next {
		case json.Delim('{'), json.Delim('['):
			depth++
		case json.Delim('}'), json.Delim(']'):
			depth--
		}
	}
	return nil
}

// csvCell renders one value. nil becomes an empty cell and a nested object
// becomes its JSON text, matching toCsv()'s escape().
func csvCell(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case json.Number:
		return v.String()
	case bool:
		return strconv.FormatBool(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(b)
	}
}

// ── small helpers ────────────────────────────────────────────────────────────

// pageMeta echoes the pagination actually applied, matching the TS routes'
// `meta: { ...meta, count }`.
func pageMeta(limit, offset, count int) gin.H {
	return gin.H{"limit": limit, "offset": offset, "count": count}
}

// firstErr runs each binder in order and returns the first error, so a PATCH
// handler reads as a list of fields rather than a ladder of if-err-return.
func firstErr(steps ...func() error) error {
	for _, step := range steps {
		if err := step(); err != nil {
			return err
		}
	}
	return nil
}

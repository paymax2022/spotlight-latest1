package orchestration

// handler_secondary.go — persistence-backed HTTP handlers for beneficiaries and
// rate alerts (backed by SecondaryStore / the orch_beneficiaries + orch_rate_alerts
// tables). When h.sec is nil (no pool) they fall back to the previous stub
// behaviour so the app still renders in a DB-less dev setup.
//
// These are NOT money-path: no ledger, no balances, no idempotency requirement.
// Every query is scoped to customerID(c) for object-level authorization.

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// beneficiaryDraft is the create/update payload from the mobile app.
type beneficiaryDraft struct {
	Name          string  `json:"name"`
	Rail          string  `json:"rail"`
	Scheme        string  `json:"scheme"`
	Currency      string  `json:"currency"`
	AccountNumber string  `json:"accountNumber"`
	BankName      *string `json:"bankName"`
	CountryCode   string  `json:"countryCode"`
	Favorite      bool    `json:"favorite"`
}

func (d beneficiaryDraft) toBeneficiary(id string) Beneficiary {
	return Beneficiary{
		ID: id, Name: d.Name, Rail: d.Rail, Scheme: d.Scheme,
		Currency: strings.ToUpper(d.Currency), AccountNumber: d.AccountNumber,
		BankName: d.BankName, CountryCode: strings.ToUpper(d.CountryCode),
		Validated: true, Favorite: d.Favorite,
	}
}

// ─── server-side input validation (fail-closed on malformed payloads) ─────────

var fxCurrencies = map[string]bool{
	"NGN": true, "USD": true, "EUR": true, "GBP": true, "GHS": true,
	"KES": true, "XAF": true, "ZAR": true, "USDC": true, "USDT": true,
}
var beneficiaryRails = map[string]bool{
	"bank_transfer": true, "mobile_money": true, "iban": true, "wallet": true, "stablecoin": true,
}
var beneficiarySchemes = map[string]bool{
	"BANK": true, "MOBILEMONEY": true, "IBAN": true, "WALLET": true, "STABLECOIN": true,
}

// validateBeneficiaryDraft returns an APIError (with the offending param) when the
// payload is malformed, else nil. Enum checks mirror the OpenAPI contract.
func validateBeneficiaryDraft(d beneficiaryDraft) *APIError {
	bad := func(param, msg string) *APIError {
		return NewError(ErrInvalidRequest, "invalid_request", msg).WithParam(param)
	}
	if strings.TrimSpace(d.Name) == "" {
		return bad("name", "name is required")
	}
	if !beneficiaryRails[strings.ToLower(strings.TrimSpace(d.Rail))] {
		return bad("rail", "unsupported rail")
	}
	if !beneficiarySchemes[strings.ToUpper(strings.TrimSpace(d.Scheme))] {
		return bad("scheme", "unsupported scheme")
	}
	if !fxCurrencies[strings.ToUpper(strings.TrimSpace(d.Currency))] {
		return bad("currency", "unsupported currency")
	}
	if strings.TrimSpace(d.AccountNumber) == "" {
		return bad("accountNumber", "accountNumber is required")
	}
	if len(strings.TrimSpace(d.CountryCode)) != 2 {
		return bad("countryCode", "countryCode must be ISO-3166 alpha-2")
	}
	return nil
}

// ─── Beneficiaries ────────────────────────────────────────────────────────────

func (h *Handler) ListBeneficiaries(c *gin.Context) {
	if h.sec == nil {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	list, err := h.sec.ListBeneficiaries(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

func (h *Handler) CreateBeneficiary(c *gin.Context) {
	var d beneficiaryDraft
	if err := c.ShouldBindJSON(&d); err != nil {
		bindErr(c, err)
		return
	}
	if apiErr := validateBeneficiaryDraft(d); apiErr != nil {
		writeErr(c, apiErr)
		return
	}
	b := d.toBeneficiary(stubID("ben"))
	if h.sec == nil {
		b.CreatedAt = nowISO()
		c.JSON(http.StatusCreated, b)
		return
	}
	created, err := h.sec.CreateBeneficiary(c.Request.Context(), customerID(c), b)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusCreated, created)
}

// ValidateBeneficiary resolves/validates an account before saving. No persistence
// — a light rail-shape check stands in for the provider name-resolution call.
func (h *Handler) ValidateBeneficiary(c *gin.Context) {
	var d beneficiaryDraft
	if err := c.ShouldBindJSON(&d); err != nil {
		bindErr(c, err)
		return
	}
	digits := 0
	for _, ch := range d.AccountNumber {
		if ch >= '0' && ch <= '9' {
			digits++
		}
	}
	if digits < 8 && strings.ToUpper(d.Scheme) != "STABLECOIN" {
		c.JSON(http.StatusOK, gin.H{"valid": false, "reason": "Account number looks too short for this rail."})
		return
	}
	name := d.Name
	if name == "" {
		name = "Verified Account"
	}
	c.JSON(http.StatusOK, gin.H{"valid": true, "resolvedName": name})
}

func (h *Handler) UpdateBeneficiary(c *gin.Context) {
	var d beneficiaryDraft
	if err := c.ShouldBindJSON(&d); err != nil {
		bindErr(c, err)
		return
	}
	if apiErr := validateBeneficiaryDraft(d); apiErr != nil {
		writeErr(c, apiErr)
		return
	}
	id := c.Param("id")
	b := d.toBeneficiary(id)
	if h.sec == nil {
		b.CreatedAt = nowISO()
		c.JSON(http.StatusOK, b)
		return
	}
	updated, ok, err := h.sec.UpdateBeneficiary(c.Request.Context(), customerID(c), id, b)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	if !ok {
		writeErr(c, NewError(ErrInvalidRequest, "not_found", "Beneficiary not found.").WithParam("id"))
		return
	}
	c.JSON(http.StatusOK, updated)
}

func (h *Handler) FavoriteBeneficiary(c *gin.Context) {
	var body struct {
		Favorite bool `json:"favorite"`
	}
	_ = c.ShouldBindJSON(&body)
	if h.sec != nil {
		if err := h.sec.SetBeneficiaryFavorite(c.Request.Context(), customerID(c), c.Param("id"), body.Favorite); err != nil {
			writeErr(c, asAPIError(err))
			return
		}
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) DeleteBeneficiary(c *gin.Context) {
	if h.sec != nil {
		if err := h.sec.DeleteBeneficiary(c.Request.Context(), customerID(c), c.Param("id")); err != nil {
			writeErr(c, asAPIError(err))
			return
		}
	}
	c.Status(http.StatusNoContent)
}

// ─── Rate alerts ──────────────────────────────────────────────────────────────

func (h *Handler) ListRateAlerts(c *gin.Context) {
	if h.sec == nil {
		c.JSON(http.StatusOK, gin.H{"data": []any{}})
		return
	}
	list, err := h.sec.ListRateAlerts(c.Request.Context(), customerID(c))
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

func (h *Handler) CreateRateAlert(c *gin.Context) {
	var req struct {
		From      string  `json:"from"`
		To        string  `json:"to"`
		Direction string  `json:"direction"`
		Target    float64 `json:"target"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		bindErr(c, err)
		return
	}
	from, to := strings.ToUpper(strings.TrimSpace(req.From)), strings.ToUpper(strings.TrimSpace(req.To))
	dir := strings.ToLower(strings.TrimSpace(req.Direction))
	switch {
	case !fxCurrencies[from]:
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "unsupported currency").WithParam("from"))
		return
	case !fxCurrencies[to]:
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "unsupported currency").WithParam("to"))
		return
	case dir != "above" && dir != "below":
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "direction must be above or below").WithParam("direction"))
		return
	case req.Target <= 0:
		writeErr(c, NewError(ErrInvalidRequest, "invalid_request", "target must be positive").WithParam("target"))
		return
	}
	a := RateAlert{
		ID: stubID("al"), Pair: from + "-" + to, From: from, To: to,
		Direction: req.Direction, Target: req.Target, Active: true,
	}
	if h.sec == nil {
		a.CreatedAt = nowISO()
		c.JSON(http.StatusCreated, a)
		return
	}
	created, err := h.sec.CreateRateAlert(c.Request.Context(), customerID(c), a)
	if err != nil {
		writeErr(c, asAPIError(err))
		return
	}
	c.JSON(http.StatusCreated, created)
}

func (h *Handler) DeleteRateAlert(c *gin.Context) {
	if h.sec != nil {
		if err := h.sec.DeleteRateAlert(c.Request.Context(), customerID(c), c.Param("id")); err != nil {
			writeErr(c, asAPIError(err))
			return
		}
	}
	c.Status(http.StatusNoContent)
}

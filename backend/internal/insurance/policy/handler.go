package policy

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes member + admin policy/quote routes.
type Handler struct {
	svc     *Service
	signRef func(ref string) (string, error) // R2 signer injected by the aggregator
}

// NewHandler constructs the policy handler. signRef may be nil (certificate route
// then returns the raw ref instead of a signed URL).
func NewHandler(svc *Service, signRef func(ref string) (string, error)) *Handler {
	return &Handler{svc: svc, signRef: signRef}
}

func userID(c *gin.Context) string { return c.GetString("user_id") }

// mapErr maps service sentinel errors to HTTP responses.
func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, ErrConsentRequired):
		c.JSON(http.StatusPreconditionRequired, gin.H{"error": "ndpa_consent_required", "code": "consent_required"})
	case errors.Is(err, ErrBadState):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// CreateQuote (member): POST /quotes {product_code, sum_insured_kobo, inputs}
func (h *Handler) CreateQuote(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		ProductCode    string         `json:"product_code" binding:"required"`
		SumInsuredKobo int64          `json:"sum_insured_kobo"`
		Inputs         map[string]any `json:"inputs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	qr, err := h.svc.CreateQuote(c.Request.Context(), uid, body.ProductCode, body.SumInsuredKobo, body.Inputs)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": qr})
}

// GetQuote (member): GET /quotes/:id
func (h *Handler) GetQuote(c *gin.Context) {
	qr, err := h.svc.GetQuote(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": qr})
}

// Bind (member): POST /policies {quote_id} — Idempotency-Key header REQUIRED.
// Runs the premium-debit→bind saga with mandatory auto-reverse.
func (h *Handler) Bind(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	idemKey := c.GetHeader("Idempotency-Key")
	if idemKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var body struct {
		QuoteID string `json:"quote_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.BindFromQuote(c.Request.Context(), uid, body.QuoteID, idemKey)
	if err != nil {
		// A bind that auto-reversed returns the VOID policy plus an error; surface
		// the policy state so the client can show "refunded".
		if p != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "data": p})
			return
		}
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// List (member): GET /policies — policy wallet.
func (h *Handler) List(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	ps, err := h.svc.ListPolicies(c.Request.Context(), userID(c), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ps})
}

// Get (member): GET /policies/:id
func (h *Handler) Get(c *gin.Context) {
	p, err := h.svc.GetPolicy(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// Certificate (member): GET /policies/:id/certificate — signed URL.
func (h *Handler) Certificate(c *gin.Context) {
	ref, err := h.svc.CertificateRef(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	url := ref
	if h.signRef != nil {
		if signed, sErr := h.signRef(ref); sErr == nil {
			url = signed
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"certificate_url": url}})
}

// Cancel (member): POST /policies/:id/cancel {reason}
func (h *Handler) Cancel(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	p, err := h.svc.Cancel(c.Request.Context(), userID(c), c.Param("id"), body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// AddBeneficiary (member): POST /policies/:id/beneficiaries
func (h *Handler) AddBeneficiary(c *gin.Context) {
	var body struct {
		FullName     string  `json:"full_name" binding:"required"`
		Relationship string  `json:"relationship" binding:"required"`
		SharePercent int     `json:"share_percent" binding:"required,min=1,max=100"`
		Phone        *string `json:"phone"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.AddBeneficiary(c.Request.Context(), userID(c), c.Param("id"), &Beneficiary{
		FullName:     body.FullName,
		Relationship: body.Relationship,
		SharePercent: body.SharePercent,
		Phone:        body.Phone,
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": b})
}

// ListBeneficiaries (member): GET /policies/:id/beneficiaries
func (h *Handler) ListBeneficiaries(c *gin.Context) {
	bs, err := h.svc.ListBeneficiaries(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": bs})
}

// AdminSearch (admin): GET /policies?state=&product_code=
func (h *Handler) AdminSearch(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	ps, err := h.svc.SearchAdmin(c.Request.Context(), c.Query("state"), c.Query("product_code"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ps})
}

package business

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
)

// Handler exposes the business-registry API over Gin.
type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// userID resolves the authenticated user id (set by RequireAuthContext before Next).
func userID(c *gin.Context) string {
	if au, ok := middleware.GetAuthenticatedUser(c); ok {
		return au.ID
	}
	return c.GetString("user_id")
}

func userEmail(c *gin.Context) string {
	if au, ok := middleware.GetAuthenticatedUser(c); ok {
		return au.Email
	}
	return ""
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	case errors.Is(err, ErrCertNotReady):
		c.JSON(http.StatusNotFound, gin.H{"error": "certificate not available yet"})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, ErrDuplicate):
		c.JSON(http.StatusConflict, gin.H{"error": "a business with this registration number already exists"})
	case errors.Is(err, ErrConflict), errors.Is(err, ErrFeeNotPaid):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrMissingIdemKey):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrValidation):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInsufficientFunds):
		c.JSON(http.StatusPaymentRequired, gin.H{"error": err.Error()})
	case errors.Is(err, ErrProvider):
		c.JSON(http.StatusBadGateway, gin.H{"error": "business registry provider error"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// ── Member endpoints ──────────────────────────────────────────────────────────

func (h *Handler) CheckName(c *gin.Context) {
	var req NameCheckRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.CheckName(c.Request.Context(), userID(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

func (h *Handler) ReserveName(c *gin.Context) {
	var req ReserveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	prof, err := h.svc.ReserveName(c.Request.Context(), userID(c), userEmail(c), "", req.BusinessID)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

func (h *Handler) VerifyExisting(c *gin.Context) {
	var req VerifyExistingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	prof, err := h.svc.StartVerifyExisting(c.Request.Context(), userID(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

func (h *Handler) RegisterNew(c *gin.Context) {
	var req RegisterNewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	prof, err := h.svc.StartRegisterNew(c.Request.Context(), userID(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": prof})
}

func (h *Handler) PayFee(c *gin.Context) {
	idemKey := c.GetHeader("Idempotency-Key")
	prof, err := h.svc.PayRegistrationFee(c.Request.Context(), userID(c), c.Param("id"), idemKey)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

// PayFeePaystackInit starts a Paystack checkout for the CAC fee (gateway alternative
// to the wallet debit). Returns {authorizationUrl, reference}. No money moves here.
func (h *Handler) PayFeePaystackInit(c *gin.Context) {
	var body struct {
		Email       string `json:"email"`
		CallbackURL string `json:"callbackUrl"`
	}
	_ = c.ShouldBindJSON(&body)
	email := body.Email
	if email == "" {
		email = userEmail(c)
	}
	out, err := h.svc.InitiateRegistrationFeePaystack(c.Request.Context(), userID(c), c.Param("id"), email, body.CallbackURL)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// PayFeePaystackVerify confirms a Paystack payment for the CAC fee and marks the fee
// paid. Idempotent; fails closed unless the gateway reports a full-amount success.
func (h *Handler) PayFeePaystackVerify(c *gin.Context) {
	var body struct {
		Reference string `json:"reference"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		h.fail(c, ErrValidation)
		return
	}
	prof, err := h.svc.VerifyRegistrationFeePaystack(c.Request.Context(), userID(c), body.Reference)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

func (h *Handler) Submit(c *gin.Context) {
	idemKey := c.GetHeader("Idempotency-Key")
	prof, err := h.svc.SubmitRegistration(c.Request.Context(), userID(c), c.Param("id"), idemKey)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

func (h *Handler) Status(c *gin.Context) {
	prof, err := h.svc.RefreshStatus(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

// Certificate returns the CAC certificate location for a registered business so
// the client can view/download it. 404 while it is not yet available.
func (h *Handler) Certificate(c *gin.Context) {
	url, err := h.svc.GetCertificate(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"certificateUrl": url}})
}

func (h *Handler) Me(c *gin.Context) {
	list, err := h.svc.ListMine(c.Request.Context(), userID(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

func (h *Handler) GetOne(c *gin.Context) {
	prof, err := h.svc.GetMyBusiness(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

// ── Admin endpoints ───────────────────────────────────────────────────────────

func (h *Handler) AdminList(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	list, err := h.svc.AdminList(c.Request.Context(), c.Query("status"), c.Query("mode"), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

func (h *Handler) AdminGet(c *gin.Context) {
	prof, err := h.svc.AdminGet(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

func (h *Handler) AdminApprove(c *gin.Context) {
	prof, err := h.svc.AdminApprove(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

func (h *Handler) AdminReject(c *gin.Context) {
	var req RejectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reason is required"})
		return
	}
	prof, err := h.svc.AdminReject(c.Request.Context(), userID(c), c.Param("id"), req.Reason)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

package business

import (
	"errors"
	"log"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/ptr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/cac"
	"spotlight/backend/internal/services"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyError = "error"

// Handler exposes the business-registry API over Gin.
type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// authUserID resolves the authenticated user id (set by RequireAuthContext before Next).
func authUserID(c *gin.Context) string {
	if au, ok := middleware.GetAuthenticatedUser(c); ok {
		return au.ID
	}
	return ""
}

func userID(c *gin.Context) string { return ginutil.UserID(c, authUserID) }

func userEmail(c *gin.Context) string {
	if au, ok := middleware.GetAuthenticatedUser(c); ok {
		return au.Email
	}
	return ""
}

var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrNotFound, ErrCertNotReady),
	httperr.R(http.StatusForbidden, ErrForbidden),
	httperr.R(http.StatusConflict, ErrDuplicate, ErrConflict, ErrFeeNotPaid),
	httperr.R(http.StatusBadRequest, ErrMissingIdemKey),
	httperr.R(http.StatusUnprocessableEntity, ErrValidation),
	httperr.R(http.StatusPaymentRequired, ErrInsufficientFunds),
	httperr.R(http.StatusBadGateway, ErrProvider),
)

func (h *Handler) fail(c *gin.Context, err error) {
	code := errMap.Code(err)
	body := gin.H{keyError: httperr.Msg(c, code, err)}
	switch {
	case errors.Is(err, ErrNotFound):
		body[keyError] = "not found"
	case errors.Is(err, ErrCertNotReady):
		body[keyError] = "certificate not available yet"
	case errors.Is(err, ErrForbidden):
		body[keyError] = "forbidden"
	case errors.Is(err, ErrDuplicate):
		body[keyError] = "a business with this registration number already exists"
	case errors.Is(err, ErrProvider):
		body[keyError] = "business registry provider error"
	}
	c.JSON(code, body)
}

func (h *Handler) CheckName(c *gin.Context) {
	var req NameCheckRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
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
	idemKey := ginutil.IdempotencyKey(c)
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
	idemKey := ginutil.IdempotencyKey(c)
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

func (h *Handler) AdminList(c *gin.Context) {
	limit := ptr.DerefZero(ginutil.IntParam(c, "limit"))
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: "reason is required"})
		return
	}
	prof, err := h.svc.AdminReject(c.Request.Context(), userID(c), c.Param("id"), req.Reason)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": prof})
}

// ReviewPermission is the RBAC slug gating the admin review/override endpoints.
const ReviewPermission = "business.registry.review"

// RouteDeps carries the collaborators to wire the business-registry routes.
type RouteDeps struct {
	Pool     *pgxpool.Pool
	Ledger   *ledger.Service
	Wallet   *wallet.Service
	Provider cac.BusinessRegistryProvider
	Payment  provider.PaymentProvider // Paystack gateway for the fee (optional)
	RBAC     services.RBACService
	FeeKobo  int64
}

// Register mounts the business-registry routes. `member` is an already-authenticated
// route group (e.g. the finance group: RequireAuthContext + requireUserID). `admin`
// is an authenticated group on which per-route RBAC (business.registry.review) is
// applied here. Returns the Service so the caller can wire the merchant-upgrade gate
// (HasVerifiedBusiness) into the onboarding grant path.
func Register(member, admin *gin.RouterGroup, d RouteDeps) *Service {
	svc := NewService(Deps{
		Repo:     NewRepository(d.Pool),
		Ledger:   d.Ledger,
		Wallet:   d.Wallet,
		Provider: d.Provider,
		Payment:  d.Payment,
		FeeKobo:  d.FeeKobo,
	})
	h := NewHandler(svc)

	b := member.Group("/business")
	b.POST("/name/check", h.CheckName)
	b.POST("/name/reserve", h.ReserveName)
	b.POST("/verify", h.VerifyExisting)
	b.POST("/register", h.RegisterNew)
	b.POST("/:id/pay-fee", h.PayFee)                               // wallet money path — Idempotency-Key required
	b.POST("/:id/pay-fee/paystack", h.PayFeePaystackInit)          // gateway: start Paystack checkout
	b.POST("/:id/pay-fee/paystack/verify", h.PayFeePaystackVerify) // gateway: confirm + mark paid
	b.POST("/:id/submit", h.Submit)                                // Idempotency-Key required
	b.GET("/:id/status", h.Status)
	b.GET("/:id/certificate", h.Certificate)
	b.GET("/me", h.Me)
	b.GET("/:id", h.GetOne)

	if admin != nil {
		review := admin.Group("")
		review.Use(middleware.RequirePermission(d.RBAC, ReviewPermission))
		review.GET("", h.AdminList)
		review.GET("/:id", h.AdminGet)
		review.POST("/:id/approve", h.AdminApprove)
		review.POST("/:id/reject", h.AdminReject)
	}

	log.Printf("[business] routes registered (provider=%s, feeKobo=%d, platformFeeKobo=%d) · pay-fee=wallet|paystack(init+verify) [build:platform-fee]", d.Provider.Name(), svc.feeKobo, svc.platformFeeKobo)
	return svc
}

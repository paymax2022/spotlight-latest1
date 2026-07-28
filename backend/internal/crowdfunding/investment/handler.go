package investment

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler adapts the investment Service to gin. List endpoints wrap results in
// gin.H{"data": ...}; single-object endpoints return the object directly.
type Handler struct {
	svc *Service
}

// NewHandler constructs an investment Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetProfile — GET /investment/profile.
func (h *Handler) GetProfile(c *gin.Context) {
	p, err := h.svc.GetProfile(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

// CompleteOnboarding — POST /investment/onboarding.
func (h *Handler) CompleteOnboarding(c *gin.Context) {
	var req OnboardingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.CompleteOnboardingStep(c.Request.Context(), c.GetString("user_id"), req.Step, req.RiskProfile)
	if err != nil {
		switch {
		case errors.Is(err, ErrBadStep), errors.Is(err, ErrBadRiskProfile):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, p)
}

// GetOffers — GET /investment/offers.
func (h *Handler) GetOffers(c *gin.Context) {
	items, err := h.svc.GetOffers(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetOffer — GET /investment/offers/:id.
func (h *Handler) GetOffer(c *gin.Context) {
	o, err := h.svc.GetOffer(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "offer not found"})
		return
	}
	c.JSON(http.StatusOK, o)
}

// GetEducation — GET /investment/education.
func (h *Handler) GetEducation(c *gin.Context) {
	items, err := h.svc.GetEducation(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetQuiz — GET /investment/quiz.
func (h *Handler) GetQuiz(c *gin.Context) {
	items, err := h.svc.GetQuiz(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// Subscribe — POST /investment/subscribe. Money mutation: requires an
// Idempotency-Key header and enforces onboarding + annual-limit fail-closed.
func (h *Handler) Subscribe(c *gin.Context) {
	idemKey := c.GetHeader("Idempotency-Key")
	if idemKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header is required"})
		return
	}
	var in InvestmentSubscriptionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cert, err := h.svc.Subscribe(c.Request.Context(), c.GetString("user_id"), in, idemKey)
	if err != nil {
		switch {
		case errors.Is(err, ErrOfferNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		case errors.Is(err, ErrNotOnboarded), errors.Is(err, ErrAnnualLimit),
			errors.Is(err, ErrBelowMinTicket), errors.Is(err, ErrOfferClosed),
			errors.Is(err, ErrAgreement):
			// 422: the request is well-formed but fails a business/regulatory rule.
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusCreated, cert)
}

// GetPortfolio — GET /investment/portfolio.
func (h *Handler) GetPortfolio(c *gin.Context) {
	items, err := h.svc.GetPortfolio(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

package top5events

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/platform/billingemail"
)

// RegisterCardCheckout mounts the ticket card-checkout routes (EVTB-D013) on the
// member group (/api/finance/events). The status route is mounted whenever the
// rail is wired, so a customer who already paid can always resolve their
// checkout; the initiate route only when initiateEnabled
// (FEATURE_EVENTS_CARD_CHECKOUT).
//
//	POST /:id/purchase/card           hold seats + open a Paystack checkout (Idempotency-Key required)
//	GET  /card/:reference/status      owner-only poll; re-verifies server-side (self-heal)
//
// Confirmation has NO route here: it is driven by the shared signed Paystack
// webhook (prefix CardReferencePrefix → Service.CardWebhookConfirmer).
func (h *Handler) RegisterCardCheckout(member *gin.RouterGroup, initiateEnabled bool) {
	if initiateEnabled {
		member.POST("/:id/purchase/card", h.InitiateCardCheckout)
	}
	member.GET("/card/:reference/status", h.CardCheckoutStatus)
}

// cardPurchaseRequest mirrors purchaseRequest (both promo spellings) plus the
// gateway-only fields. There is deliberately no amount field.
type cardPurchaseRequest struct {
	TierID      string `json:"tier_id" binding:"required"`
	Quantity    *int   `json:"quantity,omitempty"`
	Promo       string `json:"promo,omitempty"`
	PromoCode   string `json:"promo_code,omitempty"`
	Email       string `json:"email,omitempty"`
	CallbackURL string `json:"callback_url,omitempty"`
}

func (h *Handler) InitiateCardCheckout(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	key := idemKey(c)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: msgIdemKeyRequired})
		return
	}
	var req cardPurchaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	qty := 1
	if req.Quantity != nil {
		qty = *req.Quantity
	}
	promo := req.Promo
	if promo == "" {
		promo = req.PromoCode
	}
	// Resolve the billing email BEFORE any hold is taken.
	email, ok := billingemail.Require(c, req.Email)
	if !ok {
		return
	}
	out, err := h.svc.InitiateCardCheckout(c.Request.Context(), u, CardCheckoutRequest{
		EventID: c.Param("id"), TierID: req.TierID, Promo: promo, Quantity: qty,
		IdempotencyKey: key, Email: email, CallbackURL: req.CallbackURL,
	})
	if err != nil {
		cardFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{keySuccess: true, keyData: out})
}

func (h *Handler) CardCheckoutStatus(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.CardCheckoutStatus(c.Request.Context(), u, c.Param("reference"))
	if err != nil {
		cardFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out})
}

func cardFail(c *gin.Context, err error) {
	status, code := http.StatusBadGateway, "payment_unavailable"
	switch {
	case errors.Is(err, ErrCardCheckoutDisabled):
		status, code = http.StatusNotFound, "card_checkout_unavailable"
	case errors.Is(err, ErrCardUnknownReference):
		status, code = http.StatusNotFound, "unknown_reference"
	case errors.Is(err, ErrNotFound):
		status, code = http.StatusNotFound, "not_found"
	case errors.Is(err, ErrForbidden):
		status, code = http.StatusForbidden, "forbidden"
	case errors.Is(err, ErrCardIdempotencyConflict):
		status, code = http.StatusConflict, "idempotency_conflict"
	case errors.Is(err, ErrSoldOut):
		status, code = http.StatusConflict, "sold_out"
	case errors.Is(err, ErrCardInvalidKey):
		status, code = http.StatusBadRequest, "invalid_idempotency_key"
	case errors.Is(err, ErrCardNothingToCharge):
		status, code = http.StatusUnprocessableEntity, "nothing_to_charge"
	case errors.Is(err, ErrNotPurchasable), errors.Is(err, ErrTierNotOnSale), errors.Is(err, ErrInviteOnly),
		errors.Is(err, ErrPromoNotApplicable):
		status, code = http.StatusUnprocessableEntity, "not_purchasable"
	case errors.Is(err, ErrValidation):
		status, code = http.StatusBadRequest, "invalid_request"
	}
	c.JSON(status, gin.H{keyError: code, "message": httperr.Msg(c, status, err)})
}

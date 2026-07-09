package agent

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/stays/gateway"
	"spotlight/backend/internal/stays/reservation"
)

// Handler exposes the member-authenticated agent-channel routes. The authenticated
// member is the booking agent; user_id is mirrored onto the gin context by the
// upstream auth middleware (same as the self-service stays routes).
type Handler struct {
	svc *Service
}

// NewHandler constructs the agent handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func agentUserID(c *gin.Context) string { return c.GetString("user_id") }

// mapErr reuses the reservation error taxonomy so the agent channel returns the
// same normalised codes as self-service booking.
func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, reservation.ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, reservation.ErrConsentRequired):
		c.JSON(http.StatusPreconditionRequired, gin.H{"error": "ndpa_consent_required", "code": "consent_required"})
	case errors.Is(err, reservation.ErrPrebookFailed):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "PREBOOK_FAILED"})
	case errors.Is(err, reservation.ErrInsufficient):
		c.JSON(http.StatusPaymentRequired, gin.H{"error": err.Error(), "code": "INSUFFICIENT_FUNDS"})
	case errors.Is(err, reservation.ErrBadState):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// Quote (member/agent): POST /agent/quote — search + priced hold for a customer.
func (h *Handler) Quote(c *gin.Context) {
	uid := agentUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		CustomerName        string         `json:"customer_name" binding:"required"`
		CustomerContact     string         `json:"customer_contact"`
		Rail                string         `json:"rail" binding:"required"`
		SupplierCode        string         `json:"supplier_code" binding:"required"`
		PropertyID          string         `json:"property_id" binding:"required"`
		RoomTypeID          string         `json:"room_type_id" binding:"required"`
		RatePlanID          string         `json:"rate_plan_id" binding:"required"`
		SupplierPropertyRef string         `json:"supplier_property_ref"`
		SupplierRoomTypeRef string         `json:"supplier_room_type_ref"`
		SupplierRatePlanRef string         `json:"supplier_rate_plan_ref"`
		OfferToken          string         `json:"offer_token"`
		CheckIn             string         `json:"check_in" binding:"required"`
		CheckOut            string         `json:"check_out" binding:"required"`
		Rooms               int            `json:"rooms"`
		Occupancy           map[string]any `json:"occupancy"`
		Currency            string         `json:"currency"`
		LoyaltyTier         string         `json:"loyalty_tier"`
		PromoBps            int64          `json:"promo_bps"`
		PaymentMethod       string         `json:"payment_method"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ci, err1 := time.Parse("2006-01-02", body.CheckIn)
	co, err2 := time.Parse("2006-01-02", body.CheckOut)
	if err1 != nil || err2 != nil || !co.After(ci) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid check_in/check_out"})
		return
	}
	q, err := h.svc.Quote(c.Request.Context(), uid, reservation.PrebookInput{
		Rail:                gateway.SourceRail(body.Rail),
		SupplierCode:        body.SupplierCode,
		PropertyID:          body.PropertyID,
		RoomTypeID:          body.RoomTypeID,
		RatePlanID:          body.RatePlanID,
		SupplierPropertyRef: body.SupplierPropertyRef,
		SupplierRoomTypeRef: body.SupplierRoomTypeRef,
		SupplierRatePlanRef: body.SupplierRatePlanRef,
		OfferToken:          body.OfferToken,
		CheckIn:             ci,
		CheckOut:            co,
		Rooms:               body.Rooms,
		Occupancy:           body.Occupancy,
		Currency:            body.Currency,
		LoyaltyTier:         body.LoyaltyTier,
		PromoBps:            body.PromoBps,
		PaymentMethod:       gateway.PaymentMethod(body.PaymentMethod),
	}, body.CustomerName, body.CustomerContact)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": q})
}

// Book (member/agent): POST /agent/book — book the held quote for the customer.
// Idempotency-Key header REQUIRED.
func (h *Handler) Book(c *gin.Context) {
	uid := agentUserID(c)
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
		ReservationID   string `json:"reservation_id" binding:"required"`
		BookToken       string `json:"book_token" binding:"required"`
		CustomerName    string `json:"customer_name" binding:"required"`
		CustomerContact string `json:"customer_contact"`
		Guest           struct {
			FirstName string `json:"first_name" binding:"required"`
			LastName  string `json:"last_name" binding:"required"`
			Email     string `json:"email" binding:"required"`
			Phone     string `json:"phone"`
		} `json:"guest"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.Book(c.Request.Context(), uid, BookInput{
		ReservationID:   body.ReservationID,
		BookToken:       body.BookToken,
		IdempotencyKey:  idemKey,
		CustomerName:    body.CustomerName,
		CustomerContact: body.CustomerContact,
		Guest: gateway.GuestInfo{
			FirstName: body.Guest.FirstName,
			LastName:  body.Guest.LastName,
			Email:     body.Guest.Email,
			Phone:     body.Guest.Phone,
		},
	})
	if err != nil {
		// A book that auto-released returns the VOID reservation plus an error.
		if res != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "data": res})
			return
		}
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": res})
}

// Bookings (member/agent): GET /agent/bookings — reservations this agent booked.
func (h *Handler) Bookings(c *gin.Context) {
	uid := agentUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rs, err := h.svc.Bookings(c.Request.Context(), uid, limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rs})
}

// Commissions (member/agent): GET /agent/commissions — commission totals.
func (h *Handler) Commissions(c *gin.Context) {
	uid := agentUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	totals, err := h.svc.Commissions(c.Request.Context(), uid)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": totals})
}

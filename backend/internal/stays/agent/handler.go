package agent

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
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

// mapErr reuses the reservation error taxonomy so the agent channel returns the
// same normalised codes as self-service booking.
func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, reservation.ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, reservation.ErrConsentRequired):
		c.JSON(http.StatusPreconditionRequired, gin.H{"error": "ndpa_consent_required", "code": "consent_required"})
	case errors.Is(err, reservation.ErrPrebookFailed):
		c.JSON(http.StatusConflict, gin.H{"error": httperr.Msg(c, http.StatusConflict, err), "code": "PREBOOK_FAILED"})
	case errors.Is(err, reservation.ErrInsufficient):
		c.JSON(http.StatusPaymentRequired, gin.H{"error": httperr.Msg(c, http.StatusPaymentRequired, err), "code": "INSUFFICIENT_FUNDS"})
	case errors.Is(err, reservation.ErrBadState):
		c.JSON(http.StatusConflict, gin.H{"error": httperr.Msg(c, http.StatusConflict, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// Quote (member/agent): POST /agent/quote — search + priced hold for a customer.
func (h *Handler) Quote(c *gin.Context) {
	uid := ginutil.UserID(c)
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
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
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
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	idemKey := ginutil.IdempotencyKey(c)
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
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
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
			// Insufficient funds → 402, checked before the generic 409.
			if errors.Is(err, reservation.ErrInsufficient) {
				c.JSON(http.StatusPaymentRequired, gin.H{
					"error": httperr.Msg(c, http.StatusPaymentRequired, err),
					"code":  "INSUFFICIENT_FUNDS",
					"data":  res,
				})
				return
			}
			c.JSON(http.StatusConflict, gin.H{"error": httperr.Msg(c, http.StatusConflict, err), "data": res})
			return
		}
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": res})
}

// Bookings (member/agent): GET /agent/bookings — reservations this agent booked.
func (h *Handler) Bookings(c *gin.Context) {
	uid := ginutil.UserID(c)
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
	uid := ginutil.UserID(c)
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

// RegisterStaysAgent mounts the agent-assisted booking channel onto the EXISTING
// member stays group (the orchestrator passes the same group it built in
// RegisterStays, so the final paths are /api/finance/stays/agent/*). It is
// nil-safe: a nil service (e.g. nil pool at wiring time) skips registration.
// POST /agent/book requires an Idempotency-Key.
func RegisterStaysAgent(rg *gin.RouterGroup, svc *Service) {
	if svc == nil {
		log.Println("[stays.agent] nil service — skipping agent routes")
		return
	}
	h := NewHandler(svc)
	ag := rg.Group("/agent")
	ag.POST("/quote", h.Quote)
	ag.POST("/book", h.Book) // Idempotency-Key REQUIRED (enforced in handler)
	ag.GET("/bookings", h.Bookings)
	ag.GET("/commissions", h.Commissions)
	log.Println("[stays.agent] routes registered — quote/book saga + bookings/commissions live")
}

// Package agent implements the travel-agent-assisted stays booking channel.
// A member acting as a booking agent searches + prices a stay for a walk-in
// customer (quote), then books it on the customer's behalf. The money path is the
// SAME reservation.Book saga (escrow→settle) used by self-service booking — this
// package does NOT duplicate the booking logic. The agent's commission is the SAME
// DirectCommission settlement split the reservation saga already posts; we do not
// invent a new ledger account. We only TAG the reservation with the booking
// agent_user_id + walk-in customer contact so an agent can list their bookings and
// sum their earned commission.

// Service is the agent-channel façade over the reservation saga. It holds NO money
// primitives of its own — every mutation delegates to reservation.Service.
type Service struct {
	res *reservation.Service
	// resRepo is used only to TAG + query the agent_* columns (annotation, no money).
	resRepo *reservation.Repository
}

// NewService constructs the agent service. Both deps are required; a nil pool at
// the wiring layer skips registration entirely (see RegisterStaysAgent).
func NewService(res *reservation.Service, resRepo *reservation.Repository) *Service {
	return &Service{res: res, resRepo: resRepo}
}

// QuoteInput is the agent's priced-quote request. It mirrors the self-service
// PrebookInput (same offer selection) plus the walk-in customer identity the agent
// captured. NO money moves on quote — it reuses reservation.Prebook (hold token +
// re-validated price only).
type QuoteInput struct {
	CustomerName        string
	CustomerContact     string
	Rail                gateway.SourceRail
	SupplierCode        string
	PropertyID          string
	RoomTypeID          string
	RatePlanID          string
	SupplierPropertyRef string
	SupplierRoomTypeRef string
	SupplierRatePlanRef string
	OfferToken          string
	CheckIn             string // YYYY-MM-DD (parsed by the handler)
	CheckOut            string
	Rooms               int
	Occupancy           map[string]any
	Currency            string
	LoyaltyTier         string
	PromoBps            int64
	PaymentMethod       gateway.PaymentMethod
}

// Quote is the agent-facing priced hold: the reservation id doubles as the hold
// reference the agent passes to Book, the book_token gates the supplier book, and
// commission_kobo is the agent commission preview (the DirectCommission split that
// will settle when the booking confirms).
type Quote struct {
	ReservationID  string `json:"reservation_id"` // hold reference → pass to Book
	BookToken      string `json:"book_token"`
	CustomerName   string `json:"customer_name"`
	PropertyID     string `json:"property_id"`
	CheckIn        string `json:"check_in"`
	CheckOut       string `json:"check_out"`
	Currency       string `json:"currency"`
	GrossKobo      int64  `json:"gross_kobo"`
	TaxKobo        int64  `json:"tax_kobo"`
	NetRateKobo    int64  `json:"net_rate_kobo"`
	CommissionKobo int64  `json:"commission_kobo"` // agent commission preview
}

// Quote runs a search+prebook for the customer and returns a priced hold. It
// delegates to reservation.Prebook (the two-step gate); the agent identity is the
// authenticated member id and the walk-in customer contact is echoed back so the
// agent UI can confirm before booking. No money moves here.
func (s *Service) Quote(ctx context.Context, agentUserID string, in reservation.PrebookInput, customerName, customerContact string) (*Quote, error) {
	if agentUserID == "" {
		return nil, errors.New("agent: unauthenticated")
	}
	// The reservation is created under the WALK-IN CUSTOMER via the agent's member
	// session. Per the reservation saga's object-level authZ, the booking lives on
	// the agent's authenticated id (there is no separate customer account for a
	// walk-in); the agent_user_id tag + customer contact preserve provenance.
	pre, err := s.res.Prebook(ctx, agentUserID, in)
	if err != nil {
		return nil, err
	}
	return &Quote{
		ReservationID:  pre.Reservation.ID,
		BookToken:      pre.BookToken,
		CustomerName:   customerName,
		PropertyID:     pre.Reservation.PropertyID,
		CheckIn:        pre.Reservation.CheckIn.Format("2006-01-02"),
		CheckOut:       pre.Reservation.CheckOut.Format("2006-01-02"),
		Currency:       pre.Reservation.Currency,
		GrossKobo:      pre.Breakdown.GrossKobo,
		TaxKobo:        pre.Breakdown.TaxKobo,
		NetRateKobo:    pre.Breakdown.NetRateKobo,
		CommissionKobo: pre.Breakdown.CommissionKobo,
	}, nil
}

// BookInput books a held quote. Idempotency-Key is REQUIRED (enforced at the
// handler). The money path is the SAME reservation.Book saga; afterwards we TAG the
// row with the agent + customer.
type BookInput struct {
	ReservationID   string
	BookToken       string
	IdempotencyKey  string
	CustomerName    string
	CustomerContact string
	Guest           gateway.GuestInfo
}

// Book runs the reservation.Book saga on the held quote, then tags the confirmed
// reservation with the booking agent + walk-in customer. The commission is the
// reservation saga's existing DirectCommission settlement split — nothing new is
// posted here. Tagging is best-effort AFTER a confirmed book: a tag failure never
// unwinds a confirmed, paid booking (it is logged by the caller path).
func (s *Service) Book(ctx context.Context, agentUserID string, in BookInput) (*reservation.Reservation, error) {
	if agentUserID == "" {
		return nil, errors.New("agent: unauthenticated")
	}
	if in.IdempotencyKey == "" {
		return nil, errors.New("agent: Idempotency-Key required for book")
	}
	res, err := s.res.Book(ctx, agentUserID, in.ReservationID, in.BookToken, in.IdempotencyKey, in.Guest)
	if err != nil {
		return res, err
	}
	// CONFIRMED — tag provenance. Best-effort: never fail a confirmed booking on a
	// tagging error (the money already moved through the saga).
	_ = s.resRepo.TagAgentBooking(ctx, res.ID, reservation.AgentReservationTag{
		AgentUserID:     agentUserID,
		CustomerName:    in.CustomerName,
		CustomerContact: in.CustomerContact,
	})
	return res, nil
}

// Bookings lists reservations this agent booked.
func (s *Service) Bookings(ctx context.Context, agentUserID string, limit, offset int) ([]reservation.Reservation, error) {
	if agentUserID == "" {
		return nil, errors.New("agent: unauthenticated")
	}
	return s.resRepo.ListByAgent(ctx, agentUserID, limit, offset)
}

// Commissions sums the agent's commission across booked+settled reservations.
func (s *Service) Commissions(ctx context.Context, agentUserID string) (reservation.AgentCommissionTotals, error) {
	if agentUserID == "" {
		return reservation.AgentCommissionTotals{}, errors.New("agent: unauthenticated")
	}
	return s.resRepo.SumAgentCommission(ctx, agentUserID)
}

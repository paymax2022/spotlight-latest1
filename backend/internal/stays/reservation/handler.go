package reservation

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/stays/gateway"
)

// contentResolver fetches normalised property content for a (rail, supplier,
// supplier_property_ref). Matches search.Service.GetContent — passed as a plain
// func so the reservation package need not import search (avoids a cycle).
type contentResolver func(ctx context.Context, rail gateway.SourceRail, supplierCode, supplierPropertyRef string) (gateway.PropertyContent, error)

// Handler exposes the member + admin reservation routes.
type Handler struct {
	svc     *Service
	signRef func(ref string) (string, error) // R2 signer for vouchers (may be nil)
	content contentResolver                  // optional; enriches responses with display content (nil-safe)
}

// NewHandler constructs the reservation handler. signRef may be nil (voucher route
// then returns the raw ref instead of a signed URL).
func NewHandler(svc *Service, signRef func(ref string) (string, error)) *Handler {
	return &Handler{svc: svc, signRef: signRef}
}

// SetContentResolver injects a best-effort property-content fetcher used to
// enrich reservation responses with display fields (name/city/photo) so a client
// can render a booking without a second content call. Optional and nil-safe;
// non-breaking — existing constructions leave it unset.
func (h *Handler) SetContentResolver(fn contentResolver) { h.content = fn }

// reservationView embeds a Reservation (its JSON fields flatten to the top level)
// and adds an optional resolved content block.
type reservationView struct {
	*Reservation
	Content *contentView `json:"content,omitempty"`
}

type contentView struct {
	Name         string `json:"name"`
	City         string `json:"city"`
	Address      string `json:"address"`
	CoverURL     string `json:"cover_url"`
	StarRating   int    `json:"star_rating"`
	PropertyType string `json:"property_type"`
}

// enrich attaches best-effort display content to a reservation. The reservation
// persists the supplier property ref as PropertyID (clients address offers that
// way), so the resolver keys on (SourceRail, SupplierCode, PropertyID). Any error
// leaves Content nil — enrichment NEVER fails the request.
func (h *Handler) enrich(ctx context.Context, res *Reservation) reservationView {
	view := reservationView{Reservation: res}
	if h.content == nil || res == nil || res.PropertyID == "" {
		return view
	}
	pc, err := h.content(ctx, res.SourceRail, res.SupplierCode, res.PropertyID)
	if err != nil {
		return view // best-effort: leave content unresolved
	}
	cover := ""
	if len(pc.Photos) > 0 {
		cover = pc.Photos[0]
	}
	view.Content = &contentView{
		Name:         pc.Name,
		City:         pc.City,
		Address:      pc.Address,
		CoverURL:     cover,
		StarRating:   pc.StarRating,
		PropertyType: pc.PropertyType,
	}
	return view
}

func userID(c *gin.Context) string { return c.GetString("user_id") }

// mapErr maps service sentinel errors to HTTP responses (PRD §28 error taxonomy).
func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, ErrConsentRequired):
		c.JSON(http.StatusPreconditionRequired, gin.H{"error": "ndpa_consent_required", "code": "consent_required"})
	case errors.Is(err, ErrPrebookFailed):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "PREBOOK_FAILED"})
	case errors.Is(err, ErrInsufficient):
		c.JSON(http.StatusPaymentRequired, gin.H{"error": err.Error(), "code": "INSUFFICIENT_FUNDS"})
	case errors.Is(err, ErrBadState):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// Prebook (member): POST /prebook — two-step gate; returns book_token + priced total.
func (h *Handler) Prebook(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
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
	res, err := h.svc.Prebook(c.Request.Context(), uid, PrebookInput{
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
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// Book (member): POST /book {reservation_id, book_token, guest} — Idempotency-Key
// header REQUIRED. Runs the hold→book→charge→release saga with mandatory auto-release.
func (h *Handler) Book(c *gin.Context) {
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
		ReservationID string `json:"reservation_id" binding:"required"`
		BookToken     string `json:"book_token" binding:"required"`
		Guest         struct {
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
	res, err := h.svc.Book(c.Request.Context(), uid, body.ReservationID, body.BookToken, idemKey, gateway.GuestInfo{
		FirstName: body.Guest.FirstName,
		LastName:  body.Guest.LastName,
		Email:     body.Guest.Email,
		Phone:     body.Guest.Phone,
	})
	if err != nil {
		// A book that auto-released returns the VOID reservation plus an error;
		// surface the state so the client can show "released".
		if res != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "data": res})
			return
		}
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": res})
}

// List (member): GET /reservations
func (h *Handler) List(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rs, err := h.svc.List(c.Request.Context(), userID(c), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	views := make([]reservationView, 0, len(rs))
	for i := range rs {
		views = append(views, h.enrich(c.Request.Context(), &rs[i]))
	}
	c.JSON(http.StatusOK, gin.H{"data": views})
}

// Get (member): GET /reservations/:id
func (h *Handler) Get(c *gin.Context) {
	res, err := h.svc.Get(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": h.enrich(c.Request.Context(), res)})
}

// Voucher (member): GET /reservations/:id/voucher — signed URL.
func (h *Handler) Voucher(c *gin.Context) {
	ref, err := h.svc.Voucher(c.Request.Context(), userID(c), c.Param("id"))
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
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"voucher_url": url}})
}

// Cancel (member): POST /reservations/:id/cancel {reason}
func (h *Handler) Cancel(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	res, err := h.svc.Cancel(c.Request.Context(), userID(c), c.Param("id"), body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": h.enrich(c.Request.Context(), res)})
}

// Modify (member): POST /reservations/:id/modify {check_in, check_out} —
// Idempotency-Key header REQUIRED (a modify re-prices and may charge/refund the
// price delta; the key makes a retry replay-safe).
func (h *Handler) Modify(c *gin.Context) {
	idemKey := c.GetHeader("Idempotency-Key")
	if idemKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var body struct {
		CheckIn  string `json:"check_in" binding:"required"`
		CheckOut string `json:"check_out" binding:"required"`
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
	res, err := h.svc.Modify(c.Request.Context(), userID(c), c.Param("id"), idemKey, ci, co)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": h.enrich(c.Request.Context(), res)})
}

// AdminSearch (admin): GET /reservations?state=&city=
func (h *Handler) AdminSearch(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rs, err := h.svc.SearchAdmin(c.Request.Context(), c.Query("state"), c.Query("city"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rs})
}

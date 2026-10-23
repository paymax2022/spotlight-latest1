package restaurant

// FOOD-UAT-C-007: price QUOTE. Returns the exact breakdown PlaceOrder would charge
// (same priceOrder path) plus a server-signed, 15-minute snapshot stored in
// order_quotes. Consumption by PlaceOrder (refuse when the recomputed total differs
// from the stored one) is wired separately; this only emits the quote.

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// QuoteTTL is how long a quote stays valid.
const QuoteTTL = 15 * time.Minute

// OrderQuote is the quote response.
type OrderQuote struct {
	SubtotalKobo      int64     `json:"subtotal_kobo"`
	ServiceFeeKobo    int64     `json:"service_fee_kobo"`
	ServiceFeeBp      int       `json:"service_fee_bp"`
	DeliveryFeeKobo   int64     `json:"delivery_fee_kobo"`
	SurgeBp           int       `json:"surge_bp"`
	SurgeKobo         int64     `json:"surge_kobo"`
	PackagingKobo     int64     `json:"packaging_kobo"`
	PromoDiscountKobo int64     `json:"promo_discount_kobo"`
	PromoRejection    string    `json:"promo_rejection,omitempty"`
	TipKobo           int64     `json:"tip_kobo"`
	TotalKobo         int64     `json:"total_kobo"`
	Currency          string    `json:"currency"`
	QuoteID           string    `json:"quote_id"`
	ExpiresAt         time.Time `json:"expires_at"`
}

func signQuote(payload []byte) string {
	key := os.Getenv("ORDER_QUOTE_SIGNING_KEY")
	if key == "" {
		// No key configured: still an integrity digest of the stored payload.
		sum := sha256.Sum256(payload)
		return "sha256:" + hex.EncodeToString(sum[:])
	}
	m := hmac.New(sha256.New, []byte(key))
	m.Write(payload)
	return "hmac:" + hex.EncodeToString(m.Sum(nil))
}

// QuoteBreakdown prices the cart through priceOrder (no writes besides the quote
// snapshot). A rejected promo does not fail the quote: it is re-priced without the
// code and reported via promo_rejection.
func (s *Service) QuoteBreakdown(ctx context.Context, restaurantID, customerID string, req PlaceOrderRequest) (*OrderQuote, error) {
	rejection := ""
	pricing, err := s.priceOrder(ctx, restaurantID, customerID, req)
	if err != nil && errors.Is(err, ErrPromoInvalid) {
		rejection = s.classifyPromoRejection(ctx, restaurantID, strings.TrimSpace(req.PromoCode), err)
		req.PromoCode = ""
		pricing, err = s.priceOrder(ctx, restaurantID, customerID, req)
	}
	if err != nil {
		return nil, err
	}
	var feeBp, surgeBp int
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(service_fee_bp,0), COALESCE(surge_bp,0) FROM restaurants WHERE id=$1`,
		pricing.primaryRestaurantID).Scan(&feeBp, &surgeBp)

	q := &OrderQuote{
		SubtotalKobo: pricing.subtotal, ServiceFeeKobo: pricing.serviceFeeKobo, ServiceFeeBp: feeBp,
		DeliveryFeeKobo: pricing.deliveryKobo, SurgeBp: surgeBp, SurgeKobo: pricing.surgeKobo,
		PackagingKobo: pricing.packagingKobo, PromoDiscountKobo: pricing.discountKobo,
		PromoRejection: rejection, TipKobo: pricing.tipKobo, TotalKobo: pricing.total,
		Currency: "NGN", QuoteID: uuid.New().String(), ExpiresAt: time.Now().UTC().Add(QuoteTTL),
	}
	payload, err := json.Marshal(q)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO order_quotes (id, user_id, restaurant_id, payload_jsonb, signature, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6)`,
		q.QuoteID, customerID, pricing.primaryRestaurantID, payload, signQuote(payload), q.ExpiresAt); err != nil {
		return nil, err
	}
	return q, nil
}

// Quote handles POST /api/finance/restaurant/orders/quote.
func (h *Handler) Quote(c *gin.Context) {
	var body previewCartRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	rid, req, bad := body.toPlaceOrder()
	if bad != "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: bad})
		return
	}
	q, err := h.svc.QuoteBreakdown(c.Request.Context(), rid, ginutil.UserID(c), req)
	if err != nil {
		if code, ok := escrowErrStatus(err); ok {
			c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, q)
}

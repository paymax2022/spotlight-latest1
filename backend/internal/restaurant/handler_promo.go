package restaurant

// FOOD-UAT-C-011: promo-code PREVIEW. Lets checkout show "promo applied — ₦500 off" /
// "expired" / "invalid" live, without placing an order. It runs the SAME priceOrder
// path PlaceOrder uses (so the discount can never drift from what is charged) and
// commits nothing: no promo slot is reserved, no row is written.

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// previewCartRequest is the shared body of preview-promo and quote: the place-order
// cart fields plus restaurant_id (these routes are not under /:id).
type previewCartRequest struct {
	RestaurantID     string           `json:"restaurant_id"`
	Items            []OrderItemInput `json:"items"`
	DeliveryAddress  string           `json:"delivery_address"`
	DeliveryLat      *float64         `json:"delivery_lat,omitempty"`
	DeliveryLng      *float64         `json:"delivery_lng,omitempty"`
	DeliveryLocation *LatLng          `json:"delivery_location,omitempty"`
	PromoCode        string           `json:"promo_code"`
	TipKobo          int64            `json:"tip_kobo,omitempty"`
	OrderType        string           `json:"order_type,omitempty"` // accepted for parity; pricing has no per-type variant today
	ScheduledFor     *time.Time       `json:"scheduled_for,omitempty"`
	PackageCount     int              `json:"package_count,omitempty"`
}

// toPlaceOrder normalizes lines exactly like the PlaceOrder handler and returns the
// resolved restaurant id. ok=false carries a 400 message.
func (r previewCartRequest) toPlaceOrder() (string, PlaceOrderRequest, string) {
	req := PlaceOrderRequest{
		Items: r.Items, DeliveryAddress: r.DeliveryAddress, TipKobo: r.TipKobo,
		PromoCode: r.PromoCode, DeliveryLat: r.DeliveryLat, DeliveryLng: r.DeliveryLng,
		DeliveryLocation: r.DeliveryLocation, ScheduledFor: r.ScheduledFor, PackageCount: r.PackageCount,
	}
	if len(req.Items) == 0 {
		return "", req, "items are required"
	}
	for i := range req.Items {
		req.Items[i].MenuItemID = req.Items[i].MenuItem()
		req.Items[i].Quantity = req.Items[i].QtyOf()
		if req.Items[i].MenuItemID == "" {
			return "", req, "each item requires an item_id"
		}
		if req.Items[i].Quantity < 1 {
			return "", req, "each item requires a quantity >= 1"
		}
	}
	rid := strings.TrimSpace(r.RestaurantID)
	if rid == "" {
		rid = req.Items[0].RestaurantOf("")
	}
	if rid == "" {
		return "", req, "restaurant_id is required"
	}
	if cerr := ValidateDeliveryCoords(req); cerr != nil {
		return "", req, cerr.Error()
	}
	return rid, req, ""
}

// PromoPreview is the preview-promo response.
type PromoPreview struct {
	Valid              bool   `json:"valid"`
	Reason             string `json:"reason,omitempty"`
	DiscountKobo       int64  `json:"discount_kobo"`
	EffectiveTotalKobo int64  `json:"effective_total_kobo"`
	Funder             string `json:"funder,omitempty"`
}

// classifyPromoRejection maps an ErrPromoInvalid into a stable client reason:
// expired | invalid | not_eligible. Read-only.
func (s *Service) classifyPromoRejection(ctx context.Context, restaurantID, code string, err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "unknown code"):
		// Exists but scoped to some OTHER restaurant ⇒ not eligible here; else invalid.
		var one int
		if s.db.QueryRow(ctx, `SELECT 1 FROM restaurant_promos WHERE lower(code)=lower($1) LIMIT 1`, code).Scan(&one) == nil {
			return "not_eligible"
		}
		return "invalid"
	case strings.Contains(msg, "not active"):
		if p, lerr := s.loadPromoForOrder(ctx, restaurantID, code); lerr == nil {
			if p.EndsAt != nil && time.Now().After(*p.EndsAt) {
				return "expired"
			}
			if p.StartsAt != nil && time.Now().Before(*p.StartsAt) {
				return "not_started"
			}
		}
		return "invalid"
	default: // below minimum, usage limit reached, no discount, unfundable
		return "not_eligible"
	}
}

// PreviewPromo prices the cart WITH the code via the exact placement path and reports
// the outcome. A rejected code is a normal (valid:false) result, not an error; any
// other pricing refusal (unknown restaurant/item, closed, …) is returned as an error.
func (s *Service) PreviewPromo(ctx context.Context, restaurantID, customerID string, req PlaceOrderRequest) (*PromoPreview, error) {
	code := strings.TrimSpace(req.PromoCode)
	pricing, err := s.priceOrder(ctx, restaurantID, customerID, req)
	if err == nil {
		out := &PromoPreview{Valid: true, DiscountKobo: pricing.discountKobo, EffectiveTotalKobo: pricing.total}
		if pricing.promoFunder != nil {
			out.Funder = merchantFunderLabel(*pricing.promoFunder)
		}
		return out, nil
	}
	if !errors.Is(err, ErrPromoInvalid) {
		return nil, err
	}
	reason := s.classifyPromoRejection(ctx, restaurantID, code, err)
	req.PromoCode = ""
	base, berr := s.priceOrder(ctx, restaurantID, customerID, req)
	if berr != nil {
		return nil, berr
	}
	return &PromoPreview{Valid: false, Reason: reason, EffectiveTotalKobo: base.total}, nil
}

func merchantFunderLabel(f string) string {
	if f == string(FunderRestaurant) {
		return "merchant"
	}
	return f
}

// PreviewPromo handles POST /api/finance/restaurant/orders/preview-promo.
func (h *Handler) PreviewPromo(c *gin.Context) {
	var body previewCartRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if strings.TrimSpace(body.PromoCode) == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "promo_code is required"})
		return
	}
	rid, req, bad := body.toPlaceOrder()
	if bad != "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: bad})
		return
	}
	out, err := h.svc.PreviewPromo(c.Request.Context(), rid, ginutil.UserID(c), req)
	if err != nil {
		if code, ok := escrowErrStatus(err); ok {
			c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, out)
}

package restaurant

// FOOD-UAT-C-007 (consumption half): PlaceOrder with a quote_id. The quote
// minted by POST /orders/quote is claimed exactly once (consumed_at), its
// signature re-verified, and the cart re-priced through the SAME priceOrder; a
// total that drifted by more than quoteToleranceKobo is refused with
// ErrPriceChanged (HTTP 409 price_changed) so the client can re-confirm.

import (
	"context"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// quoteToleranceKobo is the largest total drift still treated as "same price".
const quoteToleranceKobo = 1

var (
	// ErrPriceChanged: the recomputed total differs from the quoted one (409).
	ErrPriceChanged = errors.New("restaurant: price changed since quote")
	// ErrQuoteInvalid: unknown, expired, already-used, tampered or foreign quote (409).
	ErrQuoteInvalid = errors.New("restaurant: quote is invalid, expired or already used")
)

// PriceChangedError carries the old (quoted) and new (current) totals.
type PriceChangedError struct {
	QuoteID                    string
	OldTotalKobo, NewTotalKobo int64
}

func (e *PriceChangedError) Error() string {
	return fmt.Sprintf("%s: was %d kobo, now %d kobo", ErrPriceChanged.Error(), e.OldTotalKobo, e.NewTotalKobo)
}
func (e *PriceChangedError) Unwrap() error { return ErrPriceChanged }

// writeQuoteError renders the quote-specific refusals; false = not one of ours.
func writeQuoteError(c *gin.Context, err error) bool {
	var pc *PriceChangedError
	switch {
	case errors.As(err, &pc):
		c.JSON(http.StatusConflict, gin.H{keyError: pc.Error(), "code": "price_changed",
			"quote_id": pc.QuoteID, "old_total_kobo": pc.OldTotalKobo, "new_total_kobo": pc.NewTotalKobo})
		return true
	case errors.Is(err, ErrQuoteInvalid):
		c.JSON(http.StatusConflict, gin.H{keyError: err.Error(), "code": "quote_invalid"})
		return true
	}
	return false
}

func (s *Service) releaseQuote(ctx context.Context, quoteID string) {
	_, _ = s.db.Exec(context.WithoutCancel(ctx), `UPDATE order_quotes SET consumed_at=NULL WHERE id=$1`, quoteID)
}

// placeOrderWithQuote claims the quote atomically BEFORE pricing (so two racing
// placements cannot both use it), verifies it, and releases the claim if the
// order is not created for a reason that leaves the quote reusable (e.g. a
// transient failure or insufficient funds). A price change or a bad signature
// keeps the quote burned: the client must fetch a fresh one.
func (s *Service) placeOrderWithQuote(ctx context.Context, restaurantID, customerID string, req PlaceOrderRequest) (*Order, error) {
	quoteID := strings.TrimSpace(req.QuoteID)
	if _, err := uuid.Parse(quoteID); err != nil {
		return nil, ErrQuoteInvalid
	}
	// A retry of an already-placed order (same Idempotency-Key) returns that order
	// even though its quote is, by now, consumed.
	if req.IdempotencyKey != "" {
		existing, err := s.findOrderByIdempotencyKey(ctx, req.IdempotencyKey, customerID)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			return existing, nil
		}
	}

	var quotedRestaurant string
	var payload []byte
	var signature string
	err := s.db.QueryRow(ctx,
		`UPDATE order_quotes SET consumed_at=now()
		  WHERE id=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at > now()
		  RETURNING restaurant_id::text, payload_jsonb, signature`, quoteID, customerID).
		Scan(&quotedRestaurant, &payload, &signature)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrQuoteInvalid
		}
		return nil, err
	}

	// jsonb does not preserve the signed bytes, so rebuild them from the typed
	// struct (deterministic field order) exactly as QuoteBreakdown signed them.
	var q OrderQuote
	if err := json.Unmarshal(payload, &q); err != nil {
		return nil, ErrQuoteInvalid
	}
	canonical, err := json.Marshal(q)
	if err != nil || !hmac.Equal([]byte(signQuote(canonical)), []byte(signature)) {
		return nil, ErrQuoteInvalid
	}

	released := false
	release := func() {
		if !released {
			released = true
			s.releaseQuote(ctx, quoteID)
		}
	}

	pricing, err := s.priceOrder(ctx, restaurantID, customerID, req)
	if err != nil {
		release()
		return nil, err
	}
	if quotedRestaurant != pricing.primaryRestaurantID {
		return nil, ErrQuoteInvalid
	}
	if d := pricing.total - q.TotalKobo; d > quoteToleranceKobo || d < -quoteToleranceKobo {
		return nil, &PriceChangedError{QuoteID: quoteID, OldTotalKobo: q.TotalKobo, NewTotalKobo: pricing.total}
	}

	order, err := s.placeOrder(ctx, restaurantID, customerID, req, false, 0)
	if err != nil {
		release()
		return nil, err
	}
	return order, nil
}

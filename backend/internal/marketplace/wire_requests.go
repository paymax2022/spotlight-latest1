package marketplace

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// Request wire shapes for the offers/threads negotiation endpoints.
//
// These are named types rather than anonymous structs inside the handlers so
// the decoding can be tested against the exact bytes the mobile client emits —
// which is the half that was never checked, and the reason every one of these
// endpoints was unreachable in production:
//
// The mobile client (mobile-app/reactnative/src/features/marketplace/api/
// client.ts) transforms in BOTH directions — deepSnake on every outbound body
// and query, deepCamel on every response. The handlers here were written with
// camelCase request tags, reasoning from the camelCase RESPONSE type. Responses
// survived that (deepCamel accepts either), but no camelCase REQUEST field could
// ever be populated, so offers bound an empty listing and a zero price.
//
// Canonical names are the contract's (contracts/openapi.yaml
// MktOfferCreateRequest: listing_id, offer_price_kobo). The camelCase aliases
// accept builds that predate this fix; they cost one field each and mean an
// older app degrades to working rather than to a silent zero.

// createOfferRequest is the POST /offers body.
type createOfferRequest struct {
	ListingID      string `json:"listing_id"`
	ListingIDAlias string `json:"listingId"`
	OfferPriceKobo int64  `json:"offer_price_kobo"`
	PriceKobo      int64  `json:"price_kobo"`
	PriceKoboAlias int64  `json:"priceKobo"`
	Message        string `json:"message"`
}

func (r createOfferRequest) listingID() string {
	return firstNonEmpty(r.ListingID, r.ListingIDAlias)
}

func (r createOfferRequest) priceKobo() int64 {
	return firstNonZero(r.OfferPriceKobo, r.PriceKobo, r.PriceKoboAlias)
}

// counterOfferRequest is the POST /offers/:id/counter body.
type counterOfferRequest struct {
	OfferPriceKobo int64 `json:"offer_price_kobo"`
	PriceKobo      int64 `json:"price_kobo"`
	PriceKoboAlias int64 `json:"priceKobo"`
}

func (r counterOfferRequest) priceKobo() int64 {
	return firstNonZero(r.OfferPriceKobo, r.PriceKobo, r.PriceKoboAlias)
}

// createThreadRequest is the POST /threads body.
type createThreadRequest struct {
	ListingID      string `json:"listing_id"`
	ListingIDAlias string `json:"listingId"`
	Message        string `json:"message"`
}

func (r createThreadRequest) listingID() string {
	return firstNonEmpty(r.ListingID, r.ListingIDAlias)
}

// listingIDQuery reads the listing_id query param for GET /offers. Every other
// query param in this module is snake_case (market_id, category_id, price_min,
// target_type…); this one was the lone camelCase outlier, so it matched nothing
// the client sent and 400'd every negotiation-history fetch. Extracted so the
// wire name is testable without a database.
func listingIDQuery(c *gin.Context) string {
	return firstNonEmpty(c.Query("listing_id"), c.Query("listingId"))
}

// ─── Wire-name compatibility helpers ─────────────────────────────────────────

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func firstNonZero(vals ...int64) int64 {
	for _, v := range vals {
		if v != 0 {
			return v
		}
	}
	return 0
}

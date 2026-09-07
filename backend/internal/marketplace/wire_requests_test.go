package marketplace

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// These payloads are the exact bytes the mobile client puts on the wire. Its
// mktPost/mktGet run every outbound body and query through deepSnake, so what
// the app calls `listingId` leaves as `listing_id`. Handlers here previously
// read the camelCase spellings, which no request could ever carry: offers bound
// an empty listing and a zero price, and the negotiation-history GET 400'd.
//
// Assert on the decoded values, not on the tags, so this fails if anyone
// reintroduces camelCase request fields.

func TestCreateOfferRequest_DecodesClientWireShape(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		listing string
		price   int64
	}{
		{
			name:    "client shape (deepSnake output, contract names)",
			body:    `{"listing_id":"4528e3a4-d5e2-4bea-9a4b-aad9d8728689","offer_price_kobo":250000,"message":"hi"}`,
			listing: "4528e3a4-d5e2-4bea-9a4b-aad9d8728689",
			price:   250000,
		},
		{
			name:    "price_kobo alias (builds before the client was aligned)",
			body:    `{"listing_id":"L1","price_kobo":900}`,
			listing: "L1",
			price:   900,
		},
		{
			name:    "camelCase alias (builds predating the fix)",
			body:    `{"listingId":"L2","priceKobo":700}`,
			listing: "L2",
			price:   700,
		},
		{
			name:    "canonical wins over aliases",
			body:    `{"listing_id":"CANON","listingId":"OLD","offer_price_kobo":100,"priceKobo":999}`,
			listing: "CANON",
			price:   100,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var r createOfferRequest
			if err := json.Unmarshal([]byte(tc.body), &r); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if got := r.listingID(); got != tc.listing {
				t.Errorf("listingID() = %q, want %q", got, tc.listing)
			}
			if got := r.priceKobo(); got != tc.price {
				t.Errorf("priceKobo() = %d, want %d", got, tc.price)
			}
		})
	}
}

// A blank listing must stay blank so the service guard can name the field,
// rather than a whitespace string reaching the repository as a bad uuid.
func TestCreateOfferRequest_BlankListingIsEmpty(t *testing.T) {
	var r createOfferRequest
	if err := json.Unmarshal([]byte(`{"listing_id":"   ","offer_price_kobo":1}`), &r); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got := r.listingID(); got != "" {
		t.Errorf("listingID() = %q, want empty for a whitespace-only value", got)
	}
}

func TestCounterOfferRequest_DecodesClientWireShape(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		want int64
	}{
		{"contract name", `{"offer_price_kobo":4500}`, 4500},
		{"price_kobo alias", `{"price_kobo":4500}`, 4500},
		{"camelCase alias", `{"priceKobo":4500}`, 4500},
		{"missing price stays zero (service rejects)", `{}`, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var r counterOfferRequest
			if err := json.Unmarshal([]byte(tc.body), &r); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if got := r.priceKobo(); got != tc.want {
				t.Errorf("priceKobo() = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestCreateThreadRequest_DecodesClientWireShape(t *testing.T) {
	for _, tc := range []struct {
		name, body, want string
	}{
		{"contract name", `{"listing_id":"L1","message":"hey"}`, "L1"},
		{"camelCase alias", `{"listingId":"L2"}`, "L2"},
		{"absent", `{}`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var r createThreadRequest
			if err := json.Unmarshal([]byte(tc.body), &r); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if got := r.listingID(); got != tc.want {
				t.Errorf("listingID() = %q, want %q", got, tc.want)
			}
		})
	}
}

// The GET /offers query param — the failure the user actually saw:
//
//	GET /api/v1/marketplace/offers?listing_id=4528e3a4-… → 400 (Bad Request)
//
// mktGet snake-cases params, so `listing_id` is the only spelling that ever
// arrives from the app.
func TestListingIDQuery_ReadsClientWireName(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, query, want string
	}{
		{"client wire name", "listing_id=4528e3a4-d5e2-4bea-9a4b-aad9d8728689", "4528e3a4-d5e2-4bea-9a4b-aad9d8728689"},
		{"camelCase alias", "listingId=L2", "L2"},
		{"canonical wins", "listing_id=CANON&listingId=OLD", "CANON"},
		{"absent", "", ""},
		{"blank is empty", "listing_id=%20%20", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodGet, "/offers?"+tc.query, nil)
			if got := listingIDQuery(c); got != tc.want {
				t.Errorf("listingIDQuery() = %q, want %q", got, tc.want)
			}
		})
	}
}

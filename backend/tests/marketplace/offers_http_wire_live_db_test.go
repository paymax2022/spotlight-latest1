package marketplace_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	mkt "spotlight/backend/internal/marketplace"
)

// The offers endpoints were unreachable from the app for a wire-name reason the
// service-level tests in this package could not see: they call the Service
// directly, so they never exercise the JSON tags or the query param. The
// handler read `listingId`/`priceKobo`; the mobile client snake-cases every
// outbound body and query, so nothing ever matched.
//
// These drive the real gin route over HTTP with the exact bytes the app sends,
// through the real Service to the real database.

// offersRouter mounts the real handlers with an injected user, standing in for
// the auth middleware (handler.go userID() reads the "user_id" context key).
func offersRouter(svc *mkt.Service, uid string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := mkt.NewHandler(svc)
	r.Use(func(c *gin.Context) { c.Set("user_id", uid); c.Next() })
	r.GET("/offers", h.ListOffers)
	r.POST("/offers", h.CreateOffer)
	r.POST("/offers/:id/counter", h.CounterOffer)
	return r
}

func TestOffersHTTP_ClientWireShape_LiveDB(t *testing.T) {
	ctx := context.Background()
	_, pool := liveConnectService(t)
	svc, seller, listingID := seedActiveOwnedListing(t, ctx)
	buyer := uuid.NewString()

	// Registered after the seed helper's teardown so it runs BEFORE it (LIFO).
	// CreateOffer also opens a thread, and nothing here cascades from the
	// listing, so every dependant has to go first or the listing delete fails
	// on mkt_threads_listing_id_fkey.
	t.Cleanup(func() {
		bg := context.Background()
		for _, q := range []string{
			`DELETE FROM public.mkt_deal_reviews WHERE thread_id IN (SELECT id FROM public.mkt_threads WHERE listing_id=$1)`,
			`DELETE FROM public.mkt_messages    WHERE thread_id IN (SELECT id FROM public.mkt_threads WHERE listing_id=$1)`,
			`DELETE FROM public.mkt_offers      WHERE listing_id=$1`,
			`DELETE FROM public.mkt_threads     WHERE listing_id=$1`,
		} {
			if _, err := pool.Exec(bg, q, listingID); err != nil {
				t.Errorf("cleanup %.48s…: %v", q, err)
			}
		}
	})

	// ── POST /offers, exactly as mktPost serialises it ────────────────────────
	buyerAPI := offersRouter(svc, buyer)
	body := fmt.Sprintf(`{"listing_id":%q,"offer_price_kobo":250000,"message":"is this still available"}`, listingID)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/offers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	buyerAPI.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /offers = %d, want 201\nbody: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Data struct {
			ID             string `json:"id"`
			ListingID      string `json:"listingId"`
			OfferPriceKobo int64  `json:"offerPriceKobo"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v — body %s", err, rec.Body.String())
	}
	// Before the fix these were "" and 0: the handler read camelCase, so the
	// listing bound empty and the price bound zero.
	if created.Data.ListingID != listingID {
		t.Errorf("created offer listing = %q, want %q", created.Data.ListingID, listingID)
	}
	if created.Data.OfferPriceKobo != 250000 {
		t.Errorf("created offer price = %d, want 250000", created.Data.OfferPriceKobo)
	}
	offerID := created.Data.ID

	// ── GET /offers?listing_id=… — the call that returned 400 ─────────────────
	sellerAPI := offersRouter(svc, seller)
	rec = httptest.NewRecorder()
	sellerAPI.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/offers?listing_id="+listingID, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /offers?listing_id = %d, want 200\nbody: %s", rec.Code, rec.Body.String())
	}
	var listed struct {
		Data []struct {
			ID        string `json:"id"`
			ListingID string `json:"listingId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode list response: %v — body %s", err, rec.Body.String())
	}
	if len(listed.Data) != 1 || listed.Data[0].ID != offerID {
		t.Fatalf("seller saw %d offers, want the 1 just created (%s): %s",
			len(listed.Data), offerID, rec.Body.String())
	}

	// ── The original failing spelling still 400s, naming the wire field ───────
	rec = httptest.NewRecorder()
	sellerAPI.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/offers", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("GET /offers with no param = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "listing_id") {
		t.Errorf("400 body should name listing_id, got %s", rec.Body.String())
	}

	// ── POST /offers/:id/counter, as the seller ──────────────────────────────
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/offers/"+offerID+"/counter",
		strings.NewReader(`{"offer_price_kobo":300000}`))
	req.Header.Set("Content-Type", "application/json")
	sellerAPI.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST counter = %d, want 201\nbody: %s", rec.Code, rec.Body.String())
	}
	var countered struct {
		Data struct {
			ID             string `json:"id"`
			OfferPriceKobo int64  `json:"offerPriceKobo"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &countered); err != nil {
		t.Fatalf("decode counter: %v", err)
	}
	// Before the fix this bound zero and the service rejected it as non-positive.
	if countered.Data.OfferPriceKobo != 300000 {
		t.Errorf("counter price = %d, want 300000", countered.Data.OfferPriceKobo)
	}
}

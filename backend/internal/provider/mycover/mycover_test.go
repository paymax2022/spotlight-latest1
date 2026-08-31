package mycover

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/insurance/gateway"
)

// ════════════════════════════════════════════════════════════════════════════
// ENVELOPE
// ════════════════════════════════════════════════════════════════════════════

// TestEnvelope_ResponseTextBothShapes is the regression that matters most:
// MyCover returns responseText as a STRING on success and as an ARRAY OF
// STRINGS on every validation failure. A parser that declares it `string`
// errors out on exactly the case a bind hits most often.
func TestEnvelope_ResponseTextBothShapes(t *testing.T) {
	t.Run("string form", func(t *testing.T) {
		var e envelope
		if err := json.Unmarshal([]byte(`{"responseCode":1,"responseText":"Products fetched successfully","data":{}}`), &e); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if !e.OK() {
			t.Fatal("responseCode 1 must be OK")
		}
		if got := e.Text(); got != "Products fetched successfully" {
			t.Fatalf("Text() = %q", got)
		}
		if got := e.Messages(); len(got) != 1 || got[0] != "Products fetched successfully" {
			t.Fatalf("Messages() = %v", got)
		}
	})

	t.Run("array form", func(t *testing.T) {
		// Verbatim shape from a live POST /products/sti/buy-marine-cover with {}.
		raw := `{"responseCode":0,"responseText":["cargo_details must be an array","first_name must be longer than or equal to 2 characters","email must be an email"]}`
		var e envelope
		if err := json.Unmarshal([]byte(raw), &e); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if e.OK() {
			t.Fatal("responseCode 0 must not be OK")
		}
		msgs := e.Messages()
		if len(msgs) != 3 {
			t.Fatalf("Messages() = %v, want 3 validation strings", msgs)
		}
		if !strings.Contains(e.Text(), "must be an email") {
			t.Fatalf("Text() dropped a validation message: %q", e.Text())
		}
	})

	t.Run("absent", func(t *testing.T) {
		var e envelope
		_ = json.Unmarshal([]byte(`{"responseCode":1}`), &e)
		if e.Text() != "" || e.Messages() != nil {
			t.Fatal("absent responseText must be empty, not a panic")
		}
	})
}

func TestDo_ForbiddenIsScopeError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"responseCode":0,"responseText":"Forbidden resource","path":"/v1/claims"}`))
	}))
	defer srv.Close()

	c := New("test-key", "", "", srv.URL)
	_, err := c.GetClaim(context.Background(), "some-ref")
	if !errors.Is(err, ErrProviderScope) {
		t.Fatalf("403 must map to ErrProviderScope, got %v", err)
	}
}

func TestDo_ValidationErrorCarriesFieldMessages(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"responseCode":0,"responseText":["nin must be exactly 11 characters","gender must be one of the following values: Male, Female"]}`))
	}))
	defer srv.Close()

	c := New("test-key", "", "", srv.URL)
	_, err := c.BindPolicy(context.Background(), gateway.BindRequest{
		Product: gateway.ProviderProduct{Code: "bastion-medisure", ProviderProductID: "uuid-1"},
		Inputs:  map[string]any{"first_name": "A"},
	})
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("want *APIError, got %#v", err)
	}
	if !apiErr.Validation() {
		t.Fatal("400 must report as a validation error")
	}
	if len(apiErr.Messages) != 2 {
		t.Fatalf("field messages lost: %v", apiErr.Messages)
	}
}

// TestDo_AuthorizationHeaderUsesBearerPrefix pins a live-verified fact: sending
// the key without the "Bearer " prefix returns 400 "Invalid bearer token format".
func TestDo_AuthorizationHeaderUsesBearerPrefix(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":{"total_count":0,"policies":[]}}`))
	}))
	defer srv.Close()

	c := New("MCASECK_TEST", "", "", srv.URL)
	if _, _, err := c.ListPolicies(context.Background(), 1, 10); err != nil {
		t.Fatalf("ListPolicies: %v", err)
	}
	if !strings.HasPrefix(gotAuth, "Bearer ") {
		t.Fatalf("Authorization header must carry the Bearer prefix, got %q", gotAuth)
	}
}

func TestDo_NoAPIKeyFailsClosed(t *testing.T) {
	c := New("", "", "", "http://127.0.0.1:1")
	if _, _, err := c.ListProducts(context.Background(), 1, 10); err == nil {
		t.Fatal("an unconfigured adapter must fail, not attempt a call")
	}
}

// ════════════════════════════════════════════════════════════════════════════
// PER-PRODUCT ROUTING
// ════════════════════════════════════════════════════════════════════════════

// TestBindPolicy_PostsToTheSingleV2Endpoint proves the v2 model: ONE purchase
// endpoint for every product, with the product selected by product_id in a flat
// body. No product identity is branched on in code.
func TestBindPolicy_PostsToTheSingleV2Endpoint(t *testing.T) {
	var gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"Purchase successful","data":{"policy_id":"pol-123","status":"active","premium":"6000.0000"}}`))
	}))
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	pol, err := c.BindPolicy(context.Background(), gateway.BindRequest{
		Product: gateway.ProviderProduct{
			Code:              "sti-marine-cover",
			ProviderProductID: "uuid-marine",
			CommissionBps:     1000, // 10%
			Underwriter:       "Sovereign Trust Insurance Plc",
		},
		Currency:    "NGN",
		PremiumKobo: 600_000,
		Inputs: map[string]any{
			"first_name":  "Ada",
			"cargo_value": 50000,
		},
	})
	if err != nil {
		t.Fatalf("BindPolicy: %v", err)
	}
	if gotPath != BuyPath {
		t.Fatalf("posted to %q, want the single v2 purchase endpoint %q", gotPath, BuyPath)
	}
	if gotBody[FieldProductID] != "uuid-marine" {
		t.Fatalf("product_id must select the product: %v", gotBody)
	}
	if gotBody["first_name"] != "Ada" {
		t.Fatalf("product fields must be sent FLAT, got %v", gotBody)
	}
	if _, nested := gotBody["inputs"]; nested {
		t.Fatal("fields must not be wrapped in an `inputs` object — no MyCover schema declares one")
	}
	if pol.ProviderPolicyRef != "pol-123" {
		t.Fatalf("policy ref = %q", pol.ProviderPolicyRef)
	}
	// "6000.0000" naira must arrive as 600000 kobo — not 6000, not a float.
	if pol.PremiumKobo != 600_000 {
		t.Fatalf("premium = %d kobo, want 600000", pol.PremiumKobo)
	}
	// 10% of 600000 kobo.
	if pol.CommissionKobo != 60_000 {
		t.Fatalf("commission = %d kobo, want 60000", pol.CommissionKobo)
	}
	if pol.Aggregator != "mycover" {
		t.Fatalf("aggregator = %q", pol.Aggregator)
	}
}

// TestBindPolicy_NoProductIDFailsClosed — product_id is the ONLY thing that
// selects which cover is bought on v2's shared endpoint. Without it we would buy
// an unknown product with a member's money.
func TestBindPolicy_NoProductIDFailsClosed(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	_, err := c.BindPolicy(context.Background(), gateway.BindRequest{
		Product: gateway.ProviderProduct{Code: "some-product"},
	})
	if !errors.Is(err, ErrNoProductID) {
		t.Fatalf("want ErrNoProductID, got %v", err)
	}
	// It must also read as a DEFINITE rejection: nothing reached the provider, so
	// a retry is safe and must not be locked for reconciliation.
	if !errors.Is(err, gateway.ErrProviderRejected) {
		t.Fatal("a pre-flight refusal must wrap ErrProviderRejected — nothing was created")
	}
}

// TestBindPolicy_RefusesBrokenProduct — 7 of MyCover's 69 products have broken
// provider configuration. Selling one takes a member's money for cover that
// cannot be issued.
func TestBindPolicy_RefusesBrokenProduct(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	prod := gateway.ProviderProduct{Code: "aiico-hospital-cash", ProviderProductID: "uuid", NotPurchasable: true}

	if _, err := c.BindPolicy(context.Background(), gateway.BindRequest{Product: prod}); !errors.Is(err, ErrProductNotPurchasable) {
		t.Fatalf("bind on a broken product must refuse, got %v", err)
	}
	// It must not even be quotable — a price for something unbuyable is a lie.
	if _, err := c.GetQuote(context.Background(), gateway.QuoteRequest{Product: prod}); !errors.Is(err, ErrProductNotPurchasable) {
		t.Fatalf("quote on a broken product must refuse, got %v", err)
	}
}

// TestBindPolicy_MissingPolicyRefIsAnError — a purchase we cannot reference is
// not a purchase we can honour.
func TestBindPolicy_MissingPolicyRefIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":{"status":"active"}}`))
	}))
	defer srv.Close()
	c := New("k", "", "", srv.URL)
	_, err := c.BindPolicy(context.Background(), gateway.BindRequest{
		Product: gateway.ProviderProduct{Code: "p", ProviderProductID: "uuid-p"},
	})
	if err == nil || !strings.Contains(err.Error(), "no policy reference") {
		t.Fatalf("want a missing-reference error, got %v", err)
	}
}

func TestCancelPolicy_IsHonestlyUnsupported(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	if _, err := c.CancelPolicy(context.Background(), "ref", "reason"); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("want ErrUnsupported, got %v", err)
	}
}

// ════════════════════════════════════════════════════════════════════════════
// QUOTING — the money path
// ════════════════════════════════════════════════════════════════════════════

// TestGetQuote_UsesProviderComputePrice is the v2 correctness win: the premium
// is the PROVIDER's own figure from POST /products/compute-price, not something
// Paymax computed and then charged.
func TestGetQuote_UsesProviderComputePrice(t *testing.T) {
	var gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		// Verbatim live shape: data.price is a bare NAIRA number.
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"Price computed successfully","data":{"price":4000}}`))
	}))
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	q, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gateway.ProviderProduct{
			Code:              "bastion-flexicare-mini",
			ProviderProductID: "f7b4bca1-b870-4648-8704-11c1802a51d0",
			CommissionBps:     1000, // 10%
			CoverPeriodDays:   365,
			Underwriter:       "Bastion Health Ltd",
		},
		Inputs: map[string]any{"first_name": "Q", "payment_plan": 1},
	})
	if err != nil {
		t.Fatalf("GetQuote: %v", err)
	}
	if gotPath != QuotePath {
		t.Fatalf("quoted at %q, want %q", gotPath, QuotePath)
	}
	// The envelope carries product_id; the answers go in `body`.
	if gotBody[FieldProductID] != "f7b4bca1-b870-4648-8704-11c1802a51d0" {
		t.Fatalf("product_id must select the product: %v", gotBody)
	}
	body, _ := gotBody["body"].(map[string]any)
	if body == nil || body["first_name"] != "Q" {
		t.Fatalf("member answers must travel in `body`: %v", gotBody)
	}
	if _, leaked := body[FieldProductID]; leaked {
		t.Fatal("product_id belongs in the envelope, not duplicated into body")
	}

	// ₦4,000 must arrive as 400,000 kobo — never 4000, never a float.
	if q.PremiumKobo != 400_000 {
		t.Fatalf("premium = %d kobo, want 400000", q.PremiumKobo)
	}
	if q.CommissionKobo != 40_000 { // 10% of the provider's premium
		t.Fatalf("commission = %d kobo, want 40000", q.CommissionKobo)
	}
	if q.Terms["priced_by"] != "provider" {
		t.Fatalf("the quote must disclose that the PROVIDER priced it: %v", q.Terms)
	}
	if q.Underwriter != "Bastion Health Ltd" {
		t.Fatalf("underwriter disclosure lost: %q", q.Underwriter)
	}
}

// TestGetQuote_ForwardsPaymentPlanToTheProvider — payment_plan is an instalment
// count that changes the premium (live: 1 => NGN4,000, 12 => NGN48,000). Under v2
// it is simply forwarded and the PROVIDER returns the resulting price, so there
// is nothing for us to compute and nothing to get wrong.
func TestGetQuote_ForwardsPaymentPlanToTheProvider(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Body map[string]any `json:"body"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		// Mirror the live provider behaviour: the price scales with the plan.
		plan := 1
		if f, ok := in.Body["payment_plan"].(float64); ok {
			plan = int(f)
		}
		fmt.Fprintf(w, `{"responseCode":1,"responseText":"ok","data":{"price":%d}}`, 4000*plan)
	}))
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	prod := gateway.ProviderProduct{Code: "bastion-flexicare-mini", ProviderProductID: "uuid"}

	for _, tc := range []struct{ plan, wantKobo int }{{1, 400_000}, {12, 4_800_000}} {
		q, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
			Product: prod,
			Inputs:  map[string]any{FieldPaymentPlan: tc.plan},
		})
		if err != nil {
			t.Fatalf("plan %d: %v", tc.plan, err)
		}
		if q.PremiumKobo != int64(tc.wantKobo) {
			t.Fatalf("plan %d: premium = %d kobo, want %d", tc.plan, q.PremiumKobo, tc.wantKobo)
		}
	}
}

// TestGetQuote_RefusesZeroPremium — a zero premium would debit nothing and bind
// cover nobody paid for. Refuse rather than pass it on.
func TestGetQuote_RefusesZeroPremium(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":{}}`))
	}))
	defer srv.Close()
	c := New("k", "", "", srv.URL)
	if _, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gateway.ProviderProduct{Code: "x", ProviderProductID: "uuid"},
	}); err == nil {
		t.Fatal("a quote with no usable premium must fail, not return zero")
	}
}

// TestGetQuote_RefusesWithoutProductID — nothing selects the product without it.
func TestGetQuote_RefusesWithoutProductID(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	if _, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gateway.ProviderProduct{Code: "x"},
	}); !errors.Is(err, ErrNoProductID) {
		t.Fatalf("want ErrNoProductID, got %v", err)
	}
}

// ════════════════════════════════════════════════════════════════════════════
// CATALOG NORMALISATION
// ════════════════════════════════════════════════════════════════════════════

// TestListProducts_NormalisesLiveShape feeds the adapter the verbatim v2 shapes
// — a LIGHT list plus a full record per id — and checks every value that crosses
// the money boundary.
func TestListProducts_NormalisesLiveShape(t *testing.T) {
	list := `{"responseCode":1,"responseText":"ok","data":{"total_count":2,"products":[
	  {"id":"6e417faa-e042-4768-8d5d-916fd531a478","name":"Annual Goods In Transit"},
	  {"id":"5886bfc5-a387-4980-8ca4-708c0f083325","name":"Laptop Standard"}
	]}}`
	details := map[string]string{
		"6e417faa-e042-4768-8d5d-916fd531a478": `{"responseCode":1,"responseText":"ok","data":{
		   "id":"6e417faa-e042-4768-8d5d-916fd531a478","name":"Annual Goods In Transit","route_name":"sti-git-annual","prefix":"sti",
		   "base_price":"0.5","is_percentage":true,"cover_period":"365","is_active":true,"is_renewable":true,"is_claimable":true,
		   "is_certificateable":true,"key_benefits":"<p>b</p>","full_benefits":["<p>one</p>","<p>two</p>"],
		   "meta":{"certificate_template":"x"},
		   "category":{"id":"c","name":"Package"},"provider":{"id":"p","organization_name":"Sovereign Trust Insurance Plc"},
		   "currency":{"name":"Nigerian Naira"},"country":{"name":"Nigeria"},
		   "sharing_formula":[{"mca_commission":25,"provider_commission":65,"distributor_commission":10,"provider_commission_from":"original_premium"}]}}`,
		"5886bfc5-a387-4980-8ca4-708c0f083325": `{"responseCode":1,"responseText":"ok","data":{
		   "id":"5886bfc5-a387-4980-8ca4-708c0f083325","name":"Laptop Standard","route_name":"sti-laptop-cover-standard","prefix":"sti",
		   "base_price":"7.0000","is_percentage":true,"cover_period":"365","is_active":true,
		   "meta":{"sum_insured":400000},
		   "category":{"id":"g","name":"Gadget"},"provider":{"organization_name":"Sovereign Trust Insurance Plc"},
		   "sharing_formula":[{"distributor_commission":"12.5"}]}}`,
	}

	var sawList bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/products/all" {
			sawList = true
			if r.URL.Query().Get("limit") != "100" {
				t.Errorf("limit not forwarded: %q", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(list))
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/products/")
		body, ok := details[id]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	products, total, err := c.ListProducts(context.Background(), 1, 100)
	if err != nil {
		t.Fatalf("ListProducts: %v", err)
	}
	if !sawList {
		t.Fatal("the v2 light list endpoint was never called")
	}
	if total != 2 || len(products) != 2 {
		t.Fatalf("got %d products (total %d)", len(products), total)
	}

	byCode := map[string]CatalogProduct{}
	for _, p := range products {
		byCode[p.Code] = p
	}

	git, ok := byCode["sti-git-annual"]
	if !ok {
		t.Fatalf("sti-git-annual missing; got %v", byCode)
	}
	if git.ProviderProductID != "6e417faa-e042-4768-8d5d-916fd531a478" {
		t.Fatalf("product uuid lost: %q — nothing can be bought without it", git.ProviderProductID)
	}
	if !git.IsPercentage || git.RateBps != 50 { // 0.5% => 50 bps
		t.Fatalf("rate = %d bps, want 50", git.RateBps)
	}
	if git.BasePriceKobo != 0 {
		t.Fatal("a rate product must not carry a flat price")
	}
	if git.BasePriceRaw != "0.5" {
		t.Fatalf("raw provider decimal must be retained verbatim, got %q", git.BasePriceRaw)
	}
	if git.CoverPeriodDays != 365 {
		t.Fatalf("cover period = %d", git.CoverPeriodDays)
	}
	if git.Underwriter != "Sovereign Trust Insurance Plc" {
		t.Fatalf("underwriter disclosure lost: %q", git.Underwriter)
	}
	if git.Category != "Package" {
		t.Fatalf("category = %q", git.Category)
	}
	// full_benefits arrives as an ARRAY on some products — found live, and it
	// used to fail the entire sync on the first one.
	if git.FullBenefitsHTML != "<p>one</p><p>two</p>" {
		t.Fatalf("array-shaped copy field mishandled: %q", git.FullBenefitsHTML)
	}
	// distributor_commission arrives as a bare JSON NUMBER here, not a string.
	if git.DistributorCommissionPercent != "10" {
		t.Fatalf("distributor commission = %q, want \"10\"", git.DistributorCommissionPercent)
	}
	if len(git.Raw) == 0 {
		t.Fatal("verbatim provider JSON must be retained for reconciliation")
	}

	laptop := byCode["sti-laptop-cover-standard"]
	if laptop.RateBps != 700 {
		t.Fatalf("rate = %d bps, want 700", laptop.RateBps)
	}
	// meta.sum_insured 400000 naira => 40,000,000 kobo.
	if laptop.DefaultSumInsuredKobo != 40_000_000 {
		t.Fatalf("declared sum insured = %d kobo, want 40000000", laptop.DefaultSumInsuredKobo)
	}
	if laptop.DistributorCommissionPercent != "12.5" {
		t.Fatalf("string commission mishandled: %q", laptop.DistributorCommissionPercent)
	}
}

// TestListProducts_SkipsUnreadableProductWithoutSinkingTheSync — one bad product
// must not cost us the other 68.
func TestListProducts_SkipsUnreadableProductWithoutSinkingTheSync(t *testing.T) {
	list := `{"responseCode":1,"responseText":"ok","data":{"total_count":2,"products":[
	  {"id":"bad","name":"Explodes"},
	  {"id":"good","name":"Good"}
	]}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/products/all":
			_, _ = w.Write([]byte(list))
		case "/products/bad":
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"responseCode":0,"responseText":"boom"}`))
		case "/products/good":
			_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":{"id":"good","route_name":"good-product","name":"Good","base_price":"1000","is_percentage":false,"prefix":"x"}}`))
		}
	}))
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	products, _, err := c.ListProducts(context.Background(), 1, 100)
	if err != nil {
		t.Fatalf("one bad product must not fail the whole sync: %v", err)
	}
	if len(products) != 1 || products[0].Code != "good-product" {
		t.Fatalf("got %+v", products)
	}
	if products[0].BasePriceKobo != 100_000 {
		t.Fatalf("flat price = %d kobo, want 100000", products[0].BasePriceKobo)
	}
}

// TestGetProduct_FallsBackToUUIDWhenRouteNameIsNull — the v2-only
// "Comprehensive Auto (AAS)" product has route_name null. Dropping it would
// silently lose a sellable product, which is exactly what the old model did.
func TestGetProduct_FallsBackToUUIDWhenRouteNameIsNull(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":{"id":"24140c74-fc6f-42f5-a0d2-24800b22d81b","name":"Comprehensive Auto (AAS)","route_name":null,"base_price":"25000","prefix":"aiico"}}`))
	}))
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	p, err := c.GetProduct(context.Background(), "24140c74-fc6f-42f5-a0d2-24800b22d81b")
	if err != nil {
		t.Fatalf("a product with no route_name must still be catalogued: %v", err)
	}
	if p.Code != "24140c74-fc6f-42f5-a0d2-24800b22d81b" {
		t.Fatalf("code = %q, want the uuid fallback", p.Code)
	}
	if p.BasePriceKobo != 2_500_000 {
		t.Fatalf("price = %d kobo, want 2500000", p.BasePriceKobo)
	}
}

func TestJSONNumberOrString_NeverGoesThroughFloat(t *testing.T) {
	// A bare JSON number's literal text IS the exact decimal. Decoding it into a
	// float64 and re-printing is where 0.46 becomes 0.45999999999999996.
	cases := map[string]string{
		`"0.46"`:      "0.46",
		`0.46`:        "0.46",
		`"6000.0000"`: "6000.0000",
		`10817.0000`:  "10817.0000",
		`null`:        "",
		``:            "",
	}
	for in, want := range cases {
		got := jsonNumberOrString(json.RawMessage(in))
		if got != want {
			t.Fatalf("jsonNumberOrString(%s) = %q, want %q", in, got, want)
		}
	}
}

// ════════════════════════════════════════════════════════════════════════════
// WEBHOOKS — must fail CLOSED
// ════════════════════════════════════════════════════════════════════════════

// TestVerifyWebhook_FailsClosedWithoutAnyKey is the security invariant. An
// adapter that treated "no key" as "no verification needed" would let anyone who
// can reach the endpoint activate policies and approve claims.
//
// MyCover issues no separate webhook secret — the signature is keyed on the
// secret API key — so "no key" means BOTH are empty.
func TestVerifyWebhook_FailsClosedWithoutAnyKey(t *testing.T) {
	c := New("", "", "", "http://127.0.0.1:1") // no API key, no webhook secret
	if c.WebhookConfigured() {
		t.Fatal("adapter must report webhook verification as unavailable")
	}
	payload := []byte(`{"id":"evt_1","event":"policy.bound","data":{"policy_id":"p1"}}`)

	for _, sig := range []string{"", "anything", "0000000000000000000000000000000000000000000000000000000000000000"} {
		ev, err := c.VerifyWebhook(context.Background(), payload, sig)
		if err != nil {
			t.Fatalf("VerifyWebhook must not error, it must report invalid: %v", err)
		}
		if ev.SignatureValid {
			t.Fatalf("signature %q accepted with NO configured secret — fail-closed broken", sig)
		}
	}
}

func TestVerifyWebhook_ValidSignature(t *testing.T) {
	const secret = "test-secret"
	c := New("k", "", secret, "http://127.0.0.1:1")
	if !c.WebhookConfigured() {
		t.Fatal("a configured secret must enable verification")
	}
	payload := []byte(`{"id":"evt_1","event":"policy.bound","data":{"policy_id":"p1","claim_id":"c1"}}`)

	sig := hmacHexForTest(secret, payload)
	ev, err := c.VerifyWebhook(context.Background(), payload, sig)
	if err != nil {
		t.Fatalf("VerifyWebhook: %v", err)
	}
	if !ev.SignatureValid {
		t.Fatal("a correctly signed payload must verify")
	}
	if ev.ExternalEventID != "evt_1" || ev.EventType != "policy.bound" {
		t.Fatalf("event normalisation wrong: %+v", ev)
	}
	if ev.ProviderPolicyRef != "p1" || ev.ProviderClaimRef != "c1" {
		t.Fatalf("refs not extracted: %+v", ev)
	}

	// A tampered payload must not verify against the same signature.
	if ev2, _ := c.VerifyWebhook(context.Background(), []byte(`{"id":"evt_1","event":"policy.bound","data":{"policy_id":"ATTACKER"}}`), sig); ev2.SignatureValid {
		t.Fatal("tampered payload verified — HMAC check is not covering the body")
	}
}

// TestVerifyWebhook_FallsBackToTheAPIKey — MyCover issues NO separate webhook
// secret; the HMAC is keyed on the distributor's own secret API key. So an empty
// INSURANCE_MYCOVER_WEBHOOK_SECRET was never a missing credential.
func TestVerifyWebhook_FallsBackToTheAPIKey(t *testing.T) {
	const apiKey = "MCASECK_TEST_KEY"
	c := New(apiKey, "", "", "http://127.0.0.1:1") // no explicit webhook secret
	if !c.WebhookConfigured() {
		t.Fatal("the API key must serve as the webhook key")
	}
	payload := []byte(`{"event":"purchase.successful","event_id":"evt_9","data":{"essential":{"policy_id":"pol-9"}}}`)

	ev, err := c.VerifyWebhook(context.Background(), payload, hmacHexForTest(apiKey, payload))
	if err != nil {
		t.Fatalf("VerifyWebhook: %v", err)
	}
	if !ev.SignatureValid {
		t.Fatal("a payload signed with the API key must verify")
	}
	if ev.ProviderPolicyRef != "pol-9" {
		t.Fatalf("v2 nests the refs under data.essential; got %+v", ev)
	}
	if ev.ExternalEventID != "evt_9" {
		t.Fatalf("event_id is the webhook idempotency key; got %q", ev.ExternalEventID)
	}
	// A SHA-256 digest must NOT pass — the scheme is SHA-512.
	mac256 := hmac.New(sha256.New, []byte(apiKey))
	mac256.Write(payload)
	if ev2, _ := c.VerifyWebhook(context.Background(), payload, hex.EncodeToString(mac256.Sum(nil))); ev2.SignatureValid {
		t.Fatal("a SHA-256 digest verified — the algorithm is HMAC-SHA512")
	}
}

func TestNormaliseStatus_UnknownNeverReadsAsCover(t *testing.T) {
	if got := normaliseStatus("some_new_provider_state"); got == "active" {
		t.Fatal("an unrecognised provider status must never normalise to active")
	}
	if got := normaliseStatus("SUCCESS"); got != "active" {
		t.Fatalf("normaliseStatus(SUCCESS) = %q", got)
	}
	if got := normaliseStatus(""); got != "" {
		t.Fatalf("empty status = %q", got)
	}
}

// Compile-time proof the adapter still satisfies the provider-agnostic gateway.
var _ gateway.UnderwriterGateway = (*Client)(nil)

// hmacHexForTest mirrors the adapter's signature scheme so the happy path can be
// exercised. It is test-only; production verification lives in
// verifyHMACSHA256.
func hmacHexForTest(secret string, payload []byte) string {
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

// ════════════════════════════════════════════════════════════════════════════
// FAMILY ENDPOINTS — product_id selects the product, the path selects the family
// ════════════════════════════════════════════════════════════════════════════

// TestBindPolicy_InjectsProductID pins the family model: one path serves many
// products and the product is chosen by a `product_id` UUID in the BODY.
func TestBindPolicy_InjectsProductID(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":{"policy_id":"pol-9"}}`))
	}))
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	_, err := c.BindPolicy(context.Background(), gateway.BindRequest{
		Product: gateway.ProviderProduct{
			Code:              "bastion-flexicare-mini",
			ProviderProductID: "6e417faa-e042-4768-8d5d-916fd531a478",
		},
		Inputs: map[string]any{"first_name": "Ada", "nin": "12345678901"},
	})
	if err != nil {
		t.Fatalf("BindPolicy: %v", err)
	}
	if gotBody[FieldProductID] != "6e417faa-e042-4768-8d5d-916fd531a478" {
		t.Fatalf("product_id not injected: %v", gotBody)
	}
}

// TestBindPolicy_CatalogProductIDWinsOverInput — product_id is authorisation,
// not data. It selects what is bought, so it comes from the catalog row and
// never from whatever the member's form posted.
func TestBindPolicy_CatalogProductIDWinsOverInput(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":{"policy_id":"p"}}`))
	}))
	defer srv.Close()
	c := New("k", "", "", srv.URL)
	_, err := c.BindPolicy(context.Background(), gateway.BindRequest{
		Product: gateway.ProviderProduct{Code: "p", ProviderProductID: "from-catalog"},
		Inputs:  map[string]any{FieldProductID: "from-caller"},
	})
	if err != nil {
		t.Fatalf("BindPolicy: %v", err)
	}
	// The CATALOG wins: product_id decides which cover is bought, and the catalog
	// row is the trusted source. A member-supplied value must never be able to
	// redirect a purchase to a different, cheaper or costlier, product.
	if gotBody[FieldProductID] != "from-catalog" {
		t.Fatalf("the catalog product_id must win over member input, got %v", gotBody[FieldProductID])
	}
}

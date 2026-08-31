package mycover

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
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
		Product: gateway.ProviderProduct{
			Code: "bastion-medisure", ProviderProductID: "uuid-1",
			BuyPath: "/products/bastion/buy-medisure",
		},
		Inputs: map[string]any{"first_name": "A"},
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

// TestBindPolicy_PostsToStoredBuyPath proves the dispatch is data-driven: the
// request goes to whatever path the catalog row carries, with the product's own
// fields sent flat. No product identity is branched on in code.
func TestBindPolicy_PostsToStoredBuyPath(t *testing.T) {
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
			BuyPath:           "/products/sti/buy-marine-cover",
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
	if gotPath != "/products/sti/buy-marine-cover" {
		t.Fatalf("posted to %q, want the stored buy path", gotPath)
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

// TestBindPolicy_NoBuyPathFailsClosed — never guess a purchase URL.
func TestBindPolicy_NoBuyPathFailsClosed(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	_, err := c.BindPolicy(context.Background(), gateway.BindRequest{
		Product: gateway.ProviderProduct{Code: "some-product"},
	})
	if !errors.Is(err, ErrNoBuyPath) {
		t.Fatalf("want ErrNoBuyPath, got %v", err)
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
		Product: gateway.ProviderProduct{Code: "p", ProviderProductID: "uuid-p", BuyPath: "/products/x/buy-y"},
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

func TestGetQuote_FlatProduct(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	q, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gateway.ProviderProduct{
			Code:            "bastion-medisure",
			BasePriceKobo:   600_000, // ₦6,000
			CommissionBps:   1000,    // 10%
			CoverPeriodDays: 365,
			Underwriter:     "Bastion Health",
		},
	})
	if err != nil {
		t.Fatalf("GetQuote: %v", err)
	}
	if q.PremiumKobo != 600_000 {
		t.Fatalf("premium = %d, want 600000", q.PremiumKobo)
	}
	if q.CommissionKobo != 60_000 {
		t.Fatalf("commission = %d, want 60000", q.CommissionKobo)
	}
	if q.Terms["pricing_model"] != "flat" {
		t.Fatalf("terms must disclose the pricing model, got %v", q.Terms)
	}
	if q.Terms["priced_by"] != "catalog" {
		t.Fatal("a locally-computed quote must say so in its terms")
	}
}

func TestGetQuote_PercentageProduct(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	// sti-marine-cover: 0.46% of the sum insured.
	q, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gateway.ProviderProduct{
			Code:         "sti-marine-cover",
			IsPercentage: true,
			RateBps:      46,
		},
		SumInsuredKobo: 100_000_000, // ₦1,000,000
	})
	if err != nil {
		t.Fatalf("GetQuote: %v", err)
	}
	if q.PremiumKobo != 460_000 { // ₦4,600
		t.Fatalf("premium = %d kobo, want 460000", q.PremiumKobo)
	}
	if q.SumInsuredKobo != 100_000_000 {
		t.Fatalf("sum insured = %d", q.SumInsuredKobo)
	}
}

func TestGetQuote_PercentageFallsBackToDeclaredSumInsured(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	// sti-laptop-cover-standard: 7% of a declared ₦400,000 cover.
	q, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gateway.ProviderProduct{
			Code:                  "sti-laptop-cover-standard",
			IsPercentage:          true,
			RateBps:               700,
			DefaultSumInsuredKobo: 40_000_000,
		},
	})
	if err != nil {
		t.Fatalf("GetQuote: %v", err)
	}
	if q.PremiumKobo != 2_800_000 { // ₦28,000
		t.Fatalf("premium = %d kobo, want 2800000", q.PremiumKobo)
	}
}

// TestGetQuote_RefusesToPriceWithoutTerms — an unpriced product must error, not
// quote zero. A ₦0 premium would debit nothing and bind cover we never paid for.
func TestGetQuote_RefusesToPriceWithoutTerms(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")

	if _, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gateway.ProviderProduct{Code: "x", IsPercentage: true, RateBps: 50},
	}); err == nil {
		t.Fatal("rate-priced product with no sum insured must not quote")
	}
	if _, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		// Rate-priced, sum insured supplied, but the catalog carries NO rate.
		Product:        gateway.ProviderProduct{Code: "x", IsPercentage: true},
		SumInsuredKobo: 100_000_000,
	}); err == nil {
		t.Fatal("rate-priced product with no rate must not quote")
	}
	if _, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: gateway.ProviderProduct{Code: "x"},
	}); err == nil {
		t.Fatal("flat product with no base price must not quote")
	}
}

// ════════════════════════════════════════════════════════════════════════════
// CATALOG NORMALISATION
// ════════════════════════════════════════════════════════════════════════════

// TestListProducts_NormalisesLiveShape feeds the adapter the verbatim shape of a
// live product and checks every value that crosses the money boundary.
func TestListProducts_NormalisesLiveShape(t *testing.T) {
	body := `{"responseCode":1,"responseText":"Products fetched successfully","data":{"total_count":2,"products":[
	  {"id":"6e417faa-e042-4768-8d5d-916fd531a478","name":"Annual Goods In Transit","route_name":"sti-git-annual","prefix":"sti",
	   "base_price":"0.5","is_percentage":true,"cover_period":"365","is_active":true,"is_renewable":true,"is_claimable":true,
	   "is_certificateable":true,"key_benefits":"<p>b</p>","meta":{"certificate_template":"x"},
	   "category":{"id":"c","name":"Package"},"provider":{"id":"p","organization_name":"Sovereign Trust Insurance Plc"},
	   "currency":{"name":"Nigerian Naira"},"country":{"name":"Nigeria"},
	   "sharing_formula":[{"mca_commission":25,"provider_commission":65,"distributor_commission":10,"provider_commission_from":"original_premium"}]},
	  {"id":"abc","name":"Laptop Standard","route_name":"sti-laptop-cover-standard","prefix":"sti",
	   "base_price":"7.0000","is_percentage":true,"cover_period":"365","is_active":true,
	   "meta":{"sum_insured":400000},
	   "category":{"id":"g","name":"Gadget"},"provider":{"organization_name":"Sovereign Trust Insurance Plc"},
	   "sharing_formula":[{"distributor_commission":"12.5"}]}
	]}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/products/get-all-products" {
			t.Errorf("wrong catalog path %q", r.URL.Path)
		}
		if r.URL.Query().Get("limit") != "100" {
			t.Errorf("limit not forwarded: %q", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	c := New("k", "", "", srv.URL)
	products, total, err := c.ListProducts(context.Background(), 1, 100)
	if err != nil {
		t.Fatalf("ListProducts: %v", err)
	}
	if total != 2 || len(products) != 2 {
		t.Fatalf("got %d products (total %d)", len(products), total)
	}

	git := products[0]
	if git.Code != "sti-git-annual" || git.Prefix != "sti" {
		t.Fatalf("identity wrong: %+v", git.Code)
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
	// distributor_commission arrives as a bare JSON NUMBER here, not a string.
	if git.DistributorCommissionPercent != "10" {
		t.Fatalf("distributor commission = %q, want \"10\"", git.DistributorCommissionPercent)
	}
	if len(git.Raw) == 0 {
		t.Fatal("verbatim provider JSON must be retained for reconciliation")
	}

	laptop := products[1]
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

// TestListProducts_SkipsMalformedProductWithoutSinkingTheSync
func TestListProducts_SkipsMalformedProductWithoutSinkingTheSync(t *testing.T) {
	body := `{"responseCode":1,"responseText":"ok","data":{"total_count":2,"products":[
	  {"route_name":"","name":"no route name"},
	  {"route_name":"good-product","name":"Good","base_price":"1000","is_percentage":false,"prefix":"x"}
	]}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(body))
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

// TestVerifyWebhook_FailsClosedWithoutSecret is the security invariant.
// INSURANCE_MYCOVER_WEBHOOK_SECRET is EMPTY in this environment. An adapter that
// treated "no secret" as "no verification needed" would let anyone who can reach
// the endpoint activate policies and approve claims.
func TestVerifyWebhook_FailsClosedWithoutSecret(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1") // no webhook secret
	if c.WebhookConfigured() {
		t.Fatal("adapter must report the secret as absent")
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

// TestProbePathExists pins the discovery signal: 404 "Cannot POST ..." means the
// family path is absent; a 400 validation array or a 403 means it exists.
func TestProbePathExists(t *testing.T) {
	if ProbePathExists(http.StatusNotFound) {
		t.Fatal("404 must read as path-absent")
	}
	for _, code := range []int{http.StatusBadRequest, http.StatusForbidden, http.StatusOK} {
		if !ProbePathExists(code) {
			t.Fatalf("http %d must read as path-present", code)
		}
	}
}

// TestPaymentPlan_ParsesFormShapes — a form can send the instalment count as a
// number or a string.
func TestPaymentPlan_ParsesFormShapes(t *testing.T) {
	cases := []struct {
		in   any
		want int
		ok   bool
	}{
		{float64(12), 12, true}, // JSON decode shape
		{1, 1, true},
		{"6", 6, true},
		{" 3 ", 3, true},
		{"", 0, false},
		{nil, 0, false},
		{"abc", 0, false},
	}
	for _, tc := range cases {
		got, ok := paymentPlan(map[string]any{FieldPaymentPlan: tc.in})
		if ok != tc.ok || (ok && got != tc.want) {
			t.Fatalf("paymentPlan(%#v) = (%d,%v), want (%d,%v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}
	if _, ok := paymentPlan(map[string]any{}); ok {
		t.Fatal("absent payment_plan must report ok=false")
	}
}

// Compile-time proof the adapter still satisfies the provider-agnostic gateway.
var _ gateway.UnderwriterGateway = (*Client)(nil)

// hmacHexForTest mirrors the adapter's signature scheme so the happy path can be
// exercised. It is test-only; production verification lives in
// verifyHMACSHA256.
func hmacHexForTest(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
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
			BuyPath:           "/products/bastion/buy-medisure",
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

// TestBindPolicy_NoProductIDFailsClosed — a family endpoint with no product_id
// would sell whichever product the family defaults to. That is the wrong cover,
// paid for. Refuse.
func TestBindPolicy_NoProductIDFailsClosed(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	_, err := c.BindPolicy(context.Background(), gateway.BindRequest{
		Product: gateway.ProviderProduct{Code: "p", BuyPath: "/products/bastion/buy-medisure"},
	})
	if !errors.Is(err, ErrNoProductID) {
		t.Fatalf("missing provider product id must fail closed, got %v", err)
	}
}

// TestBindPolicy_CallerSuppliedProductIDWins lets a curated schema override the
// catalog value without the adapter fighting it.
func TestBindPolicy_CallerSuppliedProductIDWins(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"responseCode":1,"responseText":"ok","data":{"policy_id":"p"}}`))
	}))
	defer srv.Close()
	c := New("k", "", "", srv.URL)
	_, err := c.BindPolicy(context.Background(), gateway.BindRequest{
		Product: gateway.ProviderProduct{Code: "p", ProviderProductID: "from-catalog", BuyPath: "/products/x/buy-y"},
		Inputs:  map[string]any{FieldProductID: "from-caller"},
	})
	if err != nil {
		t.Fatalf("BindPolicy: %v", err)
	}
	if gotBody[FieldProductID] != "from-caller" {
		t.Fatalf("caller-supplied product_id must win, got %v", gotBody[FieldProductID])
	}
}

// TestGetQuote_RefusesUnverifiedInstalmentPricing — payment_plan is an
// instalment COUNT (1..12) on health families and it changes what the member is
// charged. MyCover's instalment pricing rule is unverified, so anything other
// than "pay in full" must refuse to quote rather than guess a premium.
func TestGetQuote_RefusesUnverifiedInstalmentPricing(t *testing.T) {
	c := New("k", "", "", "http://127.0.0.1:1")
	prod := gateway.ProviderProduct{Code: "bastion-medisure", BasePriceKobo: 600_000}

	// payment_plan 1 (pay in full) is unambiguous and must work.
	q, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
		Product: prod,
		Inputs:  map[string]any{FieldPaymentPlan: float64(1)},
	})
	if err != nil {
		t.Fatalf("payment_plan 1 must quote: %v", err)
	}
	if q.PremiumKobo != 600_000 {
		t.Fatalf("premium = %d", q.PremiumKobo)
	}

	// Absent payment_plan behaves as pay-in-full.
	if _, err := c.GetQuote(context.Background(), gateway.QuoteRequest{Product: prod}); err != nil {
		t.Fatalf("absent payment_plan must quote: %v", err)
	}

	// Any instalment plan must REFUSE — never quote a premium that may be wrong.
	for _, plan := range []any{float64(3), 12, "6"} {
		if _, err := c.GetQuote(context.Background(), gateway.QuoteRequest{
			Product: prod,
			Inputs:  map[string]any{FieldPaymentPlan: plan},
		}); err == nil {
			t.Fatalf("payment_plan %v quoted a premium despite the pricing rule being unverified", plan)
		}
	}
}

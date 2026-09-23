package vtpass

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"spotlight/backend/internal/provider"
)

// ════════════════════════════════════════════════════════════════════════════
// Request building — payload shape genuinely differs by category
// ════════════════════════════════════════════════════════════════════════════

func TestPurchasePayload_Airtime(t *testing.T) {
	req := provider.BillRequest{
		Ref:        "ledger-ref-1",
		Type:       "airtime",
		AmountKobo: 50_000, // ₦500
		Params: map[string]string{
			"providerBillerCode": "mtn",
			"customerReference":  "08031234567",
		},
	}
	body := purchasePayload(req, "req-1")

	if body["serviceID"] != "mtn" {
		t.Fatalf("serviceID = %v, want mtn", body["serviceID"])
	}
	if body["amount"] != int64(500) {
		t.Fatalf("amount = %v, want 500", body["amount"])
	}
	if body["phone"] != "08031234567" {
		t.Fatalf("phone = %v, want 08031234567", body["phone"])
	}
	// Airtime must NOT carry electricity/cable_tv-only fields.
	for _, key := range []string{"billersCode", "variation_code", "subscription_type", "quantity"} {
		if _, ok := body[key]; ok {
			t.Fatalf("airtime payload must not include %q, got %v", key, body[key])
		}
	}
}

func TestPurchasePayload_Electricity(t *testing.T) {
	req := provider.BillRequest{
		Ref:        "ledger-ref-2",
		Type:       "electricity",
		AmountKobo: 1_000_000, // ₦10,000
		Params: map[string]string{
			"providerBillerCode": "ikeja-electric",
			"customerReference":  "1111111111111",
			"phone":              "08099999999",
			// type/payment_type/paymentType intentionally omitted to prove the
			// "prepaid" default.
		},
	}
	body := purchasePayload(req, "req-2")

	if body["billersCode"] != "1111111111111" {
		t.Fatalf("billersCode = %v, want the meter number", body["billersCode"])
	}
	if body["variation_code"] != "prepaid" {
		t.Fatalf("variation_code = %v, want default 'prepaid'", body["variation_code"])
	}
	if body["amount"] != int64(10000) {
		t.Fatalf("amount = %v, want 10000", body["amount"])
	}
	if _, ok := body["subscription_type"]; ok {
		t.Fatal("electricity payload must not include cable_tv's subscription_type")
	}

	// An explicit meter type overrides the "prepaid" default.
	req.Params["type"] = "postpaid"
	body = purchasePayload(req, "req-2")
	if body["variation_code"] != "postpaid" {
		t.Fatalf("variation_code = %v, want explicit 'postpaid' override", body["variation_code"])
	}
}

func TestPurchasePayload_CableTV(t *testing.T) {
	req := provider.BillRequest{
		Ref:        "ledger-ref-3",
		Type:       "cable_tv",
		AmountKobo: 750_000,
		Params: map[string]string{
			"providerBillerCode":  "dstv",
			"customerReference":   "1234567890",
			"providerProductCode": "dstv-compact",
			"phone":               "08055555555",
		},
	}
	body := purchasePayload(req, "req-3")

	if body["billersCode"] != "1234567890" {
		t.Fatalf("billersCode = %v", body["billersCode"])
	}
	if body["variation_code"] != "dstv-compact" {
		t.Fatalf("variation_code = %v", body["variation_code"])
	}
	if body["subscription_type"] != "change" {
		t.Fatalf("subscription_type = %v, want default 'change'", body["subscription_type"])
	}
	if body["quantity"] != int64(1) {
		t.Fatalf("quantity = %v, want default 1", body["quantity"])
	}
}

func TestPurchasePayload_Education(t *testing.T) {
	req := provider.BillRequest{
		Ref:        "ledger-ref-4",
		Type:       "education",
		AmountKobo: 300_000,
		Params: map[string]string{
			"providerBillerCode":  "waec",
			"providerProductCode": "waec-registration-pin",
			"phone":               "08022222222",
			"quantity":            "2",
		},
	}
	body := purchasePayload(req, "req-4")

	if body["variation_code"] != "waec-registration-pin" {
		t.Fatalf("variation_code = %v", body["variation_code"])
	}
	if body["quantity"] != int64(2) {
		t.Fatalf("quantity = %v, want 2", body["quantity"])
	}
	if _, ok := body["billersCode"]; ok {
		t.Fatal("education payload must not include billersCode")
	}
}

// ════════════════════════════════════════════════════════════════════════════
// Response normalization
// ════════════════════════════════════════════════════════════════════════════

func TestNormalizeProviderStatus(t *testing.T) {
	cases := []struct {
		name string
		json string
		want string
	}{
		{
			name: "success via transaction status",
			json: `{"code":"000","content":{"transactions":{"status":"delivered"}}}`,
			want: StatusSuccess,
		},
		{
			name: "success via description, no transaction status",
			json: `{"code":"000","response_description":"Transaction was successful"}`,
			want: StatusSuccess,
		},
		{
			name: "pending via description timeout",
			json: `{"code":"000","response_description":"Request timeout, transaction is pending"}`,
			want: StatusPending,
		},
		{
			name: "pending via transaction status processing",
			json: `{"code":"099","content":{"transactions":{"status":"pending processing"}}}`,
			want: StatusPending,
		},
		{
			name: "failed",
			json: `{"code":"016","response_description":"Transaction failed"}`,
			want: StatusFailed,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var payload vtpassResponse
			if err := json.Unmarshal([]byte(tc.json), &payload); err != nil {
				t.Fatalf("unmarshal fixture: %v", err)
			}
			if got := normalizeProviderStatus(payload); got != tc.want {
				t.Fatalf("normalizeProviderStatus = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTokenFrom(t *testing.T) {
	var withToken vtpassResponse
	_ = json.Unmarshal([]byte(`{"token":"1234-5678"}`), &withToken)
	if tokenFrom(withToken) != "1234-5678" {
		t.Fatalf("tokenFrom(token) = %q", tokenFrom(withToken))
	}

	var withPurchasedCode vtpassResponse
	_ = json.Unmarshal([]byte(`{"purchased_code":"AAAA-BBBB"}`), &withPurchasedCode)
	if tokenFrom(withPurchasedCode) != "AAAA-BBBB" {
		t.Fatalf("tokenFrom(purchased_code) = %q", tokenFrom(withPurchasedCode))
	}

	// token wins when both are present.
	var both vtpassResponse
	_ = json.Unmarshal([]byte(`{"token":"T","purchased_code":"P"}`), &both)
	if tokenFrom(both) != "T" {
		t.Fatalf("tokenFrom must prefer token over purchased_code, got %q", tokenFrom(both))
	}
}

// ════════════════════════════════════════════════════════════════════════════
// Sandbox meter simulation table
// ════════════════════════════════════════════════════════════════════════════

func TestSandboxPurchase_MeterTable(t *testing.T) {
	c := New("k", "p", "s", EnvironmentSandbox, "")

	cases := []struct {
		name      string
		meter     string
		wantStat  string
		wantToken string
		wantMsg   string
	}{
		{"prepaid success", sandboxMeterPrepaid, StatusSuccess, sandboxPrepaidToken, "TRANSACTION SUCCESSFUL"},
		{"postpaid success, no token", sandboxMeterPostpaid, StatusSuccess, "", "TRANSACTION SUCCESSFUL"},
		{"pending", sandboxMeterPending, StatusPending, "", "Transaction is processing."},
		{"simulated timeout still pending", sandboxMeterTimeout, StatusPending, "", "Transaction is processing."},
		{"unexpected response failed", sandboxMeterUnexpected, StatusFailed, "", "Provider returned an unexpected/no response."},
		{"no response failed", sandboxMeterNoResponse, StatusFailed, "", "Provider returned an unexpected/no response."},
		{"unrecognised meter failed", "0000000000000", StatusFailed, "", "Sandbox: meter not recognised (use 1111111111111 / 1010101010101)."},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := provider.BillRequest{
				Ref:        "ref-" + tc.name,
				Type:       "electricity",
				AmountKobo: 100_000,
				Params:     map[string]string{"customerReference": tc.meter},
			}
			res, err := c.PurchaseBill(context.Background(), req)
			if err != nil {
				t.Fatalf("PurchaseBill: %v", err)
			}
			if res.Status != tc.wantStat {
				t.Fatalf("status = %q, want %q", res.Status, tc.wantStat)
			}
			if res.Token != tc.wantToken {
				t.Fatalf("token = %q, want %q", res.Token, tc.wantToken)
			}
			if res.Message != tc.wantMsg {
				t.Fatalf("message = %q, want %q", res.Message, tc.wantMsg)
			}
			if res.Ref != req.Ref {
				t.Fatalf("Bill.Ref = %q, want %q", res.Ref, req.Ref)
			}
		})
	}
}

// The sandbox table is keyed on customerReference for EVERY category, not just
// electricity — matching the TS source, which calls sandboxPurchase before any
// category branch is consulted.
func TestSandboxPurchase_AppliesRegardlessOfCategory(t *testing.T) {
	c := New("k", "p", "s", EnvironmentSandbox, "")
	req := provider.BillRequest{
		Ref:        "ref-airtime-sandbox",
		Type:       "airtime",
		AmountKobo: 50_000,
		Params:     map[string]string{"customerReference": sandboxMeterPrepaid},
	}
	res, err := c.PurchaseBill(context.Background(), req)
	if err != nil {
		t.Fatalf("PurchaseBill: %v", err)
	}
	if res.Status != StatusSuccess || res.Token != sandboxPrepaidToken {
		t.Fatalf("sandbox table must apply to airtime too: status=%q token=%q", res.Status, res.Token)
	}
}

func TestSandboxGetBill_AlwaysSuccessful(t *testing.T) {
	c := New("k", "p", "s", EnvironmentSandbox, "")
	bill, err := c.GetBill(context.Background(), "some-provider-ref")
	if err != nil {
		t.Fatalf("GetBill: %v", err)
	}
	if bill.Status != StatusSuccess {
		t.Fatalf("sandbox GetBill status = %q, want SUCCESS (the TS stub never simulates pending/failed on requery)", bill.Status)
	}
}

// ════════════════════════════════════════════════════════════════════════════
// Auth headers — api-key always; public-key for GET; secret-key for POST
// ════════════════════════════════════════════════════════════════════════════

func TestAuthHeaders_PostUsesSecretKey(t *testing.T) {
	var gotAPIKey, gotSecretKey, gotPublicKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAPIKey = r.Header.Get("api-key")
		gotSecretKey = r.Header.Get("secret-key")
		gotPublicKey = r.Header.Get("public-key")
		_, _ = w.Write([]byte(`{"code":"000","response_description":"successful","requestId":"req-x"}`))
	}))
	defer srv.Close()

	c := New("api-key-val", "public-key-val", "secret-key-val", EnvironmentLive, srv.URL)
	req := provider.BillRequest{
		Ref:        "ref-1",
		Type:       "airtime",
		AmountKobo: 10_000,
		Params:     map[string]string{"providerBillerCode": "mtn", "customerReference": "08030000000"},
	}
	if _, err := c.PurchaseBill(context.Background(), req); err != nil {
		t.Fatalf("PurchaseBill: %v", err)
	}
	if gotAPIKey != "api-key-val" {
		t.Fatalf("api-key header = %q", gotAPIKey)
	}
	if gotSecretKey != "secret-key-val" {
		t.Fatalf("secret-key header = %q, want it set on POST", gotSecretKey)
	}
	if gotPublicKey != "" {
		t.Fatalf("public-key header = %q, must be absent on POST", gotPublicKey)
	}
}

func TestAuthHeaders_GetUsesPublicKey(t *testing.T) {
	var gotPublicKey, gotSecretKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPublicKey = r.Header.Get("public-key")
		gotSecretKey = r.Header.Get("secret-key")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := New("api-key-val", "public-key-val", "secret-key-val", EnvironmentLive, srv.URL)
	if _, _, err := c.do(context.Background(), http.MethodGet, "/balance", nil); err != nil {
		t.Fatalf("do(GET): %v", err)
	}
	if gotPublicKey != "public-key-val" {
		t.Fatalf("public-key header = %q, want it set on GET", gotPublicKey)
	}
	if gotSecretKey != "" {
		t.Fatalf("secret-key header = %q, must be absent on GET", gotSecretKey)
	}
}

func TestAuthHeaders_MissingKeysFailClosed(t *testing.T) {
	c := New("", "", "", EnvironmentLive, "http://unused.invalid")
	if _, err := c.PurchaseBill(context.Background(), provider.BillRequest{Type: "airtime"}); err == nil {
		t.Fatal("PurchaseBill with no API key must fail")
	}

	c2 := New("api", "", "", EnvironmentLive, "http://unused.invalid")
	if _, err := c2.PurchaseBill(context.Background(), provider.BillRequest{Type: "airtime"}); err == nil {
		t.Fatal("PurchaseBill with no secret key must fail (POST requires secret-key)")
	}
}

// ════════════════════════════════════════════════════════════════════════════
// Base URL selection by environment
// ════════════════════════════════════════════════════════════════════════════

func TestNew_BaseURLDefaultsByEnvironment(t *testing.T) {
	live := New("a", "p", "s", EnvironmentLive, "")
	if live.BaseURL() != "https://vtpass.com/api" {
		t.Fatalf("live BaseURL = %q", live.BaseURL())
	}

	sandbox := New("a", "p", "s", EnvironmentSandbox, "")
	if sandbox.BaseURL() != "https://sandbox.vtpass.com/api" {
		t.Fatalf("sandbox BaseURL = %q", sandbox.BaseURL())
	}

	// Environment defaults to live, matching the TS source's
	// `VTPASS_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'live'`.
	unspecified := New("a", "p", "s", "", "")
	if unspecified.Environment() != EnvironmentLive {
		t.Fatalf("unspecified environment = %q, want live", unspecified.Environment())
	}

	override := New("a", "p", "s", EnvironmentLive, "https://override.example/api/")
	if override.BaseURL() != "https://override.example/api" {
		t.Fatalf("override BaseURL = %q, want trailing slash trimmed", override.BaseURL())
	}
}

// ════════════════════════════════════════════════════════════════════════════
// End-to-end (HTTP-boundary mocked): purchase + requery
// ════════════════════════════════════════════════════════════════════════════

func TestPurchaseBill_LiveHTTPRoundTrip(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/pay" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		dec := json.NewDecoder(r.Body)
		_ = dec.Decode(&gotBody)
		_, _ = w.Write([]byte(`{"code":"000","response_description":"Transaction successful","requestId":"vtpass-req-99","token":"9999-8888-7777-6666"}`))
	}))
	defer srv.Close()

	c := New("api", "pub", "sec", EnvironmentLive, srv.URL)
	req := provider.BillRequest{
		Ref:        "ledger-ref-9",
		Type:       "electricity",
		AmountKobo: 500_050, // ₦5,000.50 → rounds to ₦5001
		Params: map[string]string{
			"providerBillerCode": "ikeja-electric",
			"customerReference":  "9999999999999",
			"phone":              "08011112222",
		},
	}
	res, err := c.PurchaseBill(context.Background(), req)
	if err != nil {
		t.Fatalf("PurchaseBill: %v", err)
	}
	if res.Status != StatusSuccess {
		t.Fatalf("status = %q", res.Status)
	}
	if res.ProviderRef != "vtpass-req-99" {
		t.Fatalf("ProviderRef = %q, want the provider's own requestId", res.ProviderRef)
	}
	if res.Token != "9999-8888-7777-6666" {
		t.Fatalf("Token = %q", res.Token)
	}
	if res.Ref != "ledger-ref-9" {
		t.Fatalf("Bill.Ref = %q, want the client ref echoed back", res.Ref)
	}
	if gotBody["amount"].(float64) != 5001 {
		t.Fatalf("provider saw amount=%v naira, want 5001", gotBody["amount"])
	}
	if gotBody["billersCode"] != "9999999999999" {
		t.Fatalf("provider saw billersCode=%v", gotBody["billersCode"])
	}
}

func TestGetBill_RequeryUsesProviderReference(t *testing.T) {
	var gotBody map[string]any
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		dec := json.NewDecoder(r.Body)
		_ = dec.Decode(&gotBody)
		_, _ = w.Write([]byte(`{"code":"000","response_description":"pending","content":{"transactions":{"status":"pending"}}}`))
	}))
	defer srv.Close()

	c := New("api", "pub", "sec", EnvironmentLive, srv.URL)
	bill, err := c.GetBill(context.Background(), "vtpass-req-77")
	if err != nil {
		t.Fatalf("GetBill: %v", err)
	}
	if gotPath != "/requery" {
		t.Fatalf("path = %q, want /requery", gotPath)
	}
	if gotBody["request_id"] != "vtpass-req-77" {
		t.Fatalf("request_id sent = %v, want the provider reference passed in, unmodified", gotBody["request_id"])
	}
	if bill.Status != StatusPending {
		t.Fatalf("status = %q, want PENDING", bill.Status)
	}
}

func TestGetBill_EmptyRefRejected(t *testing.T) {
	c := New("api", "pub", "sec", EnvironmentLive, "http://unused.invalid")
	if _, err := c.GetBill(context.Background(), ""); err == nil {
		t.Fatal("GetBill(\"\") must fail rather than requery an empty request_id")
	}
}

// ════════════════════════════════════════════════════════════════════════════
// HTTP-failure normalization — no live network calls anywhere in this suite
// ════════════════════════════════════════════════════════════════════════════

func TestDo_NonOKStatusSynthesizesEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`not json`))
	}))
	defer srv.Close()

	c := New("api", "pub", "sec", EnvironmentLive, srv.URL)
	res, err := c.PurchaseBill(context.Background(), provider.BillRequest{
		Ref: "r", Type: "airtime",
		Params: map[string]string{"providerBillerCode": "mtn", "customerReference": "0803"},
	})
	if err != nil {
		t.Fatalf("a non-2xx HTTP status must not surface as a Go error: %v", err)
	}
	if res.Status != StatusFailed {
		t.Fatalf("status = %q, want FAILED for an unreadable 502", res.Status)
	}
}

// Name and Configured.
func TestNameAndConfigured(t *testing.T) {
	c := New("api", "pub", "sec", EnvironmentLive, "")
	if c.Name() != "vtpass" {
		t.Fatalf("Name() = %q, want vtpass", c.Name())
	}
	if !c.Configured() {
		t.Fatal("Configured() must be true when an API key is set")
	}
	c2 := New("", "", "", EnvironmentLive, "")
	if c2.Configured() {
		t.Fatal("Configured() must be false with no API key")
	}
}

// Sanity: vtpassRequestID's Lagos-time prefix is stable within the same minute
// and the suffix is derived from the idempotency key, not random, whenever the
// key has alphanumeric characters.
func TestVtpassRequestID_Deterministic(t *testing.T) {
	date := time.Date(2026, 9, 15, 10, 30, 0, 0, time.UTC)
	id1 := vtpassRequestID("idem-key-ABC123", date)
	id2 := vtpassRequestID("idem-key-ABC123", date)
	if id1 != id2 {
		t.Fatalf("vtpassRequestID must be deterministic for the same key+date: %q vs %q", id1, id2)
	}
	if len(id1) < 12 {
		t.Fatalf("request id too short: %q", id1)
	}
}

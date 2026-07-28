package maplerad_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/maplerad"
)

// TestClientName verifies the provider identifier is "maplerad".
func TestClientName(t *testing.T) {
	c := maplerad.New("sk_test_dummy", false)
	if c.Name() != "maplerad" {
		t.Errorf("Name() = %q, want %q", c.Name(), "maplerad")
	}
}

// TestFXQuoteRequestCurrencyPair verifies source and target currencies are distinct.
func TestFXQuoteRequestCurrencyPair(t *testing.T) {
	req := maplerad.FXQuoteRequest{
		SourceCurrency: "NGN",
		TargetCurrency: "USD",
		AmountKobo:     500_000_00, // ₦500,000
	}
	if req.SourceCurrency == req.TargetCurrency {
		t.Error("FXQuoteRequest source and target currency must differ")
	}
	if req.AmountKobo <= 0 {
		t.Errorf("FXQuoteRequest.AmountKobo must be positive, got %d", req.AmountKobo)
	}
}

// TestFXQuoteResponseFields verifies the rate and amounts in a quote are positive.
func TestFXQuoteResponseFields(t *testing.T) {
	resp := maplerad.FXQuoteResponse{
		QuoteID:           "quote-abc",
		Rate:              0.00065,
		SourceAmountKobo:  50_000_000, // ₦500,000 in kobo
		TargetAmountMinor: 32500,      // $325.00 in cents
		Fee:               500,
		ExpiresAt:         "2026-06-16T12:00:00Z",
	}
	if resp.Rate <= 0 {
		t.Errorf("FXQuoteResponse.Rate must be positive, got %f", resp.Rate)
	}
	if resp.SourceAmountKobo <= 0 {
		t.Errorf("FXQuoteResponse.SourceAmountKobo must be positive, got %d", resp.SourceAmountKobo)
	}
	if resp.TargetAmountMinor <= 0 {
		t.Errorf("FXQuoteResponse.TargetAmountMinor must be positive, got %d", resp.TargetAmountMinor)
	}
	if resp.QuoteID == "" {
		t.Error("FXQuoteResponse.QuoteID must not be empty")
	}
}

// newTestClient builds a live client (non-empty key) pointed at an httptest server
// so request/response mapping is exercised against the real HTTP code path.
func newTestClient(srv *httptest.Server) *maplerad.Client {
	return maplerad.New("sk_test_live", false).WithBaseURL(srv.URL)
}

// --- Identity ---

func TestCreateCustomer_MapsResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/customers" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"status":true,"data":{"id":"cus_123","first_name":"Ada","last_name":"Bello","email":"a@b.co","status":"active"}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	got, err := c.CreateCustomer(context.Background(), provider.CustomerRequest{
		FirstName: "Ada", LastName: "Bello", Email: "a@b.co", BVN: "12345678901", NIN: "98765432109",
	})
	if err != nil {
		t.Fatalf("CreateCustomer error: %v", err)
	}
	if got.ID != "cus_123" || got.Status != "active" || got.FirstName != "Ada" {
		t.Fatalf("mapped customer = %+v", got)
	}
}

func TestCreateCustomer_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":false,"message":"bvn invalid"}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	if _, err := c.CreateCustomer(context.Background(), provider.CustomerRequest{}); err == nil {
		t.Fatal("CreateCustomer must surface API error (money/identity path)")
	}
}

func TestGetCustomer_MapsResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/customers/") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Write([]byte(`{"status":true,"data":{"id":"cus_9","email":"x@y.co","status":"active"}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	got, err := c.GetCustomer(context.Background(), "cus_9")
	if err != nil || got.ID != "cus_9" {
		t.Fatalf("GetCustomer = %+v err=%v", got, err)
	}
}

func TestGetCustomer_MockWhenOffline(t *testing.T) {
	c := maplerad.New("", false) // no key → READ path mocks
	got, err := c.GetCustomer(context.Background(), "cus_off")
	if err != nil || got.ID != "cus_off" {
		t.Fatalf("offline GetCustomer must mock, got %+v err=%v", got, err)
	}
}

// --- Collections / Virtual accounts ---

func TestProvisionVirtualAccount_PassThroughNaming(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Caveat: API may return a random name and bank_name "maplerad".
		w.Write([]byte(`{"status":true,"data":{"account_number":"9012345678","account_name":"RANDOM NAME","bank_name":"maplerad"}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	va, err := c.ProvisionVirtualAccount(context.Background(), provider.ProvisionVARequest{FirstName: "Ada", LastName: "Bello"})
	if err != nil {
		t.Fatalf("ProvisionVirtualAccount error: %v", err)
	}
	// The mapper must pass through what the API returns, NOT assume name==customer.
	if va.AccountName != "RANDOM NAME" {
		t.Errorf("account name must pass through, got %q", va.AccountName)
	}
	if va.BankName != "maplerad" {
		t.Errorf("bank name must pass through, got %q", va.BankName)
	}
}

func TestGetVirtualAccount_MapsResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":true,"data":{"account_number":"9088776655","account_name":"SOME NAME","bank_name":"maplerad","bank_code":"999"}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	va, err := c.GetVirtualAccount(context.Background(), "cus_1")
	if err != nil {
		t.Fatalf("GetVirtualAccount error: %v", err)
	}
	if va.AccountNumber != "9088776655" || va.BankName != "maplerad" {
		t.Fatalf("mapped VA = %+v", va)
	}
}

func TestGetVirtualAccount_MockWhenOffline(t *testing.T) {
	c := maplerad.New("", false)
	va, err := c.GetVirtualAccount(context.Background(), "cus_off")
	if err != nil || va.BankName != "maplerad" || len(va.AccountNumber) != 10 {
		t.Fatalf("offline GetVirtualAccount must mock with bank=maplerad, got %+v err=%v", va, err)
	}
}

// --- Wallets ---

func TestProvisionWallet_ReturnsID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/wallets" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"status":true,"data":{"id":"wal_1"}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	id, err := c.ProvisionWallet(context.Background(), "cus_1", "NGN")
	if err != nil || id != "wal_1" {
		t.Fatalf("ProvisionWallet id=%q err=%v", id, err)
	}
}

func TestProvisionWallet_ErrorSurfaces(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":false,"message":"nope"}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	if _, err := c.ProvisionWallet(context.Background(), "cus_1", "NGN"); err == nil {
		t.Fatal("ProvisionWallet must surface error (money path)")
	}
}

func TestGetProviderBalance_KoboInt(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":true,"data":{"id":"wal_1","currency":"NGN","balance":250000}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	bal, err := c.GetProviderBalance(context.Background(), "wal_1")
	if err != nil || bal.AmountKobo != 250000 || bal.Currency != "NGN" {
		t.Fatalf("balance = %+v err=%v", bal, err)
	}
}

func TestGetProviderBalance_MockWhenOffline(t *testing.T) {
	c := maplerad.New("", false)
	bal, err := c.GetProviderBalance(context.Background(), "wal_off")
	if err != nil || bal.AmountKobo != 0 {
		t.Fatalf("offline balance must mock zero, got %+v err=%v", bal, err)
	}
}

// --- Transfers ---

func TestInitiatePayout_PendingAndProviderRef(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/transfers" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Write([]byte(`{"status":true,"data":{"id":"trf_1","status":"pending","reference":"ref-1"}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	res, err := c.InitiatePayout(context.Background(), provider.PayoutRequest{RecipientCode: "cp_1", AmountKobo: 100000, Reference: "ref-1"})
	if err != nil {
		t.Fatalf("InitiatePayout error: %v", err)
	}
	if res.Status != "pending" {
		t.Errorf("status must be pending (terminal only via webhook), got %q", res.Status)
	}
	if res.ProviderRef != "trf_1" || res.TransferCode != "trf_1" {
		t.Errorf("provider ref must route webhooks, got %+v", res)
	}
}

func TestInitiatePayout_ErrorSurfaces(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":false,"message":"insufficient"}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	if _, err := c.InitiatePayout(context.Background(), provider.PayoutRequest{Reference: "r"}); err == nil {
		t.Fatal("InitiatePayout must surface error (money path)")
	}
}

func TestGetTransferStatus_Normalizes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":true,"data":{"status":"success"}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	st, err := c.GetTransferStatus(context.Background(), "trf_1")
	if err != nil || st.Status != "successful" {
		t.Fatalf("status = %+v err=%v", st, err)
	}
}

func TestGetTransferStatus_MockWhenOffline(t *testing.T) {
	c := maplerad.New("", false)
	st, err := c.GetTransferStatus(context.Background(), "trf_off")
	if err != nil || st.Status != "pending" {
		t.Fatalf("offline status must mock pending, got %+v err=%v", st, err)
	}
}

// --- Counterparty / Institutions ---

func TestResolveAccount_MapsResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/counterparties/resolve") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Write([]byte(`{"status":true,"data":{"account_number":"0123456789","account_name":"ADA BELLO"}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	res, err := c.ResolveAccount(context.Background(), "058", "0123456789")
	if err != nil || res.AccountName != "ADA BELLO" || res.BankCode != "058" {
		t.Fatalf("resolve = %+v err=%v", res, err)
	}
}

func TestResolveAccount_MockWhenOffline(t *testing.T) {
	c := maplerad.New("", false)
	res, err := c.ResolveAccount(context.Background(), "058", "0123456789")
	if err != nil || res.AccountName == "" || res.AccountNumber != "0123456789" {
		t.Fatalf("offline resolve must mock a name, got %+v err=%v", res, err)
	}
}

func TestListBanks_MapsResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/institutions") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Write([]byte(`{"status":true,"data":[{"code":"058","name":"GTBank","slug":"gtbank"}]}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	banks, err := c.ListBanks(context.Background())
	if err != nil || len(banks) != 1 || banks[0].Code != "058" {
		t.Fatalf("banks = %+v err=%v", banks, err)
	}
}

func TestListBanks_MockWhenOffline(t *testing.T) {
	c := maplerad.New("", false)
	banks, err := c.ListBanks(context.Background())
	if err != nil || len(banks) == 0 {
		t.Fatalf("offline ListBanks must return fallback list, got %d err=%v", len(banks), err)
	}
}

func TestCreateTransferRecipient_ReturnsCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/counterparties" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Write([]byte(`{"status":true,"data":{"id":"cp_77"}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	rcp, err := c.CreateTransferRecipient(context.Background(), provider.RecipientRequest{AccountNumber: "0123456789", BankCode: "058", AccountName: "Ada"})
	if err != nil || rcp.Code != "cp_77" {
		t.Fatalf("recipient = %+v err=%v", rcp, err)
	}
}

// --- Bills ---

func TestPurchaseBill_PendingOnAccept(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bills" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Write([]byte(`{"status":true,"data":{"id":"bill_1","reference":"br-1","type":"airtime","status":"pending","amount":50000}}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	b, err := c.PurchaseBill(context.Background(), provider.BillRequest{Ref: "br-1", Type: "airtime", AmountKobo: 50000})
	if err != nil {
		t.Fatalf("PurchaseBill error: %v", err)
	}
	if b.Status != "PENDING" {
		t.Errorf("bill must be PENDING on accept (webhook authoritative), got %q", b.Status)
	}
	if b.ProviderRef != "bill_1" || b.Ref != "br-1" {
		t.Errorf("bill mapping = %+v", b)
	}
}

func TestPurchaseBill_ErrorSurfaces(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":false,"message":"no biller"}`))
	}))
	defer srv.Close()
	c := newTestClient(srv)
	if _, err := c.PurchaseBill(context.Background(), provider.BillRequest{Ref: "br-2"}); err == nil {
		t.Fatal("PurchaseBill must surface error (money path)")
	}
}

func TestGetBill_MockWhenOffline(t *testing.T) {
	c := maplerad.New("", false)
	b, err := c.GetBill(context.Background(), "br-off")
	if err != nil || b.Status != "PENDING" {
		t.Fatalf("offline GetBill must mock PENDING, got %+v err=%v", b, err)
	}
}

// --- Webhook signature ---

func sign(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

func TestVerifyWebhookSignature_Valid(t *testing.T) {
	secret := "whsec_maplerad"
	payload := []byte(`{"event":"transfer.successful","data":{"id":"trf_1"}}`)
	c := maplerad.New("sk", false).WithWebhookSecret(secret)
	if !c.VerifyWebhookSignature(payload, sign(secret, payload)) {
		t.Error("valid HMAC-SHA256 signature must pass")
	}
}

func TestVerifyWebhookSignature_Invalid(t *testing.T) {
	c := maplerad.New("sk", false).WithWebhookSecret("whsec_maplerad")
	if c.VerifyWebhookSignature([]byte(`{"x":1}`), "deadbeef") {
		t.Error("invalid signature must be rejected")
	}
}

func TestVerifyWebhookSignature_MissingSignatureOrSecret(t *testing.T) {
	payload := []byte(`{"x":1}`)
	// Missing signature.
	c := maplerad.New("sk", false).WithWebhookSecret("s")
	if c.VerifyWebhookSignature(payload, "") {
		t.Error("missing signature must be rejected")
	}
	// Missing secret (stub used to return true — must now be false).
	c2 := maplerad.New("sk", false)
	if c2.VerifyWebhookSignature(payload, sign("s", payload)) {
		t.Error("missing webhook secret must reject (no more return-true stub)")
	}
}

// --- ParseWebhook ---

func TestParseWebhook_EventTypes(t *testing.T) {
	c := maplerad.New("sk", false)
	cases := []struct {
		event      string
		wantType   string
		wantStatus string
	}{
		{"transfer.successful", "transfer", "successful"},
		{"transfer.failed", "transfer", "failed"},
		{"transfer.reversed", "transfer", "reversed"},
		{"virtual_account.credit", "collection", "successful"},
		{"bill.successful", "bill", "successful"},
		{"bill.failed", "bill", "failed"},
		{"something.weird", "unknown", "pending"},
	}
	for _, tc := range cases {
		payload := []byte(`{"id":"evt_1","event":"` + tc.event + `","data":{"id":"obj_1","reference":"r1","status":"x","amount":1000}}`)
		ev, err := c.ParseWebhook(payload)
		if err != nil {
			t.Fatalf("ParseWebhook(%s) error: %v", tc.event, err)
		}
		if ev.Type != tc.wantType || ev.Status != tc.wantStatus {
			t.Errorf("event %q → type=%q status=%q, want %q/%q", tc.event, ev.Type, ev.Status, tc.wantType, tc.wantStatus)
		}
		if ev.EventID != "evt_1" {
			t.Errorf("event %q: EventID=%q, want evt_1 (dedupe key)", tc.event, ev.EventID)
		}
		if ev.ProviderRef != "obj_1" || ev.AmountKobo != 1000 {
			t.Errorf("event %q: mapping ref=%q amt=%d", tc.event, ev.ProviderRef, ev.AmountKobo)
		}
		if len(ev.Raw) == 0 {
			t.Errorf("event %q: Raw must be preserved for audit/unknown storage", tc.event)
		}
	}
}

func TestParseWebhook_EventIDFallsBackToDataID(t *testing.T) {
	c := maplerad.New("sk", false)
	payload := []byte(`{"event":"transfer.successful","data":{"id":"trf_42","reference":"r"}}`)
	ev, err := c.ParseWebhook(payload)
	if err != nil || ev.EventID != "trf_42" {
		t.Fatalf("EventID must fall back to data.id, got %q err=%v", ev.EventID, err)
	}
}

func TestParseWebhook_MalformedReturnsError(t *testing.T) {
	c := maplerad.New("sk", false)
	if _, err := c.ParseWebhook([]byte("not json")); err == nil {
		t.Fatal("malformed payload must return an error, not crash")
	}
}

// --- Interface satisfaction (compile + runtime sanity) ---

func TestImplementsPorts(t *testing.T) {
	c := maplerad.New("sk", false)
	var _ provider.IdentityProvider = c
	var _ provider.WalletProvider = c
	var _ provider.BillsProvider = c
	var _ provider.DisbursementProvider = c
	var _ provider.VirtualAccountProvider = c
	var _ provider.PaymentProvider = c
}

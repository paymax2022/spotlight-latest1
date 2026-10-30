package orchestration

// handler_fx_honesty_test.go — HTTP-level tests for the probe-wave fabrication
// fixes: POST /cards and POST /api-keys validate their bodies instead of
// minting/persisting defaults off "{}", GET /transfers/:reference answers 404
// instead of a phantom "processing" transfer, and the dispute endpoint refuses
// honestly (400 on bad input, 404 on an unknown transaction, 501 while disputes
// have no persistence) instead of echoing a "submitted" stub that records
// nothing. Also pins the SubmitCustomer required-field gate.

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// honestyEngine wires the stub/business/card routes under test with a fixed
// caller identity (mimics RequireAuthContext setting user_id).
func honestyEngine(h *Handler, userID string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", userID); c.Next() })
	r.POST("/customers", h.SubmitCustomer)
	r.POST("/cards", h.CreateCard)
	r.POST("/api-keys", h.CreateAPIKey)
	r.GET("/transfers/:reference", h.GetTransferByReference)
	r.POST("/transactions/:id/dispute", h.DisputeTransaction)
	return r
}

func doJSONReq(t *testing.T, r *gin.Engine, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// seedTransfer persists one transfer for the customer in the mem store so the
// transfer/dispute lookups have a real row to resolve.
func seedTransfer(t *testing.T, store Store, customer, ref string) {
	t.Helper()
	ctx := context.Background()
	if err := store.SeedBalance(ctx, customer, "NGN", 1_000_000); err != nil {
		t.Fatalf("seed balance: %v", err)
	}
	tr := &Transfer{
		ID: "tx_" + ref, Reference: ref, CustomerID: customer, Status: "processing",
		Source:      NewMoney(500_000, "NGN"),
		Destination: NewMoney(500_000, "NGN"),
		Route:       Route{Provider: "partner", Corridor: "NGN-NGN", Rail: RailBankTransfer},
		Fees:        []Fee{},
		CreatedAt:   time.Now(),
	}
	if err := store.ApplyTransfer(ctx, tr, 500_000); err != nil {
		t.Fatalf("apply transfer: %v", err)
	}
}

func TestSubmitCustomerRejectsEmptyBody(t *testing.T) {
	r := honestyEngine(NewHandler(nil), "cust_A")
	if w := doJSONReq(t, r, http.MethodPost, "/customers", `{}`, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("POST /customers {}: status = %d, want 400; body=%s", w.Code, w.Body.String())
	}
}

// Every consent is required and must be TRUE. An omitted flag is not consent:
// it decodes as false and is refused, which is the only safe reading of a
// checkbox the customer never ticked.
func TestSubmitCustomerRequiresEveryConsent(t *testing.T) {
	const identity = `"identity":{"docType":"nin","idNumber":"12345678901","dateOfBirth":"1990-01-01"}`
	r := honestyEngine(NewHandler(nil), "cust_A")

	cases := []struct {
		name   string
		body   string
		param  string // "" means accepted
	}{
		{"all consents given", `{"accountType":"individual","consents":{"terms":true,"privacy":true,"fxDisclosure":true},` + identity + `}`, ""},
		{"terms false", `{"accountType":"individual","consents":{"terms":false,"privacy":true,"fxDisclosure":true},` + identity + `}`, "consents.terms"},
		{"privacy false", `{"accountType":"individual","consents":{"terms":true,"privacy":false,"fxDisclosure":true},` + identity + `}`, "consents.privacy"},
		{"fx disclosure false", `{"accountType":"individual","consents":{"terms":true,"privacy":true,"fxDisclosure":false},` + identity + `}`, "consents.fxDisclosure"},
		{"all consents omitted", `{"accountType":"individual","consents":{},` + identity + `}`, "consents.terms"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := doJSONReq(t, r, http.MethodPost, "/customers", tc.body, nil)
			if tc.param == "" {
				if w.Code != http.StatusOK {
					t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
				}
				return
			}
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), `"param":"`+tc.param+`"`) {
				t.Fatalf("expected param %q in body, got %s", tc.param, w.Body.String())
			}
		})
	}
}

func TestCreateCardRequiresContractFields(t *testing.T) {
	r := honestyEngine(NewHandler(nil), "cust_A")
	idem := map[string]string{"Idempotency-Key": "test-key-1"}

	cases := map[string]struct {
		body    string
		headers map[string]string
	}{
		"empty body":              {`{}`, idem},
		"missing idempotency":     {`{"label":"X","brand":"visa","currency":"USD","color":"purple","fundingAmount":0}`, nil},
		"missing label":           {`{"brand":"visa","currency":"USD","color":"purple","fundingAmount":0}`, idem},
		"bad brand":               {`{"label":"X","brand":"amex","currency":"USD","color":"purple","fundingAmount":0}`, idem},
		"unsupported currency":    {`{"label":"X","brand":"visa","currency":"ZZZ9","color":"purple","fundingAmount":0}`, idem},
		"stablecoin denomination": {`{"label":"X","brand":"visa","currency":"USDC","color":"purple","fundingAmount":0}`, idem},
		"bad color":               {`{"label":"X","brand":"visa","currency":"USD","color":"chartreuse","fundingAmount":0}`, idem},
		"missing fundingAmount":   {`{"label":"X","brand":"visa","currency":"USD","color":"purple"}`, idem},
		"negative fundingAmount":  {`{"label":"X","brand":"visa","currency":"USD","color":"purple","fundingAmount":-1}`, idem},
	}
	for name, tc := range cases {
		w := doJSONReq(t, r, http.MethodPost, "/cards", tc.body, tc.headers)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400; body=%s", name, w.Code, w.Body.String())
		}
	}

	w := doJSONReq(t, r, http.MethodPost, "/cards",
		`{"label":"Subscriptions","brand":"visa","currency":"usd","color":"purple","fundingAmount":0}`, idem)
	if w.Code != http.StatusCreated {
		t.Fatalf("valid draft: status = %d, want 201; body=%s", w.Code, w.Body.String())
	}
}

func TestCreateAPIKeyRequiresLabel(t *testing.T) {
	r := honestyEngine(NewHandler(nil), "cust_A")

	for name, body := range map[string]string{
		"empty body":   `{}`,
		"blank label":  `{"label":"  "}`,
		"unknown mode": `{"label":"X","mode":"staging"}`,
	} {
		w := doJSONReq(t, r, http.MethodPost, "/api-keys", body, nil)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400; body=%s", name, w.Code, w.Body.String())
		}
	}

	w := doJSONReq(t, r, http.MethodPost, "/api-keys", `{"label":"Production"}`, nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("valid label: status = %d, want 201; body=%s", w.Code, w.Body.String())
	}
}

func TestGetTransferByReferenceRealLookup(t *testing.T) {
	store := NewMemStore()
	svc := NewService(nil, store, Options{})
	r := honestyEngine(NewHandler(svc), "cust_A")

	// Unknown reference → honest 404, no phantom transfer.
	w := doJSONReq(t, r, http.MethodGet, "/transfers/tr_does_not_exist", "", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown ref: status = %d, want 404; body=%s", w.Code, w.Body.String())
	}

	seedTransfer(t, store, "cust_A", "ref_real_1")
	w = doJSONReq(t, r, http.MethodGet, "/transfers/ref_real_1", "", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("persisted ref: status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	// A different customer's lookup on the same reference 404s (object-scoped).
	rB := honestyEngine(NewHandler(svc), "cust_B")
	w = doJSONReq(t, rB, http.MethodGet, "/transfers/ref_real_1", "", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("cross-customer ref: status = %d, want 404; body=%s", w.Code, w.Body.String())
	}
}

func TestDisputeTransactionHonestRefusal(t *testing.T) {
	store := NewMemStore()
	svc := NewService(nil, store, Options{})
	r := honestyEngine(NewHandler(svc), "cust_A")

	// Missing transactionId + reason → 400.
	if w := doJSONReq(t, r, http.MethodPost, "/transactions/tx_1/dispute", `{}`, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("empty body: status = %d, want 400; body=%s", w.Code, w.Body.String())
	}
	// Unsupported reason → 400.
	w := doJSONReq(t, r, http.MethodPost, "/transactions/tx_1/dispute",
		`{"transactionId":"tx_1","reason":"vibes"}`, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad reason: status = %d, want 400; body=%s", w.Code, w.Body.String())
	}
	// Unknown transaction → 404 (was: 201 echo that recorded nothing).
	w = doJSONReq(t, r, http.MethodPost, "/transactions/tx_missing/dispute",
		`{"transactionId":"tx_missing","reason":"not_received"}`, nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown tx: status = %d, want 404; body=%s", w.Code, w.Body.String())
	}
	// Real transaction → honest 501 until a disputes store lands.
	seedTransfer(t, store, "cust_A", "ref_dsp_1")
	w = doJSONReq(t, r, http.MethodPost, "/transactions/tx_ref_dsp_1/dispute",
		`{"transactionId":"tx_ref_dsp_1","reason":"not_received","note":"probe"}`, nil)
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("real tx: status = %d, want 501; body=%s", w.Code, w.Body.String())
	}
}

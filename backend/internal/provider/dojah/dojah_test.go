package dojah_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/dojah"
)

func TestName(t *testing.T) {
	if got := dojah.New("app", "sk", false).Name(); got != "dojah" {
		t.Fatalf("Name() = %q, want dojah", got)
	}
}

func TestVerifyIDNumber_SandboxNotConfigured(t *testing.T) {
	c := dojah.New("", "", false)
	res, err := c.VerifyIDNumber(t.Context(), provider.KycVerifyRequest{ClientRef: "ref-1", IDType: "bvn", IDNumber: "123"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != provider.KycPending || res.Terminal {
		t.Fatalf("want pending/non-terminal, got %+v", res)
	}
	if res.ProviderRef != "ref-1" {
		t.Fatalf("ClientRef not echoed: %q", res.ProviderRef)
	}
}

func TestMapWebhook_Statuses(t *testing.T) {
	cases := []struct {
		name string
		body string
		want provider.KycCheckStatus
		ref  string
	}{
		{"passed", `{"reference":"cr1","reference_id":"job1","status":"completed"}`, provider.KycPassed, "cr1"},
		{"failed", `{"reference":"cr2","reference_id":"job2","status":"failed"}`, provider.KycFailed, "cr2"},
		{"review", `{"reference":"cr3","reference_id":"job3","status":"manual_review"}`, provider.KycReview, "cr3"},
		{"pending", `{"reference":"cr4","reference_id":"job4","status":"processing"}`, provider.KycPending, "cr4"},
	}
	c := dojah.New("app", "sk", false)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ev, err := c.ParseKycWebhook([]byte(tc.body))
			if err != nil {
				t.Fatal(err)
			}
			if ev.Status != tc.want {
				t.Fatalf("status = %q, want %q", ev.Status, tc.want)
			}
			if ev.ClientRef != tc.ref {
				t.Fatalf("client_ref = %q, want %q", ev.ClientRef, tc.ref)
			}
			if ev.Provider != "dojah" {
				t.Fatalf("provider = %q", ev.Provider)
			}
		})
	}
}

func TestVerifyKycSignature(t *testing.T) {
	c := dojah.New("app", "sk", false).WithWebhookSecret("whsec")
	payload := []byte(`{"a":1}`)
	// precomputed HMAC-SHA256 of payload with key "whsec"
	// verified against crypto/hmac at construction time in adapter.
	if c.VerifyKycSignature(payload, "deadbeef") {
		t.Fatal("expected invalid signature to be rejected")
	}
	if c.VerifyKycSignature(payload, "") {
		t.Fatal("empty signature must be rejected")
	}
	nocreds := dojah.New("app", "sk", false)
	if nocreds.VerifyKycSignature(payload, "anything") {
		t.Fatal("missing webhook secret must reject")
	}
}

// stubDojah serves one canned response and records the request it received.
func stubDojah(t *testing.T, status int, body string) (*dojah.Client, *http.Request) {
	t.Helper()
	got := new(http.Request)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*got = *r.Clone(r.Context())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return dojah.New("app-id", "test_secret", false).WithBaseURL(srv.URL), got
}

func bvnReq(id string) provider.KycVerifyRequest {
	return provider.KycVerifyRequest{ClientRef: "ref-1", IDType: "bvn", IDNumber: id}
}

// A data-match hit is PASSED, terminal, and carries Dojah's auth contract:
// Authorization: <secret> and AppId: <app id> (Dojah's documented scheme).
func TestVerifyIDNumber_Found_Passes_AndSendsDojahAuthHeaders(t *testing.T) {
	c, got := stubDojah(t, http.StatusOK, `{"entity":{"bvn":"22222222222","first_name":"JOHN","last_name":"DOE"}}`)

	res, err := c.VerifyIDNumber(t.Context(), bvnReq("22222222222"))
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != provider.KycPassed || !res.Match || !res.Terminal {
		t.Fatalf("want PASSED/match/terminal, got %+v", res)
	}
	if res.ExtractedFields["first_name"] != "JOHN" {
		t.Fatalf("entity fields not surfaced: %+v", res.ExtractedFields)
	}
	if got.Header.Get("Authorization") != "test_secret" || got.Header.Get("AppId") != "app-id" {
		t.Fatalf("auth headers wrong: Authorization=%q AppId=%q", got.Header.Get("Authorization"), got.Header.Get("AppId"))
	}
}

// Dojah's verdicts on the ID itself (unknown BVN / malformed) are the user's
// problem and DO end the check as a terminal FAILED.
func TestVerifyIDNumber_UnknownOrMalformedID_IsTerminalFailed(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusNotFound, http.StatusUnprocessableEntity} {
		c, _ := stubDojah(t, status, `{"error":"Wrong BVN"}`)
		res, err := c.VerifyIDNumber(t.Context(), bvnReq("12345678901"))
		if err != nil {
			t.Fatalf("status %d: a verdict is not a provider error: %v", status, err)
		}
		if res.Status != provider.KycFailed || !res.Terminal || res.Match {
			t.Fatalf("status %d: want terminal FAILED, got %+v", status, res)
		}
	}
}

// REGRESSION: the live sandbox answered 401 "Your Secret Key could not be
// Authorized" and the adapter recorded that as FAILED "no matching record" —
// telling the user their own BVN was wrong and stopping the gateway failing
// over. A status that says nothing about the person must be a provider ERROR.
func TestVerifyIDNumber_ProviderCannotBeAsked_IsErrorNotNoMatch(t *testing.T) {
	cases := map[int]string{
		http.StatusUnauthorized:        `{"error":"Your Secret Key could not be Authorized"}`,
		http.StatusPaymentRequired:     `{"error":"Insufficient balance"}`,
		http.StatusForbidden:           `{"error":"forbidden"}`,
		http.StatusTooManyRequests:     `{"error":"rate limited"}`,
		http.StatusInternalServerError: `{"error":"boom"}`,
		http.StatusBadGateway:          `bad gateway`,
	}
	for status, body := range cases {
		c, _ := stubDojah(t, status, body)
		res, err := c.VerifyIDNumber(t.Context(), bvnReq("22222222222"))
		if err == nil {
			t.Fatalf("status %d: want an error so the gateway fails over, got result %+v", status, res)
		}
		if res.Status == provider.KycFailed {
			t.Fatalf("status %d: must not be recorded as a FAILED identity check", status)
		}
	}
}

// The ID is user input: it must reach Dojah as ONE query value, never as
// extra parameters or a fragment.
func TestVerifyIDNumber_EscapesIDNumberInQuery(t *testing.T) {
	c, got := stubDojah(t, http.StatusNotFound, `{"error":"Wrong BVN"}`)

	if _, err := c.VerifyIDNumber(t.Context(), bvnReq("1&bvn=2#x")); err != nil {
		t.Fatal(err)
	}
	q := got.URL.Query()
	if len(q) != 1 || q.Get("bvn") != "1&bvn=2#x" {
		t.Fatalf("id number was not escaped into a single value: %q", got.URL.RawQuery)
	}
}

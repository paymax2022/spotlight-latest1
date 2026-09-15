package vtpass

// Unit tests for the HealthChecker capability. Pure HTTP-level: an httptest
// server stands in for VTpass, so the classification rules are exercised with
// zero network and zero credentials.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"spotlight/backend/internal/provider"
)

func healthClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return New("api", "pub", "sec", EnvironmentLive, srv.URL)
}

// The happy path: code "1" plus a numeric contents.balance.
func TestHealthCheck_HealthyOnCode1WithNumericBalance(t *testing.T) {
	c := healthClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/balance" {
			t.Errorf("path = %s, want /balance", r.URL.Path)
		}
		// GET must carry the public key, not the secret (authHeaders).
		if got := r.Header.Get("public-key"); got != "pub" {
			t.Errorf("public-key header = %q, want %q", got, "pub")
		}
		_, _ = w.Write([]byte(`{"code":"1","contents":{"balance":1500.75}}`))
	})

	res, err := c.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("HealthCheck: %v", err)
	}
	if res.Status != HealthHealthy {
		t.Errorf("status = %q, want healthy", res.Status)
	}
	// The message carries the balance VERBATIM — no float reformatting. The TS
	// source interpolates the raw value (`Balance: ${payload.contents.balance}`).
	if res.Message != "Balance: 1500.75" {
		t.Errorf("message = %q, want %q", res.Message, "Balance: 1500.75")
	}
}

// VTpass sends `code` as a bare number on some endpoints. codeString normalises
// both spellings, so an unquoted 1 must classify identically.
func TestHealthCheck_HealthyOnUnquotedCode(t *testing.T) {
	c := healthClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"code":1,"contents":{"balance":42}}`))
	})
	res, err := c.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("HealthCheck: %v", err)
	}
	if res.Status != HealthHealthy {
		t.Errorf("status = %q, want healthy", res.Status)
	}
	if res.Message != "Balance: 42" {
		t.Errorf("message = %q, want %q", res.Message, "Balance: 42")
	}
}

// The success code for /balance is "1", NOT the "000" the transaction endpoints
// use. A response carrying 000 must NOT be read as healthy — this is the detail
// most likely to be "fixed" into a bug by someone pattern-matching on the rest
// of the adapter.
func TestHealthCheck_DegradedOnTransactionSuccessCode000(t *testing.T) {
	c := healthClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"code":"000","response_description":"TRANSACTION SUCCESSFUL","contents":{"balance":10}}`))
	})
	res, err := c.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("HealthCheck: %v", err)
	}
	if res.Status != HealthDegraded {
		t.Errorf("status = %q, want degraded (000 is not the balance endpoint's success code)", res.Status)
	}
	if res.Message != "TRANSACTION SUCCESSFUL" {
		t.Errorf("message = %q, want the response_description", res.Message)
	}
}

// `typeof payload.contents?.balance === 'number'` — a STRING balance is not a
// confirmed balance, even alongside a success code.
func TestHealthCheck_DegradedOnStringBalance(t *testing.T) {
	c := healthClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"code":"1","response_description":"ok","contents":{"balance":"1500.00"}}`))
	})
	res, err := c.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("HealthCheck: %v", err)
	}
	if res.Status != HealthDegraded {
		t.Errorf("status = %q, want degraded (a string balance fails the typeof guard)", res.Status)
	}
}

// Success code, but no balance at all.
func TestHealthCheck_DegradedOnMissingBalance(t *testing.T) {
	c := healthClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"code":"1","response_description":"no contents here"}`))
	})
	res, err := c.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("HealthCheck: %v", err)
	}
	if res.Status != HealthDegraded {
		t.Errorf("status = %q, want degraded", res.Status)
	}
	if res.Message != "no contents here" {
		t.Errorf("message = %q, want the response_description", res.Message)
	}
}

// With no response_description to quote, the TS fallback string is used.
func TestHealthCheck_DegradedFallbackMessage(t *testing.T) {
	c := healthClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"code":"099"}`))
	})
	res, err := c.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("HealthCheck: %v", err)
	}
	if res.Message != "Unable to confirm VTPass balance." {
		t.Errorf("message = %q, want the TS fallback", res.Message)
	}
}

// A non-2xx never becomes a Go error — `do` synthesises an envelope — so it
// lands as degraded carrying the synthetic description, not as down.
func TestHealthCheck_DegradedOnHTTPError(t *testing.T) {
	c := healthClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`nope`))
	})
	res, err := c.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("HealthCheck: %v", err)
	}
	if res.Status != HealthDegraded {
		t.Errorf("status = %q, want degraded", res.Status)
	}
	if res.Message != "VTPass HTTP 500" {
		t.Errorf("message = %q, want the synthetic envelope description", res.Message)
	}
}

// A genuine transport failure is 'down' — and still NOT a Go error, per the
// HealthChecker contract and the TS catch block.
func TestHealthCheck_DownOnTransportFailure(t *testing.T) {
	c := New("api", "pub", "sec", EnvironmentLive, "http://127.0.0.1:1/api")
	res, err := c.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("HealthCheck returned an error; a transport failure must be a 'down' RESULT: %v", err)
	}
	if res.Status != HealthDown {
		t.Errorf("status = %q, want down", res.Status)
	}
	if res.Message == "" {
		t.Error("a down result must carry the underlying error as its message")
	}
}

// Missing credentials make authHeaders refuse before any socket opens. That is
// still 'down', not an error — the TS vtpassFetch throws and healthCheck catches.
func TestHealthCheck_DownOnMissingCredentials(t *testing.T) {
	c := New("", "", "", EnvironmentLive, "http://unused.invalid")
	res, err := c.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("HealthCheck: %v", err)
	}
	if res.Status != HealthDown {
		t.Errorf("status = %q, want down", res.Status)
	}
}

// The adapter must satisfy the optional capability at compile time AND be
// discoverable by a type assertion, which is how utilitybills finds it.
func TestClient_ImplementsHealthChecker(t *testing.T) {
	var bills provider.BillsProvider = New("a", "p", "s", EnvironmentSandbox, "")
	if _, ok := bills.(provider.HealthChecker); !ok {
		t.Fatal("*vtpass.Client must be discoverable as provider.HealthChecker via type assertion")
	}
}

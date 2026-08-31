package webhooks

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/provider/mycover"
)

// stubAdapter records the signature the handler extracted, so a test can assert
// on the header plumbing without a database or a live provider.
type stubAdapter struct {
	name      string
	header    string
	gotSig    string
	gotBody   []byte
	callCount int
}

func (s *stubAdapter) Name() string                   { return s.name }
func (s *stubAdapter) WebhookSignatureHeader() string { return s.header }

func (s *stubAdapter) VerifyWebhook(_ context.Context, payload []byte, signature string) (gateway.WebhookEvent, error) {
	s.callCount++
	s.gotSig = signature
	s.gotBody = payload
	return gateway.WebhookEvent{
		Provider:       s.name,
		SignatureValid: signature != "",
		EventType:      "purchase.successful",
	}, nil
}

func (s *stubAdapter) GetQuote(context.Context, gateway.QuoteRequest) (gateway.Quote, error) {
	return gateway.Quote{}, nil
}
func (s *stubAdapter) BindPolicy(context.Context, gateway.BindRequest) (gateway.Policy, error) {
	return gateway.Policy{}, nil
}
func (s *stubAdapter) GetPolicy(context.Context, string) (gateway.Policy, error) {
	return gateway.Policy{}, nil
}
func (s *stubAdapter) CancelPolicy(context.Context, string, string) (gateway.Policy, error) {
	return gateway.Policy{}, nil
}
func (s *stubAdapter) SubmitClaim(context.Context, gateway.ClaimRequest) (gateway.Claim, error) {
	return gateway.Claim{}, nil
}
func (s *stubAdapter) GetClaim(context.Context, string) (gateway.Claim, error) {
	return gateway.Claim{}, nil
}
func (s *stubAdapter) UploadEvidence(context.Context, gateway.EvidenceUpload) error { return nil }

func postWebhook(t *testing.T, h *Handler, provider, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/internal/webhooks/"+provider, strings.NewReader(body))
	for k, v := range headers {
		c.Request.Header.Set(k, v)
	}
	h.ingest(c, provider)
	return w
}

// TestIngest_ReadsTheAdapterDeclaredHeader is the regression for a bug that made
// EVERY genuine MyCover delivery fail with a 401.
//
// The handler used to derive the header from the URL slug: mounted at
// /internal/webhooks/mycover, it probed "X-mycover-Signature". MyCover signs
// with "x-mycoverai-signature" — mycover != mycoverai — so the signature always
// arrived EMPTY and verification failed before the HMAC ran. A test that sets
// "X-Signature" passes against the broken code and proves nothing, so this one
// sends ONLY the real header.
func TestIngest_ReadsTheAdapterDeclaredHeader(t *testing.T) {
	stub := &stubAdapter{name: "mycover", header: "x-mycoverai-signature"}
	svc := NewService(gateway.NewRouter(nil, stub), nil, nil)
	h := NewHandler(svc)

	postWebhook(t, h, "mycover", `{"event":"purchase.successful"}`, map[string]string{
		"x-mycoverai-signature": "deadbeef",
	})

	if stub.callCount == 0 {
		t.Fatal("the adapter was never asked to verify")
	}
	if stub.gotSig != "deadbeef" {
		t.Fatalf("signature = %q — the adapter-declared header was not read", stub.gotSig)
	}
}

// TestIngest_SlugDerivedHeaderIsNotUsed pins the shape of the fix: the handler
// must not invent a header from the provider slug.
func TestIngest_SlugDerivedHeaderIsNotUsed(t *testing.T) {
	stub := &stubAdapter{name: "mycover", header: "x-mycoverai-signature"}
	svc := NewService(gateway.NewRouter(nil, stub), nil, nil)
	h := NewHandler(svc)

	w := postWebhook(t, h, "mycover", `{}`, map[string]string{
		"X-mycover-Signature": "slug-derived",
	})
	if stub.gotSig == "slug-derived" {
		t.Fatal("the handler read a slug-derived header — that is the bug, not the contract")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("an unsigned delivery must be rejected, got %d", w.Code)
	}
}

// TestIngest_GenericHeadersStayAsFallback keeps adapters that declare no header
// (Octamile today) working.
func TestIngest_GenericHeadersStayAsFallback(t *testing.T) {
	stub := &stubAdapter{name: "octamile", header: ""}
	svc := NewService(gateway.NewRouter(nil, stub), nil, nil)
	h := NewHandler(svc)

	postWebhook(t, h, "octamile", `{}`, map[string]string{"X-Signature": "generic"})
	if stub.gotSig != "generic" {
		t.Fatalf("generic fallback lost: %q", stub.gotSig)
	}
}

// TestIngest_UnsignedDeliveryIsRejected — the whole point of verification.
func TestIngest_UnsignedDeliveryIsRejected(t *testing.T) {
	stub := &stubAdapter{name: "mycover", header: "x-mycoverai-signature"}
	svc := NewService(gateway.NewRouter(nil, stub), nil, nil)
	h := NewHandler(svc)

	w := postWebhook(t, h, "mycover", `{"event":"purchase.successful"}`, nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("an unsigned webhook must be 401, got %d", w.Code)
	}
}

// TestIngest_RawBodyReachesTheVerifierByteForByte — the HMAC is over the RAW
// body. Re-serialising the JSON reorders or re-spaces it and the digest stops
// matching, so the handler must hand the verifier exactly what arrived.
func TestIngest_RawBodyReachesTheVerifierByteForByte(t *testing.T) {
	stub := &stubAdapter{name: "mycover", header: "x-mycoverai-signature"}
	svc := NewService(gateway.NewRouter(nil, stub), nil, nil)
	h := NewHandler(svc)

	// Deliberately awkward spacing and key order.
	raw := `{"event":"purchase.successful",  "event_id":"abc",   "data":{"essential":{"policy_id":"p1"}}}`
	postWebhook(t, h, "mycover", raw, map[string]string{"x-mycoverai-signature": "x"})

	if string(stub.gotBody) != raw {
		t.Fatalf("body was altered in transit:\n got %q\nwant %q", stub.gotBody, raw)
	}
}

// TestIngest_EndToEndWithTheRealAdapter wires the ACTUAL MyCover adapter behind
// the handler and posts a genuinely signed request. It is the one test that
// proves the header name, the algorithm and the key agree.
func TestIngest_EndToEndWithTheRealAdapter(t *testing.T) {
	const apiKey = "MCASECK_TEST_KEY"
	adapter := mycover.New(apiKey, "", "", "http://127.0.0.1:1")
	svc := NewService(gateway.NewRouter(nil, adapter), nil, nil)
	h := NewHandler(svc)

	body := `{"event":"purchase.successful","event_id":"evt_1","data":{"essential":{"policy_id":"pol-1"}}}`
	mac := hmac.New(sha512.New, []byte(apiKey))
	mac.Write([]byte(body))
	sig := hex.EncodeToString(mac.Sum(nil))

	// A correct signature must get past verification. The service then tries to
	// record the event and fails on the nil repository — reaching THAT is the
	// proof, since a signature failure would have 401'd first.
	w := postWebhook(t, h, "mycover", body, map[string]string{adapter.WebhookSignatureHeader(): sig})
	if w.Code == http.StatusUnauthorized {
		t.Fatalf("a correctly signed delivery was rejected: %s", w.Body.String())
	}

	// A tampered body must NOT get past.
	w2 := postWebhook(t, h, "mycover",
		`{"event":"purchase.successful","event_id":"evt_1","data":{"essential":{"policy_id":"ATTACKER"}}}`,
		map[string]string{adapter.WebhookSignatureHeader(): sig})
	if w2.Code != http.StatusUnauthorized {
		t.Fatalf("a tampered body was accepted (%d) — the HMAC does not cover it", w2.Code)
	}
}

// Compile-time proof the stub still matches the capability interface.
var _ gateway.UnderwriterGateway = (*stubAdapter)(nil)

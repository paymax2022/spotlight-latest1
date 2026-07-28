package aicare

// Internal (package-local) tests for the aicare package.
//
// SCOPE NOTE: This module is an AI *customer-support* agent, not a medical/
// telemedicine advisor. The production code contains NO medical-safety
// classifier, NO safe-completion / red-flag escalation logic, NO disclaimer
// builder, NO session FSM transition function, and NO MockProvider. Those were
// assumed by the task brief but do not exist in the source. We therefore test
// only the pure logic that is actually present:
//   1. AnthropicProvider.Reply — role mapping, request construction, headers,
//      system framing, and response/error parsing — exercised through an
//      injected fake http.RoundTripper (the live Anthropic API is never called).
//   2. A test-local mock AIProvider — interface satisfaction + determinism.
//   3. Model data integrity — status/role constants and JSON round-trips.
//
// The Service (SendMessage/Escalate/Resolve/GetHistory) is bound to a concrete
// *pgxpool.Pool with no fake seam, so its DB-driven FSM (open→escalated→
// resolved, resolved-is-terminal) is intentionally left uncovered here.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// --- fake transport so Reply never touches the network ---------------------

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// newFakeProvider returns a provider whose HTTP client is backed by rt.
func newFakeProvider(apiKey string, rt roundTripFunc) *AnthropicProvider {
	p := NewAnthropicProvider(apiKey)
	p.client = &http.Client{Transport: rt}
	return p
}

// jsonResponse builds a canned HTTP response carrying the given body.
func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}

// captureReply runs Reply against a transport that records the outbound request
// and replies with the supplied response body.
func captureReply(t *testing.T, history []Message, userMessage, respBody string) (captured *http.Request, capturedBody []byte, reply string, err error) {
	t.Helper()
	rt := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		captured = r
		capturedBody, _ = io.ReadAll(r.Body)
		return jsonResponse(200, respBody), nil
	})
	p := newFakeProvider("test-key-123", rt)
	reply, err = p.Reply(context.Background(), history, userMessage)
	return captured, capturedBody, reply, err
}

// --- compile-time interface guarantees -------------------------------------

var (
	_ AIProvider = (*AnthropicProvider)(nil)
	_ AIProvider = (*stubProvider)(nil)
)

// --- AnthropicProvider construction ----------------------------------------

func TestNewAnthropicProvider(t *testing.T) {
	p := NewAnthropicProvider("secret")
	if p == nil {
		t.Fatal("NewAnthropicProvider returned nil")
	}
	if p.apiKey != "secret" {
		t.Errorf("apiKey = %q, want %q", p.apiKey, "secret")
	}
	if p.client == nil {
		t.Fatal("client must be initialized")
	}
	if p.client.Timeout != 30*time.Second {
		t.Errorf("client timeout = %v, want 30s", p.client.Timeout)
	}
}

// --- Reply: role mapping ----------------------------------------------------

func TestReplyRoleMapping(t *testing.T) {
	history := []Message{
		{Role: RoleUser, Content: "hi"},
		{Role: RoleAI, Content: "hello, how can I help?"},
		{Role: RoleAgent, Content: "a human here"},
		{Role: RoleUser, Content: "my wallet is stuck"},
	}
	respBody := `{"content":[{"type":"text","text":"ok"}]}`
	_, body, reply, err := captureReply(t, history, "and my card too", respBody)
	if err != nil {
		t.Fatalf("Reply error: %v", err)
	}
	if reply != "ok" {
		t.Errorf("reply = %q, want %q", reply, "ok")
	}

	var req anthropicRequest
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatalf("unmarshal request body: %v", err)
	}

	// history (4) + the new trailing user message (1) = 5 messages.
	if len(req.Messages) != 5 {
		t.Fatalf("messages len = %d, want 5", len(req.Messages))
	}

	wantRoles := []string{"user", "assistant", "assistant", "user", "user"}
	for i, want := range wantRoles {
		if got := req.Messages[i].Role; got != want {
			t.Errorf("message[%d].Role = %q, want %q", i, got, want)
		}
	}

	// RoleAI and RoleAgent must both collapse to "assistant"; everything else "user".
	if req.Messages[1].Role != "assistant" {
		t.Error("RoleAI must map to assistant")
	}
	if req.Messages[2].Role != "assistant" {
		t.Error("RoleAgent must map to assistant")
	}

	// The trailing appended message must carry the userMessage argument as "user".
	last := req.Messages[len(req.Messages)-1]
	if last.Role != "user" || last.Content != "and my card too" {
		t.Errorf("trailing message = %+v, want user/'and my card too'", last)
	}
}

// TestReplyEmptyHistory verifies a single user turn is sent with no history.
func TestReplyEmptyHistory(t *testing.T) {
	_, body, _, err := captureReply(t, nil, "just this", `{"content":[{"type":"text","text":"x"}]}`)
	if err != nil {
		t.Fatalf("Reply error: %v", err)
	}
	var req anthropicRequest
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(req.Messages) != 1 {
		t.Fatalf("messages len = %d, want 1", len(req.Messages))
	}
	if req.Messages[0].Role != "user" || req.Messages[0].Content != "just this" {
		t.Errorf("message[0] = %+v, want user/'just this'", req.Messages[0])
	}
}

// --- Reply: request framing (model, tokens, system prompt) -----------------

func TestReplyRequestFraming(t *testing.T) {
	_, body, _, err := captureReply(t, nil, "hello", `{"content":[{"type":"text","text":"y"}]}`)
	if err != nil {
		t.Fatalf("Reply error: %v", err)
	}
	var req anthropicRequest
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if req.Model != anthropicModel {
		t.Errorf("model = %q, want %q", req.Model, anthropicModel)
	}
	if req.MaxTokens != maxTokens {
		t.Errorf("max_tokens = %d, want %d", req.MaxTokens, maxTokens)
	}
	if req.System == "" {
		t.Error("system prompt must be set (support framing)")
	}
	// The system prompt frames the assistant as a support agent, not an authority.
	if !strings.Contains(strings.ToLower(req.System), "support") {
		t.Errorf("system prompt should frame a support agent, got %q", req.System)
	}
}

// --- Reply: headers ---------------------------------------------------------

func TestReplyHeaders(t *testing.T) {
	req, _, _, err := captureReply(t, nil, "hi", `{"content":[{"type":"text","text":"z"}]}`)
	if err != nil {
		t.Fatalf("Reply error: %v", err)
	}
	if got := req.Header.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
	if got := req.Header.Get("x-api-key"); got != "test-key-123" {
		t.Errorf("x-api-key = %q, want test-key-123", got)
	}
	if got := req.Header.Get("anthropic-version"); got != anthropicVer {
		t.Errorf("anthropic-version = %q, want %q", got, anthropicVer)
	}
	if req.Method != http.MethodPost {
		t.Errorf("method = %q, want POST", req.Method)
	}
	if req.URL.String() != anthropicAPI {
		t.Errorf("url = %q, want %q", req.URL.String(), anthropicAPI)
	}
}

// --- Reply: response parsing & error handling ------------------------------

func TestReplyReturnsFirstContentText(t *testing.T) {
	body := `{"content":[{"type":"text","text":"first"},{"type":"text","text":"second"}]}`
	_, _, reply, err := captureReply(t, nil, "q", body)
	if err != nil {
		t.Fatalf("Reply error: %v", err)
	}
	if reply != "first" {
		t.Errorf("reply = %q, want first", reply)
	}
}

func TestReplyAnthropicError(t *testing.T) {
	body := `{"error":{"type":"overloaded_error","message":"try again"}}`
	_, _, reply, err := captureReply(t, nil, "q", body)
	if err == nil {
		t.Fatal("expected error when anthropic returns an error object")
	}
	if reply != "" {
		t.Errorf("reply = %q, want empty on error", reply)
	}
	if !strings.Contains(err.Error(), "overloaded_error") || !strings.Contains(err.Error(), "try again") {
		t.Errorf("error should surface anthropic type+message, got %v", err)
	}
}

func TestReplyEmptyContent(t *testing.T) {
	_, _, reply, err := captureReply(t, nil, "q", `{"content":[]}`)
	if err == nil {
		t.Fatal("expected error on empty content array")
	}
	if reply != "" {
		t.Errorf("reply = %q, want empty", reply)
	}
	if !strings.Contains(err.Error(), "empty response") {
		t.Errorf("error = %v, want 'empty response'", err)
	}
}

func TestReplyMalformedJSON(t *testing.T) {
	_, _, _, err := captureReply(t, nil, "q", `{not json`)
	if err == nil {
		t.Fatal("expected decode error on malformed JSON")
	}
	if !strings.Contains(err.Error(), "decode response") {
		t.Errorf("error = %v, want 'decode response'", err)
	}
}

func TestReplyTransportError(t *testing.T) {
	rt := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return nil, errors.New("connection refused")
	})
	p := newFakeProvider("k", rt)
	_, err := p.Reply(context.Background(), nil, "hi")
	if err == nil {
		t.Fatal("expected error when transport fails")
	}
	if !strings.Contains(err.Error(), "http") {
		t.Errorf("error = %v, want wrapped 'http' error", err)
	}
}

// --- Mock AIProvider: determinism + interface contract ---------------------

type stubProvider struct {
	reply       string
	err         error
	calls       int
	lastHistory []Message
	lastMsg     string
}

func (s *stubProvider) Reply(ctx context.Context, history []Message, userMessage string) (string, error) {
	s.calls++
	s.lastHistory = history
	s.lastMsg = userMessage
	return s.reply, s.err
}

func TestStubProviderDeterministic(t *testing.T) {
	s := &stubProvider{reply: "canned answer"}
	var p AIProvider = s
	hist := []Message{{Role: RoleUser, Content: "prev"}}

	r1, e1 := p.Reply(context.Background(), hist, "same input")
	r2, e2 := p.Reply(context.Background(), hist, "same input")

	if e1 != nil || e2 != nil {
		t.Fatalf("unexpected errors: %v / %v", e1, e2)
	}
	if r1 != r2 {
		t.Errorf("non-deterministic mock: %q vs %q", r1, r2)
	}
	if r1 != "canned answer" {
		t.Errorf("reply = %q, want 'canned answer'", r1)
	}
	if s.calls != 2 {
		t.Errorf("calls = %d, want 2", s.calls)
	}
	if s.lastMsg != "same input" {
		t.Errorf("lastMsg = %q, want 'same input'", s.lastMsg)
	}
}

func TestStubProviderError(t *testing.T) {
	want := errors.New("provider down")
	var p AIProvider = &stubProvider{err: want}
	got, err := p.Reply(context.Background(), nil, "x")
	if !errors.Is(err, want) {
		t.Errorf("err = %v, want %v", err, want)
	}
	if got != "" {
		t.Errorf("reply = %q, want empty on error", got)
	}
}

// --- Model data integrity ---------------------------------------------------

func TestStatusConstantValues(t *testing.T) {
	cases := map[SessionStatus]string{
		SessionOpen:      "open",
		SessionEscalated: "escalated",
		SessionResolved:  "resolved",
	}
	for got, want := range cases {
		if string(got) != want {
			t.Errorf("status const = %q, want %q", got, want)
		}
	}
}

func TestRoleConstantValues(t *testing.T) {
	cases := map[MessageRole]string{
		RoleUser:  "user",
		RoleAI:    "ai",
		RoleAgent: "agent",
	}
	for got, want := range cases {
		if string(got) != want {
			t.Errorf("role const = %q, want %q", got, want)
		}
	}
}

func TestSessionJSONRoundTrip(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	in := Session{
		ID:        "sess-1",
		UserID:    "user-1",
		Status:    SessionEscalated,
		Topic:     "wallet issue",
		CreatedAt: now,
		UpdatedAt: now,
	}
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out Session
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.ID != in.ID || out.UserID != in.UserID || out.Status != in.Status || out.Topic != in.Topic {
		t.Errorf("round trip mismatch: %+v vs %+v", out, in)
	}
	if !out.CreatedAt.Equal(in.CreatedAt) {
		t.Errorf("CreatedAt mismatch: %v vs %v", out.CreatedAt, in.CreatedAt)
	}
}

func TestMessageJSONRoundTrip(t *testing.T) {
	in := Message{ID: "m1", SessionID: "s1", Role: RoleAI, Content: "hello"}
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out Message
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out != in {
		t.Errorf("round trip mismatch: %+v vs %+v", out, in)
	}
}

// TestSessionTopicOmitempty: an empty Topic must be omitted from JSON output.
func TestSessionTopicOmitempty(t *testing.T) {
	raw, err := json.Marshal(Session{ID: "s", UserID: "u", Status: SessionOpen})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(raw), "topic") {
		t.Errorf("empty topic should be omitted, got %s", raw)
	}
}

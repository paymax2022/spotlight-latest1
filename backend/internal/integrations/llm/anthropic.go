// Package llm provides a minimal, dependency-free server-side client for the
// Anthropic Messages API. It exists so backend modules (doctor AI-assist, future
// AI care) can request a STRUCTURED JSON completion without pulling in an SDK.
//
// Iron rules honoured here:
//   - The API key is read ONLY server-side (passed in from config) and is NEVER
//     placed in any value that is returned to a client — it lives solely on the
//     unexported Client.apiKey field and the outbound request header.
//   - Only net/http + encoding/json are used (no third-party SDK).
//   - GenerateJSON returns the model's text verbatim as json.RawMessage; the
//     CALLER's system prompt is responsible for constraining the model to emit
//     ONLY valid JSON. We do not fabricate content on failure — errors propagate.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	anthropicMessagesURL = "https://api.anthropic.com/v1/messages"
	anthropicVersion     = "2023-06-01"
	defaultModel         = "claude-3-5-sonnet-latest"
	defaultMaxTokens     = 2048
	requestTimeout       = 30 * time.Second
)

// Client is a thin Anthropic Messages API client.
//
// apiKey and model are unexported; the key never leaves this package except as an
// outbound request header to api.anthropic.com.
type Client struct {
	apiKey string
	model  string
	http   *http.Client
}

// NewAnthropicClient builds a client from a server-side API key. An empty key
// yields a disabled client (Enabled() == false) — callers must check Enabled()
// and degrade gracefully rather than calling GenerateJSON.
func NewAnthropicClient(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		model:  defaultModel,
		http:   &http.Client{Timeout: requestTimeout},
	}
}

// WithModel overrides the completion model (e.g. "claude-sonnet-4-6"). An empty
// value keeps the current model. Returns the client for chaining.
func (c *Client) WithModel(model string) *Client {
	if model != "" {
		c.model = model
	}
	return c
}

// Enabled reports whether an API key is configured. When false, callers MUST NOT
// fabricate model output — they should surface a clearly-marked "not configured"
// state to the user.
func (c *Client) Enabled() bool { return c.apiKey != "" }

// Model returns the display/model identifier used for completions (safe to echo
// to clients as a label — it contains no secret).
func (c *Client) Model() string { return c.model }

// anthropicRequest is the Messages API request body.
type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// anthropicResponse captures only the fields we need from a success response.
type anthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

// GenerateJSON sends systemPrompt + userPrompt to the Anthropic Messages API and
// returns the first text content block as raw JSON. The system prompt is expected
// to instruct the model to output ONLY valid JSON; the returned bytes are the
// model's text verbatim (not re-encoded), so the caller can json.Unmarshal them
// into a typed shape.
//
// Non-2xx responses and missing/empty content yield an error and NO output — the
// caller must treat this as a failure (never present fabricated content).
func (c *Client) GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (json.RawMessage, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("llm: client not configured (missing API key)")
	}

	reqBody := anthropicRequest{
		Model:     c.model,
		MaxTokens: defaultMaxTokens,
		System:    systemPrompt,
		Messages: []anthropicMessage{
			{Role: "user", Content: userPrompt},
		},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("llm: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicMessagesURL, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("llm: build request: %w", err)
	}
	// The API key is set ONLY on the outbound request header to api.anthropic.com.
	httpReq.Header.Set("x-api-key", c.apiKey)
	httpReq.Header.Set("anthropic-version", anthropicVersion)
	httpReq.Header.Set("content-type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("llm: request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("llm: read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Surface the provider status; do NOT leak the key (it is not in the body).
		return nil, fmt.Errorf("llm: anthropic returned status %d: %s", resp.StatusCode, string(body))
	}

	var parsed anthropicResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("llm: decode response envelope: %w", err)
	}
	if len(parsed.Content) == 0 || parsed.Content[0].Text == "" {
		return nil, fmt.Errorf("llm: empty completion content")
	}

	text := parsed.Content[0].Text
	// Validate the model honoured the "JSON only" instruction. If it did not,
	// fail rather than return malformed/fabricated content downstream.
	if !json.Valid([]byte(text)) {
		return nil, fmt.Errorf("llm: model output was not valid JSON")
	}
	return json.RawMessage(text), nil
}

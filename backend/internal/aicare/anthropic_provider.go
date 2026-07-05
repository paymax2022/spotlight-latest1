package aicare

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
	anthropicAPI   = "https://api.anthropic.com/v1/messages"
	anthropicModel = "claude-haiku-4-5-20251001"
	anthropicVer   = "2023-06-01"
	maxTokens      = 1024
)

// AnthropicProvider implements AIProvider using the Anthropic Messages API.
type AnthropicProvider struct {
	apiKey string
	client *http.Client
}

func NewAnthropicProvider(apiKey string) *AnthropicProvider {
	return &AnthropicProvider{apiKey: apiKey, client: &http.Client{Timeout: 30 * time.Second}}
}

type anthropicMsg      struct { Role string `json:"role"`; Content string `json:"content"` }
type anthropicRequest  struct {
	Model     string         `json:"model"`
	MaxTokens int            `json:"max_tokens"`
	System    string         `json:"system,omitempty"`
	Messages  []anthropicMsg `json:"messages"`
}
type anthropicContent  struct { Type string `json:"type"`; Text string `json:"text"` }
type anthropicResponse struct {
	Content []anthropicContent `json:"content"`
	Error   *struct { Type string `json:"type"`; Message string `json:"message"` } `json:"error,omitempty"`
}

func (p *AnthropicProvider) Reply(ctx context.Context, history []Message, userMessage string) (string, error) {
	msgs := make([]anthropicMsg, 0, len(history)+1)
	for _, m := range history {
		role := "user"
		if m.Role == RoleAI || m.Role == RoleAgent {
			role = "assistant"
		}
		msgs = append(msgs, anthropicMsg{Role: role, Content: m.Content})
	}
	msgs = append(msgs, anthropicMsg{Role: "user", Content: userMessage})

	body, _ := json.Marshal(anthropicRequest{
		Model:     anthropicModel,
		MaxTokens: maxTokens,
		System:    "You are a helpful customer support agent for Spotlight, a fintech super-app. Be concise, friendly, and accurate.",
		Messages:  msgs,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicAPI, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("aicare: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", p.apiKey)
	req.Header.Set("anthropic-version", anthropicVer)

	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("aicare: http: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	var ar anthropicResponse
	if err := json.Unmarshal(raw, &ar); err != nil {
		return "", fmt.Errorf("aicare: decode response: %w", err)
	}
	if ar.Error != nil {
		return "", fmt.Errorf("aicare: anthropic error %s: %s", ar.Error.Type, ar.Error.Message)
	}
	if len(ar.Content) == 0 {
		return "", fmt.Errorf("aicare: empty response")
	}
	return ar.Content[0].Text, nil
}

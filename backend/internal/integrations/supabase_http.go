package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// ErrTokenInvalid marks a definitive GoTrue rejection (401/403) — the bearer
// token is expired, malformed, or revoked. Every other AuthUser failure
// (transport error, timeout, 5xx, decode failure) means the auth backend is
// unreachable/unhealthy, NOT that the token is bad; callers must map it to a
// 503, not a 401, or a Supabase/Kong blip reports "invalid token" to every
// logged-in user (AUD-AUTH-001).
var ErrTokenInvalid = errors.New("token rejected by auth backend")

func (c *SupabaseRestClient) buildRequest(ctx context.Context, method, path string, query map[string]string, body any) (*http.Request, error) {
	if !c.Enabled() {
		return nil, errors.New("supabase REST is not configured")
	}
	u, err := url.Parse(strings.TrimRight(c.baseURL, "/") + path)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	for k, v := range query {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()

	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, u.String(), reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Apikey", c.apiKey)
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	return req, nil
}

func (c *SupabaseRestClient) REST(ctx context.Context, method, table string, query map[string]string, body any, out any) error {
	req, err := c.buildRequest(ctx, method, "/rest/v1/"+table, query, body)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		buf, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase REST %s %s failed: %d: %s", method, table, resp.StatusCode, strings.TrimSpace(string(buf)))
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil && err != io.EOF {
			return err
		}
	}
	return nil
}

// RESTReturn is like REST but asks PostgREST to return the affected rows
// (Prefer: return=representation). Used for INSERT/UPDATE statements where the
// caller needs the generated id or an affected-row count.
func (c *SupabaseRestClient) RESTReturn(ctx context.Context, method, table string, query map[string]string, body any, out any) error {
	req, err := c.buildRequest(ctx, method, "/rest/v1/"+table, query, body)
	if err != nil {
		return err
	}
	req.Header.Set("Prefer", "return=representation")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		buf, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase RESTReturn %s %s failed: %d: %s", method, table, resp.StatusCode, strings.TrimSpace(string(buf)))
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil && err != io.EOF {
			return err
		}
	}
	return nil
}

func (c *SupabaseRestClient) RPC(ctx context.Context, function string, payload map[string]any, out any) error {
	req, err := c.buildRequest(ctx, http.MethodPost, "/rest/v1/rpc/"+function, nil, payload)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		buf, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase RPC %s failed: %d: %s", function, resp.StatusCode, strings.TrimSpace(string(buf)))
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil && err != io.EOF {
			return err
		}
	}
	return nil
}

func (c *SupabaseRestClient) AuthUser(ctx context.Context, accessToken string) (map[string]any, error) {
	// ADR-PR395: local verify when configured — same 401 semantics for a
	// definitively-bad token, no GoTrue round trip.
	if c.localVerify {
		return c.verifyLocalJWT(ctx, accessToken)
	}
	if strings.TrimSpace(c.baseURL) == "" {
		return nil, errors.New("supabase URL is not configured")
	}
	u := strings.TrimRight(c.baseURL, "/") + "/auth/v1/user"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Apikey", c.apiKey)
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("auth user lookup failed: %d: %w", resp.StatusCode, ErrTokenInvalid)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("auth user lookup failed: %d", resp.StatusCode)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

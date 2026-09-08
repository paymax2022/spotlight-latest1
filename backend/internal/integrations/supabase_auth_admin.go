package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// AdminConfirmEmail marks a user's email address confirmed in GoTrue.
//
// Through GoTrue's admin API rather than an UPDATE on auth.users. Writing
// email_confirmed_at directly appears to work and skips GoTrue's own bookkeeping
// — confirmed_at is a generated column in current versions, and identity rows
// carry their own confirmation state — so a direct write can leave an account
// that looks confirmed to us and unconfirmed to the thing that actually issues
// sessions. Let the owner of the schema do the write.
//
// Idempotent: confirming an already-confirmed user is a no-op that returns 200.
//
// Requires the client to hold the SERVICE ROLE key, which is how the router
// constructs it. With an anon key GoTrue answers 401 and this returns an error.
func (c *SupabaseRestClient) AdminConfirmEmail(ctx context.Context, userID string) error {
	if strings.TrimSpace(c.baseURL) == "" || strings.TrimSpace(c.apiKey) == "" {
		return fmt.Errorf("supabase: not configured")
	}
	if strings.TrimSpace(userID) == "" {
		return fmt.Errorf("supabase: empty user id")
	}

	body, err := json.Marshal(map[string]any{"email_confirm": true})
	if err != nil {
		return err
	}
	u := strings.TrimRight(c.baseURL, "/") + "/auth/v1/admin/users/" + strings.TrimSpace(userID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", c.apiKey)
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("supabase: confirm email: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		// The body can name the reason (e.g. a missing service-role key). The
		// address is NOT included — an error string that carries it ends up in
		// logs, and a log of addresses is a user list.
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<10))
		return fmt.Errorf("supabase: confirm email failed: %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	return nil
}

// AdminSetPassword replaces a user's password.
//
// Through the admin API for the same reason AdminConfirmEmail is: GoTrue owns
// the credential columns, and it re-hashes, bumps the identity row and
// invalidates outstanding recovery tokens as a side effect. A direct UPDATE
// would set a column and leave every one of those undone.
//
// The password is never logged, and it is not included in any error returned
// here — errors from this function are safe to log verbatim.
func (c *SupabaseRestClient) AdminSetPassword(ctx context.Context, userID, password string) error {
	if strings.TrimSpace(userID) == "" {
		return fmt.Errorf("supabase: empty user id")
	}
	if password == "" {
		return fmt.Errorf("supabase: empty password")
	}
	return c.adminUserPatch(ctx, userID, map[string]any{"password": password}, "set password")
}

// MintSessionByEmail issues a session for an existing user WITHOUT a password.
//
// It is the second half of the login step-up: the password was already checked
// by the normal login path, the session GoTrue minted there was deliberately
// thrown away, and this re-issues one once the emailed code has been redeemed.
// Re-minting rather than parking the first session means no access or refresh
// token is ever written to our storage waiting for a second factor.
//
// The mechanism is GoTrue's own admin magiclink: generate_link returns an
// email_otp WITHOUT sending any mail (verified against the local mail catcher —
// generate_link produced zero messages), and that otp is then redeemed at
// /verify for a real session. It is the only supported way to obtain a session
// for a user whose password we do not hold.
//
// ⚠️ This function is an authentication bypass by construction: anything that
// can call it can log in as anyone. Its ONLY caller must be a path that has
// already established both factors.
func (c *SupabaseRestClient) MintSessionByEmail(ctx context.Context, email string) (map[string]any, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return nil, fmt.Errorf("supabase: empty email")
	}
	if strings.TrimSpace(c.baseURL) == "" || strings.TrimSpace(c.apiKey) == "" {
		return nil, fmt.Errorf("supabase: not configured")
	}

	var link struct {
		EmailOTP string `json:"email_otp"`
	}
	if err := c.authPost(ctx, "/auth/v1/admin/generate_link",
		map[string]any{"type": "magiclink", "email": email}, &link); err != nil {
		return nil, fmt.Errorf("supabase: generate_link: %w", err)
	}
	if strings.TrimSpace(link.EmailOTP) == "" {
		// A GoTrue version that stops returning email_otp would otherwise show up
		// as a 400 from /verify with no explanation.
		return nil, fmt.Errorf("supabase: generate_link returned no email_otp")
	}

	var session map[string]any
	if err := c.authPost(ctx, "/auth/v1/verify",
		map[string]any{"type": "magiclink", "email": email, "token": link.EmailOTP}, &session); err != nil {
		return nil, fmt.Errorf("supabase: verify magiclink: %w", err)
	}
	if s, _ := session["access_token"].(string); strings.TrimSpace(s) == "" {
		return nil, fmt.Errorf("supabase: verify returned no access_token")
	}
	return session, nil
}

// adminUserPatch PUTs a partial update to one user.
func (c *SupabaseRestClient) adminUserPatch(ctx context.Context, userID string, body map[string]any, what string) error {
	if strings.TrimSpace(c.baseURL) == "" || strings.TrimSpace(c.apiKey) == "" {
		return fmt.Errorf("supabase: not configured")
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	u := strings.TrimRight(c.baseURL, "/") + "/auth/v1/admin/users/" + strings.TrimSpace(userID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	c.authHeaders(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("supabase: %s: %w", what, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<10))
		return fmt.Errorf("supabase: %s failed: %d: %s", what, resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	return nil
}

// authPost posts JSON to a GoTrue path and decodes the response.
func (c *SupabaseRestClient) authPost(ctx context.Context, path string, body map[string]any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(c.baseURL, "/")+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	c.authHeaders(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<10))
		return fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		return nil
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}

func (c *SupabaseRestClient) authHeaders(req *http.Request) {
	req.Header.Set("apikey", c.apiKey)
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
}

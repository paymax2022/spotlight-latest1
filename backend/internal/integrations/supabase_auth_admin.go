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

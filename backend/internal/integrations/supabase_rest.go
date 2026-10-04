package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type SupabaseRestClient struct {
	baseURL     string
	apiKey      string
	jwtSecret   []byte
	localVerify bool
	jwks        map[string]jwksKey
	jwksMu      sync.Mutex
	http        *http.Client
}

func NewSupabaseRestClient(baseURL, apiKey string) *SupabaseRestClient {
	return &SupabaseRestClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  strings.TrimSpace(apiKey),
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *SupabaseRestClient) Enabled() bool {
	return c.baseURL != "" && c.apiKey != ""
}

func (c *SupabaseRestClient) BaseURL() string { return c.baseURL }
func (c *SupabaseRestClient) APIKey() string  { return c.apiKey }

func (c *SupabaseRestClient) Count(ctx context.Context, table string) (int, error) {
	if !c.Enabled() {
		return 0, errors.New("supabase REST is not configured")
	}

	u, err := url.Parse(c.baseURL + "/rest/v1/" + table)
	if err != nil {
		return 0, err
	}
	q := u.Query()
	q.Set("select", "id")
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Apikey", c.apiKey)
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Range", "0-0")
	req.Header.Set("Prefer", "count=exact")

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		var body map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&body)
		return 0, fmt.Errorf("supabase REST %s failed: %d", table, resp.StatusCode)
	}

	contentRange := resp.Header.Get("Content-Range")
	if idx := strings.LastIndex(contentRange, "/"); idx >= 0 && idx+1 < len(contentRange) {
		var total int
		_, scanErr := fmt.Sscanf(contentRange[idx+1:], "%d", &total)
		if scanErr == nil {
			return total, nil
		}
	}

	return 0, nil
}

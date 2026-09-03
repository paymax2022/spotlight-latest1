package mycover

// utility.go — the dependent/lookup dropdowns a product schema points at.
//
// A synced field can carry an `options_url` instead of a literal enum: one
// MyCover "utility" endpoint per list (Nigerian states, banks, vehicle makes…).
// `pathUtility` has been declared since the v2 rework but nothing ever called
// it, so every schema field with an options_url had no way to be filled and the
// app's remote-options endpoint answered 404 — 219 such fields across 65 of the
// 69 products.
//
// Verified shape (live GET, 2026-08-31, states utility
// e55de863-7d98-4236-bd61-40328cd7f7fc):
//
//	{"responseCode":1,"responseText":"Product utility fetched successfully",
//	 "data":[{"label":"Abia","value":"Abia"}, …]}
//
// So it is the standard v2 envelope with `data` already in {label,value} form.
// That id ignores `?query=`; others are documented to serve a dependent list
// from the parent's value, so the parameter is forwarded when given.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// FetchUtilityOptions returns the options served by a schema field's
// options_url.
//
// optionsURL comes from OUR stored, provider-synced schema — never from a
// client, which only ever names a product and a field. It is still pinned to the
// configured provider origin before being fetched: this is a server-side GET of
// a URL that arrived as data, so without that check a bad or tampered sync row
// would turn into an SSRF against anything the backend can reach.
func (c *Client) FetchUtilityOptions(ctx context.Context, optionsURL, query string) ([]Option, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("mycover: no API key configured")
	}
	target, err := c.utilityTarget(optionsURL, query)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")

	env, err := c.do(req)
	if err != nil {
		return nil, err
	}
	var opts []Option
	if err := json.Unmarshal(env.Data, &opts); err != nil {
		return nil, fmt.Errorf("mycover: utility options: unexpected shape: %w", err)
	}
	// Drop blanks rather than render an empty row the user can select. A value is
	// what gets submitted, so an option without one is unusable; label falls back
	// to the value so a list that omits labels still reads.
	out := make([]Option, 0, len(opts))
	for _, o := range opts {
		v := strings.TrimSpace(o.Value)
		if v == "" {
			continue
		}
		l := strings.TrimSpace(o.Label)
		if l == "" {
			l = v
		}
		out = append(out, Option{Value: v, Label: l})
	}
	return out, nil
}

// utilityTarget validates the stored options_url against the configured provider
// origin and appends the optional dependent query.
func (c *Client) utilityTarget(optionsURL, query string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(optionsURL))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("mycover: utility options: unusable options_url")
	}
	if u.Scheme != "https" {
		return "", fmt.Errorf("mycover: utility options: refusing non-https options_url")
	}
	base, err := url.Parse(c.baseURL)
	if err != nil {
		return "", fmt.Errorf("mycover: utility options: bad configured base url")
	}
	if !strings.EqualFold(u.Host, base.Host) {
		// The pin is the whole point — see the doc comment on FetchUtilityOptions.
		return "", fmt.Errorf("mycover: utility options: options_url host %q is not the provider", u.Host)
	}
	if q := strings.TrimSpace(query); q != "" {
		params := u.Query()
		params.Set("query", q)
		u.RawQuery = params.Encode()
	}
	return u.String(), nil
}

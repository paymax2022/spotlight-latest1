package mycover

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

// PolicySummary is the slice of a MyCover policy the admin dashboard mirrors.
// It deliberately carries NO personal data: GET /v2/policies returns the
// policyholder's name, email, phone and date of birth on every row, and none of
// that is needed to answer "what does MyCover hold for us" — so it is never read
// out of the response, never stored, and never logged.
type PolicySummary struct {
	ProviderPolicyRef string // MyCover's policy uuid
	PolicyNumber      string
	ProductID         string
	ProductName       string
	Underwriter       string
	Status            string // active | expired | inactive | "" (unknown)
	PremiumKobo       int64
	StartsAt          time.Time
	ExpiresAt         time.Time
	CertificateURL    string
	ProviderCreatedAt time.Time
}

// ListPolicySummaries pages GET /v2/policies and returns personal-data-free
// summaries plus MyCover's total_count. Read-only: it creates, moves and charges
// nothing.
func (c *Client) ListPolicySummaries(ctx context.Context, page, limit int) ([]PolicySummary, int, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 100
	}
	q := url.Values{}
	q.Set("page", strconv.Itoa(page))
	q.Set("limit", strconv.Itoa(limit))

	env, err := c.get(ctx, pathPolicies+"?"+q.Encode())
	if err != nil {
		return nil, 0, err
	}
	var payload struct {
		TotalCount int               `json:"total_count"`
		Policies   []json.RawMessage `json:"policies"`
	}
	if err := json.Unmarshal(env.Data, &payload); err != nil {
		return nil, 0, fmt.Errorf("mycover: decode policy list: %w", err)
	}
	out := make([]PolicySummary, 0, len(payload.Policies))
	for _, raw := range payload.Policies {
		if s, ok := policySummaryFromData(raw); ok {
			out = append(out, s)
		}
	}
	return out, payload.TotalCount, nil
}

// policySummaryFromData maps one list row. A row with no id is skipped: without
// MyCover's own reference there is nothing to key the mirror on.
func policySummaryFromData(raw json.RawMessage) (PolicySummary, bool) {
	m := decodeObject(raw)
	ref := pickString(m, "id")
	if ref == "" {
		return PolicySummary{}, false
	}
	product := decodeObject(m["product"])
	provider := decodeObject(m["provider"])
	meta := decodeObject(m["meta"])

	s := PolicySummary{
		ProviderPolicyRef: ref,
		PolicyNumber:      pickString(m, "policy_number"),
		ProductID:         pickString(m, "product_id"),
		ProductName:       pickString(product, "name"),
		Underwriter:       pickString(provider, "organization_name"),
		PremiumKobo:       pickMoney(m, "amount"),
		StartsAt:          pickTime(m, "start_date", "activation_date"),
		ExpiresAt:         pickTime(m, "expiration_date"),
		CertificateURL:    pickString(m, "certificate_url"),
		ProviderCreatedAt: pickTime(m, "created_at"),
	}
	if s.PolicyNumber == "" {
		s.PolicyNumber = pickString(meta, "policy_number")
	}
	s.Status = policyStatus(m, s.ExpiresAt)
	return s, true
}

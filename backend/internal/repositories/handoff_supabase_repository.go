package repositories

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

type HandoffSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewHandoffSupabaseRepository(client *integrations.SupabaseRestClient) *HandoffSupabaseRepository {
	return &HandoffSupabaseRepository{client: client}
}

func (r *HandoffSupabaseRepository) List(limit int, status string, sessionID string) ([]domain.Handoff, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.Handoff{}, nil
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/handoff_requests")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,session_id,handoff_type,destination,status,requested_at,resolved_at")
	q.Set("order", "requested_at.desc")
	q.Set("limit", strconv.Itoa(limit))
	if trimmed := strings.TrimSpace(strings.ToLower(status)); trimmed != "" {
		q.Set("status", "eq."+trimmed)
	}
	if trimmed := strings.TrimSpace(sessionID); trimmed != "" {
		q.Set("session_id", "eq."+trimmed)
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	httpClient := &http.Client{Timeout: 10 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("handoff query failed: %d", resp.StatusCode)
	}

	var rows []domain.Handoff
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *HandoffSupabaseRepository) UpdateStatus(id, status string) error {
	if r.client == nil || !r.client.Enabled() {
		return nil
	}
	if strings.TrimSpace(id) == "" || strings.TrimSpace(status) == "" {
		return fmt.Errorf("id and status are required")
	}

	updatePayload := map[string]any{
		"status": strings.ToLower(strings.TrimSpace(status)),
	}
	if strings.EqualFold(strings.TrimSpace(status), "resolved") {
		updatePayload["resolved_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	body, err := json.Marshal(updatePayload)
	if err != nil {
		return err
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/handoff_requests")
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("id", "eq."+id)
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodPatch, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	httpClient := &http.Client{Timeout: 10 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("handoff update failed: %d", resp.StatusCode)
	}
	return nil
}

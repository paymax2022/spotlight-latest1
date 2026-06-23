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

type LeadSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewLeadSupabaseRepository(client *integrations.SupabaseRestClient) *LeadSupabaseRepository {
	return &LeadSupabaseRepository{client: client}
}

func (r *LeadSupabaseRepository) List(limit int, sessionID string) ([]domain.Lead, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.Lead{}, nil
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/lead_records")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,session_id,lead_type,status,score,source_page,name,email,phone,notes,transcript_excerpt,created_at,updated_at")
	q.Set("order", "created_at.desc")
	q.Set("limit", strconv.Itoa(limit))
	if strings.TrimSpace(sessionID) != "" {
		q.Set("session_id", "eq."+sessionID)
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
		return nil, fmt.Errorf("lead query failed: %d", resp.StatusCode)
	}

	var rows []struct {
		ID                string `json:"id"`
		SessionID         string `json:"session_id"`
		LeadType          string `json:"lead_type"`
		Status            string `json:"status"`
		Score             int    `json:"score"`
		SourcePage        string `json:"source_page"`
		Name              string `json:"name"`
		Email             string `json:"email"`
		Phone             string `json:"phone"`
		Notes             string `json:"notes"`
		TranscriptExcerpt string `json:"transcript_excerpt"`
		CreatedAt         string `json:"created_at"`
		UpdatedAt         string `json:"updated_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}

	out := make([]domain.Lead, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.Lead{
			ID: row.ID, SessionID: row.SessionID, LeadType: row.LeadType, Status: row.Status,
			Score: row.Score, SourcePage: row.SourcePage, Name: row.Name, Email: row.Email,
			Phone: row.Phone, Notes: row.Notes, TranscriptExcerpt: row.TranscriptExcerpt,
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		})
	}
	return out, nil
}

func (r *LeadSupabaseRepository) UpdateStatus(id, status string) error {
	if r.client == nil || !r.client.Enabled() {
		return nil
	}
	leadID := strings.TrimSpace(id)
	nextStatus := strings.TrimSpace(status)
	if leadID == "" || nextStatus == "" {
		return fmt.Errorf("id and status are required")
	}

	body, err := json.Marshal(map[string]any{
		"status":     nextStatus,
		"updated_at": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return err
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/lead_records")
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("id", "eq."+leadID)
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
		return fmt.Errorf("lead update failed: %d", resp.StatusCode)
	}
	return nil
}

package repositories

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
	"strconv"
	"strings"
	"time"
)

type HandoffRepository interface {
	List(limit int, status string, sessionID string) ([]domain.Handoff, error)
	UpdateStatus(id, status string) error
}

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

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	httpClient := &http.Client{Timeout: 10 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

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
		return errors.New("id and status are required")
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

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPatch, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	httpClient := &http.Client{Timeout: 10 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("handoff update failed: %d", resp.StatusCode)
	}
	return nil
}

type LeadRepository interface {
	List(limit int, sessionID string) ([]domain.Lead, error)
	UpdateStatus(id, status string) error
}

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

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	httpClient := &http.Client{Timeout: 10 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

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
		return errors.New("id and status are required")
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

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPatch, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	httpClient := &http.Client{Timeout: 10 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("lead update failed: %d", resp.StatusCode)
	}
	return nil
}

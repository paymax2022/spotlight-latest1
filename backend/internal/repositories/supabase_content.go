package repositories

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
	"strconv"
	"strings"
	"time"
)

type ChatRepository interface {
	ListSessions(limit int) ([]domain.ChatSession, error)
	GetSessionDetail(id string) (domain.ChatSessionDetail, error)
}

type ChatSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewChatSupabaseRepository(client *integrations.SupabaseRestClient) *ChatSupabaseRepository {
	return &ChatSupabaseRepository{client: client}
}

func (r *ChatSupabaseRepository) ListSessions(limit int) ([]domain.ChatSession, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.ChatSession{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/chat_sessions")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,page_context,status,started_at")
	q.Set("order", "created_at.desc")
	q.Set("limit", strconv.Itoa(limit))
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
		return nil, fmt.Errorf("chat session query failed: %d", resp.StatusCode)
	}

	var rows []struct {
		ID          string `json:"id"`
		PageContext string `json:"page_context"`
		Status      string `json:"status"`
		StartedAt   string `json:"started_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}

	out := make([]domain.ChatSession, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.ChatSession{ID: row.ID, PageContext: row.PageContext, Status: row.Status, StartedAt: row.StartedAt})
	}
	return out, nil
}

func (r *ChatSupabaseRepository) GetSessionDetail(id string) (domain.ChatSessionDetail, error) {
	empty := domain.ChatSessionDetail{
		Messages: []domain.ChatMessage{},
		Events:   []domain.ChatEvent{},
	}
	if r.client == nil || !r.client.Enabled() || strings.TrimSpace(id) == "" {
		return empty, nil
	}

	httpClient := &http.Client{Timeout: 12 * time.Second}
	base := strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/"
	headers := func(req *http.Request) {
		req.Header.Set("Apikey", r.client.APIKey())
		req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	}

	buildURL := func(table string, query map[string]string) (string, error) {
		u, err := url.Parse(base + table)
		if err != nil {
			return "", err
		}
		q := u.Query()
		for key, value := range query {
			q.Set(key, value)
		}
		u.RawQuery = q.Encode()
		return u.String(), nil
	}

	sessionURL, err := buildURL("chat_sessions", map[string]string{
		"select": "id,page_context,status,started_at",
		"id":     "eq." + id,
		"limit":  "1",
	})
	if err != nil {
		return empty, err
	}
	messagesURL, err := buildURL("chat_messages", map[string]string{
		"select":     "id,role,message_text,text,intent,confidence,created_at",
		"session_id": "eq." + id,
		"order":      "created_at.asc",
	})
	if err != nil {
		return empty, err
	}
	eventsURL, err := buildURL("chat_events", map[string]string{
		"select":     "id,event_name,event,event_payload,payload,created_at",
		"session_id": "eq." + id,
		"order":      "created_at.asc",
	})
	if err != nil {
		return empty, err
	}

	getAndDecode := func(targetURL string, out any) error {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, targetURL, nil)
		if err != nil {
			return err
		}
		headers(req)
		resp, err := httpClient.Do(req)
		if err != nil {
			return err
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode >= 400 {
			return fmt.Errorf("chat detail query failed: %d", resp.StatusCode)
		}
		return json.NewDecoder(resp.Body).Decode(out)
	}

	var sessionRows []struct {
		ID          string `json:"id"`
		PageContext string `json:"page_context"`
		Status      string `json:"status"`
		StartedAt   string `json:"started_at"`
	}
	if err := getAndDecode(sessionURL, &sessionRows); err != nil {
		return empty, err
	}
	var messageRows []domain.ChatMessage
	if err := getAndDecode(messagesURL, &messageRows); err != nil {
		return empty, err
	}
	var eventRows []domain.ChatEvent
	if err := getAndDecode(eventsURL, &eventRows); err != nil {
		return empty, err
	}

	out := domain.ChatSessionDetail{
		Messages: messageRows,
		Events:   eventRows,
	}
	if len(sessionRows) > 0 {
		out.Session = &domain.ChatSession{
			ID:          sessionRows[0].ID,
			PageContext: sessionRows[0].PageContext,
			Status:      sessionRows[0].Status,
			StartedAt:   sessionRows[0].StartedAt,
		}
	}
	return out, nil
}

type RealityTVRepository interface {
	GetDashboardMetrics() (domain.RealityTVDashboardMetrics, error)
}

type RealityTVSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewRealityTVSupabaseRepository(client *integrations.SupabaseRestClient) *RealityTVSupabaseRepository {
	return &RealityTVSupabaseRepository{client: client}
}

func (r *RealityTVSupabaseRepository) GetDashboardMetrics() (domain.RealityTVDashboardMetrics, error) {
	out := domain.RealityTVDashboardMetrics{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}

	var err error
	if out.TotalSeasons, err = r.client.Count("reality_tv_seasons"); err != nil {
		out.TotalSeasons = 0
	}
	if out.TotalApplications, err = r.client.Count("reality_tv_applications"); err != nil {
		out.TotalApplications = 0
	}
	if out.TotalContestants, err = r.client.Count("contestants?category=eq.reality_tv"); err != nil {
		out.TotalContestants = 0
	}
	if out.ActiveVotingRounds, err = r.client.Count("reality_tv_voting_rounds?status=eq.active"); err != nil {
		out.ActiveVotingRounds = 0
	}
	if out.OpenTickets, err = r.client.Count("reality_tv_support_tickets?status=in.(open,in_progress)"); err != nil {
		out.OpenTickets = 0
	}
	if out.PendingApplications, err = r.client.Count("reality_tv_applications?status=in.(submitted,screening,shortlisted,welfare_review)"); err != nil {
		out.PendingApplications = 0
	}

	activeSeason, err := r.getActiveSeason()
	if err == nil {
		out.ActiveSeason = activeSeason
	}

	totalVotes, paidVotes, err := r.getVoteSums()
	if err == nil {
		out.TotalVotes = totalVotes
		out.PaidVotes = paidVotes
		out.FreeVotes = max(totalVotes-paidVotes, 0)
	}

	return out, nil
}

func (r *RealityTVSupabaseRepository) getActiveSeason() (map[string]any, error) {
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/reality_tv_seasons")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,season_title,season_number,status")
	q.Set("status", "in.(application_open,auditioning,bootcamp,live_show,finale)")
	q.Set("order", "season_number.desc")
	q.Set("limit", "1")
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
		return nil, fmt.Errorf("active season query failed: %d", resp.StatusCode)
	}

	var rows []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

func (r *RealityTVSupabaseRepository) getVoteSums() (int, int, error) {
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/votes")
	if err != nil {
		return 0, 0, err
	}
	q := u.Query()
	q.Set("select", "vote_count,payment_id")
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, u.String(), nil)
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("Apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	httpClient := &http.Client{Timeout: 12 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		return 0, 0, fmt.Errorf("vote query failed: %d", resp.StatusCode)
	}

	var rows []struct {
		VoteCount int    `json:"vote_count"`
		PaymentID string `json:"payment_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return 0, 0, err
	}

	totalVotes := 0
	paidVotes := 0
	for _, row := range rows {
		totalVotes += row.VoteCount
		if strings.TrimSpace(row.PaymentID) != "" {
			paidVotes += row.VoteCount
		}
	}
	return totalVotes, paidVotes, nil
}

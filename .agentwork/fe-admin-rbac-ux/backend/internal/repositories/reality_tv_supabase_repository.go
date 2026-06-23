package repositories

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

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
		out.FreeVotes = maxInt(totalVotes-paidVotes, 0)
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

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	httpClient := &http.Client{Timeout: 12 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()
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

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

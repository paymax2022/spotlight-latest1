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

type CompetitionSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewCompetitionSupabaseRepository(client *integrations.SupabaseRestClient) *CompetitionSupabaseRepository {
	return &CompetitionSupabaseRepository{client: client}
}

func (r *CompetitionSupabaseRepository) GetOverview() (domain.CompetitionOverview, error) {
	out := domain.CompetitionOverview{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}

	var err error
	if out.TotalContests, err = r.client.Count("contests"); err != nil {
		return domain.CompetitionOverview{}, err
	}
	if out.RealityTVContests, err = r.client.Count("contests?contest_type=eq.reality_tv_show"); err != nil {
		// fallback if filter-in-path not supported by helper
		out.RealityTVContests = 0
	}
	if out.OpenMicContests, err = r.client.Count("contests?contest_type=eq.one_beat_one_verse"); err != nil {
		out.OpenMicContests = 0
	}
	if out.MultiSkillContests, err = r.client.Count("contests?contest_type=eq.multi_skill"); err != nil {
		out.MultiSkillContests = 0
	}
	return out, nil
}

func (r *CompetitionSupabaseRepository) ListOpenMic(limit int) ([]domain.OpenMicCompetition, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.OpenMicCompetition{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/contests")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,slug,name,status,start_date,end_date,is_featured,created_at,contest_type,category")
	q.Set("order", "created_at.desc")
	q.Set("limit", strconv.Itoa(limit))
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
		return nil, fmt.Errorf("open mic query failed: %d", resp.StatusCode)
	}

	var rows []struct {
		ID          string `json:"id"`
		Slug        string `json:"slug"`
		Name        string `json:"name"`
		Status      string `json:"status"`
		StartDate   string `json:"start_date"`
		EndDate     string `json:"end_date"`
		IsFeatured  bool   `json:"is_featured"`
		CreatedAt   string `json:"created_at"`
		ContestType string `json:"contest_type"`
		Category    string `json:"category"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}

	out := make([]domain.OpenMicCompetition, 0, len(rows))
	for _, row := range rows {
		contestType := strings.ToLower(strings.TrimSpace(row.ContestType))
		category := strings.ToLower(strings.TrimSpace(row.Category))
		slug := strings.ToLower(strings.TrimSpace(row.Slug))
		if contestType != "one_beat_one_verse" && !strings.Contains(category, "music") && !strings.Contains(slug, "open-mic") {
			continue
		}
		out = append(out, domain.OpenMicCompetition{
			ID:         row.ID,
			Slug:       row.Slug,
			Name:       row.Name,
			Status:     row.Status,
			StartDate:  row.StartDate,
			EndDate:    row.EndDate,
			IsFeatured: row.IsFeatured,
			CreatedAt:  row.CreatedAt,
		})
	}
	return out, nil
}

func (r *CompetitionSupabaseRepository) CreateOpenMic(input domain.OpenMicCreateInput) (domain.OpenMicCompetition, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.OpenMicCompetition{}, fmt.Errorf("supabase REST is not configured")
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return domain.OpenMicCompetition{}, fmt.Errorf("competition name is required")
	}

	slug := strings.TrimSpace(input.Slug)
	if slug == "" {
		slug = strings.ToLower(strings.ReplaceAll(name, " ", "-"))
		slug = strings.Trim(slug, "-")
	}
	if slug == "" {
		slug = "open-mic-edition"
	}

	payload := map[string]any{
		"name":             name,
		"slug":             slug,
		"description":      strings.TrimSpace(input.Description),
		"status":           strings.TrimSpace(input.Status),
		"category":         strings.TrimSpace(input.Category),
		"start_date":       emptyToNil(strings.TrimSpace(input.StartDate)),
		"end_date":         emptyToNil(strings.TrimSpace(input.EndDate)),
		"is_featured":      input.IsFeatured,
		"entry_fee_ngn":    maxZero(input.EntryFeeNGN),
		"vote_price_ngn":   maxZero(input.VotePriceNGN),
		"rules_text":       strings.TrimSpace(input.RulesText),
		"eligibility_text": strings.TrimSpace(input.EligibilityText),
		"contest_type":     "one_beat_one_verse",
		"visibility":       "public",
	}
	if payload["status"] == "" {
		payload["status"] = "upcoming"
	}
	if payload["category"] == "" {
		payload["category"] = "Music"
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return domain.OpenMicCompetition{}, err
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/contests")
	if err != nil {
		return domain.OpenMicCompetition{}, err
	}
	q := u.Query()
	q.Set("select", "id,slug,name,status,start_date,end_date,is_featured,created_at")
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.OpenMicCompetition{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	httpClient := &http.Client{Timeout: 12 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return domain.OpenMicCompetition{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.OpenMicCompetition{}, fmt.Errorf("open mic create failed: %d", resp.StatusCode)
	}

	var rows []domain.OpenMicCompetition
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.OpenMicCompetition{}, err
	}
	if len(rows) == 0 {
		return domain.OpenMicCompetition{}, fmt.Errorf("open mic create failed: empty response")
	}
	return rows[0], nil
}

func emptyToNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func maxZero(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

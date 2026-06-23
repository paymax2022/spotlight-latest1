package repositories

import (
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

type AnalyticsSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewAnalyticsSupabaseRepository(client *integrations.SupabaseRestClient) *AnalyticsSupabaseRepository {
	return &AnalyticsSupabaseRepository{client: client}
}

func (r *AnalyticsSupabaseRepository) GetChatAnalytics() (domain.ChatAnalytics, error) {
	out := domain.ChatAnalytics{ByPage: map[string]int{}, ByIntent: map[string]int{}, LeadsByType: map[string]int{}}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}

	var err error
	if out.SessionsTotal, err = r.client.Count("chat_sessions"); err != nil { return domain.ChatAnalytics{}, err }
	if out.MessagesTotal, err = r.client.Count("chat_messages"); err != nil { return domain.ChatAnalytics{}, err }
	if out.LeadsTotal, err = r.client.Count("lead_records"); err != nil { return domain.ChatAnalytics{}, err }
	return out, nil
}

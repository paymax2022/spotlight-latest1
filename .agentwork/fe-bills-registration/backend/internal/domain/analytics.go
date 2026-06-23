package domain

type ChatAnalytics struct {
	SessionsTotal int            `json:"sessionsTotal"`
	MessagesTotal int            `json:"messagesTotal"`
	LeadsTotal    int            `json:"leadsTotal"`
	ByPage        map[string]int `json:"byPage"`
	ByIntent      map[string]int `json:"byIntent"`
	LeadsByType   map[string]int `json:"leadsByType"`
}

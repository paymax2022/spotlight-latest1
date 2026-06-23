package services

import (
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/repositories"
)

type AnalyticsService interface {
	GetChatAnalytics() (domain.ChatAnalytics, error)
}

type analyticsService struct { repo repositories.AnalyticsRepository }

func NewAnalyticsService(repo repositories.AnalyticsRepository) AnalyticsService {
	return &analyticsService{repo: repo}
}

func (s *analyticsService) GetChatAnalytics() (domain.ChatAnalytics, error) {
	if s.repo == nil { return domain.ChatAnalytics{ByPage: map[string]int{}, ByIntent: map[string]int{}, LeadsByType: map[string]int{}}, nil }
	return s.repo.GetChatAnalytics()
}

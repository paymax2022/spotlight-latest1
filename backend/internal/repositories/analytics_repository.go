package repositories

import "spotlight/backend/internal/domain"

type AnalyticsRepository interface {
	GetChatAnalytics() (domain.ChatAnalytics, error)
}

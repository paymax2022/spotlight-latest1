package repositories

import "spotlight/backend/internal/domain"

type ChatRepository interface {
	ListSessions(limit int) ([]domain.ChatSession, error)
	GetSessionDetail(id string) (domain.ChatSessionDetail, error)
}

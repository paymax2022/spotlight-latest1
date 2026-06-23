package services

import (
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/repositories"
)

type ChatService interface {
	ListSessions(limit int) ([]domain.ChatSession, error)
	GetSessionDetail(id string) (domain.ChatSessionDetail, error)
}

type chatService struct{ repo repositories.ChatRepository }

func NewChatService(repo repositories.ChatRepository) ChatService { return &chatService{repo: repo} }

func (s *chatService) ListSessions(limit int) ([]domain.ChatSession, error) {
	if s.repo == nil {
		return []domain.ChatSession{}, nil
	}
	return s.repo.ListSessions(limit)
}

func (s *chatService) GetSessionDetail(id string) (domain.ChatSessionDetail, error) {
	if s.repo == nil {
		return domain.ChatSessionDetail{Messages: []domain.ChatMessage{}, Events: []domain.ChatEvent{}}, nil
	}
	return s.repo.GetSessionDetail(id)
}

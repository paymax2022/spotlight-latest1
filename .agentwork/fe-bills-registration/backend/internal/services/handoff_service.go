package services

import (
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/repositories"
)

type HandoffService interface {
	List(limit int, status string, sessionID string) ([]domain.Handoff, error)
	UpdateStatus(id, status string) error
}

type handoffService struct {
	repo repositories.HandoffRepository
}

func NewHandoffService(repo repositories.HandoffRepository) HandoffService {
	return &handoffService{repo: repo}
}

func (s *handoffService) List(limit int, status string, sessionID string) ([]domain.Handoff, error) {
	if s.repo == nil {
		return []domain.Handoff{}, nil
	}
	return s.repo.List(limit, status, sessionID)
}

func (s *handoffService) UpdateStatus(id, status string) error {
	if s.repo == nil {
		return nil
	}
	return s.repo.UpdateStatus(id, status)
}

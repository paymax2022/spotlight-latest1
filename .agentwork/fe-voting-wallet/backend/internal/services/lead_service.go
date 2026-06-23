package services

import (
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/repositories"
)

type LeadService interface {
	List(limit int, sessionID string) ([]domain.Lead, error)
	UpdateStatus(id, status string) error
}

type leadService struct {
	repo repositories.LeadRepository
}

func NewLeadService(repo repositories.LeadRepository) LeadService {
	return &leadService{repo: repo}
}

func (s *leadService) List(limit int, sessionID string) ([]domain.Lead, error) {
	if s.repo == nil {
		return []domain.Lead{}, nil
	}
	return s.repo.List(limit, sessionID)
}

func (s *leadService) UpdateStatus(id, status string) error {
	if s.repo == nil {
		return nil
	}
	return s.repo.UpdateStatus(id, status)
}

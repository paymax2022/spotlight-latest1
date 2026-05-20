package services

import (
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/repositories"
)

type CompetitionService interface {
	GetOverview() (domain.CompetitionOverview, error)
	ListOpenMic(limit int) ([]domain.OpenMicCompetition, error)
	CreateOpenMic(input domain.OpenMicCreateInput) (domain.OpenMicCompetition, error)
}

type competitionService struct {
	repo repositories.CompetitionRepository
}

func NewCompetitionService(repo repositories.CompetitionRepository) CompetitionService {
	return &competitionService{repo: repo}
}

func (s *competitionService) GetOverview() (domain.CompetitionOverview, error) {
	if s.repo == nil {
		return domain.CompetitionOverview{}, nil
	}
	return s.repo.GetOverview()
}

func (s *competitionService) ListOpenMic(limit int) ([]domain.OpenMicCompetition, error) {
	if s.repo == nil {
		return []domain.OpenMicCompetition{}, nil
	}
	return s.repo.ListOpenMic(limit)
}

func (s *competitionService) CreateOpenMic(input domain.OpenMicCreateInput) (domain.OpenMicCompetition, error) {
	if s.repo == nil {
		return domain.OpenMicCompetition{}, nil
	}
	return s.repo.CreateOpenMic(input)
}

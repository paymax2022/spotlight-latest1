package services

import (
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/repositories"
)

type RealityTVService interface {
	GetDashboardMetrics() (domain.RealityTVDashboardMetrics, error)
}

type realityTVService struct {
	repo repositories.RealityTVRepository
}

func NewRealityTVService(repo repositories.RealityTVRepository) RealityTVService {
	return &realityTVService{repo: repo}
}

func (s *realityTVService) GetDashboardMetrics() (domain.RealityTVDashboardMetrics, error) {
	if s.repo == nil {
		return domain.RealityTVDashboardMetrics{}, nil
	}
	return s.repo.GetDashboardMetrics()
}

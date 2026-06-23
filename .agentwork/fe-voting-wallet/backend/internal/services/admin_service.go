package services

import (
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/repositories"
)

type AdminService interface {
	GetMenuCounts() (domain.AdminMenuCounts, error)
}

type adminService struct {
	repo repositories.AdminRepository
}

func NewAdminService(repo repositories.AdminRepository) AdminService {
	return &adminService{repo: repo}
}

func (s *adminService) GetMenuCounts() (domain.AdminMenuCounts, error) {
	if s.repo == nil {
		return domain.AdminMenuCounts{}, nil
	}
	return s.repo.GetMenuCounts()
}

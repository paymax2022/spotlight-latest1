package repositories

import "spotlight/backend/internal/domain"

type AdminRepository interface {
	GetMenuCounts() (domain.AdminMenuCounts, error)
}

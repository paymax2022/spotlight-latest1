package repositories

import "spotlight/backend/internal/domain"

type RealityTVRepository interface {
	GetDashboardMetrics() (domain.RealityTVDashboardMetrics, error)
}

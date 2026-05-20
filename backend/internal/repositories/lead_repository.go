package repositories

import "spotlight/backend/internal/domain"

type LeadRepository interface {
	List(limit int, sessionID string) ([]domain.Lead, error)
	UpdateStatus(id, status string) error
}

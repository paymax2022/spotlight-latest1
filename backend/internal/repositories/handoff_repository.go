package repositories

import "spotlight/backend/internal/domain"

type HandoffRepository interface {
	List(limit int, status string, sessionID string) ([]domain.Handoff, error)
	UpdateStatus(id, status string) error
}

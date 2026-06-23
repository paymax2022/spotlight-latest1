package repositories

import "spotlight/backend/internal/domain"

type CompetitionRepository interface {
	GetOverview() (domain.CompetitionOverview, error)
	ListOpenMic(limit int) ([]domain.OpenMicCompetition, error)
	CreateOpenMic(input domain.OpenMicCreateInput) (domain.OpenMicCompetition, error)
}

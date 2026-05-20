package repositories

import (
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

type AdminSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewAdminSupabaseRepository(client *integrations.SupabaseRestClient) *AdminSupabaseRepository {
	return &AdminSupabaseRepository{client: client}
}

func (r *AdminSupabaseRepository) GetMenuCounts() (domain.AdminMenuCounts, error) {
	counts := domain.AdminMenuCounts{}
	if r.client == nil || !r.client.Enabled() {
		return counts, nil
	}

	var err error
	if counts.Contestants, err = r.client.Count("contestants"); err != nil {
		return domain.AdminMenuCounts{}, err
	}
	if counts.Auditions, err = r.client.Count("audition_registrations"); err != nil {
		return domain.AdminMenuCounts{}, err
	}
	if counts.Academy, err = r.client.Count("academy_applications"); err != nil {
		return domain.AdminMenuCounts{}, err
	}
	if counts.RealityTV, err = r.client.Count("reality_tv_applications"); err != nil {
		return domain.AdminMenuCounts{}, err
	}
	if counts.SMEPitch, err = r.client.Count("sme_pitch_applications"); err != nil {
		return domain.AdminMenuCounts{}, err
	}
	if counts.Stem, err = r.client.Count("stem_applications_v2"); err != nil {
		return domain.AdminMenuCounts{}, err
	}
	if counts.Bootcamp, err = r.client.Count("bootcamp_applications"); err != nil {
		return domain.AdminMenuCounts{}, err
	}
	if counts.OpenMic, err = r.client.Count("competition_enrollments"); err != nil {
		return domain.AdminMenuCounts{}, err
	}

	return counts, nil
}

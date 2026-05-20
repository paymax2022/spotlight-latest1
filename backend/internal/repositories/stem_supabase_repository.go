package repositories

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

type StemSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewStemSupabaseRepository(client *integrations.SupabaseRestClient) *StemSupabaseRepository {
	return &StemSupabaseRepository{client: client}
}

func (r *StemSupabaseRepository) GetOverview() (domain.StemOverview, error) {
	out := domain.StemOverview{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}

	var err error
	if out.TotalApplications, err = r.client.Count("stem_applications_v2"); err != nil {
		out.TotalApplications = 0
	}
	if out.SubmittedApplications, err = r.client.Count("stem_applications_v2?status=eq.submitted"); err != nil {
		out.SubmittedApplications = 0
	}
	if out.UnderReviewApplications, err = r.client.Count("stem_applications_v2?status=eq.under_review"); err != nil {
		out.UnderReviewApplications = 0
	}
	if out.ShortlistedApplications, err = r.client.Count("stem_applications_v2?status=eq.shortlisted"); err != nil {
		out.ShortlistedApplications = 0
	}
	if out.SchoolChannelApplicants, err = r.client.Count("stem_applications_v2?entry_route=eq.school"); err != nil {
		out.SchoolChannelApplicants = 0
	}
	if out.EmergingApplicants, err = r.client.Count("stem_applications_v2?entry_route=eq.open"); err != nil {
		out.EmergingApplicants = 0
	}

	return out, nil
}

func (r *StemSupabaseRepository) ListSchools(limit int) ([]domain.StemSchool, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemSchool{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}

	if schools, err := r.listSchoolsFromDedicatedTable(limit); err == nil && len(schools) > 0 {
		return schools, nil
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_applications_v2")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "status,school_info")
	q.Set("entry_route", "eq.school")
	q.Set("order", "created_at.desc")
	q.Set("limit", "1500")
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	httpClient := &http.Client{Timeout: 12 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("stem school query failed: %d", resp.StatusCode)
	}

	var rows []struct {
		Status     string         `json:"status"`
		SchoolInfo map[string]any `json:"school_info"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}

	aggregate := map[string]*domain.StemSchool{}
	for _, row := range rows {
		name := readSchoolField(row.SchoolInfo, "schoolName")
		if name == "" {
			name = readSchoolField(row.SchoolInfo, "name")
		}
		if name == "" {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(name))
		if _, ok := aggregate[key]; !ok {
			aggregate[key] = &domain.StemSchool{
				Name:               name,
				State:              readSchoolField(row.SchoolInfo, "state"),
				Applications:       0,
				SubmittedCount:     0,
				UnderReviewCount:   0,
				ShortlistedCount:   0,
				VerificationStatus: fallback(readSchoolField(row.SchoolInfo, "verificationStatus"), "PENDING"),
			}
		}
		item := aggregate[key]
		item.Applications++
		switch strings.ToLower(strings.TrimSpace(row.Status)) {
		case "submitted":
			item.SubmittedCount++
		case "under_review":
			item.UnderReviewCount++
		case "shortlisted":
			item.ShortlistedCount++
		}
	}

	out := make([]domain.StemSchool, 0, len(aggregate))
	for _, item := range aggregate {
		out = append(out, *item)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Applications == out[j].Applications {
			return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
		}
		return out[i].Applications > out[j].Applications
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateSchool(input domain.StemSchoolCreateInput) (domain.StemSchool, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemSchool{}, fmt.Errorf("supabase REST is not configured")
	}
	schoolName := strings.TrimSpace(input.SchoolName)
	if schoolName == "" {
		return domain.StemSchool{}, fmt.Errorf("school name is required")
	}

	payload := map[string]any{
		"school_name":                schoolName,
		"school_type":                strings.TrimSpace(input.SchoolType),
		"ownership_type":             strings.TrimSpace(input.OwnershipType),
		"education_level":            strings.TrimSpace(input.EducationLevel),
		"country":                    fallback(strings.TrimSpace(input.Country), "Nigeria"),
		"state":                      strings.TrimSpace(input.State),
		"lga_city":                   strings.TrimSpace(input.LGACity),
		"address":                    strings.TrimSpace(input.Address),
		"official_email":             strings.TrimSpace(strings.ToLower(input.OfficialEmail)),
		"official_phone":             strings.TrimSpace(input.OfficialPhone),
		"website":                    strings.TrimSpace(input.Website),
		"principal_name":             strings.TrimSpace(input.PrincipalName),
		"school_admin_name":          strings.TrimSpace(input.SchoolAdminName),
		"school_admin_email":         strings.TrimSpace(strings.ToLower(input.SchoolAdminEmail)),
		"school_admin_phone":         strings.TrimSpace(input.SchoolAdminPhone),
		"number_of_students":         maxInt(input.NumberOfStudents, 0),
		"has_stem_club":              input.HasStemClub,
		"has_stem_teacher":           input.HasStemTeacher,
		"school_logo_url":            strings.TrimSpace(input.SchoolLogoURL),
		"registration_document_url":  strings.TrimSpace(input.RegistrationDocumentURL),
		"accreditation_document_url": strings.TrimSpace(input.AccreditationDocumentURL),
		"social_links":               input.SocialLinks,
		"preferred_contest_category": strings.TrimSpace(input.PreferredContestCategory),
		"verification_status":        "PENDING",
		"submitted_by":               emptyToNilStem(strings.TrimSpace(input.SubmittedBy)),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemSchool{}, err
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_schools")
	if err != nil {
		return domain.StemSchool{}, err
	}
	q := u.Query()
	q.Set("select", "id,school_name,state,verification_status")
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemSchool{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	resp, err := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	if err != nil {
		return domain.StemSchool{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemSchool{}, fmt.Errorf("school create failed: %d", resp.StatusCode)
	}

	var rows []struct {
		ID                 string `json:"id"`
		SchoolName         string `json:"school_name"`
		State              string `json:"state"`
		VerificationStatus string `json:"verification_status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemSchool{}, err
	}
	if len(rows) == 0 {
		return domain.StemSchool{}, fmt.Errorf("school create failed: empty response")
	}
	return domain.StemSchool{
		ID:                 rows[0].ID,
		Name:               rows[0].SchoolName,
		State:              rows[0].State,
		VerificationStatus: fallback(rows[0].VerificationStatus, "PENDING"),
	}, nil
}

func (r *StemSupabaseRepository) UpdateSchoolVerification(schoolID string, status string, reason string, actorID string) error {
	if r.client == nil || !r.client.Enabled() {
		return nil
	}
	if strings.TrimSpace(schoolID) == "" || strings.TrimSpace(status) == "" {
		return fmt.Errorf("school id and status are required")
	}

	// Read previous state for audit trail row.
	currentURL, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_schools")
	if err != nil {
		return err
	}
	currentQ := currentURL.Query()
	currentQ.Set("select", "verification_status")
	currentQ.Set("id", "eq."+schoolID)
	currentQ.Set("limit", "1")
	currentURL.RawQuery = currentQ.Encode()

	currentReq, err := http.NewRequest(http.MethodGet, currentURL.String(), nil)
	if err != nil {
		return err
	}
	currentReq.Header.Set("apikey", r.client.APIKey())
	currentReq.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	currentResp, err := (&http.Client{Timeout: 10 * time.Second}).Do(currentReq)
	if err != nil {
		return err
	}
	defer currentResp.Body.Close()

	prevStatus := ""
	if currentResp.StatusCode < 400 {
		var rows []struct {
			VerificationStatus string `json:"verification_status"`
		}
		if err := json.NewDecoder(currentResp.Body).Decode(&rows); err == nil && len(rows) > 0 {
			prevStatus = rows[0].VerificationStatus
		}
	}

	updatePayload := map[string]any{
		"verification_status": strings.ToUpper(strings.TrimSpace(status)),
		"verification_notes":  strings.TrimSpace(reason),
		"reviewed_by":         emptyToNilStem(strings.TrimSpace(actorID)),
		"reviewed_at":         time.Now().UTC().Format(time.RFC3339Nano),
	}
	updateBody, err := json.Marshal(updatePayload)
	if err != nil {
		return err
	}

	updateURL, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_schools")
	if err != nil {
		return err
	}
	updateQ := updateURL.Query()
	updateQ.Set("id", "eq."+schoolID)
	updateURL.RawQuery = updateQ.Encode()

	updateReq, err := http.NewRequest(http.MethodPatch, updateURL.String(), bytes.NewReader(updateBody))
	if err != nil {
		return err
	}
	updateReq.Header.Set("apikey", r.client.APIKey())
	updateReq.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq.Header.Set("Prefer", "return=minimal")

	updateResp, err := (&http.Client{Timeout: 10 * time.Second}).Do(updateReq)
	if err != nil {
		return err
	}
	defer updateResp.Body.Close()
	if updateResp.StatusCode >= 400 {
		return fmt.Errorf("school verification update failed: %d", updateResp.StatusCode)
	}

	verificationPayload := map[string]any{
		"school_id":       schoolID,
		"previous_status": emptyToNilStem(strings.TrimSpace(prevStatus)),
		"new_status":      strings.ToUpper(strings.TrimSpace(status)),
		"reason":          strings.TrimSpace(reason),
		"actor_id":        emptyToNilStem(strings.TrimSpace(actorID)),
	}
	verificationBody, err := json.Marshal(verificationPayload)
	if err != nil {
		return err
	}
	verificationURL := strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_school_verifications"
	verificationReq, err := http.NewRequest(http.MethodPost, verificationURL, bytes.NewReader(verificationBody))
	if err != nil {
		return err
	}
	verificationReq.Header.Set("apikey", r.client.APIKey())
	verificationReq.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	verificationReq.Header.Set("Content-Type", "application/json")
	verificationReq.Header.Set("Prefer", "return=minimal")

	verificationResp, err := (&http.Client{Timeout: 10 * time.Second}).Do(verificationReq)
	if err != nil {
		return err
	}
	defer verificationResp.Body.Close()
	if verificationResp.StatusCode >= 400 {
		return fmt.Errorf("school verification log failed: %d", verificationResp.StatusCode)
	}
	_ = r.logAdminAuditAction(
		"stem_school_verification_updated",
		"stem_schools",
		schoolID,
		map[string]any{
			"previous_status": prevStatus,
			"new_status":      strings.ToUpper(strings.TrimSpace(status)),
			"reason":          strings.TrimSpace(reason),
		},
		"STEM school verification status update",
		actorID,
	)
	return nil
}

func (r *StemSupabaseRepository) listSchoolsFromDedicatedTable(limit int) ([]domain.StemSchool, error) {
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_schools")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,school_name,state,verification_status")
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("stem schools table query failed: %d", resp.StatusCode)
	}

	var rows []struct {
		ID                 string `json:"id"`
		SchoolName         string `json:"school_name"`
		State              string `json:"state"`
		VerificationStatus string `json:"verification_status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}

	out := make([]domain.StemSchool, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemSchool{
			ID:                 row.ID,
			Name:               row.SchoolName,
			State:              row.State,
			VerificationStatus: fallback(row.VerificationStatus, "PENDING"),
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) ListEmergingInnovators(limit int) ([]domain.StemEmergingInnovator, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemEmergingInnovator{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_emerging_innovators")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,full_name,email,phone,state,current_status,innovation_track,team_name,prototype_available,verification_status")
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("stem emerging query failed: %d", resp.StatusCode)
	}

	var rows []struct {
		ID                 string `json:"id"`
		FullName           string `json:"full_name"`
		Email              string `json:"email"`
		Phone              string `json:"phone"`
		State              string `json:"state"`
		CurrentStatus      string `json:"current_status"`
		InnovationTrack    string `json:"innovation_track"`
		TeamName           string `json:"team_name"`
		PrototypeAvailable bool   `json:"prototype_available"`
		VerificationStatus string `json:"verification_status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}

	out := make([]domain.StemEmergingInnovator, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemEmergingInnovator{
			ID:                 row.ID,
			FullName:           row.FullName,
			Email:              row.Email,
			Phone:              row.Phone,
			State:              row.State,
			CurrentStatus:      row.CurrentStatus,
			InnovationTrack:    row.InnovationTrack,
			TeamName:           row.TeamName,
			PrototypeAvailable: row.PrototypeAvailable,
			VerificationStatus: fallback(row.VerificationStatus, "PENDING"),
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateEmergingInnovator(input domain.StemEmergingInnovatorCreateInput) (domain.StemEmergingInnovator, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemEmergingInnovator{}, fmt.Errorf("supabase REST is not configured")
	}
	fullName := strings.TrimSpace(input.FullName)
	email := strings.TrimSpace(strings.ToLower(input.Email))
	if fullName == "" || email == "" {
		return domain.StemEmergingInnovator{}, fmt.Errorf("full name and email are required")
	}

	payload := map[string]any{
		"full_name":            fullName,
		"email":                email,
		"phone":                strings.TrimSpace(input.Phone),
		"country":              fallback(strings.TrimSpace(input.Country), "Nigeria"),
		"state":                strings.TrimSpace(input.State),
		"lga_city":             strings.TrimSpace(input.LGACity),
		"education_background": strings.TrimSpace(input.EducationBackground),
		"current_status":       strings.TrimSpace(input.CurrentStatus),
		"stem_skill_area":      strings.TrimSpace(input.StemSkillArea),
		"innovation_track":     strings.TrimSpace(input.InnovationTrack),
		"portfolio_url":        strings.TrimSpace(input.PortfolioURL),
		"linkedin_url":         strings.TrimSpace(input.LinkedInURL),
		"github_url":           strings.TrimSpace(input.GitHubURL),
		"social_links":         input.SocialLinks,
		"business_name":        strings.TrimSpace(input.BusinessName),
		"team_name":            strings.TrimSpace(input.TeamName),
		"prototype_available":  input.PrototypeAvailable,
		"pitch_deck_url":       strings.TrimSpace(input.PitchDeckURL),
		"video_demo_url":       strings.TrimSpace(input.VideoDemoURL),
		"photo_url":            strings.TrimSpace(input.PhotoURL),
		"id_verification_url":  strings.TrimSpace(input.IDVerificationURL),
		"verification_status":  "PENDING",
		"submitted_by":         emptyToNilStem(strings.TrimSpace(input.SubmittedBy)),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemEmergingInnovator{}, err
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_emerging_innovators")
	if err != nil {
		return domain.StemEmergingInnovator{}, err
	}
	q := u.Query()
	q.Set("select", "id,full_name,email,phone,state,current_status,innovation_track,team_name,prototype_available,verification_status")
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemEmergingInnovator{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	resp, err := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	if err != nil {
		return domain.StemEmergingInnovator{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemEmergingInnovator{}, fmt.Errorf("emerging innovator create failed: %d", resp.StatusCode)
	}

	var rows []struct {
		ID                 string `json:"id"`
		FullName           string `json:"full_name"`
		Email              string `json:"email"`
		Phone              string `json:"phone"`
		State              string `json:"state"`
		CurrentStatus      string `json:"current_status"`
		InnovationTrack    string `json:"innovation_track"`
		TeamName           string `json:"team_name"`
		PrototypeAvailable bool   `json:"prototype_available"`
		VerificationStatus string `json:"verification_status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemEmergingInnovator{}, err
	}
	if len(rows) == 0 {
		return domain.StemEmergingInnovator{}, fmt.Errorf("emerging innovator create failed: empty response")
	}
	return domain.StemEmergingInnovator{
		ID:                 rows[0].ID,
		FullName:           rows[0].FullName,
		Email:              rows[0].Email,
		Phone:              rows[0].Phone,
		State:              rows[0].State,
		CurrentStatus:      rows[0].CurrentStatus,
		InnovationTrack:    rows[0].InnovationTrack,
		TeamName:           rows[0].TeamName,
		PrototypeAvailable: rows[0].PrototypeAvailable,
		VerificationStatus: fallback(rows[0].VerificationStatus, "PENDING"),
	}, nil
}

func (r *StemSupabaseRepository) GetSchoolDashboard(schoolID string) (domain.StemSchoolDashboard, error) {
	out := domain.StemSchoolDashboard{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}
	schoolID = strings.TrimSpace(schoolID)
	if schoolID == "" {
		return out, fmt.Errorf("school id is required")
	}

	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_schools")
	if err != nil {
		return out, err
	}
	q := u.Query()
	q.Set("select", "id,school_name,verification_status")
	q.Set("id", "eq."+schoolID)
	q.Set("limit", "1")
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("school dashboard query failed: %d", resp.StatusCode)
	}

	var schools []struct {
		ID                 string `json:"id"`
		SchoolName         string `json:"school_name"`
		VerificationStatus string `json:"verification_status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&schools); err != nil {
		return out, err
	}
	if len(schools) == 0 {
		return out, fmt.Errorf("school not found")
	}
	out.SchoolID = schools[0].ID
	out.SchoolName = schools[0].SchoolName
	out.VerificationStatus = fallback(schools[0].VerificationStatus, "PENDING")
	if strings.EqualFold(out.VerificationStatus, "PENDING") || strings.EqualFold(out.VerificationStatus, "UNDER_REVIEW") {
		out.PendingVerifications = 1
	}

	// Derived counts from existing v2 submissions payload while we build dedicated relational links.
	appURL, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_applications_v2")
	if err != nil {
		return out, err
	}
	appQ := appURL.Query()
	appQ.Set("select", "id,status,project_solution,team_info")
	appQ.Set("entry_route", "eq.school")
	appQ.Set("school_info->>schoolName", "ilike."+url.QueryEscape(out.SchoolName))
	appQ.Set("limit", "1500")
	appURL.RawQuery = appQ.Encode()

	appReq, err := http.NewRequest(http.MethodGet, appURL.String(), nil)
	if err != nil {
		return out, err
	}
	appReq.Header.Set("apikey", r.client.APIKey())
	appReq.Header.Set("Authorization", "Bearer "+r.client.APIKey())

	appResp, err := (&http.Client{Timeout: 10 * time.Second}).Do(appReq)
	if err == nil {
		defer appResp.Body.Close()
		if appResp.StatusCode < 400 {
			var apps []struct {
				Status          string         `json:"status"`
				TeamInfo        map[string]any `json:"team_info"`
				ProjectSolution map[string]any `json:"project_solution"`
			}
			if json.NewDecoder(appResp.Body).Decode(&apps) == nil {
				out.TotalSubmissions = len(apps)
				teamSet := map[string]struct{}{}
				projectSet := map[string]struct{}{}
				for _, a := range apps {
					teamName := readSchoolField(a.TeamInfo, "teamName")
					if teamName != "" {
						teamSet[strings.ToLower(teamName)] = struct{}{}
					}
					projectTitle := readSchoolField(a.ProjectSolution, "projectTitle")
					if projectTitle != "" {
						projectSet[strings.ToLower(projectTitle)] = struct{}{}
					}
				}
				out.TotalTeams = len(teamSet)
				out.TotalProjects = len(projectSet)
			}
		}
	}
	return out, nil
}

func (r *StemSupabaseRepository) ListSchoolProfiles(limit int) ([]domain.StemSchoolProfile, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemSchoolProfile{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_school_profiles")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,school_id,user_id,role_type,full_name,email,phone,grade_level,specialization,status")
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("school profiles query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID             string `json:"id"`
		SchoolID       string `json:"school_id"`
		UserID         string `json:"user_id"`
		RoleType       string `json:"role_type"`
		FullName       string `json:"full_name"`
		Email          string `json:"email"`
		Phone          string `json:"phone"`
		GradeLevel     string `json:"grade_level"`
		Specialization string `json:"specialization"`
		Status         string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemSchoolProfile, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemSchoolProfile{
			ID: row.ID, SchoolID: row.SchoolID, UserID: row.UserID, RoleType: row.RoleType, FullName: row.FullName,
			Email: row.Email, Phone: row.Phone, GradeLevel: row.GradeLevel, Specialization: row.Specialization, Status: row.Status,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateSchoolProfile(input domain.StemSchoolProfileCreateInput) (domain.StemSchoolProfile, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemSchoolProfile{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"school_id":      strings.TrimSpace(input.SchoolID),
		"user_id":        emptyToNilStem(strings.TrimSpace(input.UserID)),
		"role_type":      strings.TrimSpace(strings.ToUpper(input.RoleType)),
		"full_name":      strings.TrimSpace(input.FullName),
		"email":          strings.TrimSpace(strings.ToLower(input.Email)),
		"phone":          strings.TrimSpace(input.Phone),
		"grade_level":    strings.TrimSpace(input.GradeLevel),
		"specialization": strings.TrimSpace(input.Specialization),
		"status":         "ACTIVE",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemSchoolProfile{}, err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_school_profiles")
	if err != nil {
		return domain.StemSchoolProfile{}, err
	}
	q := u.Query()
	q.Set("select", "id,school_id,user_id,role_type,full_name,email,phone,grade_level,specialization,status")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemSchoolProfile{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemSchoolProfile{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemSchoolProfile{}, fmt.Errorf("create school profile failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID             string `json:"id"`
		SchoolID       string `json:"school_id"`
		UserID         string `json:"user_id"`
		RoleType       string `json:"role_type"`
		FullName       string `json:"full_name"`
		Email          string `json:"email"`
		Phone          string `json:"phone"`
		GradeLevel     string `json:"grade_level"`
		Specialization string `json:"specialization"`
		Status         string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemSchoolProfile{}, err
	}
	if len(rows) == 0 {
		return domain.StemSchoolProfile{}, fmt.Errorf("create school profile failed: empty response")
	}
	return domain.StemSchoolProfile{
		ID: rows[0].ID, SchoolID: rows[0].SchoolID, UserID: rows[0].UserID, RoleType: rows[0].RoleType, FullName: rows[0].FullName,
		Email: rows[0].Email, Phone: rows[0].Phone, GradeLevel: rows[0].GradeLevel, Specialization: rows[0].Specialization, Status: rows[0].Status,
	}, nil
}

func (r *StemSupabaseRepository) ListSchoolTeams(limit int) ([]domain.StemSchoolTeam, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemSchoolTeam{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_school_teams")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,school_id,team_name,contest_category,coach_name,project_title,team_size")
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("school teams query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID              string `json:"id"`
		SchoolID        string `json:"school_id"`
		TeamName        string `json:"team_name"`
		ContestCategory string `json:"contest_category"`
		CoachName       string `json:"coach_name"`
		ProjectTitle    string `json:"project_title"`
		TeamSize        int    `json:"team_size"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemSchoolTeam, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemSchoolTeam{
			ID: row.ID, SchoolID: row.SchoolID, TeamName: row.TeamName, ContestCategory: row.ContestCategory,
			CoachName: row.CoachName, ProjectTitle: row.ProjectTitle, TeamSize: row.TeamSize,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateSchoolTeam(input domain.StemSchoolTeamCreateInput) (domain.StemSchoolTeam, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemSchoolTeam{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"school_id":        strings.TrimSpace(input.SchoolID),
		"team_name":        strings.TrimSpace(input.TeamName),
		"contest_category": strings.TrimSpace(input.ContestCategory),
		"coach_name":       strings.TrimSpace(input.CoachName),
		"project_title":    strings.TrimSpace(input.ProjectTitle),
		"team_size":        maxInt(input.TeamSize, 1),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemSchoolTeam{}, err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_school_teams")
	if err != nil {
		return domain.StemSchoolTeam{}, err
	}
	q := u.Query()
	q.Set("select", "id,school_id,team_name,contest_category,coach_name,project_title,team_size")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemSchoolTeam{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemSchoolTeam{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemSchoolTeam{}, fmt.Errorf("create school team failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID              string `json:"id"`
		SchoolID        string `json:"school_id"`
		TeamName        string `json:"team_name"`
		ContestCategory string `json:"contest_category"`
		CoachName       string `json:"coach_name"`
		ProjectTitle    string `json:"project_title"`
		TeamSize        int    `json:"team_size"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemSchoolTeam{}, err
	}
	if len(rows) == 0 {
		return domain.StemSchoolTeam{}, fmt.Errorf("create school team failed: empty response")
	}
	return domain.StemSchoolTeam{
		ID: rows[0].ID, SchoolID: rows[0].SchoolID, TeamName: rows[0].TeamName, ContestCategory: rows[0].ContestCategory,
		CoachName: rows[0].CoachName, ProjectTitle: rows[0].ProjectTitle, TeamSize: rows[0].TeamSize,
	}, nil
}

func (r *StemSupabaseRepository) ListEmergingTeams(limit int) ([]domain.StemEmergingTeam, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemEmergingTeam{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_emerging_teams")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,innovator_id,team_name,innovation_track,team_size")
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("emerging teams query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID              string `json:"id"`
		InnovatorID     string `json:"innovator_id"`
		TeamName        string `json:"team_name"`
		InnovationTrack string `json:"innovation_track"`
		TeamSize        int    `json:"team_size"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemEmergingTeam, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemEmergingTeam{
			ID: row.ID, InnovatorID: row.InnovatorID, TeamName: row.TeamName,
			InnovationTrack: row.InnovationTrack, TeamSize: row.TeamSize,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateEmergingTeam(input domain.StemEmergingTeamCreateInput) (domain.StemEmergingTeam, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemEmergingTeam{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"innovator_id":     strings.TrimSpace(input.InnovatorID),
		"team_name":        strings.TrimSpace(input.TeamName),
		"innovation_track": strings.TrimSpace(input.InnovationTrack),
		"team_size":        maxInt(input.TeamSize, 1),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemEmergingTeam{}, err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_emerging_teams")
	if err != nil {
		return domain.StemEmergingTeam{}, err
	}
	q := u.Query()
	q.Set("select", "id,innovator_id,team_name,innovation_track,team_size")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemEmergingTeam{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemEmergingTeam{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemEmergingTeam{}, fmt.Errorf("create emerging team failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID              string `json:"id"`
		InnovatorID     string `json:"innovator_id"`
		TeamName        string `json:"team_name"`
		InnovationTrack string `json:"innovation_track"`
		TeamSize        int    `json:"team_size"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemEmergingTeam{}, err
	}
	if len(rows) == 0 {
		return domain.StemEmergingTeam{}, fmt.Errorf("create emerging team failed: empty response")
	}
	return domain.StemEmergingTeam{
		ID: rows[0].ID, InnovatorID: rows[0].InnovatorID, TeamName: rows[0].TeamName,
		InnovationTrack: rows[0].InnovationTrack, TeamSize: rows[0].TeamSize,
	}, nil
}

func (r *StemSupabaseRepository) ListEmergingProjects(limit int) ([]domain.StemEmergingProject, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemEmergingProject{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_emerging_projects")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,team_id,project_title,category,status")
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("emerging projects query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID           string `json:"id"`
		TeamID       string `json:"team_id"`
		ProjectTitle string `json:"project_title"`
		Category     string `json:"category"`
		Status       string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemEmergingProject, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemEmergingProject{
			ID: row.ID, TeamID: row.TeamID, ProjectTitle: row.ProjectTitle, Category: row.Category, Status: row.Status,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateEmergingProject(input domain.StemEmergingProjectCreateInput) (domain.StemEmergingProject, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemEmergingProject{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"team_id":           strings.TrimSpace(input.TeamID),
		"project_title":     strings.TrimSpace(input.ProjectTitle),
		"category":          strings.TrimSpace(input.Category),
		"problem_statement": strings.TrimSpace(input.ProblemStatement),
		"proposed_solution": strings.TrimSpace(input.ProposedSolution),
		"status":            "DRAFT",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemEmergingProject{}, err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_emerging_projects")
	if err != nil {
		return domain.StemEmergingProject{}, err
	}
	q := u.Query()
	q.Set("select", "id,team_id,project_title,category,status")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemEmergingProject{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemEmergingProject{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemEmergingProject{}, fmt.Errorf("create emerging project failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID           string `json:"id"`
		TeamID       string `json:"team_id"`
		ProjectTitle string `json:"project_title"`
		Category     string `json:"category"`
		Status       string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemEmergingProject{}, err
	}
	if len(rows) == 0 {
		return domain.StemEmergingProject{}, fmt.Errorf("create emerging project failed: empty response")
	}
	return domain.StemEmergingProject{
		ID: rows[0].ID, TeamID: rows[0].TeamID, ProjectTitle: rows[0].ProjectTitle, Category: rows[0].Category, Status: rows[0].Status,
	}, nil
}

func (r *StemSupabaseRepository) ListContests(limit int) ([]domain.StemContest, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemContest{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_contests")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,name,slug,contest_type,contest_mode,eligible_participant_types,eligible_school_levels,eligible_states,allow_mixed_channels,ranking_formula,stage_lifecycle,stage_transitions,status")
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("stem contests query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID                       string              `json:"id"`
		Name                     string              `json:"name"`
		Slug                     string              `json:"slug"`
		ContestType              string              `json:"contest_type"`
		ContestMode              string              `json:"contest_mode"`
		EligibleParticipantTypes []string            `json:"eligible_participant_types"`
		EligibleSchoolLevels     []string            `json:"eligible_school_levels"`
		EligibleStates           []string            `json:"eligible_states"`
		AllowMixedChannels       bool                `json:"allow_mixed_channels"`
		RankingFormula           string              `json:"ranking_formula"`
		StageLifecycle           []string            `json:"stage_lifecycle"`
		StageTransitions         map[string][]string `json:"stage_transitions"`
		Status                   string              `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemContest, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemContest{
			ID: row.ID, Name: row.Name, Slug: row.Slug, ContestType: row.ContestType, ContestMode: row.ContestMode,
			EligibleParticipantTypes: row.EligibleParticipantTypes, EligibleSchoolLevels: row.EligibleSchoolLevels, EligibleStates: row.EligibleStates,
			AllowMixedChannels: row.AllowMixedChannels, RankingFormula: row.RankingFormula,
			StageLifecycle: row.StageLifecycle, StageTransitions: row.StageTransitions, Status: row.Status,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateContest(input domain.StemContestCreateInput) (domain.StemContest, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemContest{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"name":                       strings.TrimSpace(input.Name),
		"slug":                       strings.TrimSpace(strings.ToLower(input.Slug)),
		"contest_type":               strings.TrimSpace(input.ContestType),
		"contest_mode":               strings.TrimSpace(input.ContestMode),
		"eligible_participant_types": input.EligibleParticipantTypes,
		"eligible_school_levels":     input.EligibleSchoolLevels,
		"eligible_states":            input.EligibleStates,
		"allow_mixed_channels":       input.AllowMixedChannels,
		"ranking_formula":            strings.TrimSpace(input.RankingFormula),
		"stage_lifecycle":            input.StageLifecycle,
		"stage_transitions":          input.StageTransitions,
		"status":                     fallback(strings.TrimSpace(input.Status), "DRAFT"),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemContest{}, err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_contests")
	if err != nil {
		return domain.StemContest{}, err
	}
	q := u.Query()
	q.Set("select", "id,name,slug,contest_type,contest_mode,eligible_participant_types,eligible_school_levels,eligible_states,allow_mixed_channels,ranking_formula,stage_lifecycle,stage_transitions,status")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemContest{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemContest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemContest{}, fmt.Errorf("create stem contest failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID                       string              `json:"id"`
		Name                     string              `json:"name"`
		Slug                     string              `json:"slug"`
		ContestType              string              `json:"contest_type"`
		ContestMode              string              `json:"contest_mode"`
		EligibleParticipantTypes []string            `json:"eligible_participant_types"`
		EligibleSchoolLevels     []string            `json:"eligible_school_levels"`
		EligibleStates           []string            `json:"eligible_states"`
		AllowMixedChannels       bool                `json:"allow_mixed_channels"`
		RankingFormula           string              `json:"ranking_formula"`
		StageLifecycle           []string            `json:"stage_lifecycle"`
		StageTransitions         map[string][]string `json:"stage_transitions"`
		Status                   string              `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemContest{}, err
	}
	if len(rows) == 0 {
		return domain.StemContest{}, fmt.Errorf("create stem contest failed: empty response")
	}
	created := domain.StemContest{
		ID: rows[0].ID, Name: rows[0].Name, Slug: rows[0].Slug, ContestType: rows[0].ContestType, ContestMode: rows[0].ContestMode,
		EligibleParticipantTypes: rows[0].EligibleParticipantTypes, EligibleSchoolLevels: rows[0].EligibleSchoolLevels, EligibleStates: rows[0].EligibleStates,
		AllowMixedChannels: rows[0].AllowMixedChannels, RankingFormula: rows[0].RankingFormula,
		StageLifecycle: rows[0].StageLifecycle, StageTransitions: rows[0].StageTransitions, Status: rows[0].Status,
	}
	_ = r.logAdminAuditAction(
		"stem_contest_created",
		"stem_contests",
		created.ID,
		map[string]any{
			"name":         created.Name,
			"slug":         created.Slug,
			"contest_type": created.ContestType,
			"contest_mode": created.ContestMode,
			"status":       created.Status,
		},
		"STEM contest created",
		"",
	)
	return created, nil
}

func (r *StemSupabaseRepository) GetContestByID(contestID string) (domain.StemContest, error) {
	out := domain.StemContest{}
	if r.client == nil || !r.client.Enabled() {
		return out, fmt.Errorf("supabase REST is not configured")
	}
	contestID = strings.TrimSpace(contestID)
	if contestID == "" {
		return out, fmt.Errorf("contest id required")
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_contests")
	if err != nil {
		return out, err
	}
	q := u.Query()
	q.Set("select", "id,name,slug,contest_type,contest_mode,eligible_participant_types,eligible_school_levels,eligible_states,allow_mixed_channels,ranking_formula,stage_lifecycle,stage_transitions,status")
	q.Set("id", "eq."+contestID)
	q.Set("limit", "1")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("stem contest lookup failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID                       string              `json:"id"`
		Name                     string              `json:"name"`
		Slug                     string              `json:"slug"`
		ContestType              string              `json:"contest_type"`
		ContestMode              string              `json:"contest_mode"`
		EligibleParticipantTypes []string            `json:"eligible_participant_types"`
		EligibleSchoolLevels     []string            `json:"eligible_school_levels"`
		EligibleStates           []string            `json:"eligible_states"`
		AllowMixedChannels       bool                `json:"allow_mixed_channels"`
		RankingFormula           string              `json:"ranking_formula"`
		StageLifecycle           []string            `json:"stage_lifecycle"`
		StageTransitions         map[string][]string `json:"stage_transitions"`
		Status                   string              `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return out, err
	}
	if len(rows) == 0 {
		return out, fmt.Errorf("contest not found")
	}
	return domain.StemContest{
		ID: rows[0].ID, Name: rows[0].Name, Slug: rows[0].Slug, ContestType: rows[0].ContestType, ContestMode: rows[0].ContestMode,
		EligibleParticipantTypes: rows[0].EligibleParticipantTypes, EligibleSchoolLevels: rows[0].EligibleSchoolLevels, EligibleStates: rows[0].EligibleStates,
		AllowMixedChannels: rows[0].AllowMixedChannels, RankingFormula: rows[0].RankingFormula,
		StageLifecycle: rows[0].StageLifecycle, StageTransitions: rows[0].StageTransitions, Status: rows[0].Status,
	}, nil
}

func (r *StemSupabaseRepository) ListLeaderboard(contestID string, limit int) ([]domain.StemLeaderboardEntry, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemLeaderboardEntry{}, nil
	}
	if strings.TrimSpace(contestID) == "" {
		return nil, fmt.Errorf("contest id is required")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_leaderboard_entries")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,contest_id,participant_id,participant_type,display_name,judge_score,vote_score,stage_score,final_score,rank_position")
	q.Set("contest_id", "eq."+strings.TrimSpace(contestID))
	q.Set("order", "rank_position.asc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("stem leaderboard query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID              string  `json:"id"`
		ContestID       string  `json:"contest_id"`
		ParticipantID   string  `json:"participant_id"`
		ParticipantType string  `json:"participant_type"`
		DisplayName     string  `json:"display_name"`
		JudgeScore      float64 `json:"judge_score"`
		VoteScore       float64 `json:"vote_score"`
		StageScore      float64 `json:"stage_score"`
		FinalScore      float64 `json:"final_score"`
		RankPosition    int     `json:"rank_position"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemLeaderboardEntry, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemLeaderboardEntry{
			ID: row.ID, ContestID: row.ContestID, ParticipantID: row.ParticipantID, ParticipantType: row.ParticipantType, DisplayName: row.DisplayName,
			JudgeScore: row.JudgeScore, VoteScore: row.VoteScore, StageScore: row.StageScore, FinalScore: row.FinalScore, RankPosition: row.RankPosition,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) ListLeaderboardSlices(contestID string, by string, limit int) ([]domain.StemLeaderboardSlice, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemLeaderboardSlice{}, nil
	}
	entries, err := r.ListLeaderboard(contestID, limit)
	if err != nil {
		return nil, err
	}
	groupBy := strings.ToLower(strings.TrimSpace(by))
	if groupBy == "" {
		groupBy = "participant_type"
	}
	type agg struct {
		count int
		sum   float64
	}
	store := map[string]agg{}
	for _, e := range entries {
		key := e.ParticipantType
		if groupBy == "state" {
			// state-level slices are approximated from displayName suffix while dedicated geo fields are being finalized.
			parts := strings.Split(e.DisplayName, " - ")
			if len(parts) > 1 {
				key = strings.TrimSpace(parts[len(parts)-1])
			} else {
				key = "UNKNOWN"
			}
		}
		cur := store[key]
		cur.count++
		cur.sum += e.FinalScore
		store[key] = cur
	}
	out := make([]domain.StemLeaderboardSlice, 0, len(store))
	for k, v := range store {
		avg := 0.0
		if v.count > 0 {
			avg = v.sum / float64(v.count)
		}
		out = append(out, domain.StemLeaderboardSlice{GroupKey: k, Count: v.count, AvgScore: avg})
	}
	return out, nil
}

func (r *StemSupabaseRepository) ListSubmissions(limit int, status string) ([]domain.StemSubmission, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemSubmission{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_applications_v2")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,status,review_stage,entry_route,challenge_type,category_track,completion_percent")
	if strings.TrimSpace(status) != "" {
		q.Set("status", "eq."+strings.TrimSpace(status))
	}
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("stem submissions query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID                string `json:"id"`
		Status            string `json:"status"`
		ReviewStage       string `json:"review_stage"`
		EntryRoute        string `json:"entry_route"`
		ChallengeType     string `json:"challenge_type"`
		CategoryTrack     string `json:"category_track"`
		CompletionPercent int    `json:"completion_percent"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemSubmission, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemSubmission{
			ID: row.ID, Status: row.Status, ReviewStage: row.ReviewStage, EntryRoute: row.EntryRoute,
			ChallengeType: row.ChallengeType, CategoryTrack: row.CategoryTrack, CompletionPercent: row.CompletionPercent,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) UpdateSubmissionStatus(submissionID string, status string, reviewStage string) error {
	if r.client == nil || !r.client.Enabled() {
		return nil
	}
	submissionID = strings.TrimSpace(submissionID)
	if submissionID == "" {
		return fmt.Errorf("submission id required")
	}
	payload := map[string]any{
		"status": strings.TrimSpace(status),
	}
	if strings.TrimSpace(reviewStage) != "" {
		payload["review_stage"] = strings.TrimSpace(reviewStage)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_applications_v2")
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("id", "eq."+submissionID)
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPatch, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("submission status update failed: %d", resp.StatusCode)
	}
	_ = r.logAdminAuditAction(
		"stem_submission_status_updated",
		"stem_applications_v2",
		submissionID,
		map[string]any{
			"status":       strings.TrimSpace(status),
			"review_stage": strings.TrimSpace(reviewStage),
		},
		"STEM submission status update",
		"",
	)
	return nil
}

func (r *StemSupabaseRepository) UpsertJudgingScore(score domain.StemJudgingScore) (domain.StemJudgingScore, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemJudgingScore{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"application_id":        strings.TrimSpace(score.ApplicationID),
		"reviewer_id":           emptyToNilStem(strings.TrimSpace(score.ReviewerID)),
		"innovation_score":      score.InnovationScore,
		"technical_depth_score": score.TechnicalDepthScore,
		"impact_score":          score.ImpactScore,
		"overall_score":         score.OverallScore,
		"notes":                 strings.TrimSpace(score.Notes),
		"review_status":         fallback(strings.TrimSpace(score.ReviewStatus), "submitted"),
		"is_locked":             score.IsLocked,
		"lock_reason":           emptyToNilStem(strings.TrimSpace(score.LockReason)),
		"locked_by":             emptyToNilStem(strings.TrimSpace(score.LockedBy)),
		"has_conflict":          score.HasConflict,
		"conflict_reason":       emptyToNilStem(strings.TrimSpace(score.ConflictReason)),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemJudgingScore{}, err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_review_scores_v2")
	if err != nil {
		return domain.StemJudgingScore{}, err
	}
	q := u.Query()
	q.Set("select", "id,application_id,reviewer_id,innovation_score,technical_depth_score,impact_score,overall_score,notes,review_status,is_locked,lock_reason,locked_at,locked_by,has_conflict,conflict_reason")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemJudgingScore{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemJudgingScore{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemJudgingScore{}, fmt.Errorf("judging score create failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID                  string  `json:"id"`
		ApplicationID       string  `json:"application_id"`
		ReviewerID          string  `json:"reviewer_id"`
		InnovationScore     float64 `json:"innovation_score"`
		TechnicalDepthScore float64 `json:"technical_depth_score"`
		ImpactScore         float64 `json:"impact_score"`
		OverallScore        float64 `json:"overall_score"`
		Notes               string  `json:"notes"`
		ReviewStatus        string  `json:"review_status"`
		IsLocked            bool    `json:"is_locked"`
		LockReason          string  `json:"lock_reason"`
		LockedAt            string  `json:"locked_at"`
		LockedBy            string  `json:"locked_by"`
		HasConflict         bool    `json:"has_conflict"`
		ConflictReason      string  `json:"conflict_reason"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemJudgingScore{}, err
	}
	if len(rows) == 0 {
		return domain.StemJudgingScore{}, fmt.Errorf("judging score create failed: empty response")
	}
	return domain.StemJudgingScore{
		ID: rows[0].ID, ApplicationID: rows[0].ApplicationID, ReviewerID: rows[0].ReviewerID, InnovationScore: rows[0].InnovationScore,
		TechnicalDepthScore: rows[0].TechnicalDepthScore, ImpactScore: rows[0].ImpactScore, OverallScore: rows[0].OverallScore, Notes: rows[0].Notes,
		ReviewStatus: rows[0].ReviewStatus, IsLocked: rows[0].IsLocked, LockReason: rows[0].LockReason, LockedAt: rows[0].LockedAt, LockedBy: rows[0].LockedBy,
		HasConflict: rows[0].HasConflict, ConflictReason: rows[0].ConflictReason,
	}, nil
}

func (r *StemSupabaseRepository) ListJudgingScores(applicationID string, limit int) ([]domain.StemJudgingScore, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemJudgingScore{}, nil
	}
	if strings.TrimSpace(applicationID) == "" {
		return nil, fmt.Errorf("application id is required")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_review_scores_v2")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,application_id,reviewer_id,innovation_score,technical_depth_score,impact_score,overall_score,notes,review_status,is_locked,lock_reason,locked_at,locked_by,has_conflict,conflict_reason")
	q.Set("application_id", "eq."+strings.TrimSpace(applicationID))
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("judging score query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID                  string  `json:"id"`
		ApplicationID       string  `json:"application_id"`
		ReviewerID          string  `json:"reviewer_id"`
		InnovationScore     float64 `json:"innovation_score"`
		TechnicalDepthScore float64 `json:"technical_depth_score"`
		ImpactScore         float64 `json:"impact_score"`
		OverallScore        float64 `json:"overall_score"`
		Notes               string  `json:"notes"`
		ReviewStatus        string  `json:"review_status"`
		IsLocked            bool    `json:"is_locked"`
		LockReason          string  `json:"lock_reason"`
		LockedAt            string  `json:"locked_at"`
		LockedBy            string  `json:"locked_by"`
		HasConflict         bool    `json:"has_conflict"`
		ConflictReason      string  `json:"conflict_reason"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemJudgingScore, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemJudgingScore{
			ID: row.ID, ApplicationID: row.ApplicationID, ReviewerID: row.ReviewerID, InnovationScore: row.InnovationScore,
			TechnicalDepthScore: row.TechnicalDepthScore, ImpactScore: row.ImpactScore, OverallScore: row.OverallScore, Notes: row.Notes,
			ReviewStatus: row.ReviewStatus, IsLocked: row.IsLocked, LockReason: row.LockReason, LockedAt: row.LockedAt, LockedBy: row.LockedBy,
			HasConflict: row.HasConflict, ConflictReason: row.ConflictReason,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) UpdateJudgingScoreReviewState(scoreID string, reviewStatus string, isLocked bool, lockReason string, lockedBy string) error {
	if r.client == nil || !r.client.Enabled() {
		return nil
	}
	scoreID = strings.TrimSpace(scoreID)
	if scoreID == "" {
		return fmt.Errorf("score id required")
	}
	payload := map[string]any{
		"review_status": fallback(strings.TrimSpace(reviewStatus), "submitted"),
		"is_locked":     isLocked,
		"lock_reason":   emptyToNilStem(strings.TrimSpace(lockReason)),
		"locked_by":     emptyToNilStem(strings.TrimSpace(lockedBy)),
	}
	if isLocked {
		payload["locked_at"] = time.Now().UTC().Format(time.RFC3339)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_review_scores_v2")
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("id", "eq."+scoreID)
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPatch, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("score review state update failed: %d", resp.StatusCode)
	}
	_ = r.logAdminAuditAction(
		"stem_judging_score_review_state_updated",
		"stem_review_scores_v2",
		scoreID,
		map[string]any{
			"review_status": reviewStatus,
			"is_locked":     isLocked,
			"lock_reason":   lockReason,
			"locked_by":     lockedBy,
		},
		"STEM judging score review-state change",
		lockedBy,
	)
	return nil
}

func (r *StemSupabaseRepository) CreateJudgingRubric(
	rubric domain.StemJudgingRubric,
	criteria []domain.StemJudgingCriterion,
) (domain.StemJudgingRubric, []domain.StemJudgingCriterion, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemJudgingRubric{}, []domain.StemJudgingCriterion{}, fmt.Errorf("supabase REST is not configured")
	}
	rubricPayload := map[string]any{
		"contest_id":  strings.TrimSpace(rubric.ContestID),
		"name":        strings.TrimSpace(rubric.Name),
		"description": strings.TrimSpace(rubric.Description),
		"status":      fallback(strings.TrimSpace(rubric.Status), "active"),
	}
	body, err := json.Marshal(rubricPayload)
	if err != nil {
		return domain.StemJudgingRubric{}, nil, err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_judging_rubrics")
	if err != nil {
		return domain.StemJudgingRubric{}, nil, err
	}
	q := u.Query()
	q.Set("select", "id,contest_id,name,description,status")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemJudgingRubric{}, nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemJudgingRubric{}, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemJudgingRubric{}, nil, fmt.Errorf("judging rubric create failed: %d", resp.StatusCode)
	}
	var rubrics []struct {
		ID          string `json:"id"`
		ContestID   string `json:"contest_id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Status      string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rubrics); err != nil {
		return domain.StemJudgingRubric{}, nil, err
	}
	if len(rubrics) == 0 {
		return domain.StemJudgingRubric{}, nil, fmt.Errorf("judging rubric create failed: empty response")
	}
	created := domain.StemJudgingRubric{
		ID: rubrics[0].ID, ContestID: rubrics[0].ContestID, Name: rubrics[0].Name, Description: rubrics[0].Description, Status: rubrics[0].Status,
	}
	if len(criteria) == 0 {
		_ = r.logAdminAuditAction(
			"stem_judging_rubric_created",
			"stem_judging_rubrics",
			created.ID,
			map[string]any{
				"contest_id": created.ContestID,
				"name":       created.Name,
				"status":     created.Status,
				"criteria":   0,
			},
			"STEM judging rubric created",
			"",
		)
		return created, []domain.StemJudgingCriterion{}, nil
	}
	insertCriteria := make([]map[string]any, 0, len(criteria))
	for _, c := range criteria {
		insertCriteria = append(insertCriteria, map[string]any{
			"rubric_id":     created.ID,
			"criterion_key": strings.TrimSpace(c.Key),
			"label":         strings.TrimSpace(c.Label),
			"weight_pct":    c.WeightPct,
			"max_score":     c.MaxScore,
			"description":   strings.TrimSpace(c.Description),
		})
	}
	criteriaBody, err := json.Marshal(insertCriteria)
	if err != nil {
		return domain.StemJudgingRubric{}, nil, err
	}
	cu, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_judging_criteria")
	if err != nil {
		return domain.StemJudgingRubric{}, nil, err
	}
	cq := cu.Query()
	cq.Set("select", "id,rubric_id,criterion_key,label,weight_pct,max_score,description")
	cu.RawQuery = cq.Encode()
	creq, err := http.NewRequest(http.MethodPost, cu.String(), bytes.NewReader(criteriaBody))
	if err != nil {
		return domain.StemJudgingRubric{}, nil, err
	}
	creq.Header.Set("apikey", r.client.APIKey())
	creq.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	creq.Header.Set("Content-Type", "application/json")
	creq.Header.Set("Prefer", "return=representation")
	cresp, err := (&http.Client{Timeout: 10 * time.Second}).Do(creq)
	if err != nil {
		return domain.StemJudgingRubric{}, nil, err
	}
	defer cresp.Body.Close()
	if cresp.StatusCode >= 400 {
		return domain.StemJudgingRubric{}, nil, fmt.Errorf("judging criteria create failed: %d", cresp.StatusCode)
	}
	var rows []struct {
		ID          string  `json:"id"`
		RubricID    string  `json:"rubric_id"`
		Key         string  `json:"criterion_key"`
		Label       string  `json:"label"`
		WeightPct   float64 `json:"weight_pct"`
		MaxScore    float64 `json:"max_score"`
		Description string  `json:"description"`
	}
	if err := json.NewDecoder(cresp.Body).Decode(&rows); err != nil {
		return domain.StemJudgingRubric{}, nil, err
	}
	outCriteria := make([]domain.StemJudgingCriterion, 0, len(rows))
	for _, row := range rows {
		outCriteria = append(outCriteria, domain.StemJudgingCriterion{
			ID: row.ID, RubricID: row.RubricID, Key: row.Key, Label: row.Label, WeightPct: row.WeightPct, MaxScore: row.MaxScore, Description: row.Description,
		})
	}
	_ = r.logAdminAuditAction(
		"stem_judging_rubric_created",
		"stem_judging_rubrics",
		created.ID,
		map[string]any{
			"contest_id": created.ContestID,
			"name":       created.Name,
			"status":     created.Status,
			"criteria":   len(outCriteria),
		},
		"STEM judging rubric created",
		"",
	)
	return created, outCriteria, nil
}

func (r *StemSupabaseRepository) ListJudgingRubrics(contestID string, limit int) ([]domain.StemJudgingRubric, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemJudgingRubric{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_judging_rubrics")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,contest_id,name,description,status")
	if strings.TrimSpace(contestID) != "" {
		q.Set("contest_id", "eq."+strings.TrimSpace(contestID))
	}
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("judging rubric query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID          string `json:"id"`
		ContestID   string `json:"contest_id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Status      string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemJudgingRubric, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemJudgingRubric{
			ID: row.ID, ContestID: row.ContestID, Name: row.Name, Description: row.Description, Status: row.Status,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) ListJudgingCriteria(rubricID string, limit int) ([]domain.StemJudgingCriterion, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemJudgingCriterion{}, nil
	}
	if strings.TrimSpace(rubricID) == "" {
		return nil, fmt.Errorf("rubric id is required")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_judging_criteria")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,rubric_id,criterion_key,label,weight_pct,max_score,description")
	q.Set("rubric_id", "eq."+strings.TrimSpace(rubricID))
	q.Set("order", "created_at.asc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("judging criteria query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID          string  `json:"id"`
		RubricID    string  `json:"rubric_id"`
		Key         string  `json:"criterion_key"`
		Label       string  `json:"label"`
		WeightPct   float64 `json:"weight_pct"`
		MaxScore    float64 `json:"max_score"`
		Description string  `json:"description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemJudgingCriterion, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemJudgingCriterion{
			ID: row.ID, RubricID: row.RubricID, Key: row.Key, Label: row.Label, WeightPct: row.WeightPct, MaxScore: row.MaxScore, Description: row.Description,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateJudgeAssignment(assignment domain.StemJudgeAssignment) (domain.StemJudgeAssignment, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemJudgeAssignment{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"contest_id":      strings.TrimSpace(assignment.ContestID),
		"application_id":  strings.TrimSpace(assignment.ApplicationID),
		"judge_user_id":   strings.TrimSpace(assignment.JudgeUserID),
		"status":          fallback(strings.TrimSpace(assignment.Status), "assigned"),
		"has_conflict":    assignment.HasConflict,
		"conflict_reason": emptyToNilStem(strings.TrimSpace(assignment.ConflictReason)),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemJudgeAssignment{}, err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_judge_assignments")
	if err != nil {
		return domain.StemJudgeAssignment{}, err
	}
	q := u.Query()
	q.Set("select", "id,contest_id,application_id,judge_user_id,status,has_conflict,conflict_reason")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemJudgeAssignment{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemJudgeAssignment{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemJudgeAssignment{}, fmt.Errorf("judge assignment create failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID             string `json:"id"`
		ContestID      string `json:"contest_id"`
		ApplicationID  string `json:"application_id"`
		JudgeUserID    string `json:"judge_user_id"`
		Status         string `json:"status"`
		HasConflict    bool   `json:"has_conflict"`
		ConflictReason string `json:"conflict_reason"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemJudgeAssignment{}, err
	}
	if len(rows) == 0 {
		return domain.StemJudgeAssignment{}, fmt.Errorf("judge assignment create failed: empty response")
	}
	created := domain.StemJudgeAssignment{
		ID: rows[0].ID, ContestID: rows[0].ContestID, ApplicationID: rows[0].ApplicationID, JudgeUserID: rows[0].JudgeUserID, Status: rows[0].Status,
		HasConflict: rows[0].HasConflict, ConflictReason: rows[0].ConflictReason,
	}
	_ = r.logAdminAuditAction(
		"stem_judge_assignment_created",
		"stem_judge_assignments",
		created.ID,
		map[string]any{
			"contest_id":     created.ContestID,
			"application_id": created.ApplicationID,
			"judge_user_id":  created.JudgeUserID,
			"status":         created.Status,
			"has_conflict":   created.HasConflict,
		},
		"STEM judge assignment created",
		"",
	)
	return created, nil
}

func (r *StemSupabaseRepository) ListJudgeAssignments(contestID string, applicationID string, judgeUserID string, limit int) ([]domain.StemJudgeAssignment, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemJudgeAssignment{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_judge_assignments")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,contest_id,application_id,judge_user_id,status,has_conflict,conflict_reason")
	if strings.TrimSpace(contestID) != "" {
		q.Set("contest_id", "eq."+strings.TrimSpace(contestID))
	}
	if strings.TrimSpace(applicationID) != "" {
		q.Set("application_id", "eq."+strings.TrimSpace(applicationID))
	}
	if strings.TrimSpace(judgeUserID) != "" {
		q.Set("judge_user_id", "eq."+strings.TrimSpace(judgeUserID))
	}
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("judge assignment query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID             string `json:"id"`
		ContestID      string `json:"contest_id"`
		ApplicationID  string `json:"application_id"`
		JudgeUserID    string `json:"judge_user_id"`
		Status         string `json:"status"`
		HasConflict    bool   `json:"has_conflict"`
		ConflictReason string `json:"conflict_reason"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemJudgeAssignment, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemJudgeAssignment{
			ID: row.ID, ContestID: row.ContestID, ApplicationID: row.ApplicationID, JudgeUserID: row.JudgeUserID, Status: row.Status,
			HasConflict: row.HasConflict, ConflictReason: row.ConflictReason,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) UpdateJudgeAssignmentConflict(assignmentID string, hasConflict bool, conflictReason string, status string) error {
	if r.client == nil || !r.client.Enabled() {
		return nil
	}
	assignmentID = strings.TrimSpace(assignmentID)
	if assignmentID == "" {
		return fmt.Errorf("assignment id required")
	}
	payload := map[string]any{
		"has_conflict":    hasConflict,
		"conflict_reason": emptyToNilStem(strings.TrimSpace(conflictReason)),
	}
	if strings.TrimSpace(status) != "" {
		payload["status"] = strings.TrimSpace(status)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_judge_assignments")
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("id", "eq."+assignmentID)
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPatch, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("assignment conflict update failed: %d", resp.StatusCode)
	}
	_ = r.logAdminAuditAction(
		"stem_judge_assignment_conflict_updated",
		"stem_judge_assignments",
		assignmentID,
		map[string]any{
			"has_conflict":    hasConflict,
			"conflict_reason": conflictReason,
			"status":          status,
		},
		"STEM judge assignment conflict update",
		"",
	)
	return nil
}

func (r *StemSupabaseRepository) UpsertVotingRule(rule domain.StemVotingRule) (domain.StemVotingRule, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemVotingRule{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"contest_id": rule.ContestID, "voting_status": fallback(strings.TrimSpace(rule.VotingStatus), "NOT_STARTED"),
		"voting_mode": fallback(strings.TrimSpace(rule.VotingMode), "FREE"), "daily_vote_limit": rule.DailyVoteLimit,
		"one_user_one_vote": rule.OneUserOneVote, "allow_paid_votes": rule.AllowPaidVotes,
	}
	body, _ := json.Marshal(payload)
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_voting_rules")
	q := u.Query()
	q.Set("select", "id,contest_id,voting_status,voting_mode,daily_vote_limit,one_user_one_vote,allow_paid_votes")
	q.Set("contest_id", "eq."+strings.TrimSpace(rule.ContestID))
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "resolution=merge-duplicates,return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemVotingRule{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemVotingRule{}, fmt.Errorf("voting rule upsert failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID             string `json:"id"`
		ContestID      string `json:"contest_id"`
		VotingStatus   string `json:"voting_status"`
		VotingMode     string `json:"voting_mode"`
		DailyVoteLimit int    `json:"daily_vote_limit"`
		OneUserOneVote bool   `json:"one_user_one_vote"`
		AllowPaidVotes bool   `json:"allow_paid_votes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil || len(rows) == 0 {
		return domain.StemVotingRule{}, fmt.Errorf("voting rule decode failed")
	}
	return domain.StemVotingRule{
		ID: rows[0].ID, ContestID: rows[0].ContestID, VotingStatus: rows[0].VotingStatus, VotingMode: rows[0].VotingMode,
		DailyVoteLimit: rows[0].DailyVoteLimit, OneUserOneVote: rows[0].OneUserOneVote, AllowPaidVotes: rows[0].AllowPaidVotes,
	}, nil
}

func (r *StemSupabaseRepository) ListVotingRules(contestID string, limit int) ([]domain.StemVotingRule, error) {
	out := []domain.StemVotingRule{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}
	if limit <= 0 {
		limit = 100
	}
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_voting_rules")
	q := u.Query()
	q.Set("select", "id,contest_id,voting_status,voting_mode,daily_vote_limit,one_user_one_vote,allow_paid_votes")
	if strings.TrimSpace(contestID) != "" {
		q.Set("contest_id", "eq."+strings.TrimSpace(contestID))
	}
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("voting rules query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID             string `json:"id"`
		ContestID      string `json:"contest_id"`
		VotingStatus   string `json:"voting_status"`
		VotingMode     string `json:"voting_mode"`
		DailyVoteLimit int    `json:"daily_vote_limit"`
		OneUserOneVote bool   `json:"one_user_one_vote"`
		AllowPaidVotes bool   `json:"allow_paid_votes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return out, err
	}
	for _, r0 := range rows {
		out = append(out, domain.StemVotingRule{
			ID: r0.ID, ContestID: r0.ContestID, VotingStatus: r0.VotingStatus, VotingMode: r0.VotingMode, DailyVoteLimit: r0.DailyVoteLimit,
			OneUserOneVote: r0.OneUserOneVote, AllowPaidVotes: r0.AllowPaidVotes,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateVotePackage(pkg domain.StemVotePackage) (domain.StemVotePackage, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemVotePackage{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{"contest_id": pkg.ContestID, "name": pkg.Name, "votes": pkg.Votes, "amount_ngn": pkg.AmountNGN, "is_active": pkg.IsActive}
	body, _ := json.Marshal(payload)
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_vote_packages")
	q := u.Query()
	q.Set("select", "id,contest_id,name,votes,amount_ngn,is_active")
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemVotePackage{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemVotePackage{}, fmt.Errorf("vote package create failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID        string  `json:"id"`
		ContestID string  `json:"contest_id"`
		Name      string  `json:"name"`
		Votes     int     `json:"votes"`
		AmountNGN float64 `json:"amount_ngn"`
		IsActive  bool    `json:"is_active"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil || len(rows) == 0 {
		return domain.StemVotePackage{}, fmt.Errorf("vote package decode failed")
	}
	return domain.StemVotePackage{ID: rows[0].ID, ContestID: rows[0].ContestID, Name: rows[0].Name, Votes: rows[0].Votes, AmountNGN: rows[0].AmountNGN, IsActive: rows[0].IsActive}, nil
}

func (r *StemSupabaseRepository) ListVotePackages(contestID string, limit int) ([]domain.StemVotePackage, error) {
	out := []domain.StemVotePackage{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}
	if limit <= 0 {
		limit = 100
	}
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_vote_packages")
	q := u.Query()
	q.Set("select", "id,contest_id,name,votes,amount_ngn,is_active")
	if contestID != "" {
		q.Set("contest_id", "eq."+contestID)
	}
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("vote package query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID        string  `json:"id"`
		ContestID string  `json:"contest_id"`
		Name      string  `json:"name"`
		Votes     int     `json:"votes"`
		AmountNGN float64 `json:"amount_ngn"`
		IsActive  bool    `json:"is_active"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return out, err
	}
	for _, r0 := range rows {
		out = append(out, domain.StemVotePackage{ID: r0.ID, ContestID: r0.ContestID, Name: r0.Name, Votes: r0.Votes, AmountNGN: r0.AmountNGN, IsActive: r0.IsActive})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateVoteTransaction(tx domain.StemVoteTransaction) (domain.StemVoteTransaction, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemVoteTransaction{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"contest_id":        strings.TrimSpace(tx.ContestID),
		"application_id":    emptyToNilStem(tx.ApplicationID),
		"package_id":        emptyToNilStem(tx.PackageID),
		"voter_ref":         strings.TrimSpace(tx.VoterRef),
		"payment_reference": strings.TrimSpace(tx.PaymentReference),
		"amount_ngn":        tx.AmountNGN,
		"votes_allocated":   tx.VotesAllocated,
		"status":            fallback(strings.TrimSpace(tx.Status), "pending"),
	}
	body, _ := json.Marshal(payload)
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_vote_transactions")
	q := u.Query()
	q.Set("select", "id,contest_id,application_id,package_id,voter_ref,payment_reference,amount_ngn,votes_allocated,status")
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemVoteTransaction{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemVoteTransaction{}, fmt.Errorf("vote tx create failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID               string  `json:"id"`
		ContestID        string  `json:"contest_id"`
		ApplicationID    string  `json:"application_id"`
		PackageID        string  `json:"package_id"`
		VoterRef         string  `json:"voter_ref"`
		PaymentReference string  `json:"payment_reference"`
		Status           string  `json:"status"`
		AmountNGN        float64 `json:"amount_ngn"`
		VotesAllocated   int     `json:"votes_allocated"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil || len(rows) == 0 {
		return domain.StemVoteTransaction{}, fmt.Errorf("vote tx decode failed")
	}
	return domain.StemVoteTransaction{
		ID: rows[0].ID, ContestID: rows[0].ContestID, ApplicationID: rows[0].ApplicationID, PackageID: rows[0].PackageID,
		VoterRef: rows[0].VoterRef, PaymentReference: rows[0].PaymentReference, AmountNGN: rows[0].AmountNGN,
		VotesAllocated: rows[0].VotesAllocated, Status: rows[0].Status,
	}, nil
}

func (r *StemSupabaseRepository) ListVoteTransactions(contestID string, limit int) ([]domain.StemVoteTransaction, error) {
	out := []domain.StemVoteTransaction{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}
	if limit <= 0 {
		limit = 100
	}
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_vote_transactions")
	q := u.Query()
	q.Set("select", "id,contest_id,application_id,package_id,voter_ref,payment_reference,amount_ngn,votes_allocated,status")
	if contestID != "" {
		q.Set("contest_id", "eq."+contestID)
	}
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("vote tx query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID               string  `json:"id"`
		ContestID        string  `json:"contest_id"`
		ApplicationID    string  `json:"application_id"`
		PackageID        string  `json:"package_id"`
		VoterRef         string  `json:"voter_ref"`
		PaymentReference string  `json:"payment_reference"`
		Status           string  `json:"status"`
		AmountNGN        float64 `json:"amount_ngn"`
		VotesAllocated   int     `json:"votes_allocated"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return out, err
	}
	for _, r0 := range rows {
		out = append(out, domain.StemVoteTransaction{ID: r0.ID, ContestID: r0.ContestID, ApplicationID: r0.ApplicationID, PackageID: r0.PackageID, VoterRef: r0.VoterRef, PaymentReference: r0.PaymentReference, AmountNGN: r0.AmountNGN, VotesAllocated: r0.VotesAllocated, Status: r0.Status})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateBootcampCohort(cohort domain.StemBootcampCohort) (domain.StemBootcampCohort, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemBootcampCohort{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{"contest_id": emptyToNilStem(cohort.ContestID), "name": cohort.Name, "status": fallback(cohort.Status, "planned"), "start_date": emptyToNilStem(cohort.StartDate), "end_date": emptyToNilStem(cohort.EndDate)}
	body, _ := json.Marshal(payload)
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_bootcamp_cohorts")
	q := u.Query()
	q.Set("select", "id,contest_id,name,status,start_date,end_date")
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemBootcampCohort{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemBootcampCohort{}, fmt.Errorf("cohort create failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID        string `json:"id"`
		ContestID string `json:"contest_id"`
		Name      string `json:"name"`
		Status    string `json:"status"`
		StartDate string `json:"start_date"`
		EndDate   string `json:"end_date"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil || len(rows) == 0 {
		return domain.StemBootcampCohort{}, fmt.Errorf("cohort decode failed")
	}
	return domain.StemBootcampCohort{ID: rows[0].ID, ContestID: rows[0].ContestID, Name: rows[0].Name, Status: rows[0].Status, StartDate: rows[0].StartDate, EndDate: rows[0].EndDate}, nil
}

func (r *StemSupabaseRepository) ListBootcampCohorts(contestID string, limit int) ([]domain.StemBootcampCohort, error) {
	out := []domain.StemBootcampCohort{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}
	if limit <= 0 {
		limit = 100
	}
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_bootcamp_cohorts")
	q := u.Query()
	q.Set("select", "id,contest_id,name,status,start_date,end_date")
	if contestID != "" {
		q.Set("contest_id", "eq."+contestID)
	}
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("cohort query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID        string `json:"id"`
		ContestID string `json:"contest_id"`
		Name      string `json:"name"`
		Status    string `json:"status"`
		StartDate string `json:"start_date"`
		EndDate   string `json:"end_date"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return out, err
	}
	for _, r0 := range rows {
		out = append(out, domain.StemBootcampCohort{ID: r0.ID, ContestID: r0.ContestID, Name: r0.Name, Status: r0.Status, StartDate: r0.StartDate, EndDate: r0.EndDate})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateBootcampTask(task domain.StemBootcampTask) (domain.StemBootcampTask, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemBootcampTask{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"cohort_id":   strings.TrimSpace(task.CohortID),
		"title":       strings.TrimSpace(task.Title),
		"description": strings.TrimSpace(task.Description),
		"day_number":  maxInt(task.DayNumber, 1),
		"max_score":   maxFloat(task.MaxScore, 1),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemBootcampTask{}, err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_bootcamp_tasks")
	if err != nil {
		return domain.StemBootcampTask{}, err
	}
	q := u.Query()
	q.Set("select", "id,cohort_id,title,description,day_number,max_score")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemBootcampTask{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemBootcampTask{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemBootcampTask{}, fmt.Errorf("create stem bootcamp task failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID          string  `json:"id"`
		CohortID    string  `json:"cohort_id"`
		Title       string  `json:"title"`
		Description string  `json:"description"`
		DayNumber   int     `json:"day_number"`
		MaxScore    float64 `json:"max_score"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemBootcampTask{}, err
	}
	if len(rows) == 0 {
		return domain.StemBootcampTask{}, fmt.Errorf("create stem bootcamp task failed: empty response")
	}
	return domain.StemBootcampTask{
		ID: rows[0].ID, CohortID: rows[0].CohortID, Title: rows[0].Title, Description: rows[0].Description,
		DayNumber: rows[0].DayNumber, MaxScore: rows[0].MaxScore,
	}, nil
}

func (r *StemSupabaseRepository) ListBootcampTasks(cohortID string, limit int) ([]domain.StemBootcampTask, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemBootcampTask{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_bootcamp_tasks")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,cohort_id,title,description,day_number,max_score")
	if strings.TrimSpace(cohortID) != "" {
		q.Set("cohort_id", "eq."+strings.TrimSpace(cohortID))
	}
	q.Set("order", "day_number.asc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("stem bootcamp tasks query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID          string  `json:"id"`
		CohortID    string  `json:"cohort_id"`
		Title       string  `json:"title"`
		Description string  `json:"description"`
		DayNumber   int     `json:"day_number"`
		MaxScore    float64 `json:"max_score"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemBootcampTask, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemBootcampTask{
			ID: row.ID, CohortID: row.CohortID, Title: row.Title, Description: row.Description,
			DayNumber: row.DayNumber, MaxScore: row.MaxScore,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) UpsertBootcampScore(score domain.StemBootcampScore) (domain.StemBootcampScore, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemBootcampScore{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{
		"cohort_id":      strings.TrimSpace(score.CohortID),
		"task_id":        strings.TrimSpace(score.TaskID),
		"application_id": strings.TrimSpace(score.ApplicationID),
		"score":          score.Score,
		"note":           strings.TrimSpace(score.Note),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return domain.StemBootcampScore{}, err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_bootcamp_scores")
	if err != nil {
		return domain.StemBootcampScore{}, err
	}
	q := u.Query()
	q.Set("select", "id,cohort_id,task_id,application_id,score,note")
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return domain.StemBootcampScore{}, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "resolution=merge-duplicates,return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemBootcampScore{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemBootcampScore{}, fmt.Errorf("upsert stem bootcamp score failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID            string  `json:"id"`
		CohortID      string  `json:"cohort_id"`
		TaskID        string  `json:"task_id"`
		ApplicationID string  `json:"application_id"`
		Score         float64 `json:"score"`
		Note          string  `json:"note"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return domain.StemBootcampScore{}, err
	}
	if len(rows) == 0 {
		return domain.StemBootcampScore{}, fmt.Errorf("upsert stem bootcamp score failed: empty response")
	}
	return domain.StemBootcampScore{
		ID: rows[0].ID, CohortID: rows[0].CohortID, TaskID: rows[0].TaskID,
		ApplicationID: rows[0].ApplicationID, Score: rows[0].Score, Note: rows[0].Note,
	}, nil
}

func (r *StemSupabaseRepository) ListBootcampScores(cohortID string, applicationID string, limit int) ([]domain.StemBootcampScore, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemBootcampScore{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_bootcamp_scores")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("select", "id,cohort_id,task_id,application_id,score,note")
	if strings.TrimSpace(cohortID) != "" {
		q.Set("cohort_id", "eq."+strings.TrimSpace(cohortID))
	}
	if strings.TrimSpace(applicationID) != "" {
		q.Set("application_id", "eq."+strings.TrimSpace(applicationID))
	}
	q.Set("order", "updated_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("stem bootcamp scores query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID            string  `json:"id"`
		CohortID      string  `json:"cohort_id"`
		TaskID        string  `json:"task_id"`
		ApplicationID string  `json:"application_id"`
		Score         float64 `json:"score"`
		Note          string  `json:"note"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	out := make([]domain.StemBootcampScore, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.StemBootcampScore{
			ID: row.ID, CohortID: row.CohortID, TaskID: row.TaskID, ApplicationID: row.ApplicationID,
			Score: row.Score, Note: row.Note,
		})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateSponsor(sponsor domain.StemSponsor) (domain.StemSponsor, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemSponsor{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{"name": sponsor.Name, "sponsor_type": fallback(sponsor.SponsorType, "general"), "logo_url": sponsor.LogoURL, "website_url": sponsor.WebsiteURL, "campaign_message": sponsor.CampaignMessage, "cta_url": sponsor.CTAURL, "is_active": sponsor.IsActive}
	body, _ := json.Marshal(payload)
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_sponsors")
	q := u.Query()
	q.Set("select", "id,name,sponsor_type,logo_url,website_url,campaign_message,cta_url,is_active")
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemSponsor{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemSponsor{}, fmt.Errorf("sponsor create failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		SponsorType     string `json:"sponsor_type"`
		LogoURL         string `json:"logo_url"`
		WebsiteURL      string `json:"website_url"`
		CampaignMessage string `json:"campaign_message"`
		CTAURL          string `json:"cta_url"`
		IsActive        bool   `json:"is_active"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil || len(rows) == 0 {
		return domain.StemSponsor{}, fmt.Errorf("sponsor decode failed")
	}
	return domain.StemSponsor{ID: rows[0].ID, Name: rows[0].Name, SponsorType: rows[0].SponsorType, LogoURL: rows[0].LogoURL, WebsiteURL: rows[0].WebsiteURL, CampaignMessage: rows[0].CampaignMessage, CTAURL: rows[0].CTAURL, IsActive: rows[0].IsActive}, nil
}

func (r *StemSupabaseRepository) ListSponsors(limit int) ([]domain.StemSponsor, error) {
	out := []domain.StemSponsor{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}
	if limit <= 0 {
		limit = 100
	}
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_sponsors")
	q := u.Query()
	q.Set("select", "id,name,sponsor_type,logo_url,website_url,campaign_message,cta_url,is_active")
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("sponsors query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		SponsorType     string `json:"sponsor_type"`
		LogoURL         string `json:"logo_url"`
		WebsiteURL      string `json:"website_url"`
		CampaignMessage string `json:"campaign_message"`
		CTAURL          string `json:"cta_url"`
		IsActive        bool   `json:"is_active"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return out, err
	}
	for _, r0 := range rows {
		out = append(out, domain.StemSponsor{ID: r0.ID, Name: r0.Name, SponsorType: r0.SponsorType, LogoURL: r0.LogoURL, WebsiteURL: r0.WebsiteURL, CampaignMessage: r0.CampaignMessage, CTAURL: r0.CTAURL, IsActive: r0.IsActive})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateCertificate(cert domain.StemCertificate) (domain.StemCertificate, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemCertificate{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{"application_id": emptyToNilStem(cert.ApplicationID), "certificate_type": cert.CertificateType, "certificate_number": cert.CertificateNumber, "file_url": cert.FileURL}
	body, _ := json.Marshal(payload)
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_certificates")
	q := u.Query()
	q.Set("select", "id,application_id,certificate_type,certificate_number,issued_at,file_url")
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemCertificate{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemCertificate{}, fmt.Errorf("certificate create failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID                string `json:"id"`
		ApplicationID     string `json:"application_id"`
		CertificateType   string `json:"certificate_type"`
		CertificateNumber string `json:"certificate_number"`
		IssuedAt          string `json:"issued_at"`
		FileURL           string `json:"file_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil || len(rows) == 0 {
		return domain.StemCertificate{}, fmt.Errorf("certificate decode failed")
	}
	return domain.StemCertificate{ID: rows[0].ID, ApplicationID: rows[0].ApplicationID, CertificateType: rows[0].CertificateType, CertificateNumber: rows[0].CertificateNumber, IssuedAt: rows[0].IssuedAt, FileURL: rows[0].FileURL}, nil
}

func (r *StemSupabaseRepository) ListCertificates(limit int) ([]domain.StemCertificate, error) {
	out := []domain.StemCertificate{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}
	if limit <= 0 {
		limit = 100
	}
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_certificates")
	q := u.Query()
	q.Set("select", "id,application_id,certificate_type,certificate_number,issued_at,file_url")
	q.Set("order", "issued_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("certificates query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID                string `json:"id"`
		ApplicationID     string `json:"application_id"`
		CertificateType   string `json:"certificate_type"`
		CertificateNumber string `json:"certificate_number"`
		IssuedAt          string `json:"issued_at"`
		FileURL           string `json:"file_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return out, err
	}
	for _, r0 := range rows {
		out = append(out, domain.StemCertificate{ID: r0.ID, ApplicationID: r0.ApplicationID, CertificateType: r0.CertificateType, CertificateNumber: r0.CertificateNumber, IssuedAt: r0.IssuedAt, FileURL: r0.FileURL})
	}
	return out, nil
}

func (r *StemSupabaseRepository) CreateBadge(badge domain.StemBadge) (domain.StemBadge, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemBadge{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{"name": badge.Name, "description": badge.Description, "icon_url": badge.IconURL}
	body, _ := json.Marshal(payload)
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_badges")
	q := u.Query()
	q.Set("select", "id,name,description,icon_url")
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemBadge{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemBadge{}, fmt.Errorf("badge create failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		IconURL     string `json:"icon_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil || len(rows) == 0 {
		return domain.StemBadge{}, fmt.Errorf("badge decode failed")
	}
	return domain.StemBadge{ID: rows[0].ID, Name: rows[0].Name, Description: rows[0].Description, IconURL: rows[0].IconURL}, nil
}

func (r *StemSupabaseRepository) ListBadges(limit int) ([]domain.StemBadge, error) {
	out := []domain.StemBadge{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}
	if limit <= 0 {
		limit = 100
	}
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_badges")
	q := u.Query()
	q.Set("select", "id,name,description,icon_url")
	q.Set("order", "created_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("badges query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		IconURL     string `json:"icon_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return out, err
	}
	for _, r0 := range rows {
		out = append(out, domain.StemBadge{ID: r0.ID, Name: r0.Name, Description: r0.Description, IconURL: r0.IconURL})
	}
	return out, nil
}

func (r *StemSupabaseRepository) AwardBadge(award domain.StemBadgeAward) (domain.StemBadgeAward, error) {
	if r.client == nil || !r.client.Enabled() {
		return domain.StemBadgeAward{}, fmt.Errorf("supabase REST is not configured")
	}
	payload := map[string]any{"badge_id": award.BadgeID, "application_id": emptyToNilStem(award.ApplicationID), "note": award.Note}
	body, _ := json.Marshal(payload)
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_badge_awards")
	q := u.Query()
	q.Set("select", "id,badge_id,application_id,awarded_at,note")
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return domain.StemBadgeAward{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return domain.StemBadgeAward{}, fmt.Errorf("badge award failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID            string `json:"id"`
		BadgeID       string `json:"badge_id"`
		ApplicationID string `json:"application_id"`
		AwardedAt     string `json:"awarded_at"`
		Note          string `json:"note"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil || len(rows) == 0 {
		return domain.StemBadgeAward{}, fmt.Errorf("badge award decode failed")
	}
	return domain.StemBadgeAward{ID: rows[0].ID, BadgeID: rows[0].BadgeID, ApplicationID: rows[0].ApplicationID, AwardedAt: rows[0].AwardedAt, Note: rows[0].Note}, nil
}

func (r *StemSupabaseRepository) ListBadgeAwards(applicationID string, limit int) ([]domain.StemBadgeAward, error) {
	out := []domain.StemBadgeAward{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}
	if limit <= 0 {
		limit = 100
	}
	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/stem_badge_awards")
	q := u.Query()
	q.Set("select", "id,badge_id,application_id,awarded_at,note")
	if applicationID != "" {
		q.Set("application_id", "eq."+applicationID)
	}
	q.Set("order", "awarded_at.desc")
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("badge awards query failed: %d", resp.StatusCode)
	}
	var rows []struct {
		ID            string `json:"id"`
		BadgeID       string `json:"badge_id"`
		ApplicationID string `json:"application_id"`
		AwardedAt     string `json:"awarded_at"`
		Note          string `json:"note"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return out, err
	}
	for _, r0 := range rows {
		out = append(out, domain.StemBadgeAward{ID: r0.ID, BadgeID: r0.BadgeID, ApplicationID: r0.ApplicationID, AwardedAt: r0.AwardedAt, Note: r0.Note})
	}
	return out, nil
}

func (r *StemSupabaseRepository) GetReportSummary() (domain.StemReportSummary, error) {
	out := domain.StemReportSummary{}
	if r.client == nil || !r.client.Enabled() {
		return out, nil
	}
	var err error
	if out.TotalApplications, err = r.client.Count("stem_applications_v2"); err != nil {
		out.TotalApplications = 0
	}
	if out.TotalSchools, err = r.client.Count("stem_schools"); err != nil {
		out.TotalSchools = 0
	}
	if out.TotalEmerging, err = r.client.Count("stem_emerging_innovators"); err != nil {
		out.TotalEmerging = 0
	}
	if out.TotalVotes, err = r.client.Count("stem_vote_transactions"); err != nil {
		out.TotalVotes = 0
	}
	if out.TotalSponsors, err = r.client.Count("stem_sponsors"); err != nil {
		out.TotalSponsors = 0
	}
	if out.TotalCertificates, err = r.client.Count("stem_certificates"); err != nil {
		out.TotalCertificates = 0
	}
	if out.TotalBadgeAwards, err = r.client.Count("stem_badge_awards"); err != nil {
		out.TotalBadgeAwards = 0
	}
	if out.TotalBootcampCohorts, err = r.client.Count("stem_bootcamp_cohorts"); err != nil {
		out.TotalBootcampCohorts = 0
	}
	return out, nil
}

func (r *StemSupabaseRepository) GetReportBuckets(kind string, contestID string, limit int) ([]domain.StemReportBucket, error) {
	if r.client == nil || !r.client.Enabled() {
		return []domain.StemReportBucket{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	groupCol := "status"
	table := "stem_vote_transactions"
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "vote_status":
		table = "stem_vote_transactions"
		groupCol = "status"
	case "cohort_status":
		table = "stem_bootcamp_cohorts"
		groupCol = "status"
	case "badge_distribution":
		table = "stem_badges"
		groupCol = "name"
	default:
		return []domain.StemReportBucket{}, nil
	}

	u, _ := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/" + table)
	q := u.Query()
	q.Set("select", groupCol)
	if table == "stem_vote_transactions" && strings.TrimSpace(contestID) != "" {
		q.Set("contest_id", "eq."+strings.TrimSpace(contestID))
	}
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("report buckets query failed: %d", resp.StatusCode)
	}

	var rawRows []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&rawRows); err != nil {
		return nil, err
	}
	buckets := map[string]int{}
	for _, row := range rawRows {
		key, _ := row[groupCol].(string)
		key = strings.TrimSpace(key)
		if key == "" {
			key = "unknown"
		}
		buckets[key]++
	}
	out := make([]domain.StemReportBucket, 0, len(buckets))
	for key, count := range buckets {
		out = append(out, domain.StemReportBucket{Key: key, Count: count})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Count > out[j].Count })
	return out, nil
}

func readSchoolField(row map[string]any, key string) string {
	if row == nil {
		return ""
	}
	raw, ok := row[key]
	if !ok {
		return ""
	}
	text, ok := raw.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func fallback(value, fallbackValue string) string {
	if strings.TrimSpace(value) == "" {
		return fallbackValue
	}
	return value
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func emptyToNilStem(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func (r *StemSupabaseRepository) logAdminAuditAction(
	actionType string,
	targetTable string,
	targetID string,
	newValue map[string]any,
	reason string,
	adminID string,
) error {
	if r.client == nil || !r.client.Enabled() {
		return nil
	}
	payload := map[string]any{
		"action_type":  actionType,
		"target_table": targetTable,
		"target_id":    strings.TrimSpace(targetID),
		"new_value":    newValue,
		"reason":       reason,
	}
	if strings.TrimSpace(adminID) != "" {
		payload["admin_id"] = strings.TrimSpace(adminID)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	u, err := url.Parse(strings.TrimRight(r.client.BaseURL(), "/") + "/rest/v1/admin_audit_logs")
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", r.client.APIKey())
	req.Header.Set("Authorization", "Bearer "+r.client.APIKey())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("admin audit log insert failed: %d", resp.StatusCode)
	}
	return nil
}

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

type AnalyticsService interface {
	GetChatAnalytics() (domain.ChatAnalytics, error)
}

type analyticsService struct {
	repo repositories.AnalyticsRepository
}

func NewAnalyticsService(repo repositories.AnalyticsRepository) AnalyticsService {
	return &analyticsService{repo: repo}
}

func (s *analyticsService) GetChatAnalytics() (domain.ChatAnalytics, error) {
	if s.repo == nil {
		return domain.ChatAnalytics{ByPage: map[string]int{}, ByIntent: map[string]int{}, LeadsByType: map[string]int{}}, nil
	}
	return s.repo.GetChatAnalytics()
}

type AuditService interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
	LogLogin(userID, email, status, failureReason, ipAddress, userAgent string, location map[string]any)
	ListAuditLogs(filter domain.AuditFilter) ([]map[string]any, error)
	ListLoginActivity(filter domain.AuditFilter) ([]map[string]any, error)
	ListSecurityEvents(filter domain.AuditFilter) ([]map[string]any, error)
}

type auditService struct{ repo repositories.AuditRepository }

func NewAuditService(repo repositories.AuditRepository) AuditService {
	return &auditService{repo: repo}
}

func (s *auditService) LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string) {
	if s.repo == nil {
		return
	}
	_ = s.repo.LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID, oldValues, newValues, ipAddress, userAgent, severity)
}

func (s *auditService) LogLogin(userID, email, status, failureReason, ipAddress, userAgent string, location map[string]any) {
	if s.repo == nil {
		return
	}
	_ = s.repo.LogLogin(userID, email, status, failureReason, ipAddress, userAgent, location)
}

func (s *auditService) ListAuditLogs(filter domain.AuditFilter) ([]map[string]any, error) {
	if s.repo == nil {
		return []map[string]any{}, nil
	}
	return s.repo.ListAuditLogs(filter)
}

func (s *auditService) ListLoginActivity(filter domain.AuditFilter) ([]map[string]any, error) {
	if s.repo == nil {
		return []map[string]any{}, nil
	}
	return s.repo.ListLoginActivity(filter)
}

func (s *auditService) ListSecurityEvents(filter domain.AuditFilter) ([]map[string]any, error) {
	if s.repo == nil {
		return []map[string]any{}, nil
	}
	return s.repo.ListSecurityEvents(filter)
}

type ChatService interface {
	ListSessions(limit int) ([]domain.ChatSession, error)
	GetSessionDetail(id string) (domain.ChatSessionDetail, error)
}

type chatService struct{ repo repositories.ChatRepository }

func NewChatService(repo repositories.ChatRepository) ChatService { return &chatService{repo: repo} }

func (s *chatService) ListSessions(limit int) ([]domain.ChatSession, error) {
	if s.repo == nil {
		return []domain.ChatSession{}, nil
	}
	return s.repo.ListSessions(limit)
}

func (s *chatService) GetSessionDetail(id string) (domain.ChatSessionDetail, error) {
	if s.repo == nil {
		return domain.ChatSessionDetail{Messages: []domain.ChatMessage{}, Events: []domain.ChatEvent{}}, nil
	}
	return s.repo.GetSessionDetail(id)
}

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

type HandoffService interface {
	List(limit int, status string, sessionID string) ([]domain.Handoff, error)
	UpdateStatus(id, status string) error
}

type handoffService struct {
	repo repositories.HandoffRepository
}

func NewHandoffService(repo repositories.HandoffRepository) HandoffService {
	return &handoffService{repo: repo}
}

func (s *handoffService) List(limit int, status string, sessionID string) ([]domain.Handoff, error) {
	if s.repo == nil {
		return []domain.Handoff{}, nil
	}
	return s.repo.List(limit, status, sessionID)
}

func (s *handoffService) UpdateStatus(id, status string) error {
	if s.repo == nil {
		return nil
	}
	return s.repo.UpdateStatus(id, status)
}

type LeadService interface {
	List(limit int, sessionID string) ([]domain.Lead, error)
	UpdateStatus(id, status string) error
}

type leadService struct {
	repo repositories.LeadRepository
}

func NewLeadService(repo repositories.LeadRepository) LeadService {
	return &leadService{repo: repo}
}

func (s *leadService) List(limit int, sessionID string) ([]domain.Lead, error) {
	if s.repo == nil {
		return []domain.Lead{}, nil
	}
	return s.repo.List(limit, sessionID)
}

func (s *leadService) UpdateStatus(id, status string) error {
	if s.repo == nil {
		return nil
	}
	return s.repo.UpdateStatus(id, status)
}

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

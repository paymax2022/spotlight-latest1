package services

import (
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/repositories"
)

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

package repositories

import "spotlight/backend/internal/domain"

type AuditRepository interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string) error
	LogLogin(userID, email, status, failureReason, ipAddress, userAgent string, location map[string]any) error
	ListAuditLogs(filter domain.AuditFilter) ([]map[string]any, error)
	ListLoginActivity(filter domain.AuditFilter) ([]map[string]any, error)
	ListSecurityEvents(filter domain.AuditFilter) ([]map[string]any, error)
}

package repositories

import (
	"fmt"
	"net/http"
	"strings"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

type AuditSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewAuditSupabaseRepository(client *integrations.SupabaseRestClient) *AuditSupabaseRepository {
	return &AuditSupabaseRepository{client: client}
}

func (r *AuditSupabaseRepository) LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string) error {
	if r.client == nil || !r.client.Enabled() {
		return nil
	}
	payload := map[string]any{"actor_user_id": emptyAudit(actorUserID), "target_user_id": emptyAudit(targetUserID), "action": action, "module": module, "resource_type": emptyAudit(resourceType), "resource_id": emptyAudit(resourceID), "old_values": oldValues, "new_values": newValues, "ip_address": emptyAudit(ipAddress), "user_agent": emptyAudit(userAgent), "severity": fallbackSeverity(severity)}
	return r.client.REST(http.MethodPost, "audit_logs", map[string]string{}, payload, nil)
}

func (r *AuditSupabaseRepository) LogLogin(userID, email, status, failureReason, ipAddress, userAgent string, location map[string]any) error {
	if r.client == nil || !r.client.Enabled() {
		return nil
	}
	payload := map[string]any{"user_id": emptyAudit(userID), "email": strings.TrimSpace(strings.ToLower(email)), "status": status, "failure_reason": emptyAudit(failureReason), "ip_address": emptyAudit(ipAddress), "user_agent": emptyAudit(userAgent), "location_metadata": location}
	return r.client.REST(http.MethodPost, "login_activity", map[string]string{}, payload, nil)
}

func (r *AuditSupabaseRepository) ListAuditLogs(filter domain.AuditFilter) ([]map[string]any, error) {
	if r.client == nil || !r.client.Enabled() {
		return []map[string]any{}, nil
	}
	q := buildAuditQuery(filter)
	q["select"] = "id,actor_user_id,target_user_id,action,module,resource_type,resource_id,severity,created_at,old_values,new_values,ip_address,user_agent"
	var rows []map[string]any
	err := r.client.REST(http.MethodGet, "audit_logs", q, nil, &rows)
	return rows, err
}

func (r *AuditSupabaseRepository) ListLoginActivity(filter domain.AuditFilter) ([]map[string]any, error) {
	if r.client == nil || !r.client.Enabled() {
		return []map[string]any{}, nil
	}
	if filter.Limit <= 0 || filter.Limit > 500 {
		filter.Limit = 100
	}
	q := map[string]string{"select": "id,user_id,email,status,failure_reason,ip_address,user_agent,location_metadata,created_at", "order": "created_at.desc", "limit": fmt.Sprintf("%d", filter.Limit)}
	if v := strings.TrimSpace(filter.Status); v != "" {
		q["status"] = "eq." + strings.ToLower(v)
	}
	if v := strings.TrimSpace(filter.Email); v != "" {
		q["email"] = "ilike.*" + v + "*"
	}
	if v := strings.TrimSpace(filter.ActorUser); v != "" {
		q["user_id"] = "eq." + v
	}
	rangeExpr := buildCreatedAtRange(filter.DateFrom, filter.DateTo)
	if rangeExpr != "" {
		q["and"] = rangeExpr
	}
	var rows []map[string]any
	err := r.client.REST(http.MethodGet, "login_activity", q, nil, &rows)
	return rows, err
}

func (r *AuditSupabaseRepository) ListSecurityEvents(filter domain.AuditFilter) ([]map[string]any, error) {
	if r.client == nil || !r.client.Enabled() {
		return []map[string]any{}, nil
	}
	if filter.Limit <= 0 || filter.Limit > 500 {
		filter.Limit = 100
	}
	auditFilter := filter
	if strings.TrimSpace(auditFilter.Severity) == "" {
		auditFilter.Severity = "critical,high"
	}
	auditRows, err := r.ListAuditLogs(auditFilter)
	if err != nil {
		return nil, err
	}
	loginFilter := filter
	loginFilter.Status = "failed"
	failedLogins, err := r.ListLoginActivity(loginFilter)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(auditRows)+len(failedLogins))
	out = append(out, auditRows...)
	for _, row := range failedLogins {
		out = append(out, map[string]any{"type": "failed_login", "id": row["id"], "user_id": row["user_id"], "email": row["email"], "status": row["status"], "failure_reason": row["failure_reason"], "ip_address": row["ip_address"], "user_agent": row["user_agent"], "created_at": row["created_at"]})
	}
	return out, nil
}

func buildAuditQuery(filter domain.AuditFilter) map[string]string {
	if filter.Limit <= 0 || filter.Limit > 500 {
		filter.Limit = 100
	}
	q := map[string]string{"order": "created_at.desc", "limit": fmt.Sprintf("%d", filter.Limit)}
	if v := strings.TrimSpace(filter.ActorUser); v != "" {
		q["actor_user_id"] = "eq." + v
	}
	if v := strings.TrimSpace(filter.TargetUser); v != "" {
		q["target_user_id"] = "eq." + v
	}
	if v := strings.TrimSpace(filter.Module); v != "" {
		q["module"] = "eq." + strings.ToLower(v)
	}
	if v := strings.TrimSpace(filter.Action); v != "" {
		q["action"] = "ilike.*" + v + "*"
	}
	if v := strings.TrimSpace(filter.Severity); v != "" {
		parts := strings.Split(v, ",")
		vals := make([]string, 0, len(parts))
		for _, p := range parts {
			s := strings.ToLower(strings.TrimSpace(p))
			if s != "" {
				vals = append(vals, s)
			}
		}
		if len(vals) == 1 {
			q["severity"] = "eq." + vals[0]
		}
		if len(vals) > 1 {
			q["severity"] = "in.(" + strings.Join(vals, ",") + ")"
		}
	}
	rangeExpr := buildCreatedAtRange(filter.DateFrom, filter.DateTo)
	if rangeExpr != "" {
		q["and"] = rangeExpr
	}
	return q
}

func buildCreatedAtRange(from, to string) string {
	f := strings.TrimSpace(from)
	t := strings.TrimSpace(to)
	if f == "" && t == "" {
		return ""
	}
	if f != "" && t != "" {
		return "(created_at.gte." + f + ",created_at.lte." + t + ")"
	}
	if f != "" {
		return "(created_at.gte." + f + ")"
	}
	return "(created_at.lte." + t + ")"
}

func emptyAudit(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return strings.TrimSpace(v)
}
func fallbackSeverity(v string) string {
	s := strings.ToLower(strings.TrimSpace(v))
	if s == "critical" || s == "high" || s == "medium" || s == "low" || s == "info" {
		return s
	}
	return "info"
}

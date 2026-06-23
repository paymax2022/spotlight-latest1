package services

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

type AuthService interface {
	RegisterUser(in domain.RegisterRequest) error
	LoginUser(in domain.LoginRequest) (map[string]any, error)
	VerifyEmailToken(token string) error
	ResendVerificationLink(email string) error
	RequestPasswordReset(email string) error
	ResetPassword(token, password string) error
	ChangePassword(accessToken, currentPassword, newPassword string) error
	CompleteProfile(userID string, profileType string, metadata map[string]any) error
}

type authService struct {
	supabase *integrations.SupabaseRestClient
	rbac     RBACService
	cfg      config.Config
}

func NewAuthService(supabase *integrations.SupabaseRestClient, rbac RBACService, cfg config.Config) AuthService {
	return &authService{supabase: supabase, rbac: rbac, cfg: cfg}
}

func (s *authService) RegisterUser(in domain.RegisterRequest) error {
	if in.Password != in.ConfirmPassword {
		return fmt.Errorf("password confirmation mismatch")
	}
	payload := map[string]any{
		"email":    strings.TrimSpace(strings.ToLower(in.Email)),
		"password": in.Password,
		"data": map[string]any{
			"first_name": in.FirstName,
			"last_name":  in.LastName,
			"user_type":  in.UserType,
			"phone":      in.Phone,
		},
	}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(s.supabase.BaseURL(), "/")+"/auth/v1/signup", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", s.supabase.APIKey())
	req.Header.Set("Authorization", "Bearer "+s.supabase.APIKey())
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("registration failed: %d", resp.StatusCode)
	}
	return nil
}

func (s *authService) LoginUser(in domain.LoginRequest) (map[string]any, error) {
	email := strings.TrimSpace(strings.ToLower(in.Email))
	user, err := s.findPlatformUserByEmail(email)
	if err == nil && user != nil {
		if err := s.validateLoginStatus(user); err != nil {
			return nil, err
		}
	}

	payload := map[string]any{"email": email, "password": in.Password}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(s.supabase.BaseURL(), "/")+"/auth/v1/token?grant_type=password", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", s.supabase.APIKey())
	req.Header.Set("Authorization", "Bearer "+s.supabase.APIKey())
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		if user != nil {
			_ = s.bumpFailedLogin(user)
		}
		return nil, fmt.Errorf("invalid credentials")
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if user != nil {
		_ = s.supabase.REST(http.MethodPatch, "platform_users", map[string]string{"id": "eq." + user.ID}, map[string]any{
			"failed_login_attempts": 0,
			"locked_until":          nil,
			"last_login_at":         time.Now().UTC().Format(time.RFC3339),
		}, nil)
		// Surface the platform user id to the handler (internal hint, stripped
		// before the response is returned to the client). Lets the session layer
		// issue a tracked session + run suspicious-login detection.
		out["__user_id"] = user.ID
	}
	// When session hardening is ON the SessionService owns session creation
	// (richer row + rotation metadata), so skip the legacy minimal insert to
	// avoid duplicate rows. Flag OFF keeps the existing behaviour.
	if !s.cfg.FeatureSessionHardeningEnabled {
		_ = s.createSession(user, out)
	}
	return out, nil
}

func (s *authService) RequestPasswordReset(email string) error {
	payload := map[string]any{"email": strings.TrimSpace(strings.ToLower(email))}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(s.supabase.BaseURL(), "/")+"/auth/v1/recover", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", s.supabase.APIKey())
	req.Header.Set("Authorization", "Bearer "+s.supabase.APIKey())
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil
	}
	return nil
}

func (s *authService) ResetPassword(token, password string) error {
	if strings.TrimSpace(token) == "" || len(password) < 8 {
		return fmt.Errorf("invalid reset payload")
	}
	// Supabase reset completion is client-token based; backend keeps this endpoint for contract compatibility.
	return nil
}

func (s *authService) VerifyEmailToken(token string) error {
	if strings.TrimSpace(token) == "" {
		return fmt.Errorf("token is required")
	}
	return nil
}

func (s *authService) ResendVerificationLink(email string) error {
	if strings.TrimSpace(email) == "" {
		return fmt.Errorf("email is required")
	}
	// Supabase handles re-sending verification links by signup/recovery configurations.
	return nil
}

func (s *authService) ChangePassword(accessToken, currentPassword, newPassword string) error {
	if strings.TrimSpace(accessToken) == "" || len(currentPassword) < 8 || len(newPassword) < 8 {
		return fmt.Errorf("invalid password change payload")
	}
	authUser, err := s.supabase.AuthUser(accessToken)
	if err != nil {
		return fmt.Errorf("unauthorized")
	}
	userID := asString(authUser["id"])
	if strings.TrimSpace(userID) == "" {
		return fmt.Errorf("unauthorized")
	}
	// Revoke existing sessions after password change.
	_ = s.supabase.REST(http.MethodPatch, "auth_sessions", map[string]string{
		"user_id":    "eq." + userID,
		"expires_at": "gt." + time.Now().UTC().Format(time.RFC3339),
		"revoked_at": "is.null",
	}, map[string]any{"revoked_at": time.Now().UTC().Format(time.RFC3339)}, nil)
	return nil
}

func (s *authService) CompleteProfile(userID string, profileType string, metadata map[string]any) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(profileType) == "" {
		return fmt.Errorf("user and profile type are required")
	}
	payload := map[string]any{
		"user_id":          userID,
		"profile_type":     profileType,
		"metadata":         metadata,
		"completion_score": 100,
	}
	return s.supabase.REST(http.MethodPost, "profiles", map[string]string{}, payload, nil)
}

type platformUser struct {
	ID                  string
	Status              string
	FailedLoginAttempts int
	LockedUntil         *time.Time
	DeletedAt           *time.Time
}

func (s *authService) findPlatformUserByEmail(email string) (*platformUser, error) {
	var rows []map[string]any
	err := s.supabase.REST(http.MethodGet, "platform_users", map[string]string{
		"email":  "eq." + email,
		"select": "id,status,failed_login_attempts,locked_until,deleted_at",
		"limit":  "1",
	}, nil, &rows)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	row := rows[0]
	u := &platformUser{
		ID:     asString(row["id"]),
		Status: strings.ToLower(asString(row["status"])),
	}
	u.FailedLoginAttempts = asInt(row["failed_login_attempts"])
	u.LockedUntil = asTimePtr(row["locked_until"])
	u.DeletedAt = asTimePtr(row["deleted_at"])
	return u, nil
}

func (s *authService) validateLoginStatus(u *platformUser) error {
	now := time.Now().UTC()
	if u.DeletedAt != nil {
		return fmt.Errorf("account unavailable")
	}
	if u.Status == "suspended" || u.Status == "deleted" {
		return fmt.Errorf("account unavailable")
	}
	if u.Status == "locked" && u.LockedUntil != nil && u.LockedUntil.After(now) {
		return fmt.Errorf("account locked")
	}
	return nil
}

func (s *authService) bumpFailedLogin(u *platformUser) error {
	next := u.FailedLoginAttempts + 1
	body := map[string]any{"failed_login_attempts": next}
	if next >= s.cfg.MaxFailedLoginAttempts {
		body["status"] = "locked"
		body["locked_until"] = time.Now().UTC().Add(time.Duration(s.cfg.AccountLockMinutes) * time.Minute).Format(time.RFC3339)
	}
	return s.supabase.REST(http.MethodPatch, "platform_users", map[string]string{"id": "eq." + u.ID}, body, nil)
}

func (s *authService) createSession(u *platformUser, out map[string]any) error {
	if u == nil {
		return nil
	}
	refresh := asString(out["refresh_token"])
	if strings.TrimSpace(refresh) == "" {
		return nil
	}
	expiresIn := asInt(out["expires_in"])
	if expiresIn <= 0 {
		expiresIn = 86400
	}
	sum := sha256.Sum256([]byte(refresh))
	return s.supabase.REST(http.MethodPost, "auth_sessions", map[string]string{}, map[string]any{
		"user_id":            u.ID,
		"refresh_token_hash": hex.EncodeToString(sum[:]),
		"expires_at":         time.Now().UTC().Add(time.Duration(expiresIn) * time.Second).Format(time.RFC3339),
		"created_at":         time.Now().UTC().Format(time.RFC3339),
	}, nil)
}

func asString(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

func asInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	case float32:
		return int(n)
	default:
		return 0
	}
}

func asTimePtr(v any) *time.Time {
	s := asString(v)
	if strings.TrimSpace(s) == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil
	}
	return &t
}

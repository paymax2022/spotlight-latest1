package services

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

type AuthService interface {
	RegisterUser(in domain.RegisterRequest) (*RegisterResult, error)
	LoginUser(in domain.LoginRequest) (map[string]any, error)
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

// RegisterResult is what registration produces, rather than the bare error the
// caller used to get. Discarding the response body meant this endpoint could
// never return a user or a session, which is why the web and mobile apps each
// grew their own signUp call instead of using it.
type RegisterResult struct {
	UserID string
	Email  string
	// Session is nil when email confirmation is required — which both cloud
	// projects require — and the caller must then send the user to enter a code.
	AccessToken  string
	RefreshToken string
}

// NeedsVerification reports whether the account still has to confirm an emailed
// code before it can be used.
func (r *RegisterResult) NeedsVerification() bool {
	return r == nil || strings.TrimSpace(r.AccessToken) == ""
}

// signupResponse covers BOTH Supabase signup shapes: with confirmation OFF the
// body is {access_token, user:{id}}; with it ON there is no session and the user
// object IS the body, {id, email}. Handling one shape would break silently the
// moment an environment differed — which is precisely what audit item B3 was.
type signupResponse struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	User         struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	} `json:"user"`
}

func parseSignupResponse(body []byte) *RegisterResult {
	var p signupResponse
	if err := json.Unmarshal(body, &p); err != nil {
		return &RegisterResult{}
	}
	out := &RegisterResult{AccessToken: p.AccessToken, RefreshToken: p.RefreshToken}
	if strings.TrimSpace(p.User.ID) != "" {
		out.UserID, out.Email = p.User.ID, p.User.Email
	} else {
		out.UserID, out.Email = strings.TrimSpace(p.ID), p.Email
	}
	return out
}

// extractSignupUserID is retained for callers that only need the id.
func extractSignupUserID(body []byte) string { return parseSignupResponse(body).UserID }

func (s *authService) RegisterUser(in domain.RegisterRequest) (*RegisterResult, error) {
	// Only when the client actually sent it — see domain.RegisterRequest.
	if strings.TrimSpace(in.ConfirmPassword) != "" && in.Password != in.ConfirmPassword {
		return nil, fmt.Errorf("password confirmation mismatch")
	}

	// full_name is what the on_auth_user_created trigger (handle_new_user) copies
	// into user_profiles: COALESCE(raw_user_meta_data->>'full_name', ''). Sending
	// only first_name/last_name gave every account an EMPTY profile name.
	fullName := in.FullNameOrJoin()

	payload := map[string]any{
		"email":    strings.TrimSpace(strings.ToLower(in.Email)),
		"password": in.Password,
		"data": map[string]any{
			"full_name":  fullName,
			"first_name": in.FirstName,
			"last_name":  in.LastName,
			"user_type":  in.UserTypeOrDefault(),
			"phone":      in.Phone,
		},
	}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(s.supabase.BaseURL(), "/")+"/auth/v1/signup", bytes.NewReader(b))
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
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		// The handler does not echo this: a distinguishable "already registered"
		// would be an account-enumeration oracle.
		return nil, fmt.Errorf("registration failed: %d", resp.StatusCode)
	}

	result := parseSignupResponse(respBody)

	// The trigger does not copy phone, so it needs an explicit write. Best-effort:
	// the ACCOUNT EXISTS by now, and failing here would send the user back to
	// register and meet "already registered" on an account that is genuinely theirs.
	if phone := strings.TrimSpace(in.Phone); phone != "" && result.UserID != "" {
		if err := s.supabase.REST(http.MethodPatch, "user_profiles",
			map[string]string{"id": "eq." + result.UserID},
			map[string]any{"phone": phone}, nil); err != nil {
			log.Printf("[auth] register: profile phone update failed for %s: %v", result.UserID, err)
		}
	}
	return result, nil
}

// resolveLoginEmail turns a client-supplied identifier into the account email.
//
// A phone is resolved SERVER-SIDE and the email is never returned to the caller. A
// public "phone -> email" endpoint would be an enumeration oracle: anyone could walk a
// range of numbers and harvest the address behind each. Resolving inside the login call
// means a wrong phone is indistinguishable from a wrong password.
//
// Stored phones are not normalised, so the match is on the last 10 digits (see
// NormalizePhone and the user_profiles_phone_nsn_idx functional index).
func (s *authService) resolveLoginEmail(identifier, fallbackEmail string) string {
	id := strings.TrimSpace(identifier)
	if id == "" {
		return strings.TrimSpace(strings.ToLower(fallbackEmail))
	}
	if LooksLikeEmail(id) {
		return strings.ToLower(id)
	}
	nsn := NormalizePhone(id)
	if nsn == "" {
		return "" // not an email, not a usable phone — no match
	}
	return s.phoneToEmail(nsn)
}

// phoneToEmail finds the account email behind a normalised 10-digit national number.
//
// PostgREST cannot express "last 10 digits of a de-punctuated column", so the match is
// done here: fetch the candidate rows whose stored phone ENDS in those digits (a
// `like` PostgREST can index-assist), then confirm with the same normalisation the
// caller used. Returns "" on no match or ambiguity — two accounts sharing a number is
// a data problem, and guessing between them would sign somebody into the wrong account.
func (s *authService) phoneToEmail(nsn string) string {
	var rows []map[string]any
	if err := s.supabase.REST(http.MethodGet, "user_profiles", map[string]string{
		"phone":  "like.*" + nsn,
		"select": "email,phone",
		"limit":  "5",
	}, nil, &rows); err != nil {
		return ""
	}
	var found string
	for _, r := range rows {
		if NormalizePhone(asString(r["phone"])) != nsn {
			continue
		}
		email := strings.ToLower(strings.TrimSpace(asString(r["email"])))
		if email == "" {
			continue
		}
		if found != "" && found != email {
			return "" // ambiguous — refuse rather than pick
		}
		found = email
	}
	return found
}

func (s *authService) LoginUser(in domain.LoginRequest) (map[string]any, error) {
	email := s.resolveLoginEmail(in.Identifier, in.Email)
	if email == "" {
		// Same error the wrong-password path returns, deliberately: a distinct
		// "no such account" would leak which phone numbers are registered.
		return nil, fmt.Errorf("invalid credentials")
	}
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

	// A 4xx is EXPECTED and must stay quiet: Supabase answers this way for an
	// address with no account, and the endpoint deliberately does not disclose
	// whether one exists. Reporting it would turn the reset form into an account
	// enumeration oracle.
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return nil
	}
	// A 5xx is NOT expected. It previously returned nil too, so an outage looked
	// exactly like success: the user was told to check their email and no email
	// was ever going to arrive. The caller still answers the user identically —
	// this exists so the failure reaches the logs instead of vanishing.
	if resp.StatusCode >= 500 {
		return fmt.Errorf("password reset upstream returned %d", resp.StatusCode)
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

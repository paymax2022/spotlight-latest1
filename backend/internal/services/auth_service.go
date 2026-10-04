package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	RegisterUser(ctx context.Context, in domain.RegisterRequest) (*RegisterResult, error)
	LoginUser(ctx context.Context, in domain.LoginRequest) (map[string]any, error)
	LogoutUser(accessToken string) error
	RequestPasswordReset(ctx context.Context, email string) error
	ChangePassword(ctx context.Context, accessToken, currentPassword, newPassword string) error
	CompleteProfile(userID string, profileType string, metadata map[string]any) error
}

// gotrueHTTPClient bounds the direct GoTrue calls in this file (signup,
// password grant, recovery). AUD-REL-003: these ran on http.DefaultClient —
// no timeout — so a hung GoTrue held the request goroutine forever.
var gotrueHTTPClient = &http.Client{Timeout: 10 * time.Second}

type authService struct {
	// otpOperational is true only when the OTP service was ACTUALLY BUILT —
	// flag on AND pepper AND Brevo credentials AND a database. Branching on the
	// flag alone produced unverifiable accounts: the silent admin creation path
	// sent nothing and neither did the register handler (which checks the wired
	// issuer), leaving a permanently unconfirmed account. The two decisions must
	// share this one signal.
	otpOperational bool

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

// ErrSignupDisabled is returned when the project has closed new sign-ups and the
// admin creation path — which GoTrue does not gate for us — refuses on its behalf.
var ErrSignupDisabled = errors.New("signups are disabled")

func (s *authService) RegisterUser(ctx context.Context, in domain.RegisterRequest) (*RegisterResult, error) {
	// Only when the client actually sent it — see domain.RegisterRequest.
	if strings.TrimSpace(in.ConfirmPassword) != "" && in.Password != in.ConfirmPassword {
		return nil, errors.New("password confirmation mismatch")
	}

	// full_name is what the on_auth_user_created trigger (handle_new_user) copies
	// into user_profiles: COALESCE(raw_user_meta_data->>'full_name', ''). Sending
	// only first_name/last_name gave every account an EMPTY profile name.
	fullName := in.FullNameOrJoin()

	meta := map[string]any{
		"full_name":  fullName,
		"first_name": in.FirstName,
		"last_name":  in.LastName,
		"user_type":  in.UserTypeOrDefault(),
		"phone":      in.Phone,
	}
	email := strings.TrimSpace(strings.ToLower(in.Email))

	// WHICH GOTRUE ENDPOINT CREATES THE ACCOUNT — and why it depends on a flag.
	// /auth/v1/signup sends GoTrue's own confirmation email; there is no setting
	// that keeps the account unconfirmed while suppressing it
	// (enable_confirmations governs BOTH, and SMTP must stay up for the
	// password-reset link).
	// /auth/v1/admin/users sends NOTHING — our own OTP becomes the single
	// verification email, so it is used only when OTP is operational.
	// Accepted differences on the admin path: GoTrue's sign_in_sign_ups rate
	// limit does not apply (the route carries AuthRateLimiter), and the project's
	// enable_signup switch is enforced manually below.
	// Metadata key differs: /signup takes "data", admin takes "user_metadata";
	// the wrong one leaves every profile nameless.
	path := "/auth/v1/signup"
	payload := map[string]any{"email": email, "password": in.Password, "data": meta}
	if s.otpOperational {
		// The admin endpoint bypasses the project's enable_signup switch, so the
		// policy is enforced here from GoTrue's own /settings — read fresh every
		// attempt (a cache is a window a just-closed door stays open through).
		// Fails CLOSED: a settings read that fails signals the create would too.
		disabled, err := s.supabase.SignupDisabled(context.Background())
		if err != nil {
			log.Printf("[auth] register: could not read the project signup policy, refusing: %v", err)
			return nil, ErrSignupDisabled
		}
		if disabled {
			return nil, ErrSignupDisabled
		}

		path = "/auth/v1/admin/users"
		payload = map[string]any{
			"email":         email,
			"password":      in.Password,
			"email_confirm": false,
			"user_metadata": meta,
		}
	}

	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.supabase.BaseURL(), "/")+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Apikey", s.supabase.APIKey())
	req.Header.Set("Authorization", "Bearer "+s.supabase.APIKey())
	req.Header.Set("Content-Type", "application/json")
	resp, err := gotrueHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
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

// ErrEmailNotConfirmed means the credentials were CORRECT but the address has
// not been verified yet.
//
// Safe to distinguish from a bad password, which is not obvious and was checked
// against the live server before relying on it: Supabase returns
// email_not_confirmed ONLY when the password is right. A wrong password on an
// unconfirmed account, and an address with no account at all, both come back as
// invalid_credentials. So this reveals nothing to someone who does not already
// hold the password, and it is the only way to offer the user a route forward.
var ErrEmailNotConfirmed = errors.New("email not confirmed")

// ErrAuthUnavailable means the login could not be EVALUATED at all — the
// GoTrue token endpoint was unreachable, timed out, was rate-limited, or
// answered something unparseable — so no credential verdict exists.
//
// E2E-FR-049: these used to fold into "invalid credentials", which both told
// the user their (correct) password was wrong and counted a strike against
// failed_login_attempts — a GoTrue outage became a mass lockout. Distinct from
// ErrEmailNotConfirmed in the other direction too: that one is a definitive
// answer about the credentials (they were right), this one is the absence of
// any answer. Callers must not count it as a failed attempt.
var ErrAuthUnavailable = errors.New("authentication service unavailable")

// LoginFailureError wraps an error from LoginUser with the identity the service had
// already resolved when the attempt failed — a phone identifier becomes the
// account email, and the platform user id is known once platform_users has
// answered. Login used to hand the handler a bare error, so every failed
// login_activity row was anonymous (E2E-AUTH-007). Unwrap keeps
// errors.Is(err, ErrEmailNotConfirmed) working through the wrapper.
type LoginFailureError struct {
	UserID string
	Email  string
	Err    error
}

func (e *LoginFailureError) Error() string { return e.Err.Error() }
func (e *LoginFailureError) Unwrap() error { return e.Err }

func (s *authService) LoginUser(ctx context.Context, in domain.LoginRequest) (map[string]any, error) {
	email := s.resolveLoginEmail(in.Identifier, in.Email)
	if email == "" {
		// Same error the wrong-password path returns, deliberately: a distinct
		// "no such account" would leak which phone numbers are registered.
		return nil, errors.New("invalid credentials")
	}
	var user *platformUser
	// fail reports err with whatever identity was resolved before the failure,
	// so the handler can attribute the login_activity row.
	fail := func(err error) error {
		f := &LoginFailureError{Email: email, Err: err}
		if user != nil {
			f.UserID = user.ID
		}
		return f
	}
	user, err := s.findPlatformUserByEmail(email)
	if err == nil {
		if user == nil {
			// Zero platform_users rows for an email that is attempting to log in
			// (AUTH-014). The RBAC identity-bridge trigger
			// (20260904000000_rbac_identity_bridge.sql) mirrors auth.users into
			// platform_users SYNCHRONOUSLY, inside the same transaction as account
			// creation — so a normal account always has a row by the time it can
			// log in at all. A missing row here is not a race to tolerate, it's
			// anomalous, and silently skipping the suspension/lock gate for it was
			// the bug: refuse instead, with the same generic message every other
			// refusal on this path uses so this can't be told apart from a wrong
			// password.
			return nil, fail(errors.New("invalid credentials"))
		}
		if err := s.validateLoginStatus(user); err != nil {
			return nil, fail(err)
		}
	}
	// err != nil here means the platform_users lookup itself failed (REST/network),
	// not that it returned zero rows — that case is handled above. Left
	// unchanged: falling through to GoTrue on a lookup error is existing
	// behaviour, not part of AUTH-014.

	payload := map[string]any{"email": email, "password": in.Password}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.supabase.BaseURL(), "/")+"/auth/v1/token?grant_type=password", bytes.NewReader(b))
	if err != nil {
		// A request that cannot even be built is a configuration failure, not a
		// credential verdict.
		return nil, fail(fmt.Errorf("%w: build token request: %w", ErrAuthUnavailable, err))
	}
	req.Header.Set("Apikey", s.supabase.APIKey())
	req.Header.Set("Authorization", "Bearer "+s.supabase.APIKey())
	req.Header.Set("Content-Type", "application/json")
	resp, err := gotrueHTTPClient.Do(req)
	if err != nil {
		// Transport failure/timeout against GoTrue: no verdict was ever reached
		// (E2E-FR-049). Must NOT land on the invalid-credentials path — the
		// handler would log a false wrong-password row, and no strike may count
		// against an account whose password was never evaluated.
		return nil, fail(fmt.Errorf("%w: %w", ErrAuthUnavailable, err))
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		errBody, _ := io.ReadAll(resp.Body)
		var upstream struct {
			ErrorCode string `json:"error_code"`
		}
		_ = json.Unmarshal(errBody, &upstream)

		// The password was CORRECT — only verification is missing. Counting this as
		// a failed attempt locks the account out after MaxFailedLoginAttempts for
		// doing nothing wrong, and the user cannot escape it: every retry is
		// another strike, and the thing they need to fix is not their password.
		if upstream.ErrorCode == "email_not_confirmed" {
			return nil, fail(ErrEmailNotConfirmed)
		}

		// E2E-FR-049: an upstream failure is not a credential verdict. GoTrue
		// answered (or its proxy did) but declined to evaluate — 5xx, or 429
		// from its own rate limiter. Folding these into invalid_credentials
		// counted outage seconds as wrong-password strikes: one degraded-IdP
		// window then mass-locked accounts whose passwords were fine. Only a
		// definitive 4xx credential rejection earns a bumpFailedLogin strike.
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			return nil, fail(fmt.Errorf("%w: token endpoint returned %d", ErrAuthUnavailable, resp.StatusCode))
		}

		if user != nil {
			// A failed bump must not go silent — an uncounted failure is one
			// free retry against the lockout budget (AUD-BE-007).
			if err := s.bumpFailedLogin(user); err != nil {
				log.Printf("bumpFailedLogin(%s): %v", user.ID, err)
			}
		}
		return nil, fail(errors.New("invalid credentials"))
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		// A 2xx we cannot decode is an upstream/version-compat failure, not a
		// verdict on the password — same classification as a transport error.
		return nil, fail(fmt.Errorf("%w: decode token response: %w", ErrAuthUnavailable, err))
	}
	// The ACCOUNT email, which is not the same as what the caller sent — login
	// accepts a phone number and resolves it server-side. A second factor has to
	// be emailed to the resolved address, and the handler has no other way to
	// learn it. Internal hint, stripped before the response leaves the handler.
	out["__email"] = email
	if user != nil {
		patch := platformUserLoginSuccessPatch{
			LastLoginAt: time.Now().UTC().Format(time.RFC3339),
		}
		// status=locked is only reachable here via an expired auto-lockout
		// (validateLoginStatus refuses every other locked state first); reset
		// to the same "active" UnlockUser writes, else the row stays
		// locked+nil locked_until → an indefinite lock on the next login.
		if user.Status == "locked" {
			patch.Status = "active"
		}
		_ = s.supabase.REST(http.MethodPatch, "platform_users", map[string]string{"id": "eq." + user.ID}, patch, nil)
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

// LogoutUser revokes the caller's own GoTrue session — POST /auth/v1/logout
// with the user's access token (default scope: this session only). Called by
// the logout handler; without it logout only cleared the client (E2E-SEC-055).
func (s *authService) LogoutUser(accessToken string) error {
	if strings.TrimSpace(accessToken) == "" {
		return errors.New("access token required")
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, strings.TrimRight(s.supabase.BaseURL(), "/")+"/auth/v1/logout", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Apikey", s.supabase.APIKey())
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := gotrueHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("gotrue logout returned %d", resp.StatusCode)
	}
	return nil
}

func (s *authService) RequestPasswordReset(ctx context.Context, email string) error {
	payload := map[string]any{"email": strings.TrimSpace(strings.ToLower(email))}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.supabase.BaseURL(), "/")+"/auth/v1/recover", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Apikey", s.supabase.APIKey())
	req.Header.Set("Authorization", "Bearer "+s.supabase.APIKey())
	req.Header.Set("Content-Type", "application/json")
	resp, err := gotrueHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

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

func (s *authService) ChangePassword(ctx context.Context, accessToken, currentPassword, newPassword string) error {
	if strings.TrimSpace(accessToken) == "" || len(currentPassword) < 8 || len(newPassword) < 8 {
		return errors.New("invalid password change payload")
	}
	authUser, err := s.supabase.AuthUser(ctx, accessToken)
	if err != nil {
		// AUD-AUTH-001: a definitive rejection means bad/expired token; any
		// other failure is an auth-backend outage, not an authz verdict.
		if errors.Is(err, integrations.ErrTokenInvalid) {
			return errors.New("unauthorized")
		}
		return ErrAuthUnavailable
	}
	userID := asString(authUser["id"])
	if strings.TrimSpace(userID) == "" {
		return errors.New("unauthorized")
	}
	// The bearer token proves a live session, not knowledge of the credential
	// being replaced — verify the current password against GoTrue's own grant
	// before touching anything.
	email := asString(authUser["email"])
	if strings.TrimSpace(email) == "" {
		return errors.New("unauthorized")
	}
	if err := s.supabase.VerifyPasswordGrant(email, currentPassword); err != nil {
		return errors.New("current password is incorrect")
	}
	if err := s.supabase.AdminSetPassword(context.Background(), userID, newPassword); err != nil {
		return errors.New("password update failed")
	}
	// Revoke existing sessions after password change.
	_ = s.supabase.REST(http.MethodPatch, "auth_sessions", map[string]string{
		"user_id":    "eq." + userID,
		"expires_at": "gt." + time.Now().UTC().Format(time.RFC3339),
		"revoked_at": "is.null",
	}, map[string]any{"revoked_at": time.Now().UTC().Format(time.RFC3339)}, nil)
	return nil
}

// allowedProfileTypes mirrors frontend-web's SpotlightProfileType union (plus
// "general", a legacy value still present on rows). E2E-SEC-060: an unchecked
// write let arbitrary strings — including "<script>alert(1)</script>" — land
// in profile_type where admin UIs may render them.
var allowedProfileTypes = map[string]bool{
	"artist": true, "student": true, "school_representative": true,
	"sme_founder": true, "football_talent": true, "actor": true,
	"content_creator": true, "parent_guardian": true,
	"general_applicant": true, "general": true,
}

// profileMetadataAdminKeys are keys whose values only an admin path may set —
// a caller self-asserting them is a privilege claim (E2E-SEC-060 flagged
// program_id, which admin surfaces read back).
var profileMetadataAdminKeys = map[string]bool{
	"program_id": true, "role": true, "status": true,
	"is_admin": true, "permissions": true, "verified": true,
}

func (s *authService) CompleteProfile(userID string, profileType string, metadata map[string]any) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(profileType) == "" {
		return errors.New("user and profile type are required")
	}
	if !allowedProfileTypes[profileType] {
		return errors.New("invalid profile type")
	}
	for k := range metadata {
		if profileMetadataAdminKeys[k] {
			delete(metadata, k)
		}
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

// platformUserLoginSuccessPatch is the PostgREST PATCH body written after a
// successful password login. locked_until must serialize as JSON null to
// clear it, so it has no omitempty; status is only sent when clearing an
// expired auto-lockout latch.
type platformUserLoginSuccessPatch struct {
	FailedLoginAttempts int        `json:"failed_login_attempts"`
	LockedUntil         *time.Time `json:"locked_until"`
	LastLoginAt         string     `json:"last_login_at"`
	Status              string     `json:"status,omitempty"`
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
		return errors.New("account unavailable")
	}
	if u.Status == "suspended" || u.Status == "deleted" {
		return errors.New("account unavailable")
	}
	// A nil LockedUntil means "no expiry" (see UnlockUser, which clears it to nil
	// as part of unlocking), not "not locked" — an indefinite manual lock (e.g.
	// the admin console's "Lock User" action, which sets status=locked without
	// ever setting LockedUntil) must still refuse. Only a LockedUntil that has
	// actually passed lets an auto-lockout (which always sets it) self-expire.
	if u.Status == "locked" && (u.LockedUntil == nil || u.LockedUntil.After(now)) {
		return errors.New("account locked")
	}
	return nil
}

// bumpFailedLogin atomically increments the counter in Postgres via
// bump_failed_login_attempts (20270314000000_atomic_failed_login_bump.sql).
// The previous read-then-PATCH undercounted concurrent failures — two
// requests both read n and both wrote n+1 (AUD-BE-007). The lockout decision
// moved into the function so increment+lock is one statement.
func (s *authService) bumpFailedLogin(u *platformUser) error {
	var attempts int
	if err := s.supabase.RPC("bump_failed_login_attempts", map[string]any{
		"p_user_id":      u.ID,
		"p_max_attempts": s.cfg.MaxFailedLoginAttempts,
		"p_lock_minutes": s.cfg.AccountLockMinutes,
	}, &attempts); err != nil {
		return err
	}
	u.FailedLoginAttempts = attempts
	return nil
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

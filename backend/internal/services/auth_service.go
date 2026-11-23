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

	"github.com/google/uuid"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

type AuthService interface {
	RegisterUser(ctx context.Context, in domain.RegisterRequest) (*RegisterResult, error)
	LoginUser(ctx context.Context, in domain.LoginRequest) (map[string]any, error)
	LogoutUser(accessToken string) error
	ChangePassword(ctx context.Context, accessToken, currentPassword, newPassword string) error
	CompleteProfile(ctx context.Context, userID string, profileType string, metadata map[string]any) error
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
	// AlreadyExisted marks a DECOY result: the address already has an account
	// and GoTrue said so outright. The caller must receive exactly what a fresh
	// unverified signup receives — a distinguishable answer is an account-
	// existence oracle — so UserID is a fabricated uuid and the handler renders
	// the identical body while skipping the side effects that only make sense
	// for a real new account (referral attribution against the fake id, a
	// "register.success" audit row).
	AlreadyExisted bool `json:"-"`
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

// isSignupTakenError recognises GoTrue's "the email already has an account"
// answers. /auth/v1/admin/users replies 422 with error_code "email_exists"
// (older builds used "user_already_exists", and some only fill the msg text).
// /auth/v1/signup never reaches here — with confirmations on it returns an
// obfuscated user and a 200, which is the same decoy this detection restores.
func isSignupTakenError(code string, msgs ...string) bool {
	switch strings.ToLower(code) {
	case "email_exists", "user_already_exists":
		return true
	}
	for _, m := range msgs {
		if strings.Contains(strings.ToLower(m), "already been registered") {
			return true
		}
	}
	return false
}

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
		disabled, err := s.supabase.SignupDisabled(ctx)
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
		var up struct {
			ErrorCode string `json:"error_code"`
			Msg       string `json:"msg"`
			Message   string `json:"message"`
		}
		_ = json.Unmarshal(respBody, &up)

		// "This address is taken" is the one verdict the caller must never
		// receive: a distinct status is an account-existence oracle. The
		// supabase-js registration this endpoint replaced never leaked it —
		// GoTrue's /signup answers a duplicate with an obfuscated user and a
		// 200 — but the silent admin path answers 422/email_exists instead,
		// which is exactly what re-opened the oracle. Convert the definitive
		// signal into a decoy the handler renders like a fresh unverified
		// signup. Every other failure keeps the generic refusal.
		if isSignupTakenError(up.ErrorCode, up.Msg, up.Message) {
			return &RegisterResult{UserID: uuid.NewString(), Email: email, AlreadyExisted: true}, nil
		}
		// A closed project is a policy fact, not a fact about this address —
		// surface it as signup_disabled rather than the generic refusal. The
		// admin path refuses earlier via /settings; this covers /signup.
		if strings.EqualFold(up.ErrorCode, "signup_disabled") {
			return nil, ErrSignupDisabled
		}
		return nil, fmt.Errorf("registration failed: %d", resp.StatusCode)
	}

	result := parseSignupResponse(respBody)

	// The trigger does not copy phone, so it needs an explicit write. Best-effort:
	// the ACCOUNT EXISTS by now, and failing here would send the user back to
	// register and meet "already registered" on an account that is genuinely theirs.
	if phone := strings.TrimSpace(in.Phone); phone != "" && result.UserID != "" {
		if err := s.supabase.REST(ctx, http.MethodPatch, "user_profiles",
			map[string]string{"id": "eq." + result.UserID},
			map[string]any{"phone": phone}, nil); err != nil {
			log.Printf("[auth] register: profile phone update failed for %s: %v", result.UserID, err)
		}
	}
	return result, nil
}

// resolveLoginEmail turns a client-supplied identifier into the account email,
// collapsing every reason it cannot into "".
//
// Kept for the OTP code path (otp_login.go), which has its own, deliberately
// vague posture: there the identifier already came from an address we agreed
// to send a code to, so distinguishing "no account" there buys the user
// nothing and costs an oracle. Password login uses resolveLoginIdentity,
// which reports WHY.
func (s *authService) resolveLoginEmail(ctx context.Context, identifier, fallbackEmail string) string {
	email, err := s.resolveLoginIdentity(ctx, identifier, fallbackEmail)
	if err != nil {
		return ""
	}
	return email
}

// resolveLoginIdentity is resolveLoginEmail with a cause attached.
//
// A phone is still resolved SERVER-SIDE and its email is never returned to the
// caller (see TestLogin_NeverEchoesTheResolvedEmailForAPhoneIdentifier): the
// caller learns "no account uses that number" or "that number is on two
// accounts", not which address sits behind it.
//
// The four failure causes are distinct on purpose — an unusable shape, an
// unknown account, an ambiguous number and a broken lookup were all one ""
// before, which is why a lookup outage could be reported as a missing account.
func (s *authService) resolveLoginIdentity(ctx context.Context, identifier, fallbackEmail string) (string, error) {
	id := strings.TrimSpace(identifier)
	if id == "" {
		fallback := strings.TrimSpace(strings.ToLower(fallbackEmail))
		if fallback == "" {
			return "", ErrInvalidIdentifier
		}
		return fallback, nil
	}
	if LooksLikeEmail(id) {
		return strings.ToLower(id), nil
	}
	nsn := NormalizePhone(id)
	if nsn == "" {
		return "", ErrInvalidIdentifier // neither an email nor a usable phone
	}
	return s.phoneToEmail(ctx, nsn)
}

// phoneToEmail finds the account email behind a normalised 10-digit national number.
//
// PostgREST cannot express "last 10 digits of a de-punctuated column", so the
// match is done here: fetch the candidate rows whose stored phone ENDS in those
// digits (a `like` PostgREST can index-assist), then confirm with the same
// normalisation the caller used.
//
// The three outcomes are separated because the user's next step differs:
// no match → the number is not registered; two matches → sign in with the
// email instead; lookup failure → nothing was proven, so retry (a failed read
// must never be reported as "no account found", which is a claim about data we
// could not read).
func (s *authService) phoneToEmail(ctx context.Context, nsn string) (string, error) {
	var rows []map[string]any
	if err := s.supabase.REST(ctx, http.MethodGet, "user_profiles", map[string]string{
		"phone":  "like.*" + nsn,
		"select": "email,phone",
		"limit":  "5",
	}, nil, &rows); err != nil {
		return "", fmt.Errorf("%w: phone lookup: %w", ErrAuthUnavailable, err)
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
			return "", ErrAmbiguousIdentifier // refuse rather than pick
		}
		found = email
	}
	if found == "" {
		return "", ErrAccountNotFound
	}
	return found, nil
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

// LOGIN FAILURE CAUSES — one per thing that can actually be wrong.
//
// Until ADR-PR802 every refusal below collapsed into errors.New("invalid
// credentials"), which the handler answered as a bare 401. That was a
// deliberate anti-enumeration choice (#788), and in practice it told a user
// whose account was LOCKED, whose account was SUSPENDED, whose address was
// never registered, or who had typed an unusable identifier, that their
// password was wrong. They then did what the message invited: retried the
// password they remembered correctly, each retry another strike against the
// lockout budget. A real user lost an afternoon to exactly that.
//
// The product decision is now to tell the truth (docs/adr/ADR-PR802). These
// are the causes; the handler owns wording and status, this layer owns
// classification and the data a sentence needs (unlock time, strikes left).
//
// Each is only satisfied by its own errors.Is target — TestLoginClass_CausesAreDistinct
// pins that, because two causes matching each other is how "invalid
// credentials" got back in through the side door.
var (
	// ErrInvalidIdentifier: what was typed is neither a parseable email nor a
	// usable Nigerian phone number, so there is nothing to look up.
	ErrInvalidIdentifier = errors.New("invalid identifier")
	// ErrAmbiguousIdentifier: a phone number that more than one account uses.
	// Picking one would sign someone into a stranger's account.
	ErrAmbiguousIdentifier = errors.New("ambiguous identifier")
	// ErrAccountNotFound: nothing registered matches the identifier.
	ErrAccountNotFound = errors.New("account not found")
	// ErrIncorrectPassword: the account exists; the password did not match.
	ErrIncorrectPassword = errors.New("incorrect password")
	// ErrAccountLocked: too many failed attempts; the lock expires. Carries
	// when, via AccountLockedError.
	ErrAccountLocked = errors.New("account locked")
	// ErrAccountLockedByAdmin: status=locked with no locked_until, i.e. the
	// admin console's "Lock User" action. Nothing expires; waiting does not
	// help, so it must not be phrased like an auto-lockout.
	ErrAccountLockedByAdmin = errors.New("account locked by support")
	// ErrAccountSuspended: status suspended/deleted. Needs support, not a
	// password.
	ErrAccountSuspended = errors.New("account suspended")
	// ErrAccountClosed: the profile row is soft-deleted (deleted_at set).
	ErrAccountClosed = errors.New("account closed")
	// ErrIdentityRecordMissing: GoTrue accepts the password but platform_users
	// has no row, so the suspension/lock gate could not run. The session is
	// refused — issuing it would bypass that gate — and the log line is loud
	// because the identity bridge trigger is supposed to make this impossible.
	ErrIdentityRecordMissing = errors.New("identity record missing")
)

// WrongPasswordError reports a bad password and how much of the lockout
// budget is left, so the client can say "3 attempts left" instead of letting
// the user discover the lock by hitting it.
type WrongPasswordError struct {
	AttemptsRemaining int
}

func (e *WrongPasswordError) Error() string {
	return fmt.Sprintf("incorrect password (%d attempts remaining)", e.AttemptsRemaining)
}

func (e *WrongPasswordError) Unwrap() error { return ErrIncorrectPassword }

// AccountLockedError reports a lock that expires at Until (set by
// bump_failed_login_attempts). Until is UTC; the human sentence counts down in
// minutes rather than printing a wall clock in the wrong zone.
type AccountLockedError struct {
	Until time.Time
}

func (e *AccountLockedError) Error() string {
	return "account locked until " + e.Until.UTC().Format(time.RFC3339)
}

func (e *AccountLockedError) Unwrap() error { return ErrAccountLocked }

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
	email, idErr := s.resolveLoginIdentity(ctx, in.Identifier, in.Email)
	if idErr != nil {
		// A cause, not a guess: unparseable input, an unknown number, a number on
		// two accounts, and an unreadable lookup are four different things and the
		// user's next step differs for each. Before ADR-PR802 all four answered
		// "invalid credentials".
		return nil, idErr
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
	// rowMissing records the AUTH-014 state: an email whose platform_users row is
	// absent, so the suspension/lock gate has nothing to check. The password is
	// still evaluated — for CLASSIFICATION only (see below) — never to issue a
	// session.
	rowMissing := false
	user, err := s.findPlatformUserByEmail(ctx, email)
	if err == nil {
		if user == nil {
			// Zero platform_users rows for an email that is attempting to log in
			// (AUTH-014). The RBAC identity-bridge trigger
			// (20260904000000_rbac_identity_bridge.sql) mirrors auth.users into
			// platform_users SYNCHRONOUSLY, inside the same transaction as account
			// creation — so a normal account always has a row by the time it can
			// log in at all. A missing row is still anomalous and still must not
			// produce a session: skipping the gate silently was the original bug.
			// What changed (ADR-PR802) is the ANSWER — GoTrue decides whether this
			// is "no such account" or "your account record is broken", instead of
			// both claiming the password was wrong.
			rowMissing = true
		} else if err := s.validateLoginStatus(user); err != nil {
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
		//
		// With no platform_users row, though, GoTrue accepting the password means
		// the mirror is broken, and "verify your email" would send the user to a
		// code flow for an account this service cannot gate. Report the broken
		// record, which is the true cause.
		if upstream.ErrorCode == "email_not_confirmed" {
			if rowMissing {
				return nil, fail(ErrIdentityRecordMissing)
			}
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

		// A definitive 4xx credential rejection. With no platform_users row there
		// is nothing to strike and no account to sign in: GoTrue just confirmed
		// the address is not registered (or not with that password) — the truth
		// is "no account found", which is ADR-PR802's disclosure.
		if rowMissing {
			return nil, fail(ErrAccountNotFound)
		}

		// The account exists; the password did not match. The atomic bump RPC has
		// already decided in SQL whether this strike trips the lock, and it
		// returns the post-increment count, so the count — not a re-read — tells
		// the user how many tries are left, or that the account is now locked
		// until the window expires. Saying "incorrect password" for the strike
		// that locked them out would hide the thing they now have to act on.
		if err := s.bumpFailedLogin(ctx, user); err != nil {
			// A failed bump must not go silent — an uncounted failure is one
			// free retry against the lockout budget (AUD-BE-007). The stored
			// count never moved, so the budget left is still measured from it.
			log.Printf("bumpFailedLogin(%s): %v", user.ID, err)
			return nil, fail(&WrongPasswordError{
				AttemptsRemaining: s.cfg.MaxFailedLoginAttempts - user.FailedLoginAttempts,
			})
		}
		if user.FailedLoginAttempts >= s.cfg.MaxFailedLoginAttempts {
			lockedUntil := time.Now().UTC().Add(time.Duration(s.cfg.AccountLockMinutes) * time.Minute)
			return nil, fail(&AccountLockedError{Until: lockedUntil})
		}
		return nil, fail(&WrongPasswordError{
			AttemptsRemaining: s.cfg.MaxFailedLoginAttempts - user.FailedLoginAttempts,
		})
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		// A 2xx we cannot decode is an upstream/version-compat failure, not a
		// verdict on the password — same classification as a transport error.
		return nil, fail(fmt.Errorf("%w: decode token response: %w", ErrAuthUnavailable, err))
	}
	// GoTrue accepted the password, but platform_users has no row to gate it
	// against — the suspension/lock check could not run — so the session is
	// withheld rather than issued (AUTH-014 keeps its teeth). Loud on purpose:
	// the identity-bridge trigger makes this state impossible for an account
	// created through this service, so seeing it means data drift, not a
	// credential problem the user can fix. No address in the line: an access log
	// of addresses is a user list.
	if rowMissing {
		log.Printf("[auth] LOGIN: GoTrue accepted a password with no platform_users row — session withheld (identity-bridge drift, ADR-PR802)")
		return nil, fail(ErrIdentityRecordMissing)
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
		_ = s.supabase.REST(ctx, http.MethodPatch, "platform_users", map[string]string{"id": "eq." + user.ID}, patch, nil)
		// Surface the platform user id to the handler (internal hint, stripped
		// before the response is returned to the client). Lets the session layer
		// issue a tracked session + run suspicious-login detection.
		out["__user_id"] = user.ID
	}
	// When session hardening is ON the SessionService owns session creation
	// (richer row + rotation metadata), so skip the legacy minimal insert to
	// avoid duplicate rows. Flag OFF keeps the existing behaviour.
	if !s.cfg.FeatureSessionHardeningEnabled {
		_ = s.createSession(ctx, user, out)
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
	if err := s.supabase.VerifyPasswordGrant(ctx, email, currentPassword); err != nil {
		return errors.New("current password is incorrect")
	}
	if err := s.supabase.AdminSetPassword(ctx, userID, newPassword); err != nil {
		return errors.New("password update failed")
	}
	// Revoke existing sessions after password change.
	_ = s.supabase.REST(ctx, http.MethodPatch, "auth_sessions", map[string]string{
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

// ErrProfileStoreFailed wraps a PostgREST write failure from CompleteProfile.
// The wrapped message embeds the PostgREST error body — table, column and
// constraint names — which must never reach a client; handlers answer this
// with a generic error and keep the detail in logs.
var ErrProfileStoreFailed = errors.New("profile could not be stored")

// profileMetadataAdminKeys are keys whose values only an admin path may set —
// a caller self-asserting them is a privilege claim (E2E-SEC-060 flagged
// program_id, which admin surfaces read back).
var profileMetadataAdminKeys = map[string]bool{
	"program_id": true, "role": true, "status": true,
	"is_admin": true, "permissions": true, "verified": true,
}

func (s *authService) CompleteProfile(ctx context.Context, userID string, profileType string, metadata map[string]any) error {
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
	if err := s.supabase.REST(ctx, http.MethodPost, "profiles", map[string]string{}, payload, nil); err != nil {
		return fmt.Errorf("%w: %w", ErrProfileStoreFailed, err)
	}
	return nil
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

func (s *authService) findPlatformUserByEmail(ctx context.Context, email string) (*platformUser, error) {
	var rows []map[string]any
	err := s.supabase.REST(ctx, http.MethodGet, "platform_users", map[string]string{
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

// validateLoginStatus runs the account-state gate BEFORE any password is
// evaluated, and now says which state it refused on. Every branch here used to
// return the same prose the wrong-password path used, which is how a locked
// account talked its owner into retrying a correct password until the lockout
// deepened.
func (s *authService) validateLoginStatus(u *platformUser) error {
	now := time.Now().UTC()
	// A soft-deleted profile is a closed account, not a punishment: the honest
	// next step is to open a new one, which a "suspended, contact support"
	// sentence would block.
	if u.DeletedAt != nil {
		return ErrAccountClosed
	}
	if u.Status == "suspended" || u.Status == "deleted" {
		return ErrAccountSuspended
	}
	// A nil LockedUntil means "no expiry" (see UnlockUser, which clears it to nil
	// as part of unlocking), not "not locked" — an indefinite manual lock (e.g.
	// the admin console's "Lock User" action, which sets status=locked without
	// ever setting LockedUntil) must still refuse. Only a LockedUntil that has
	// actually passed lets an auto-lockout (which always sets it) self-expire.
	//
	// The two are told apart because only one of them ends by itself: an expired
	// auto-lockout gets a countdown, an admin lock gets support.
	if u.Status == "locked" && (u.LockedUntil == nil || u.LockedUntil.After(now)) {
		if u.LockedUntil == nil {
			return ErrAccountLockedByAdmin
		}
		return &AccountLockedError{Until: *u.LockedUntil}
	}
	return nil
}

// bumpFailedLogin atomically increments the counter in Postgres via
// bump_failed_login_attempts (20270314000000_atomic_failed_login_bump.sql).
// The previous read-then-PATCH undercounted concurrent failures — two
// requests both read n and both wrote n+1 (AUD-BE-007). The lockout decision
// moved into the function so increment+lock is one statement.
func (s *authService) bumpFailedLogin(ctx context.Context, u *platformUser) error {
	var attempts int
	if err := s.supabase.RPC(ctx, "bump_failed_login_attempts", map[string]any{
		"p_user_id":      u.ID,
		"p_max_attempts": s.cfg.MaxFailedLoginAttempts,
		"p_lock_minutes": s.cfg.AccountLockMinutes,
	}, &attempts); err != nil {
		return err
	}
	u.FailedLoginAttempts = attempts
	return nil
}

func (s *authService) createSession(ctx context.Context, u *platformUser, out map[string]any) error {
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
	return s.supabase.REST(ctx, http.MethodPost, "auth_sessions", map[string]string{}, map[string]any{
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

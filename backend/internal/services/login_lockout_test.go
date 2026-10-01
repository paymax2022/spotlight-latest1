package services

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

// AUTH-005: this logic was extensively live-tested during UAT (account
// lockout, expired-lock retry) with no direct unit coverage — these pin the
// behaviour so a regression is caught by `go test`, not only another live
// pass.

func TestValidateLoginStatus_ActiveUserPasses(t *testing.T) {
	u := &platformUser{ID: "u1", Status: "active"}
	if err := (&authService{}).validateLoginStatus(u); err != nil {
		t.Fatalf("active user must be allowed to proceed, got: %v", err)
	}
}

func TestValidateLoginStatus_RefusesSuspendedLockedDeleted(t *testing.T) {
	for _, status := range []string{"suspended", "deleted", "locked"} {
		t.Run(status, func(t *testing.T) {
			u := &platformUser{ID: "u1", Status: status}
			if status == "locked" {
				// Locked with no expiry, or an expiry still in the future, must refuse.
				future := time.Now().UTC().Add(time.Hour)
				u.LockedUntil = &future
			}
			if err := (&authService{}).validateLoginStatus(u); err == nil {
				t.Fatalf("status=%q must refuse login, got nil error", status)
			}
		})
	}
}

func TestValidateLoginStatus_DeletedAtRefusesRegardlessOfStatus(t *testing.T) {
	deletedAt := time.Now().UTC().Add(-time.Hour)
	u := &platformUser{ID: "u1", Status: "active", DeletedAt: &deletedAt}
	if err := (&authService{}).validateLoginStatus(u); err == nil {
		t.Fatal("a non-nil DeletedAt must refuse login even if Status still reads active")
	}
}

// A lock whose locked_until has already passed must NOT refuse — the lockout
// window expired and the next login attempt is the normal retry path.
func TestValidateLoginStatus_ExpiredLockDoesNotRefuse(t *testing.T) {
	past := time.Now().UTC().Add(-time.Minute)
	u := &platformUser{ID: "u1", Status: "locked", LockedUntil: &past}
	if err := (&authService{}).validateLoginStatus(u); err != nil {
		t.Fatalf("a lock whose locked_until is in the past must not refuse login, got: %v", err)
	}
}

// status=="locked" with LockedUntil==nil means an indefinite lock (no
// expiry) and must refuse — this is exactly the state the admin console's
// "Lock User" action produces (RBACSupabaseRepository.LockUser sets
// status=locked but never sets locked_until). AUTH-021: this used to NOT
// refuse, which meant every admin-initiated manual lock had zero effect.
func TestValidateLoginStatus_LockedWithNilLockedUntilRefuses(t *testing.T) {
	u := &platformUser{ID: "u1", Status: "locked", LockedUntil: nil}
	if err := (&authService{}).validateLoginStatus(u); err == nil {
		t.Fatal("status=locked with nil LockedUntil (indefinite lock) must refuse login")
	}
}

// Missing/unknown status: pinning the ACTUAL current behaviour (only
// suspended/deleted/locked are checked, so anything else — including "",
// "pending", or a typo — falls through and is allowed).
func TestValidateLoginStatus_UnknownOrMissingStatusIsNotRefused(t *testing.T) {
	for _, status := range []string{"", "pending", "some-unknown-status"} {
		t.Run("status="+status, func(t *testing.T) {
			u := &platformUser{ID: "u1", Status: status}
			if err := (&authService{}).validateLoginStatus(u); err != nil {
				t.Fatalf("pinning current behaviour: status=%q must NOT refuse, got: %v", status, err)
			}
		})
	}
}

// AUD-BE-007: the increment + lockout decision moved into the
// bump_failed_login_attempts RPC so it is one atomic UPDATE — the read-
// then-PATCH undercounted concurrent failures. The stub therefore asserts the
// CALL (function name + policy params + no client-computed counter/status),
// not the SQL outcome, which is exercised by live-DB suites.

// captureBumpRPC runs bumpFailedLogin against a stub PostgREST server,
// returns the RPC payload, and captures the count it answered with.
func captureBumpRPC(t *testing.T, cfg config.Config, u *platformUser, rpcReply string) (map[string]any, string) {
	t.Helper()
	var body map[string]any
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		if r.Method != http.MethodPost || !strings.Contains(path, "/rest/v1/rpc/bump_failed_login_attempts") {
			t.Fatalf("bump must be a single atomic RPC — got %s %s (a PATCH would reintroduce the read-modify-write race)", r.Method, path)
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(rpcReply))
	}))
	defer srv.Close()

	svc := &authService{supabase: integrations.NewSupabaseRestClient(srv.URL, "key"), cfg: cfg}
	if err := svc.bumpFailedLogin(u); err != nil {
		t.Fatalf("bumpFailedLogin: %v", err)
	}
	return body, path
}

func TestBumpFailedLogin_CallsAtomicRPC(t *testing.T) {
	cfg := config.Config{MaxFailedLoginAttempts: 5, AccountLockMinutes: 30}
	u := &platformUser{ID: "u1", FailedLoginAttempts: 2}
	body, path := captureBumpRPC(t, cfg, u, "3")

	if !strings.Contains(path, "/rpc/bump_failed_login_attempts") {
		t.Fatalf("path = %q, want the atomic bump RPC", path)
	}
	if body["p_user_id"] != "u1" {
		t.Fatalf("p_user_id = %v, want u1", body["p_user_id"])
	}
}

func TestBumpFailedLogin_SendsPolicyParamsNotComputedOutcome(t *testing.T) {
	cfg := config.Config{MaxFailedLoginAttempts: 5, AccountLockMinutes: 30}
	body, _ := captureBumpRPC(t, cfg, &platformUser{ID: "u1", FailedLoginAttempts: 4}, "5")

	if body["p_max_attempts"] != float64(5) || body["p_lock_minutes"] != float64(30) {
		t.Fatalf("policy params = %v, want max_attempts=5 lock_minutes=30", body)
	}
	// The pre-RPC code computed next/status/locked_until in Go — the race was
	// exactly that read-modify-write. None of those may appear in the payload.
	for _, k := range []string{"failed_login_attempts", "status", "locked_until"} {
		if _, present := body[k]; present {
			t.Fatalf("payload carries %q — the lock decision must stay inside the atomic UPDATE", k)
		}
	}
}

func TestBumpFailedLogin_StoresReturnedCount(t *testing.T) {
	cfg := config.Config{MaxFailedLoginAttempts: 5, AccountLockMinutes: 30}
	u := &platformUser{ID: "u1", FailedLoginAttempts: 2}
	captureBumpRPC(t, cfg, u, "3")
	if u.FailedLoginAttempts != 3 {
		t.Fatalf("FailedLoginAttempts = %d, want the RPC-returned 3", u.FailedLoginAttempts)
	}
}

func TestBumpFailedLogin_RPCErrorPropagates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	svc := &authService{supabase: integrations.NewSupabaseRestClient(srv.URL, "key"), cfg: config.Config{}}
	if err := svc.bumpFailedLogin(&platformUser{ID: "u1"}); err == nil {
		t.Fatal("RPC failure must propagate — silently skipped bumps are free retries against the lockout budget")
	}
}

// AUD-BE-009: the success PATCH cleared failed_login_attempts and
// locked_until but never status, so an expired auto-lockout left the row as
// status=locked + locked_until=nil — which validateLoginStatus reads as an
// indefinite ADMIN lock. First login after expiry succeeded, every
// subsequent one was refused until a manual UnlockUser. These pin that the
// latch is cleared to "active" only for users who logged in through an
// expired lock, and untouched for everyone else.

// loginSuccessPatchServer stubs the whole LoginUser path: platform_users GET
// returns the supplied row, GoTrue token grant succeeds, PATCH bodies are
// captured into gotPatch, session insert is accepted.
func loginSuccessPatchServer(t *testing.T, userRow map[string]any, gotPatch *map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "platform_users") && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			b, _ := json.Marshal([]map[string]any{userRow})
			_, _ = w.Write(b)
		case strings.Contains(r.URL.Path, "platform_users") && r.Method == http.MethodPatch:
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, gotPatch)
			w.WriteHeader(http.StatusOK)
		case strings.Contains(r.URL.Path, "/auth/v1/token"):
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"at","refresh_token":"rt","expires_in":3600,"user":{"id":"g1","email":"u@x.com"}}`))
		case strings.Contains(r.URL.Path, "auth_sessions"):
			w.WriteHeader(http.StatusCreated)
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
}

func TestLoginUser_ExpiredAutoLockClearsStatusToActive(t *testing.T) {
	past := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)
	var patch map[string]any
	srv := loginSuccessPatchServer(t, map[string]any{
		"id": "u1", "status": "locked", "failed_login_attempts": 5, "locked_until": past, "deleted_at": nil,
	}, &patch)
	defer srv.Close()

	svc := &authService{
		supabase: integrations.NewSupabaseRestClient(srv.URL, "key"),
		cfg:      config.Config{MaxFailedLoginAttempts: 5, AccountLockMinutes: 30},
	}
	if _, err := svc.LoginUser(domain.LoginRequest{Email: "u@x.com", Password: "pw"}); err != nil {
		t.Fatalf("expired auto-lock must allow login, got: %v", err)
	}
	if patch["status"] != "active" {
		t.Fatalf("PATCH status = %v, want \"active\" — the lock latch must be cleared or the next login locks forever", patch["status"])
	}
	if got, ok := patch["failed_login_attempts"].(float64); !ok || int(got) != 0 {
		t.Fatalf("failed_login_attempts = %v, want 0", patch["failed_login_attempts"])
	}
	if v, present := patch["locked_until"]; !present || v != nil {
		t.Fatalf("locked_until = %v (present=%v), want an explicit JSON null to clear it", v, present)
	}
}

func TestLoginUser_NonLockedLoginDoesNotTouchStatus(t *testing.T) {
	var patch map[string]any
	srv := loginSuccessPatchServer(t, map[string]any{
		"id": "u1", "status": "active", "failed_login_attempts": 1, "locked_until": nil, "deleted_at": nil,
	}, &patch)
	defer srv.Close()

	svc := &authService{
		supabase: integrations.NewSupabaseRestClient(srv.URL, "key"),
		cfg:      config.Config{MaxFailedLoginAttempts: 5, AccountLockMinutes: 30},
	}
	if _, err := svc.LoginUser(domain.LoginRequest{Email: "u@x.com", Password: "pw"}); err != nil {
		t.Fatalf("active user login must succeed, got: %v", err)
	}
	if _, present := patch["status"]; present {
		t.Fatalf("status must not be written for a non-locked login (would flip e.g. pending→active), got: %v", patch["status"])
	}
}

func newAuthServiceWithProfiles(t *testing.T, rows []map[string]any) *authService {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "user_profiles") {
			t.Fatalf("unexpected request to %s — resolveLoginEmail on an email identifier must not hit user_profiles", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		b, _ := json.Marshal(rows)
		_, _ = w.Write(b)
	}))
	t.Cleanup(srv.Close)
	return &authService{supabase: integrations.NewSupabaseRestClient(srv.URL, "key")}
}

// An email-shaped identifier passes through unchanged (lowercased) and must
// not trigger a phone lookup at all.
func TestResolveLoginEmail_EmailShapedIdentifierPassesThroughLowercased(t *testing.T) {
	svc := newAuthServiceWithProfiles(t, nil) // fails the test if REST is ever called
	got := svc.resolveLoginEmail("Ada@Example.COM", "")
	if got != "ada@example.com" {
		t.Errorf("resolveLoginEmail = %q, want lowercased email with no REST call", got)
	}
}

// An empty identifier falls back to the caller-supplied email, lowercased.
func TestResolveLoginEmail_EmptyIdentifierFallsBackToEmail(t *testing.T) {
	svc := &authService{supabase: integrations.NewSupabaseRestClient("http://unused.invalid", "key")}
	got := svc.resolveLoginEmail("   ", "Ada@Example.COM")
	if got != "ada@example.com" {
		t.Errorf("resolveLoginEmail = %q, want the fallback email lowercased", got)
	}
}

// Garbage that is neither an email nor a phone must resolve to "" without a
// network call.
func TestResolveLoginEmail_NonEmailNonPhoneResolvesToEmpty(t *testing.T) {
	svc := &authService{supabase: integrations.NewSupabaseRestClient("http://unused.invalid", "key")}
	if got := svc.resolveLoginEmail("not-an-email-or-phone", "fallback@x.com"); got != "" {
		t.Errorf("resolveLoginEmail = %q, want \"\"", got)
	}
}

// A phone-shaped identifier resolves via the user_profiles lookup.
func TestResolveLoginEmail_PhoneShapedIdentifierResolvesViaProfileLookup(t *testing.T) {
	svc := newAuthServiceWithProfilesFiltered(t, "8159491618", []map[string]any{
		{"email": "Ada@Example.com", "phone": "+2348159491618"},
	})
	got := svc.resolveLoginEmail("08159491618", "")
	if got != "ada@example.com" {
		t.Errorf("resolveLoginEmail = %q, want the resolved+lowercased account email", got)
	}
}

func TestPhoneToEmail_NoMatchReturnsEmpty(t *testing.T) {
	svc := newAuthServiceWithProfilesFiltered(t, "8159491618", nil)
	if got := svc.phoneToEmail("8159491618"); got != "" {
		t.Errorf("phoneToEmail = %q, want \"\" on no match", got)
	}
}

// Two accounts sharing a normalised number is a data problem — refuse rather
// than guess which one to sign in.
func TestPhoneToEmail_AmbiguousMatchReturnsEmpty(t *testing.T) {
	svc := newAuthServiceWithProfilesFiltered(t, "8159491618", []map[string]any{
		{"email": "first@example.com", "phone": "08159491618"},
		{"email": "second@example.com", "phone": "+2348159491618"},
	})
	if got := svc.phoneToEmail("8159491618"); got != "" {
		t.Errorf("phoneToEmail = %q, want \"\" when two accounts share a number", got)
	}
}

// Rows returned by the `like` prefilter that do NOT actually normalise to the
// same 10-digit number (a false-positive from the substring match) must be
// discarded rather than trusted.
func TestPhoneToEmail_DiscardsRowsThatDoNotActuallyMatchAfterNormalisation(t *testing.T) {
	svc := newAuthServiceWithProfilesFiltered(t, "8159491618", []map[string]any{
		{"email": "close-but-no.example.com", "phone": "9159491618"}, // like-matched, normalises differently
	})
	if got := svc.phoneToEmail("8159491618"); got != "" {
		t.Errorf("phoneToEmail = %q, want \"\" — the row does not actually match after normalisation", got)
	}
}

// findPlatformUserByEmail returns (nil, nil) — no error — when the email has
// zero platform_users rows. LoginUser used to read that as "the gate does not
// apply" and fall straight through to GoTrue, so a suspended/locked account
// with no platform_users row (trigger failure, manual cleanup, migration gap)
// authenticated with zero enforcement. The RBAC identity-bridge trigger
// (20260904000000_rbac_identity_bridge.sql) mirrors auth.users into
// platform_users SYNCHRONOUSLY within account creation, so a normal account
// always has a row by the time it can log in — a missing row is anomalous,
// not a race to tolerate, and the fix is to fail closed.

// authServerRefusingToken answers GET .../platform_users with zero rows and
// fails the test if /auth/v1/token is ever called — the fixed LoginUser must
// refuse before it would reach GoTrue at all.
func authServerRefusingToken(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "platform_users") && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
			return
		}
		if strings.Contains(r.URL.Path, "/auth/v1/token") {
			t.Fatalf("LoginUser reached GoTrue at %s despite a missing platform_users row — the AUTH-014 gate must refuse first", r.URL.Path)
		}
		t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
	}))
}

func TestLoginUser_MissingPlatformUsersRowRefusesLogin(t *testing.T) {
	srv := authServerRefusingToken(t)
	defer srv.Close()

	svc := &authService{
		supabase: integrations.NewSupabaseRestClient(srv.URL, "key"),
		cfg:      config.Config{MaxFailedLoginAttempts: 5, AccountLockMinutes: 30},
	}
	_, err := svc.LoginUser(domain.LoginRequest{Email: "ghost@example.com", Password: "correct-horse-battery"})
	if err == nil {
		t.Fatal("LoginUser must refuse when the account has zero platform_users rows, got nil error")
	}
	// Must be the SAME generic message every other refusal on this path uses —
	// a distinct message here would be a new account-enumeration signal.
	if err.Error() != "invalid credentials" {
		t.Fatalf(`err = %q, want "invalid credentials" (the same message wrong-password uses)`, err.Error())
	}
}

// findPlatformUserByEmail itself: pin that zero rows really is (nil, nil), not
// an error — the case LoginUser and otpAuthBridge.gate both have to handle
// explicitly rather than relying on a non-nil error to catch it.
func TestFindPlatformUserByEmail_ZeroRowsReturnsNilNil(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	svc := &authService{supabase: integrations.NewSupabaseRestClient(srv.URL, "key")}
	user, err := svc.findPlatformUserByEmail("ghost@example.com")
	if err != nil {
		t.Fatalf("err = %v, want nil for a zero-row lookup", err)
	}
	if user != nil {
		t.Fatalf("user = %+v, want nil for a zero-row lookup", user)
	}
}

// otpAuthBridge.gate: the second, independent instance of the same bug
// (documented, until this fix, as intentional in gate's own comment). Covers
// both of gate's callers — MintSession (OTP login step-up) and SetPassword
// (OTP-code password reset) — neither of which may reach past the gate on a
// missing row.

func TestOTPGate_MissingPlatformUsersRowRefuses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "platform_users") && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
			return
		}
		t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
	}))
	defer srv.Close()

	auth := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "key"), nil, config.Config{})
	svc := auth.(*authService)
	bridge := &otpAuthBridge{svc: svc}

	_, err := bridge.gate("ghost@example.com")
	if err == nil {
		t.Fatal("gate() must refuse when the account has zero platform_users rows, got nil error")
	}
	if !errors.Is(err, ErrAccountUnavailable) {
		t.Fatalf("err = %v, want it to wrap ErrAccountUnavailable — the same refusal a suspended/locked account gets", err)
	}
}

func TestOTPMintSession_MissingPlatformUsersRowRefusesWithoutMinting(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "platform_users") && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
			return
		}
		t.Fatalf("MintSession reached %s despite a missing platform_users row — AUTH-014 gate must refuse first", r.URL.Path)
	}))
	defer srv.Close()

	auth := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "key"), nil, config.Config{})
	svc := auth.(*authService)
	bridge := &otpAuthBridge{svc: svc}

	session, err := bridge.MintSession(context.Background(), "ghost@example.com")
	if err == nil {
		t.Fatal("MintSession must refuse when the account has zero platform_users rows, got nil error")
	}
	if !errors.Is(err, ErrAccountUnavailable) {
		t.Fatalf("err = %v, want it to wrap ErrAccountUnavailable", err)
	}
	if session != nil {
		t.Fatalf("session = %+v, want nil on refusal", session)
	}
}

func TestOTPSetPassword_MissingPlatformUsersRowRefusesWithoutTouchingAuthUsers(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "platform_users") && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
			return
		}
		t.Fatalf("SetPassword reached %s despite a missing platform_users row — AUTH-014 gate must refuse first", r.URL.Path)
	}))
	defer srv.Close()

	auth := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "key"), nil, config.Config{})
	svc := auth.(*authService)
	// db stays nil: the gate must refuse BEFORE SetPassword ever reaches
	// authUserByEmail, which is the only thing that touches it.
	bridge := &otpAuthBridge{svc: svc}

	changed, err := bridge.SetPassword(context.Background(), "ghost@example.com", "new-correct-horse")
	if err == nil {
		t.Fatal("SetPassword must refuse when the account has zero platform_users rows, got nil error")
	}
	if !errors.Is(err, ErrAccountUnavailable) {
		t.Fatalf("err = %v, want it to wrap ErrAccountUnavailable", err)
	}
	if changed {
		t.Fatal("changed = true on a refusal, want false")
	}
}

// newAuthServiceWithProfilesFiltered stubs GET .../user_profiles and returns
// rows only, regardless of the exact query PostgREST parameters received (the
// production code already asserts the `like.*<nsn>` shape indirectly by only
// working when it's used correctly end-to-end).
func newAuthServiceWithProfilesFiltered(t *testing.T, wantNSNSubstr string, rows []map[string]any) *authService {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "user_profiles") {
			t.Fatalf("unexpected request to %s", r.URL.Path)
		}
		if !strings.Contains(r.URL.RawQuery, wantNSNSubstr) {
			t.Fatalf("query %q does not reference the normalised number %q", r.URL.RawQuery, wantNSNSubstr)
		}
		w.Header().Set("Content-Type", "application/json")
		b, _ := json.Marshal(rows)
		_, _ = w.Write(b)
	}))
	t.Cleanup(srv.Close)
	return &authService{supabase: integrations.NewSupabaseRestClient(srv.URL, "key")}
}

package services

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

// A single blanket "invalid credentials" made every refusal on this path look
// like a wrong password, so an account that was locked, suspended, never
// registered, or typed as a malformed identifier was indistinguishable from a
// mistyped password. That cost a real user their afternoon: an active
// auto-lockout answered 401 "invalid credentials" and they kept retrying the
// correct password, each retry another strike.
//
// These tests pin one distinct, classified cause per failure. The service owns
// the CLASSIFICATION (including the data the message needs — unlock time,
// attempts remaining); the handler owns the wording and the status code
// (auth_login_error_classes_test.go).
//
// Consequences recorded in docs/adr/ADR-PR802: login becomes a bounded
// account-existence oracle, which supersedes the anti-enumeration posture of
// #788's login leg and amends RST-UAT-0011. That tradeoff is the user's
// deliberate choice, not an oversight — do not "fix" these back to generic.

// loginClassStub configures the fake Supabase: what platform_users and
// user_profiles answer, how GoTrue's token endpoint responds, and what the
// atomic bump RPC returns.
type loginClassStub struct {
	platformRows  string // GET platform_users body (default: one active row)
	profileRows   string // GET user_profiles body (default: no rows)
	profileStatus int    // status for GET user_profiles (default: 200)
	tokenStatus   int    // POST /auth/v1/token status (default: 400 invalid_credentials)
	tokenBody     string // POST /auth/v1/token body
	bumpResult    int    // value the bump RPC returns (default 1)
	svcCfg        config.Config

	loginURL string // set by loginClassFail; the fake's base URL

	tokenCalls atomic.Int32
	bumpCalls  atomic.Int32
	sessionRow bool // an auth_sessions insert was attempted

	mu    sync.Mutex
	paths []string
}

func (st *loginClassStub) loginServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		st.mu.Lock()
		st.paths = append(st.paths, r.Method+" "+r.URL.Path)
		st.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(r.URL.Path, "/auth/v1/token"):
			st.tokenCalls.Add(1)
			status := st.tokenStatus
			if status == 0 {
				status = http.StatusBadRequest
			}
			body := st.tokenBody
			if body == "" {
				body = `{"error_code":"invalid_credentials","msg":"Invalid login credentials"}`
			}
			w.WriteHeader(status)
			_, _ = w.Write([]byte(body))
		case strings.Contains(r.URL.Path, "bump_failed_login_attempts"):
			st.bumpCalls.Add(1)
			n := st.bumpResult
			if n == 0 {
				n = 1
			}
			_, _ = fmt.Fprintf(w, "%d", n)
		case strings.Contains(r.URL.Path, "auth_sessions"):
			st.sessionRow = true
			_, _ = w.Write([]byte(`[]`))
		case strings.Contains(r.URL.Path, "platform_users") && r.Method == http.MethodGet:
			rows := st.platformRows
			if rows == "" {
				rows = `[{"id":"u1","status":"active","failed_login_attempts":0,"locked_until":null,"deleted_at":null}]`
			}
			_, _ = w.Write([]byte(rows))
		case strings.Contains(r.URL.Path, "user_profiles") && r.Method == http.MethodGet:
			if st.profileStatus != 0 && st.profileStatus >= 400 {
				w.WriteHeader(st.profileStatus)
				_, _ = w.Write([]byte(`{"error":"lookup failed"}`))
				return
			}
			rows := st.profileRows
			if rows == "" {
				rows = `[]`
			}
			_, _ = w.Write([]byte(rows))
		case strings.Contains(r.URL.Path, "platform_users") && r.Method == http.MethodPatch:
			_, _ = w.Write([]byte(`[]`))
		default:
			t.Errorf("unexpected upstream request: %s %s", r.Method, r.URL.Path)
			_, _ = w.Write([]byte(`[]`))
		}
	}))
}

func (st *loginClassStub) svc() *authService {
	cfg := st.svcCfg
	if cfg.MaxFailedLoginAttempts == 0 {
		cfg.MaxFailedLoginAttempts = 5
	}
	if cfg.AccountLockMinutes == 0 {
		cfg.AccountLockMinutes = 30
	}
	return &authService{supabase: integrations.NewSupabaseRestClient(st.loginURL, "key"), cfg: cfg}
}

// Every case below must be classified WITHOUT the handler ever seeing the
// password verdict as a guess: the error must be one of the named causes.
func loginClassFail(t *testing.T, st *loginClassStub, identifier string) error {
	t.Helper()
	srv := st.loginServer(t)
	defer srv.Close()
	st.loginURL = srv.URL
	_, err := st.svc().LoginUser(context.Background(), domain.LoginRequest{
		Identifier: identifier,
		Password:   "correct-horse-battery",
	})
	if err == nil {
		t.Fatal("LoginUser succeeded; the case is not a failure")
	}
	return err
}

func platformRow(status string, failed int, lockedUntil, deletedAt *string) string {
	lu := "null"
	if lockedUntil != nil {
		lu = `"` + *lockedUntil + `"`
	}
	da := "null"
	if deletedAt != nil {
		da = `"` + *deletedAt + `"`
	}
	return `[{"id":"u1","status":"` + status + `","failed_login_attempts":` +
		strconv.Itoa(failed) + `,"locked_until":` + lu + `,"deleted_at":` + da + `}]`
}

func strPtr(s string) *string { return &s }

// ── 1. The address simply is not registered ────────────────────────────────

// An email with no platform_users row whose password is rejected by GoTrue is
// "no account found", not "wrong password". This is the disclosure ADR-PR802
// accepts in exchange for telling people the truth.
func TestLoginClass_UnknownEmailIsAccountNotFound(t *testing.T) {
	st := &loginClassStub{platformRows: `[]`}
	err := loginClassFail(t, st, "nobody-at-all@example.com")
	if !errors.Is(err, ErrAccountNotFound) {
		t.Fatalf("err = %v, want ErrAccountNotFound for an unregistered address", err)
	}
	if errors.Is(err, ErrIncorrectPassword) {
		t.Fatal("an unregistered address must not be reported as a wrong password")
	}
	if st.bumpCalls.Load() != 0 {
		t.Fatalf("bump_failed_login_attempts called %d times for an account that does not exist", st.bumpCalls.Load())
	}
	var fail *LoginFailureError
	if !errors.As(err, &fail) || fail.Email != "nobody-at-all@example.com" {
		t.Fatalf("err = %v, want a *LoginFailureError carrying the attempted address for the audit row", err)
	}
}

// A correctly-formatted phone that matches no account is the same answer.
func TestLoginClass_UnknownPhoneIsAccountNotFound(t *testing.T) {
	st := &loginClassStub{profileRows: `[]`}
	err := loginClassFail(t, st, "+234 803 555 0199")
	if !errors.Is(err, ErrAccountNotFound) {
		t.Fatalf("err = %v, want ErrAccountNotFound for a phone no account uses", err)
	}
	if st.tokenCalls.Load() != 0 {
		t.Fatal("a phone that resolves to no email must not be sent to GoTrue")
	}
}

// ── 2. The identifier itself is unusable ───────────────────────────────────

func TestLoginClass_UnusableIdentifierIsInvalidIdentifier(t *testing.T) {
	st := &loginClassStub{}
	err := loginClassFail(t, st, "not-an-email-or-phone")
	if !errors.Is(err, ErrInvalidIdentifier) {
		t.Fatalf("err = %v, want ErrInvalidIdentifier — the user typed something unparseable", err)
	}
	if errors.Is(err, ErrAccountNotFound) {
		t.Fatal("an unparseable identifier must not claim the account is missing")
	}
}

// Two accounts sharing one number is a data problem; guessing between them
// could sign someone into the wrong account, so it needs its own answer.
func TestLoginClass_AmbiguousPhoneIsItsOwnCause(t *testing.T) {
	st := &loginClassStub{profileRows: `[` +
		`{"email":"a@example.com","phone":"08035550111"},` +
		`{"email":"b@example.com","phone":"+2348035550111"}` + `]`}
	err := loginClassFail(t, st, "08035550111")
	if !errors.Is(err, ErrAmbiguousIdentifier) {
		t.Fatalf("err = %v, want ErrAmbiguousIdentifier, not a generic refusal", err)
	}
}

// A lookup that cannot be completed is not evidence of absence: the phone→email
// resolution failing on a REST error must read as "try again", never as "no
// account found".
func TestLoginClass_IdentifierLookupFailureIsUnavailable(t *testing.T) {
	st := &loginClassStub{profileStatus: http.StatusServiceUnavailable}
	err := loginClassFail(t, st, "08035550111")
	if !errors.Is(err, ErrAuthUnavailable) {
		t.Fatalf("err = %v, want ErrAuthUnavailable — a broken lookup cannot prove absence", err)
	}
	if errors.Is(err, ErrAccountNotFound) {
		t.Fatal("a failed lookup must not be reported as a missing account")
	}
}

// ── 3. Locked out ──────────────────────────────────────────────────────────

// The case that started this: status=locked with a future locked_until. The
// message needs the unlock time, so the error has to carry it.
func TestLoginClass_TimedLockoutReportsUnlockTime(t *testing.T) {
	until := time.Now().UTC().Add(12 * time.Minute).Truncate(time.Second)
	st := &loginClassStub{platformRows: platformRow("locked", 5, strPtr(until.Format(time.RFC3339)), nil)}
	err := loginClassFail(t, st, "locked-out@example.com")
	if !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("err = %v, want ErrAccountLocked", err)
	}
	var locked *AccountLockedError
	if !errors.As(err, &locked) {
		t.Fatalf("err = %v, want *AccountLockedError so the message can say when it ends", err)
	}
	if diff := locked.Until.Sub(until); diff > time.Second || diff < -time.Second {
		t.Fatalf("AccountLockedError.Until = %v, want the locked_until value %v", locked.Until, until)
	}
	if st.tokenCalls.Load() != 0 {
		t.Fatal("a locked account must never have its password evaluated")
	}
	if st.bumpCalls.Load() != 0 {
		t.Fatal("retrying while locked must not extend the lockout with another strike")
	}
}

// status=locked with locked_until NULL is an admin lock with no expiry — the
// user cannot wait it out, so it must be tellable apart from an auto-lockout.
func TestLoginClass_AdminLockIsNotTimedLockout(t *testing.T) {
	st := &loginClassStub{platformRows: platformRow("locked", 0, nil, nil)}
	err := loginClassFail(t, st, "locked-out@example.com")
	if !errors.Is(err, ErrAccountLockedByAdmin) {
		t.Fatalf("err = %v, want ErrAccountLockedByAdmin (indefinite lock, no expiry to report)", err)
	}
	if errors.Is(err, ErrAccountSuspended) {
		t.Fatal("a lock is not a suspension")
	}
}

// ── 4. Suspended and closed accounts ───────────────────────────────────────

func TestLoginClass_SuspendedIsItsOwnCause(t *testing.T) {
	for _, status := range []string{"suspended", "deleted"} {
		t.Run(status, func(t *testing.T) {
			st := &loginClassStub{platformRows: platformRow(status, 0, nil, nil)}
			err := loginClassFail(t, st, "banned@example.com")
			if !errors.Is(err, ErrAccountSuspended) {
				t.Fatalf("status=%q: err = %v, want ErrAccountSuspended", status, err)
			}
			if errors.Is(err, ErrAccountClosed) || errors.Is(err, ErrAccountLocked) {
				t.Fatalf("status=%q: suspended must not read as locked or closed", status)
			}
			if st.tokenCalls.Load() != 0 {
				t.Fatalf("status=%q: password was evaluated for a suspended account", status)
			}
		})
	}
}

func TestLoginClass_SoftDeletedIsAccountClosed(t *testing.T) {
	st := &loginClassStub{platformRows: platformRow("active", 0, nil, strPtr(time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)))}
	err := loginClassFail(t, st, "gone@example.com")
	if !errors.Is(err, ErrAccountClosed) {
		t.Fatalf("err = %v, want ErrAccountClosed — the account was closed, that is a different sentence", err)
	}
}

// ── 5. The password is genuinely wrong ─────────────────────────────────────

func TestLoginClass_WrongPasswordIsNamedAsThePassword(t *testing.T) {
	st := &loginClassStub{bumpResult: 2}
	err := loginClassFail(t, st, "someone@example.com")
	if !errors.Is(err, ErrIncorrectPassword) {
		t.Fatalf("err = %v, want ErrIncorrectPassword for a registered account with a bad password", err)
	}
	if errors.Is(err, ErrAccountNotFound) {
		t.Fatal("a wrong password must not claim the account is missing")
	}
	var wrong *WrongPasswordError
	if !errors.As(err, &wrong) {
		t.Fatalf("err = %v, want *WrongPasswordError so the message can say how many tries are left", err)
	}
	if wrong.AttemptsRemaining != 3 {
		t.Fatalf("AttemptsRemaining = %d, want 3 (max 5, two failures counted)", wrong.AttemptsRemaining)
	}
	if st.bumpCalls.Load() != 1 {
		t.Fatalf("bump RPC calls = %d, want exactly 1 strike", st.bumpCalls.Load())
	}
}

// The strike that trips the lock must report the lock, not "one try left".
func TestLoginClass_FifthStrikeReportsTheLock(t *testing.T) {
	st := &loginClassStub{bumpResult: 5}
	err := loginClassFail(t, st, "someone@example.com")
	if !errors.Is(err, ErrAccountLocked) {
		t.Fatalf("err = %v, want ErrAccountLocked — this attempt locked the account", err)
	}
}

// ── 6. Identity record missing ─────────────────────────────────────────────

// platform_users has no row but GoTrue accepts the password: the account
// exists and its mirror row is broken. Never issue the session (that would
// bypass the suspension/lock gate), and say so plainly instead of pretending
// the password was wrong.
func TestLoginClass_GoTrueAcceptsWithoutPlatformRowRefuses(t *testing.T) {
	st := &loginClassStub{
		platformRows: `[]`,
		tokenStatus:  http.StatusOK,
		tokenBody:    `{"access_token":"tok","refresh_token":"ref","expires_in":3600}`,
	}
	srv := st.loginServer(t)
	defer srv.Close()
	st.loginURL = srv.URL
	out, err := st.svc().LoginUser(context.Background(), domain.LoginRequest{
		Identifier: "ghost@example.com", Password: "correct-horse-battery",
	})
	if err == nil {
		t.Fatalf("LoginUser returned a session (%d keys) for an account with no platform_users row", len(out))
	}
	if out != nil {
		t.Fatal("a discarded session must not be returned to the handler")
	}
	if !errors.Is(err, ErrIdentityRecordMissing) {
		t.Fatalf("err = %v, want ErrIdentityRecordMissing, not a credential verdict", err)
	}
	if errors.Is(err, ErrAccountNotFound) || errors.Is(err, ErrIncorrectPassword) {
		t.Fatal("GoTrue accepted the password: calling this a bad credential is a lie")
	}
	if st.sessionRow {
		t.Fatal("an auth_sessions row was written for a session that was never issued")
	}
}

// ── 7. The causes must be mutually exclusive ───────────────────────────────

// One error, one cause: a wrapped error that satisfies two of the sentinels is
// how the generic message came back, and it must not come back through the
// side door.
func TestLoginClass_CausesAreDistinct(t *testing.T) {
	causes := []error{
		ErrAccountNotFound, ErrIncorrectPassword, ErrAccountLocked, ErrAccountLockedByAdmin,
		ErrAccountSuspended, ErrAccountClosed, ErrInvalidIdentifier, ErrAmbiguousIdentifier,
		ErrIdentityRecordMissing, ErrEmailNotConfirmed, ErrAuthUnavailable,
	}
	for i, a := range causes {
		for j, b := range causes {
			if i == j {
				continue
			}
			if errors.Is(a, b) {
				t.Fatalf("causes %q and %q are not distinguishable — errors.Is conflates them", a, b)
			}
		}
	}
}

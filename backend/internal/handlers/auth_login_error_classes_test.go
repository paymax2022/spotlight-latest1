package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"spotlight/backend/internal/services"
)

// Login used to answer every refusal except two with the same 401 body:
// {"error":"invalid credentials"}. A locked account, a suspended account, an
// address that was never registered, and a mistyped identifier were all
// reported as "wrong password", so the user did the one thing the message
// invited — retry the password they remembered correctly, each attempt
// burning another strike against the lockout.
//
// The user's instruction this change implements, verbatim: "if the issue is
// that account is locked out, then error message should indicate it clearly,
// and if its password or email related issue, then error message should be
// clear and say it .. do not generalize the issues".
//
// So: one status + one code + one human sentence per cause, and each sentence
// must name the actual cause. Recorded in docs/adr/ADR-PR1163; the
// anti-enumeration leg of #788 and RST-UAT-0011 are amended accordingly.

type loginClass struct {
	name       string
	err        error
	identifier string
	status     int
	code       string
	reason     string
	want       []string // substrings the sentence must contain
	banned     []string // substrings it must NOT contain
}

func loginClassCases() []loginClass {
	until := time.Now().UTC().Add(12 * time.Minute)
	typed := "+234 803 555 0111"
	resolved := "someone@example.com"
	return []loginClass{
		{
			name:       "locked out",
			err:        &services.AccountLockedError{Until: until},
			identifier: typed,
			status:     http.StatusLocked,
			code:       "account_locked",
			reason:     "account_locked",
			want:       []string{"locked", "12 minute", typed},
			// The countdown is the only way out of a time lock, because a completed
			// password reset does NOT clear failed_login_attempts/locked_until (the ADR
			// records that gap). Telling a locked user to reset would promise something
			// the reset cannot deliver.
			banned:     []string{"invalid credentials", resolved, "Forgot password"},
		},
		{
			name:       "locked by support",
			err:        services.ErrAccountLockedByAdmin,
			identifier: typed,
			status:     http.StatusLocked,
			code:       "account_locked_by_support",
			reason:     "account_locked_by_support",
			want:       []string{"locked", "support"},
			banned:     []string{"invalid credentials", "minute"},
		},
		{
			name:       "wrong password",
			err:        &services.WrongPasswordError{AttemptsRemaining: 3},
			identifier: typed,
			status:     http.StatusUnauthorized,
			code:       "incorrect_password",
			reason:     "incorrect_password",
			// "Forgot password" is pinned because the same sentence has to work for the
			// person whose sign-up was a decoy (address already had an account): the
			// reset link is the only exit that is not a dead end for them.
			want:       []string{"password", "3 attempts left", "Forgot password", typed},
			banned:     []string{"invalid credentials", "is locked", resolved},
		},
		{
			name:       "no such account",
			err:        services.ErrAccountNotFound,
			identifier: typed,
			status:     http.StatusUnauthorized,
			code:       "account_not_found",
			reason:     "account_not_found",
			want:       []string{"No account found", typed},
			banned:     []string{"invalid credentials", "password", resolved},
		},
		{
			name:       "suspended",
			err:        services.ErrAccountSuspended,
			identifier: typed,
			status:     http.StatusForbidden,
			code:       "account_suspended",
			reason:     "account_suspended",
			want:       []string{"suspended", "support"},
			banned:     []string{"invalid credentials", "password"},
		},
		{
			name:       "closed",
			err:        services.ErrAccountClosed,
			identifier: typed,
			status:     http.StatusForbidden,
			code:       "account_closed",
			reason:     "account_closed",
			want:       []string{"closed"},
			banned:     []string{"invalid credentials", "suspended"},
		},
		{
			name:       "unusable identifier",
			err:        services.ErrInvalidIdentifier,
			identifier: "080",
			status:     http.StatusBadRequest,
			code:       "invalid_identifier",
			reason:     "invalid_identifier",
			want:       []string{"email address or phone number"},
			banned:     []string{"invalid credentials", "password"},
		},
		{
			name:       "ambiguous phone",
			err:        services.ErrAmbiguousIdentifier,
			identifier: typed,
			status:     http.StatusBadRequest,
			code:       "ambiguous_identifier",
			reason:     "ambiguous_identifier",
			want:       []string{"more than one account", "email"},
			banned:     []string{"invalid credentials"},
		},
		{
			name:       "identity record missing",
			err:        services.ErrIdentityRecordMissing,
			identifier: typed,
			status:     http.StatusInternalServerError,
			code:       "account_record_missing",
			reason:     "identity_record_missing",
			want:       []string{"can't load your account"},
			banned:     []string{"invalid credentials", "password"},
		},
		{
			name:       "email not confirmed",
			err:        services.ErrEmailNotConfirmed,
			identifier: typed,
			status:     http.StatusForbidden,
			code:       "email_not_confirmed",
			reason:     "email_not_confirmed",
			want:       []string{"not been verified"},
			banned:     []string{"invalid credentials", "password"},
		},
		{
			name:       "upstream outage",
			err:        fmt.Errorf("%w: token endpoint returned 502", services.ErrAuthUnavailable),
			identifier: typed,
			status:     http.StatusServiceUnavailable,
			code:       "auth_unavailable",
			reason:     "upstream_error",
			want:       []string{"temporarily unavailable"},
			banned:     []string{"invalid credentials", "password"},
		},
	}
}

func TestLogin_AnswersEachCauseWithItsOwnMessage(t *testing.T) {
	seenCodes := map[string]string{}
	for _, tc := range loginClassCases() {
		t.Run(tc.name, func(t *testing.T) {
			auth := &stubAuthService{loginErr: &services.LoginFailureError{
				UserID: "pu-1", Email: "someone@example.com", Err: tc.err,
			}}
			r, audit := loginAuditRouter(t, auth)
			w := post(t, r, "/api/auth/login",
				map[string]string{"identifier": tc.identifier, "password": "correct-horse-battery"})

			if w.Code != tc.status {
				t.Fatalf("status = %d, want %d — body: %s", w.Code, tc.status, w.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("body is not JSON: %v (%s)", err, w.Body.String())
			}
			if got, _ := body["code"].(string); got != tc.code {
				t.Errorf("code = %q, want %q", got, tc.code)
			}
			msg, _ := body["error"].(string)
			for _, s := range tc.want {
				if !strings.Contains(msg, s) {
					t.Errorf("message %q must contain %q", msg, s)
				}
			}
			for _, s := range tc.banned {
				if strings.Contains(msg, s) {
					t.Errorf("message %q must NOT contain %q — that is generalising the cause", msg, s)
				}
			}
			got, ok := audit.last()
			if !ok {
				t.Fatal("no login_activity row written")
			}
			if got.reason != tc.reason {
				t.Errorf("audit failure_reason = %q, want %q", got.reason, tc.reason)
			}
			if got.status != "failed" {
				t.Errorf("audit status = %q, want failed", got.status)
			}
			seenCodes[tc.code] = tc.name
		})
	}
	if len(seenCodes) != len(loginClassCases()) {
		t.Errorf("codes are not unique per cause: %v", seenCodes)
	}
}

// The message tells the user about the thing THEY typed. A phone identifier
// resolves to an account email server-side; leaking it into a client-visible
// sentence would hand out the address behind any number.
func TestLogin_NeverEchoesTheResolvedEmailForAPhoneIdentifier(t *testing.T) {
	for _, tc := range loginClassCases() {
		auth := &stubAuthService{loginErr: &services.LoginFailureError{
			UserID: "pu-1", Email: "someone@example.com", Err: tc.err,
		}}
		r, _ := loginAuditRouter(t, auth)
		w := post(t, r, "/api/auth/login",
			map[string]string{"identifier": "+234 803 555 0111", "password": "correct-horse-battery"})
		if body := w.Body.String(); strings.Contains(body, "someone@example.com") {
			t.Errorf("%s: response leaks the resolved email: %s", tc.name, body)
		}
	}
}

// An unclassified error still gets the old generic 401. Not every refusal on
// this path is a known cause — a nil-pointer wrap from elsewhere must not be
// dressed up as one of the named ones — but no KNOWN cause may fall through
// here, which is what the table above pins.
func TestLogin_KeepsGenericFallbackOnlyForUnclassifiedErrors(t *testing.T) {
	auth := &stubAuthService{loginErr: errors.New("something unexpected")}
	r, audit := loginAuditRouter(t, auth)
	w := post(t, r, "/api/auth/login",
		map[string]string{"email": "ada@example.com", "password": "correct-horse-battery"})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if got, _ := audit.last(); got.reason != "invalid_credentials" {
		t.Errorf("audit reason = %q, want invalid_credentials", got.reason)
	}
}

package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrAccountUnavailable is returned when the lockout gate refuses a step-up.
var ErrAccountUnavailable = errors.New("account unavailable")

// SessionMinter issues a session for a user whose second factor has just been
// proved. It is the login step-up's other half.
//
// ⚠️ Whatever holds this interface can log in as anyone whose address it names.
// The ONLY legitimate caller is the OTP verify path for purpose=login, and that
// path is reachable only for a code that the PASSWORD-verified login flow issued
// — see handlers.OTPHandler.RequestOTP, which refuses to issue login codes to
// the public.
type SessionMinter interface {
	// MintSession returns a session for email, or (nil, nil) when there is no
	// usable account. A nil map with a nil error is the "no account" case and
	// must be answered identically to success by the caller.
	MintSession(ctx context.Context, email string) (map[string]any, error)
}

// PasswordSetter completes a code-based password reset.
type PasswordSetter interface {
	// SetPassword replaces the password for email. Reports (false, nil) when no
	// account exists — an ordinary outcome, since the reset endpoint accepts any
	// address on purpose.
	SetPassword(ctx context.Context, email, newPassword string) (bool, error)
}

// otpAuthBridge implements both against the same authService, so the lockout
// gate, the platform_users lookup and the Supabase client are the ones login
// already uses rather than a second copy that can drift from them.
type otpAuthBridge struct {
	svc *authService
	db  *pgxpool.Pool
}

// NewOTPAuthBridge adapts an AuthService for the OTP flows. Returns nil unless
// every dependency is present, so a caller can treat nil as "not available"
// instead of discovering it at a user's first step-up.
func NewOTPAuthBridge(auth AuthService, db *pgxpool.Pool) *otpAuthBridge {
	svc, ok := auth.(*authService)
	if !ok || svc == nil || svc.supabase == nil || !svc.supabase.Enabled() || db == nil {
		return nil
	}
	return &otpAuthBridge{svc: svc, db: db}
}

// gate re-runs the lockout checks and returns the platform user.
//
// Re-run rather than trusted from the password step: minutes can pass between
// the two factors, and an account suspended in between must not complete a
// login that started before it. The password path is not the authority on
// whether an account is still allowed in at the moment a session is issued.
func (b *otpAuthBridge) gate(email string) error {
	user, err := b.svc.findPlatformUserByEmail(email)
	if err != nil || user == nil {
		// No platform_users row is not a refusal: login treats that the same way
		// (the gate only applies when a row exists).
		return nil
	}
	if err := b.svc.validateLoginStatus(user); err != nil {
		return fmt.Errorf("%w: %v", ErrAccountUnavailable, err)
	}
	return nil
}

func (b *otpAuthBridge) MintSession(ctx context.Context, email string) (map[string]any, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return nil, nil
	}
	if err := b.gate(email); err != nil {
		return nil, err
	}
	session, err := b.svc.supabase.MintSessionByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	return session, nil
}

func (b *otpAuthBridge) SetPassword(ctx context.Context, email, newPassword string) (bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || newPassword == "" {
		return false, nil
	}
	// The lockout gate applies here too. A suspended account must not be able to
	// take a new password and walk back in.
	if err := b.gate(email); err != nil {
		return false, err
	}

	id, _, err := authUserByEmail(ctx, b.db, email)
	if err != nil {
		return false, err
	}
	if id == "" {
		return false, nil // no account — an ordinary outcome
	}
	if err := b.svc.supabase.AdminSetPassword(ctx, id, newPassword); err != nil {
		return false, err
	}
	return true, nil
}

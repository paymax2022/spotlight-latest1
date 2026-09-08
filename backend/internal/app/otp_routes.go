package app

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/email"
	"spotlight/backend/internal/handlers"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/otp"
	"spotlight/backend/internal/services"
)

// registerOTPRoutes wires POST /api/auth/otp/{request,verify}.
//
// SCOPE — read this before assuming more than it does.
//
// This is a SECOND OTP system. Today every OTP a user receives is minted and
// mailed by Supabase Auth, not by us (docs/audit/USER_MANAGEMENT_AUDIT.md, B1:
// no SMTP on either cloud project and a project-wide budget of two emails an
// hour). These endpoints prove control of a mailbox through our own transport
// and our own store; they do NOT replace Supabase's confirmation, and a code
// verified here does not confirm a GoTrue user or issue a session. Connecting
// the two is a deliberate follow-up, not something to infer from this file —
// the audit is explicit that two coexisting verification paradigms is the state
// to avoid, so whichever one wins should win on purpose.
//
// GATING — three independent conditions, all fail CLOSED:
//
//  1. FEATURE_OTP_EMAIL_ENABLED is off by default.
//  2. The shared pgx pool must exist. Postgres is the authoritative store (see
//     migration 20270193000000 for why it is not Redis), so with no pool there
//     is nothing to be authoritative.
//  3. OTP_PEPPER and the Brevo credentials must be present.
//
// A failure of 2 or 3 while the flag is ON does not panic the process — this is
// a sixty-module monolith and one misconfigured flag must not take the other
// fifty-nine down. It refuses to wire the service, logs at ERROR, and leaves
// routes that answer 503 naming the reason. Nothing silently proceeds with a
// weak hash or a missing store, which is the property the guide's fail-fast rule
// actually protects.
// registerOTPRoutes returns the issuer the registration handler uses to send a
// verification code, or nil when the feature is closed. Returning it keeps ONE
// service instance behind both surfaces: registration and POST /otp/request must
// share a store and a send budget, or "resend" would hand out a second live code
// and a second allowance.
func registerOTPRoutes(r *gin.Engine, cfg config.Config, pool *pgxpool.Pool, supabase *integrations.SupabaseRestClient, auth services.AuthService) (handlers.OTPIssuer, handlers.OTPVerifier, services.PasswordSetter, handlers.SignupGate) {
	group := r.Group("/api/auth/otp")

	svc, reason := buildOTPService(cfg, pool)
	h := handlers.NewOTPHandler(svc, reason)

	// Account confirmation for the verify_email purpose. Without it a redeemed
	// code proves mailbox control and activates nothing, so the handler refuses
	// that purpose loudly rather than returning a cheerful 200.
	verifier := services.NewSupabaseEmailVerifier(pool, supabase)
	h.WithEmailVerifier(verifier)

	// The login step-up's other half, and the password-reset completion. Both come
	// from one bridge over the SAME authService, so the lockout gate they apply is
	// the one login already applies rather than a second copy that can drift.
	bridge := services.NewOTPAuthBridge(auth, pool)
	if bridge != nil {
		h.WithSessionMinter(bridge)
	}

	// Routes are registered even when disabled so the surface answers 503 rather
	// than 404. A 404 reads as "this endpoint does not exist in this build",
	// which sends an operator looking for a deploy problem that is not there.
	group.POST("/request", h.RequestOTP)
	group.POST("/verify", h.VerifyOTP)

	if svc == nil {
		log.Printf("[otp] routes registered DISABLED (%s) — POST /api/auth/otp/* will answer 503", reason)
		// Registration keeps using /auth/v1/signup, which GoTrue gates itself, so
		// no signup budget is returned either.
		return nil, nil, nil, nil
	}
	if bridge == nil {
		log.Printf("[otp] ERROR: OTP is enabled but the auth bridge could not be built — login step-up and code-based password reset are unavailable")
	}
	if verifier == nil {
		// Enabled but unable to finish the job it is enabled for. Loud, because
		// the symptom otherwise appears only at a user's first verification.
		log.Printf("[otp] ERROR: OTP is enabled but no email verifier could be built (Supabase not configured) — verify_email will answer 500")
	}
	log.Printf("[otp] routes enabled — length=%d ttl=%s", cfg.OTPLength, time.Duration(cfg.OTPTTLMinutes)*time.Minute)

	issue := func(ctx context.Context, email, name, purpose, ip string) error {
		return svc.Issue(ctx, email, name, purpose, ip)
	}
	verify := func(ctx context.Context, email, purpose, code, ip string) error {
		return svc.Verify(ctx, email, purpose, code, ip)
	}
	// nil-typed interface guard: returning a typed nil *otpAuthBridge as a
	// PasswordSetter would make `!= nil` true at the call site and produce a nil
	// dereference at the first reset.
	var setter services.PasswordSetter
	if bridge != nil {
		setter = bridge
	}

	// Signup budget for the admin creation path, which GoTrue does not gate.
	//
	// The same Postgres fixed-window limiter the OTP flows use — atomic, and
	// shared across replicas, which is the property the in-process
	// middleware.AuthRateLimiter on this route cannot offer. The IP is hashed
	// with the pepper for the same reason the OTP keys are: an unsalted digest of
	// an IPv4 address is a four-billion-entry lookup, i.e. not a hash at all.
	limiter := otp.NewPostgresLimiter(pool)
	pepper := []byte(cfg.OTPPepper)
	window := 5 * time.Minute
	budget := cfg.SignupRateLimitPer5Min
	gate := func(ctx context.Context, ip string) (bool, error) {
		if strings.TrimSpace(ip) == "" {
			// No IP to budget against. Allowing is correct rather than refusing
			// everyone behind a proxy that strips it; the per-process limiter on
			// the route still applies.
			return true, nil
		}
		return limiter.Allow(ctx, "signup:ip:"+otp.Hash(ip, pepper), budget, window)
	}

	return issue, verify, setter, gate
}

// buildOTPService returns (nil, reason) when the feature must stay closed.
func buildOTPService(cfg config.Config, pool *pgxpool.Pool) (*otp.Service, string) {
	if !cfg.FeatureOTPEmailEnabled {
		return nil, "feature_disabled"
	}
	if pool == nil {
		log.Printf("[otp] ERROR: FEATURE_OTP_EMAIL_ENABLED is on but the shared Postgres pool is nil — refusing to wire")
		return nil, "misconfigured_no_database"
	}

	// Collected rather than short-circuited: an operator turning this on for the
	// first time should learn everything that is missing in one pass, not one
	// item per restart.
	var missing []string
	if strings.TrimSpace(cfg.OTPPepper) == "" {
		missing = append(missing, "OTP_PEPPER")
	}
	if strings.TrimSpace(cfg.BrevoAPIKey) == "" {
		missing = append(missing, "BREVO_API_KEY")
	}
	if strings.TrimSpace(cfg.BrevoSenderEmail) == "" {
		missing = append(missing, "BREVO_SENDER_EMAIL")
	}
	if cfg.BrevoOTPTemplateID <= 0 {
		missing = append(missing, "BREVO_OTP_TEMPLATE_ID")
	}
	if len(missing) > 0 {
		log.Printf("[otp] ERROR: FEATURE_OTP_EMAIL_ENABLED is on but %s %s unset — refusing to wire; endpoints will 503",
			strings.Join(missing, ", "), plural(len(missing)))
		return nil, "misconfigured_missing_credentials"
	}

	sender := email.NewBrevoClient(
		cfg.BrevoAPIKey,
		cfg.BrevoSenderName,
		cfg.BrevoSenderEmail,
		cfg.BrevoOTPTemplateID,
		time.Duration(cfg.BrevoTimeoutSeconds)*time.Second,
	)

	svc, err := otp.NewService(
		otp.NewPostgresStore(pool),
		retryingSender{inner: sender},
		otp.NewPostgresLimiter(pool),
		otp.Config{
			Length:          cfg.OTPLength,
			TTL:             time.Duration(cfg.OTPTTLMinutes) * time.Minute,
			MaxAttempts:     cfg.OTPMaxAttempts,
			ResendCooldown:  time.Duration(cfg.OTPResendCooldownSeconds) * time.Second,
			MaxSendsPerHour: cfg.OTPMaxSendsPerHour,
			MaxSendsPerIP:   cfg.OTPMaxSendsPerIPPerHour,
			MaxVerifyPerIP:  cfg.OTPMaxVerifyPerIPPerHour,
			Pepper:          []byte(cfg.OTPPepper),
		},
	)
	if err != nil {
		log.Printf("[otp] ERROR: could not construct OTP service: %v — refusing to wire", err)
		return nil, "misconfigured"
	}
	return svc, ""
}

func plural(n int) string {
	if n == 1 {
		return "is"
	}
	return "are"
}

// retryingSender applies the transient-only retry policy at the seam, so the otp
// service stays unaware of transport classification and tests can drive it with
// a plain fake.
type retryingSender struct{ inner *email.BrevoClient }

func (s retryingSender) SendOTP(ctx context.Context, to, name, code string, ttl time.Duration) error {
	return email.SendWithRetry(ctx, s.inner, to, name, code, ttl)
}

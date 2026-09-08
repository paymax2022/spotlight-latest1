package extranet

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ── Email-based staff invites ────────────────────────────────────────────────
//
// UpsertStaff (handler.go/service.go) grants a role to an EXISTING platform
// user_id — it has no path for onboarding someone who doesn't hold a Spotlight
// account yet. InviteStaffByEmail closes that gap: if a platform user already
// owns the email, the grant is applied immediately (same UpsertStaff write);
// otherwise a pending invite is persisted and an accept-link email is sent, and
// the grant lands once the invitee signs up or logs in and opens that link.
//
// Modeled on the restaurant module's staff-invite credential handling
// (backend/internal/restaurant/staff_invite.go): only a SHA-256 hash of the
// invite token is stored, never the plaintext, and accept returns ONE message
// for "wrong token", "not yours" and "expired" — distinguishing them would tell
// an attacker which guess was warm. Unlike that flow, the invitee has no
// user_id yet at invite time, so the credential is bound to the email address
// instead and re-checked against the authenticated caller's own verified email
// (from RequireAuthContext, not client input) at accept time.

const staffInviteTTL = 7 * 24 * time.Hour

// grantableInviteRoles mirrors stays_hotelier_profile's CHECK constraint minus
// OWNER: OWNER mirrors stays_property's creator (CreateProperty) and is never
// grantable through the staff list or an invite.
var grantableInviteRoles = map[string]bool{
	"MANAGER":    true,
	"FRONT_DESK": true,
	"FINANCE":    true,
	"READ_ONLY":  true,
}

// ErrInviteNotValid covers every reason an accept attempt fails — wrong token,
// wrong addressee, expired, already used. Deliberately one message for all of
// them (see the package doc above).
var ErrInviteNotValid = errors.New("extranet: this invite is not valid")

// StaffInviteResult reports what InviteStaffByEmail actually did, for the API
// response — the caller needs to know whether access was granted immediately
// or is still pending the invitee's acceptance.
type StaffInviteResult struct {
	Email  string `json:"email"`
	Role   string `json:"role"`
	Status string `json:"status"` // "active" (granted now) or "invited" (pending)
}

// InviteStaffByEmail is the entry point for POST .../staff/invite {name, email, role}.
func (s *Service) InviteStaffByEmail(ctx context.Context, actorUserID, propertyID, name, email, role string) (*StaffInviteResult, error) {
	if !s.authz.HasPropertyRole(ctx, actorUserID, propertyID, "OWNER", "MANAGER") {
		return nil, ErrForbidden
	}
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return nil, fmt.Errorf("extranet: email is required")
	}
	role = orStr(strings.ToUpper(strings.TrimSpace(role)), "READ_ONLY")
	if !grantableInviteRoles[role] {
		return nil, fmt.Errorf("extranet: %s cannot be granted through a staff invite", role)
	}

	propertyName, err := s.repo.propertyNameForInvite(ctx, propertyID)
	if err != nil {
		return nil, ErrNotFound
	}

	if existingUserID, found, err := s.repo.FindPlatformUserByEmail(ctx, email); err != nil {
		return nil, err
	} else if found {
		if err := s.repo.UpsertStaff(ctx, propertyID, existingUserID, role, "ACTIVE"); err != nil {
			return nil, err
		}
		s.mailer.SendGrantNotice(email, name, propertyName, role)
		return &StaffInviteResult{Email: email, Role: role, Status: "active"}, nil
	}

	plain, hash, err := newStaffInviteToken()
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateStaffInvite(ctx, propertyID, email, name, role, actorUserID, hash, time.Now().Add(staffInviteTTL)); err != nil {
		return nil, fmt.Errorf("extranet: could not create the invite: %w", err)
	}
	acceptURL := fmt.Sprintf("%s/extranet/staff/invite/accept?token=%s", strings.TrimRight(s.adminBaseURL, "/"), plain)
	s.mailer.SendInvite(email, name, propertyName, role, acceptURL)
	return &StaffInviteResult{Email: email, Role: role, Status: "invited"}, nil
}

// AcceptStaffInvite redeems a token for the authenticated caller. The invite's
// email is matched against the caller's OWN verified email (from
// RequireAuthContext) — never a client-supplied value — which is what binds
// the invite to its addressee: a forwarded link is useless to anyone else.
func (s *Service) AcceptStaffInvite(ctx context.Context, callerUserID, callerEmail, token string) error {
	if token == "" || callerUserID == "" || callerEmail == "" {
		return ErrInviteNotValid
	}
	return s.repo.acceptStaffInvite(ctx, hashStaffInviteToken(token), callerUserID, callerEmail)
}

func newStaffInviteToken() (plain, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", fmt.Errorf("extranet: could not generate an invite token: %w", err)
	}
	plain = hex.EncodeToString(b)
	return plain, hashStaffInviteToken(plain), nil
}

func hashStaffInviteToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// --- repository ---

func (r *Repository) propertyNameForInvite(ctx context.Context, propertyID string) (string, error) {
	var name string
	err := r.db.QueryRow(ctx, `SELECT name FROM public.stays_property WHERE id = $1`, propertyID).Scan(&name)
	return name, err
}

// FindPlatformUserByEmail returns the platform user id owning this email, if any.
// platform_users.id mirrors auth.users.id (20260904000000_rbac_identity_bridge.sql),
// so the id returned here is exactly what stays_hotelier_profile.user_id expects.
func (r *Repository) FindPlatformUserByEmail(ctx context.Context, email string) (userID string, found bool, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT id::text FROM public.platform_users
		WHERE lower(email) = lower($1) AND deleted_at IS NULL
		LIMIT 1`, email).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return userID, true, nil
}

// CreateStaffInvite persists a pending invite, or re-issues one (fresh token,
// pushed-out expiry) if this property+email already has one outstanding —
// mirrors the restaurant module's re-invite-reissues-a-token behavior.
func (r *Repository) CreateStaffInvite(ctx context.Context, propertyID, email, name, role, invitedBy, tokenHash string, expiresAt time.Time) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_staff_invite (property_id, email, name, role, invited_by, token_hash, expires_at)
		VALUES ($1, lower($2), $3, $4, $5, $6, $7)
		ON CONFLICT (property_id, lower(email)) WHERE status = 'PENDING' DO UPDATE
		   SET name = EXCLUDED.name,
		       role = EXCLUDED.role,
		       invited_by = EXCLUDED.invited_by,
		       token_hash = EXCLUDED.token_hash,
		       expires_at = EXCLUDED.expires_at,
		       updated_at = now()`,
		propertyID, email, name, role, invitedBy, tokenHash, expiresAt)
	return err
}

// acceptStaffInvite redeems a pending invite in one transaction: mark it
// accepted, then grant the role it names via the same write UpsertStaff uses.
// Requiring status='PENDING' makes it single-use, so a replayed token cannot
// resurrect a grant that was later revoked.
func (r *Repository) acceptStaffInvite(ctx context.Context, tokenHash, callerUserID, callerEmail string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("extranet: begin accept-invite tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var inviteID, propertyID, invEmail, invRole string
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT id::text, property_id::text, email, role, expires_at
		FROM public.stays_staff_invite
		WHERE token_hash = $1 AND status = 'PENDING'
		FOR UPDATE`, tokenHash).Scan(&inviteID, &propertyID, &invEmail, &invRole, &expiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInviteNotValid
		}
		return err
	}
	if !strings.EqualFold(invEmail, callerEmail) || time.Now().After(expiresAt) {
		return ErrInviteNotValid
	}

	if _, err := tx.Exec(ctx, `
		UPDATE public.stays_staff_invite SET status = 'ACCEPTED', accepted_at = now() WHERE id = $1`,
		inviteID); err != nil {
		return fmt.Errorf("extranet: could not accept the invite: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.stays_hotelier_profile (user_id, property_id, role, status)
		VALUES ($1, $2, $3, 'ACTIVE')
		ON CONFLICT (user_id, property_id) DO UPDATE
		   SET role = EXCLUDED.role, status = 'ACTIVE', updated_at = now()`,
		callerUserID, propertyID, invRole); err != nil {
		return fmt.Errorf("extranet: could not grant staff access: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("extranet: commit accept-invite tx: %w", err)
	}
	return nil
}

// --- email delivery ---

// StaffInviteMailer sends the two hotelier-staff transactional emails. Resend,
// no queue, failures silent (CLAUDE.md email policy: "fire-and-forget") — it
// must never block or fail the API response on delivery.
type StaffInviteMailer interface {
	SendInvite(email, name, propertyName, role, acceptURL string)
	SendGrantNotice(email, name, propertyName, role string)
}

// noopStaffInviteMailer is used when Resend isn't configured (e.g. local dev):
// the invite row is still created so the flow can be exercised without email.
type noopStaffInviteMailer struct{}

func (noopStaffInviteMailer) SendInvite(string, string, string, string, string) {}
func (noopStaffInviteMailer) SendGrantNotice(string, string, string, string)    {}

// resendStaffInviteMailer is a fire-and-forget Resend sender — same shape as
// services.resendNotifier (backend/internal/services/security_notifier.go).
type resendStaffInviteMailer struct {
	apiKey string
	from   string
	http   *http.Client
}

// NewResendStaffInviteMailer returns a StaffInviteMailer. With no API key it is
// a no-op (still satisfies the interface) so invites keep working, minus
// delivery, in environments without Resend configured.
func NewResendStaffInviteMailer(apiKey, from string) StaffInviteMailer {
	if strings.TrimSpace(apiKey) == "" {
		return noopStaffInviteMailer{}
	}
	return &resendStaffInviteMailer{apiKey: apiKey, from: from, http: &http.Client{Timeout: 5 * time.Second}}
}

func (m *resendStaffInviteMailer) SendInvite(email, name, propertyName, role, acceptURL string) {
	greet := orStr(name, email)
	subject := fmt.Sprintf("You've been invited to join %s on Paymax Stays", propertyName)
	body := fmt.Sprintf(
		"Hi %s,\n\n%s has invited you to help manage their property on Paymax Stays as %s.\n\n"+
			"Sign up or log in to Paymax with this email address, then open this link to accept the invite:\n%s\n\n"+
			"This invite expires in 7 days. If you weren't expecting this, you can ignore this email.",
		greet, propertyName, humanizeStaffRole(role), acceptURL)
	m.send(email, subject, body)
}

func (m *resendStaffInviteMailer) SendGrantNotice(email, name, propertyName, role string) {
	greet := orStr(name, email)
	subject := fmt.Sprintf("You now have access to %s on Paymax Stays", propertyName)
	body := fmt.Sprintf(
		"Hi %s,\n\nYou've been added as %s on %s's Paymax Stays extranet. Log in to get started.",
		greet, humanizeStaffRole(role), propertyName)
	m.send(email, subject, body)
}

func (m *resendStaffInviteMailer) send(to, subject, body string) {
	go func() {
		defer func() { _ = recover() }() // never let email delivery crash the request goroutine
		payload := map[string]any{"from": m.from, "to": []string{to}, "subject": subject, "text": body}
		b, _ := json.Marshal(payload)
		req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(b))
		if err != nil {
			return
		}
		req.Header.Set("Authorization", "Bearer "+m.apiKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := m.http.Do(req)
		if err != nil {
			return
		}
		_ = resp.Body.Close()
	}()
}

func humanizeStaffRole(role string) string {
	switch role {
	case "MANAGER":
		return "a revenue manager"
	case "FRONT_DESK":
		return "front-desk staff"
	case "FINANCE":
		return "finance staff"
	default:
		return "a read-only viewer"
	}
}

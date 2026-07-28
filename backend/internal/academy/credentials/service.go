package credentials

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// credentialStore is the data-access surface the Service depends on. *Repository is
// the production implementation; tests inject a pure in-memory fake. Keeping this an
// interface lets the Apply-idempotency and revoke-updates-registry behaviours be
// exercised without a DB.
type credentialStore interface {
	HolderName(ctx context.Context, userID string) string
	IssueCredential(ctx context.Context, actor string, c Credential, holderName string) (*Credential, error)
	RevokeCredential(ctx context.Context, actor, id, reason string) (*Credential, error)
	GetVerification(ctx context.Context, verificationID string) (*PublicVerification, error)
	ListCredentialsByUser(ctx context.Context, userID string) ([]Credential, error)
	ListIssuedByUser(ctx context.Context, userID string) ([]Credential, error)
	GetOpportunity(ctx context.Context, id string) (*EarningOpportunity, error)
	ListOpportunities(ctx context.Context, activeOnly bool) ([]EarningOpportunity, error)
	InsertOpportunity(ctx context.Context, actor string, req CreateOpportunityRequest) (*EarningOpportunity, error)
	UpdateOpportunity(ctx context.Context, actor, id string, req UpdateOpportunityRequest) (*EarningOpportunity, error)
	FindApplicationByIdem(ctx context.Context, idemKey string) (*EarningApplication, error)
	InsertApplication(ctx context.Context, userID, opportunityID, idemKey string) (*EarningApplication, error)
	GetApplication(ctx context.Context, id string) (*EarningApplication, error)
	MarkApplicationRouted(ctx context.Context, userID, id, paymaxRef string) (*EarningApplication, error)
}

// Service is the Spotlight Academy credentials + earning-bridge domain. It owns the
// GUARDED credential state machine (pending→issued→revoked), the PUBLIC verification
// registry, and the earning bridge that routes apply() into the EXISTING Paymax
// role-upgrade/KYC flow via the injected RoleUpgrader. No money moves here; role
// onboarding is owned by Paymax. Every mutating path is audit-logged.
type Service struct {
	repo     credentialStore
	upgrader RoleUpgrader
	secret   []byte // server-side signing secret for credential signatures
}

// NewService wires the credentials service. A nil upgrader falls back to a
// deterministic no-op so the package runs end-to-end without Paymax bound (dev). The
// signing secret comes from ACADEMY_CREDENTIAL_SECRET (a stable per-env default keeps
// dev signatures deterministic and verifiable).
func NewService(db *pgxpool.Pool, upgrader RoleUpgrader) *Service {
	if upgrader == nil {
		upgrader = noopRoleUpgrader{}
	}
	secret := os.Getenv("ACADEMY_CREDENTIAL_SECRET")
	if secret == "" {
		secret = "academy-credential-dev-secret"
	}
	return &Service{repo: NewRepository(db), upgrader: upgrader, secret: []byte(secret)}
}

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrIllegalTransition = errors.New("credentials: illegal state transition")
	ErrInvalidInput      = errors.New("credentials: invalid input")
	ErrNotEligible       = errors.New("credentials: not eligible for opportunity")
)

// ── Issue / sign ──────────────────────────────────────────────────────────────────

// TradeCredentialIssuer is the local interface the trade package matches to issue a
// trade credential without importing the concrete Service. IssueTradeCredential's
// shape is exported via this interface so the trade package can call it.
type TradeCredentialIssuer interface {
	IssueTradeCredential(ctx context.Context, userID, tradeTrack, title string) (credentialID, verificationID string, err error)
}

// Compile-time assertion: Service satisfies TradeCredentialIssuer.
var _ TradeCredentialIssuer = (*Service)(nil)

// IssueTradeCredential creates a trade credential pending→issued, generates a unique
// public verification id, signs the claim, and registers it in the public
// verification registry (status=valid). Returns the credential id + verification id.
// The trade package calls this via TradeCredentialIssuer when an assessment passes.
func (s *Service) IssueTradeCredential(ctx context.Context, userID, tradeTrack, title string) (string, string, error) {
	if userID == "" || tradeTrack == "" || title == "" {
		return "", "", ErrInvalidInput
	}
	tt := tradeTrack
	cred, err := s.issue(ctx, userID, Credential{
		UserID:     userID,
		Kind:       KindTrade,
		Title:      title,
		TradeTrack: &tt,
	})
	if err != nil {
		return "", "", err
	}
	return cred.ID, cred.VerificationID, nil
}

// IssueAcademic creates an academic credential pending→issued (e.g. on exam pass),
// optionally tied to a subject. Same sign + register path as the trade issuer.
func (s *Service) IssueAcademic(ctx context.Context, userID, title string, subjectID *string) (string, string, error) {
	if userID == "" || title == "" {
		return "", "", ErrInvalidInput
	}
	cred, err := s.issue(ctx, userID, Credential{
		UserID:    userID,
		Kind:      KindAcademic,
		Title:     title,
		SubjectID: subjectID,
	})
	if err != nil {
		return "", "", err
	}
	return cred.ID, cred.VerificationID, nil
}

// issue is the shared issue path: defence-in-depth guard, verification-id generation,
// signing, holder-name lookup, and the transactional pending→issued + registry upsert.
func (s *Service) issue(ctx context.Context, actor string, c Credential) (*Credential, error) {
	// Defence in depth: the SM start is pending and must be legal to issued.
	if !canCred(CredPending, CredIssued) {
		return nil, ErrIllegalTransition
	}
	verID, err := newVerificationID()
	if err != nil {
		return nil, err
	}
	c.VerificationID = verID
	sig := s.sign(c.UserID, verID, c.Kind, c.Title)
	c.Signature = &sig
	holder := s.repo.HolderName(ctx, c.UserID)
	return s.repo.IssueCredential(ctx, actor, c, holder)
}

// sign produces a deterministic detached HMAC-SHA256 signature over the claim. The
// secret is server-side; verification of the signature is a server concern (the
// public verify endpoint reads the registry, not the signature).
func (s *Service) sign(userID, verificationID, kind, title string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(strings.Join([]string{userID, verificationID, kind, title}, "\x00")))
	return hex.EncodeToString(mac.Sum(nil))
}

// newVerificationID generates a unique, shareable, URL-safe verification id: 20 bytes
// of crypto-random, base32 (no padding), lowercase — collision-resistant + QR-friendly.
func newVerificationID() (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	return "vc_" + strings.ToLower(enc.EncodeToString(b)), nil
}

// ── Verify (public) ─────────────────────────────────────────────────────────────

// Verify returns the public sanitized verification record (no PII beyond holder
// display name). The registry is the public source of truth — a revoked credential
// shows status=revoked here.
func (s *Service) Verify(ctx context.Context, verificationID string) (*PublicVerification, error) {
	if verificationID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.GetVerification(ctx, verificationID)
}

// ── Revoke (admin) ───────────────────────────────────────────────────────────────

// Revoke runs the guarded issued→revoked transition (illegal rejected + audited) and
// updates the public registry status=revoked. RBAC academy.credentials is enforced at
// the route layer.
func (s *Service) Revoke(ctx context.Context, adminID, credentialID, reason string) (*Credential, error) {
	if credentialID == "" || reason == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.RevokeCredential(ctx, adminID, credentialID, reason)
}

// ── Member reads ─────────────────────────────────────────────────────────────────

func (s *Service) ListMine(ctx context.Context, userID string) ([]Credential, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.ListCredentialsByUser(ctx, userID)
}

// ── Earning bridge ───────────────────────────────────────────────────────────────

// EvaluateBridge computes the earning opportunities a user is eligible for from their
// ISSUED credentials vs each active opportunity's eligibility rules. Pure eligibility
// math lives in eligible(); this only fetches inputs and filters.
func (s *Service) EvaluateBridge(ctx context.Context, userID string) ([]EarningOpportunity, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	creds, err := s.repo.ListIssuedByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	opps, err := s.repo.ListOpportunities(ctx, true)
	if err != nil {
		return nil, err
	}
	out := []EarningOpportunity{}
	for _, o := range opps {
		if eligible(o.EligibilityRules, creds) {
			out = append(out, o)
		}
	}
	return out, nil
}

// Apply routes a user's application for an earning opportunity into the EXISTING
// Paymax role-upgrade/KYC flow. It is IDEMPOTENT on idemKey: a replay returns the same
// application + paymax_ref with NO second route. Flow:
//  1. If idemKey already has an application, return it (already routed) — no re-route.
//  2. Re-check eligibility from issued credentials (fail-closed).
//  3. Insert the application (submitted); the unique idem index also guards the DB.
//  4. Route via the injected RoleUpgrader (ref = application id) → submitted→routed.
//
// Paymax owns the actual onboarding; this only surfaces the unlocked role + ref.
func (s *Service) Apply(ctx context.Context, userID, opportunityID, idemKey string) (*ApplyResult, error) {
	if userID == "" || opportunityID == "" {
		return nil, ErrInvalidInput
	}

	// 1. Idempotency: a prior application for this key short-circuits the route.
	if idemKey != "" {
		if existing, err := s.repo.FindApplicationByIdem(ctx, idemKey); err == nil {
			opp, oerr := s.repo.GetOpportunity(ctx, existing.OpportunityID)
			role := ""
			if oerr == nil {
				role = opp.Role
			}
			ref := ""
			if existing.PaymaxRef != nil {
				ref = *existing.PaymaxRef
			}
			return &ApplyResult{Application: existing, UnlockedRole: role, PaymaxRef: ref, AlreadyRouted: true}, nil
		} else if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}

	// 2. Re-check eligibility (fail-closed) against the live opportunity.
	opp, err := s.repo.GetOpportunity(ctx, opportunityID)
	if err != nil {
		return nil, err
	}
	creds, err := s.repo.ListIssuedByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !eligible(opp.EligibilityRules, creds) {
		return nil, ErrNotEligible
	}

	// 3. Insert the application (submitted). The unique partial idem index is the DB
	//    backstop against a concurrent double-apply with the same key.
	app, err := s.repo.InsertApplication(ctx, userID, opportunityID, idemKey)
	if err != nil {
		// Lost the race on the unique idem index → fetch + return the winner (one route).
		if idemKey != "" {
			if existing, ferr := s.repo.FindApplicationByIdem(ctx, idemKey); ferr == nil {
				ref := ""
				if existing.PaymaxRef != nil {
					ref = *existing.PaymaxRef
				}
				return &ApplyResult{Application: existing, UnlockedRole: opp.Role, PaymaxRef: ref, AlreadyRouted: true}, nil
			}
		}
		return nil, err
	}

	// 4. Route into Paymax role-upgrade (idempotent on the application id as ref).
	paymaxRef, err := s.upgrader.UpgradeRole(ctx, userID, opp.Role, app.ID)
	if err != nil {
		return nil, err
	}
	routed, err := s.repo.MarkApplicationRouted(ctx, userID, app.ID, paymaxRef)
	if err != nil {
		return nil, err
	}
	return &ApplyResult{Application: routed, UnlockedRole: opp.Role, PaymaxRef: paymaxRef, AlreadyRouted: false}, nil
}

// ── Opportunities admin ──────────────────────────────────────────────────────────

func (s *Service) ListOpportunities(ctx context.Context, activeOnly bool) ([]EarningOpportunity, error) {
	return s.repo.ListOpportunities(ctx, activeOnly)
}

func (s *Service) CreateOpportunity(ctx context.Context, actor string, req CreateOpportunityRequest) (*EarningOpportunity, error) {
	if req.Code == "" || req.Title == "" || req.Role == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertOpportunity(ctx, actor, req)
}

func (s *Service) UpdateOpportunity(ctx context.Context, actor, id string, req UpdateOpportunityRequest) (*EarningOpportunity, error) {
	if id == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.UpdateOpportunity(ctx, actor, id, req)
}

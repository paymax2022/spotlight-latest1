package healthproviders

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor is the minimal slice of services.AuditService the package needs (HL-12).
// Satisfied by the immutable audit service; nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// CapabilityGranter is the minimal slice of services.RBACService needed to grant
// the provider capability/role on APPROVED (HL-2). Satisfied by RBACService via a
// thin adapter in the wiring layer.
type CapabilityGranter interface {
	GetUserRoles(userID string) ([]string, error)
	AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy string) error
	ListRoles() ([]RoleView, error)
}

// RoleView is a tiny structural shim — we only need id+slug. The real
// services.RBACService.ListRoles returns []domain.Role; the wiring layer adapts
// it into this shape so the package does not import the services/domain trees.
type RoleView struct {
	ID   string
	Slug string
}

// Service owns the ProviderApplication state machine + credential vault. HL-1:
// it carries no clinical logic — only onboarding workflow/state. Every transition
// is audited (HL-12). On APPROVED it idempotently grants the capability (HL-2).
type Service struct {
	db    *pgxpool.Pool
	rbac  CapabilityGranter
	audit Auditor
}

func NewService(db *pgxpool.Pool, rbac CapabilityGranter, audit Auditor) *Service {
	return &Service{db: db, rbac: rbac, audit: audit}
}

// CreateApplication starts onboarding in DRAFT for the acting user.
func (s *Service) CreateApplication(ctx context.Context, ownerID, domain, providerType, displayName string) (*Application, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("providers: owner required")
	}
	if !validDomain(domain) || !validType(domain, providerType) {
		return nil, fmt.Errorf("providers: invalid domain/provider_type")
	}
	a := &Application{
		ID:           uuid.New().String(),
		OwnerUserID:  ownerID,
		Domain:       domain,
		ProviderType: providerType,
		DisplayName:  displayName,
		State:        StateDraft,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	const ins = `
		INSERT INTO health_provider_applications
		  (id, owner_user_id, domain, provider_type, display_name, state)
		VALUES ($1,$2,$3,$4,$5,'DRAFT')`
	if _, err := s.db.Exec(ctx, ins, a.ID, a.OwnerUserID, a.Domain, a.ProviderType, a.DisplayName); err != nil {
		return nil, fmt.Errorf("providers: insert application: %w", err)
	}
	s.audited(ownerID, ownerID, "health.provider.application.create", a.ID, nil,
		map[string]any{"domain": domain, "provider_type": providerType, "state": string(StateDraft)})
	return a, nil
}

// AddCredential appends a license document to an application's vault. The blob is
// already in R2; storageKey is a signed-URL ref only (HL-8 — never a blob).
func (s *Service) AddCredential(ctx context.Context, ownerID, applicationID string, d CredentialDoc) (*CredentialDoc, error) {
	app, err := s.getApplication(ctx, applicationID)
	if err != nil {
		return nil, err
	}
	if app.OwnerUserID != ownerID { // object-level authZ
		return nil, fmt.Errorf("providers: forbidden")
	}
	if d.StorageKey == "" {
		return nil, fmt.Errorf("providers: storage_key required")
	}
	d.ID = uuid.New().String()
	d.ApplicationID = applicationID
	d.OwnerUserID = ownerID
	d.CreatedAt = time.Now()
	const ins = `
		INSERT INTO health_credential_docs
		  (id, application_id, owner_user_id, cred_type, reference_no, nafdac_ref, storage_key, expires_at, verified)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`
	if _, err := s.db.Exec(ctx, ins, d.ID, d.ApplicationID, d.OwnerUserID, d.CredType,
		d.ReferenceNo, d.NAFDACRef, d.StorageKey, nullTime(d.ExpiresAt), d.Verified); err != nil {
		return nil, fmt.Errorf("providers: insert credential: %w", err)
	}
	// HL-8: never log the storage_key / PII — only the doc id + type.
	s.audited(ownerID, ownerID, "health.provider.credential.add", d.ID, nil,
		map[string]any{"cred_type": d.CredType, "application_id": applicationID})
	return &d, nil
}

// Submit moves DRAFT|NEEDS_INFO → SUBMITTED (member action). NEEDS_INFO resubmits
// via UNDER_REVIEW, so a NEEDS_INFO app is first re-submitted then re-reviewed by
// admin; for the member path SUBMITTED is the only forward edge from DRAFT.
func (s *Service) Submit(ctx context.Context, ownerID, applicationID string) (*Application, error) {
	return s.transition(ctx, ownerID, applicationID, func(cur State) (State, error) {
		// member submit: DRAFT→SUBMITTED, or NEEDS_INFO→UNDER_REVIEW (back to admin queue)
		switch cur {
		case StateDraft:
			return StateSubmitted, nil
		case StateNeedsInfo:
			return StateUnderReview, nil
		default:
			return "", fmt.Errorf("providers: cannot submit from %s", cur)
		}
	}, "health.provider.application.submit")
}

// Decision is the admin verdict on an application (HEALTH-BUILD §6 decision route).
// action ∈ {start_review, need_info, approve, reject}.
func (s *Service) Decision(ctx context.Context, adminID, applicationID, action, note string) (*Application, error) {
	target := func(cur State) (State, error) {
		switch action {
		case "start_review":
			return StateUnderReview, nil
		case "need_info":
			return StateNeedsInfo, nil
		case "approve":
			return StateApproved, nil
		case "reject":
			return StateRejected, nil
		default:
			return "", fmt.Errorf("providers: unknown decision %q", action)
		}
	}
	return s.transitionAdmin(ctx, adminID, applicationID, target, note)
}

// transition runs an owner-scoped guarded transition (member edges).
func (s *Service) transition(ctx context.Context, ownerID, applicationID string, next func(State) (State, error), auditAction string) (*Application, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("providers: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	app, err := lockApplication(ctx, tx, applicationID)
	if err != nil {
		return nil, err
	}
	if app.OwnerUserID != ownerID {
		return nil, fmt.Errorf("providers: forbidden")
	}
	to, err := next(app.State)
	if err != nil {
		return nil, err
	}
	if !canTransition(app.State, to) {
		return nil, fmt.Errorf("providers: illegal transition %s -> %s", app.State, to)
	}
	if _, err := tx.Exec(ctx, `UPDATE health_provider_applications SET state=$2, updated_at=now() WHERE id=$1`, applicationID, string(to)); err != nil {
		return nil, fmt.Errorf("providers: update state: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("providers: commit: %w", err)
	}
	s.audited(ownerID, app.OwnerUserID, auditAction, applicationID,
		map[string]any{"state": string(app.State)}, map[string]any{"state": string(to)})
	app.State = to
	return app, nil
}

// transitionAdmin runs an admin guarded transition; on APPROVED it idempotently
// grants the provider capability + role (HL-2) atomically with the state flip.
func (s *Service) transitionAdmin(ctx context.Context, adminID, applicationID string, next func(State) (State, error), note string) (*Application, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("providers: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	app, err := lockApplication(ctx, tx, applicationID)
	if err != nil {
		return nil, err
	}
	to, err := next(app.State)
	if err != nil {
		return nil, err
	}
	if !canTransition(app.State, to) {
		return nil, fmt.Errorf("providers: illegal transition %s -> %s", app.State, to)
	}

	var providerID *string
	if to == StateApproved {
		// Idempotently upsert the capability row. UNIQUE(owner,domain,type) makes a
		// repeated approve return the SAME provider id (no duplicate capability, HL-2).
		pid, err := upsertProvider(ctx, tx, app)
		if err != nil {
			return nil, err
		}
		providerID = &pid
	}
	if to == StateSuspended || to == StateRejected {
		// HL-2: a suspended/rejected provider is not discoverable/active.
		if app.ProviderID != nil {
			if _, err := tx.Exec(ctx, `UPDATE health_providers SET status='SUSPENDED', discoverable=false, updated_at=now() WHERE id=$1`, *app.ProviderID); err != nil {
				return nil, fmt.Errorf("providers: suspend capability: %w", err)
			}
		}
	}
	if to == StateApproved && app.ProviderID != nil {
		providerID = app.ProviderID // re-approve of an existing capability
	}

	const upd = `UPDATE health_provider_applications
	             SET state=$2, review_note=$3, provider_id=COALESCE($4, provider_id), updated_at=now()
	             WHERE id=$1`
	if _, err := tx.Exec(ctx, upd, applicationID, string(to), note, providerID); err != nil {
		return nil, fmt.Errorf("providers: update application: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("providers: commit: %w", err)
	}

	// Capability/role grant runs AFTER commit so a grant retry never rolls back the
	// approved state; the grant itself is idempotent (checks existing roles first).
	if to == StateApproved {
		s.grantCapabilityRole(app, adminID)
	}

	s.audited(adminID, app.OwnerUserID, "health.provider.application.decision", applicationID,
		map[string]any{"state": string(app.State)},
		map[string]any{"state": string(to), "note": note})

	app.State = to
	app.ReviewNote = note
	if providerID != nil {
		app.ProviderID = providerID
	}
	return app, nil
}

// grantCapabilityRole assigns the health-provider-<type> role idempotently (HL-2).
// If RBAC is unwired (nil) it is a no-op; if the user already has the role it does
// nothing — so a repeated APPROVE never double-grants.
func (s *Service) grantCapabilityRole(app *Application, adminID string) {
	if s.rbac == nil {
		return
	}
	slug := "health-provider-" + app.ProviderType
	existing, err := s.rbac.GetUserRoles(app.OwnerUserID)
	if err == nil {
		for _, r := range existing {
			if r == slug {
				return // already granted — idempotent
			}
		}
	}
	roles, err := s.rbac.ListRoles()
	if err != nil {
		return
	}
	for _, r := range roles {
		if r.Slug == slug {
			_ = s.rbac.AssignRoleToUser(app.OwnerUserID, r.ID, "global", "", adminID)
			s.audited(adminID, app.OwnerUserID, "health.provider.capability.grant", app.OwnerUserID, nil,
				map[string]any{"role": slug, "provider_type": app.ProviderType})
			return
		}
	}
}

// SuspendExpired is the HL-2 auto-suspend signal: any APPROVED provider whose
// application has at least one expired credential is suspended + de-listed. Safe
// to run repeatedly (idempotent — already-suspended rows are skipped).
func (s *Service) SuspendExpired(ctx context.Context, now time.Time) (int, error) {
	const q = `
		UPDATE health_providers p
		SET status='SUSPENDED', discoverable=false, updated_at=now()
		WHERE p.status='APPROVED'
		  AND EXISTS (
		    SELECT 1 FROM health_provider_applications a
		    JOIN health_credential_docs d ON d.application_id = a.id
		    WHERE a.provider_id = p.id AND d.expires_at IS NOT NULL AND d.expires_at < $1
		  )`
	ct, err := s.db.Exec(ctx, q, now)
	if err != nil {
		return 0, fmt.Errorf("providers: suspend expired: %w", err)
	}
	return int(ct.RowsAffected()), nil
}

func (s *Service) GetApplication(ctx context.Context, ownerID, applicationID string) (*Application, error) {
	a, err := s.getApplication(ctx, applicationID)
	if err != nil {
		return nil, err
	}
	if a.OwnerUserID != ownerID {
		return nil, fmt.Errorf("providers: forbidden")
	}
	return a, nil
}

func (s *Service) ListApplications(ctx context.Context, ownerID string) ([]Application, error) {
	const q = `SELECT id, owner_user_id, domain, provider_type, display_name, state, review_note, provider_id, created_at, updated_at
	           FROM health_provider_applications WHERE owner_user_id=$1 ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, ownerID)
	if err != nil {
		return nil, fmt.Errorf("providers: list: %w", err)
	}
	defer rows.Close()
	var out []Application
	for rows.Next() {
		var a Application
		var state string
		if err := rows.Scan(&a.ID, &a.OwnerUserID, &a.Domain, &a.ProviderType, &a.DisplayName,
			&state, &a.ReviewNote, &a.ProviderID, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		a.State = State(state)
		out = append(out, a)
	}
	return out, nil
}

// --- internals ---

func (s *Service) getApplication(ctx context.Context, id string) (*Application, error) {
	var a Application
	var state string
	const q = `SELECT id, owner_user_id, domain, provider_type, display_name, state, review_note, provider_id, created_at, updated_at
	           FROM health_provider_applications WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, id).Scan(&a.ID, &a.OwnerUserID, &a.Domain, &a.ProviderType,
		&a.DisplayName, &state, &a.ReviewNote, &a.ProviderID, &a.CreatedAt, &a.UpdatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("providers: application not found")
		}
		return nil, err
	}
	a.State = State(state)
	return &a, nil
}

func lockApplication(ctx context.Context, tx pgx.Tx, id string) (*Application, error) {
	var a Application
	var state string
	const q = `SELECT id, owner_user_id, domain, provider_type, display_name, state, provider_id
	           FROM health_provider_applications WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, q, id).Scan(&a.ID, &a.OwnerUserID, &a.Domain, &a.ProviderType,
		&a.DisplayName, &state, &a.ProviderID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("providers: application not found")
		}
		return nil, err
	}
	a.State = State(state)
	return &a, nil
}

// upsertProvider idempotently creates the capability row. ON CONFLICT on the
// UNIQUE(owner,domain,type) flips it back to APPROVED+discoverable and returns the
// existing id — so a repeated APPROVE yields ONE capability (HL-2 idempotency).
func upsertProvider(ctx context.Context, tx pgx.Tx, app *Application) (string, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status, discoverable)
		VALUES ($1,$2,$3,$4,$5,'APPROVED',true)
		ON CONFLICT (owner_user_id, domain, provider_type)
		DO UPDATE SET status='APPROVED', discoverable=true, updated_at=now()
		RETURNING id`
	var out string
	if err := tx.QueryRow(ctx, q, id, app.OwnerUserID, app.Domain, app.ProviderType, app.DisplayName).Scan(&out); err != nil {
		return "", fmt.Errorf("providers: upsert capability: %w", err)
	}
	return out, nil
}

func (s *Service) audited(actor, target, action, resourceID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "health", "health_provider", resourceID, oldV, newV, "", "", "info")
}

func validDomain(d string) bool {
	switch d {
	case "VET", "PHARMACY", "LAB":
		return true
	}
	return false
}

func validType(domain, t string) bool {
	switch domain {
	case "VET":
		return t == "vet"
	case "PHARMACY":
		return t == "pharmacy" || t == "pharmacist"
	case "LAB":
		return t == "lab" || t == "lab_scientist" || t == "phlebotomist"
	}
	return false
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

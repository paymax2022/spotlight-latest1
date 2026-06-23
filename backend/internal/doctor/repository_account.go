package doctor

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// repository_account.go — pgx data access for the Wave 2 (account / provider /
// admin) endpoints. Every read is scoped to the owning doctor's user_id (defence
// in depth on top of RLS). Mutations on tables that carry a UNIQUE idempotency_key
// use ON CONFLICT (idempotency_key) DO NOTHING + replay, exactly like the MVP
// (see Repository.InsertPrescription / InsertLabOrder).

// ── Onboarding: legal consents ───────────────────────────────────────────────

func (r *Repository) ListConsents(ctx context.Context, userID string) ([]LegalConsent, error) {
	const q = `
		SELECT id, user_id, consent_kind, version, accepted, accepted_at, created_at
		FROM doctor_legal_consents WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LegalConsent{}
	for rows.Next() {
		c := LegalConsent{}
		if err := rows.Scan(&c.ID, &c.UserID, &c.ConsentKind, &c.Version, &c.Accepted,
			&c.AcceptedAt, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// UpsertConsent records a consent decision. Natural key UNIQUE(user_id, consent_kind, version).
func (r *Repository) UpsertConsent(ctx context.Context, userID string, req AcceptConsentRequest) (*LegalConsent, error) {
	version := req.Version
	if version == "" {
		version = "v1"
	}
	accepted := boolOrDefault(req.Accepted, true)
	var acceptedAt *time.Time
	if accepted {
		now := time.Now()
		acceptedAt = &now
	}
	const q = `
		INSERT INTO doctor_legal_consents (user_id, consent_kind, version, accepted, accepted_at)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (user_id, consent_kind, version) DO UPDATE SET
			accepted = EXCLUDED.accepted,
			accepted_at = EXCLUDED.accepted_at`
	if _, err := r.db.Exec(ctx, q, userID, req.ConsentKind, version, accepted, acceptedAt); err != nil {
		return nil, err
	}
	const sel = `
		SELECT id, user_id, consent_kind, version, accepted, accepted_at, created_at
		FROM doctor_legal_consents WHERE user_id = $1 AND consent_kind = $2 AND version = $3`
	c := &LegalConsent{}
	err := r.db.QueryRow(ctx, sel, userID, req.ConsentKind, version).Scan(&c.ID, &c.UserID,
		&c.ConsentKind, &c.Version, &c.Accepted, &c.AcceptedAt, &c.CreatedAt)
	return c, err
}

// ── Onboarding: app permissions ──────────────────────────────────────────────

func (r *Repository) ListPermissions(ctx context.Context, userID string) ([]AppPermission, error) {
	const q = `
		SELECT id, user_id, permission_kind, state, decided_at, created_at, updated_at
		FROM doctor_app_permissions WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AppPermission{}
	for rows.Next() {
		p := AppPermission{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.PermissionKind, &p.State, &p.DecidedAt,
			&p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpsertPermission records a permission decision. UNIQUE(user_id, permission_kind).
func (r *Repository) UpsertPermission(ctx context.Context, userID string, req RecordPermissionRequest) (*AppPermission, error) {
	const q = `
		INSERT INTO doctor_app_permissions (user_id, permission_kind, state, decided_at, updated_at)
		VALUES ($1,$2,$3, now(), now())
		ON CONFLICT (user_id, permission_kind) DO UPDATE SET
			state = EXCLUDED.state,
			decided_at = now(),
			updated_at = now()`
	if _, err := r.db.Exec(ctx, q, userID, req.PermissionKind, req.State); err != nil {
		return nil, err
	}
	const sel = `
		SELECT id, user_id, permission_kind, state, decided_at, created_at, updated_at
		FROM doctor_app_permissions WHERE user_id = $1 AND permission_kind = $2`
	p := &AppPermission{}
	err := r.db.QueryRow(ctx, sel, userID, req.PermissionKind).Scan(&p.ID, &p.UserID,
		&p.PermissionKind, &p.State, &p.DecidedAt, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

// ── Onboarding: merchant upgrade ─────────────────────────────────────────────

func (r *Repository) GetMerchantUpgrade(ctx context.Context, userID string) (*MerchantUpgrade, error) {
	const q = `
		SELECT id, user_id, state, requested_at, completed_at, detail, created_at, updated_at
		FROM doctor_merchant_upgrades WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`
	m := &MerchantUpgrade{}
	err := r.db.QueryRow(ctx, q, userID).Scan(&m.ID, &m.UserID, &m.State, &m.RequestedAt,
		&m.CompletedAt, &m.Detail, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// InsertMerchantUpgrade requests an upgrade. Idempotent on UNIQUE(idempotency_key).
func (r *Repository) InsertMerchantUpgrade(ctx context.Context, userID, idemKey string, detail []byte) (*MerchantUpgrade, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `
		INSERT INTO doctor_merchant_upgrades (id, user_id, state, requested_at, detail, idempotency_key)
		VALUES ($1,$2,'requested',$3,$4,$5)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, now, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getMerchantUpgradeByIdem(ctx, userID, idemKey)
	}
	return r.getMerchantUpgradeByID(ctx, userID, id)
}

func (r *Repository) getMerchantUpgradeByID(ctx context.Context, userID, id string) (*MerchantUpgrade, error) {
	const q = `
		SELECT id, user_id, state, requested_at, completed_at, detail, created_at, updated_at
		FROM doctor_merchant_upgrades WHERE id = $1 AND user_id = $2`
	m := &MerchantUpgrade{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&m.ID, &m.UserID, &m.State, &m.RequestedAt,
		&m.CompletedAt, &m.Detail, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

func (r *Repository) getMerchantUpgradeByIdem(ctx context.Context, userID, idemKey string) (*MerchantUpgrade, error) {
	const q = `
		SELECT id, user_id, state, requested_at, completed_at, detail, created_at, updated_at
		FROM doctor_merchant_upgrades WHERE user_id = $1 AND idempotency_key = $2`
	m := &MerchantUpgrade{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&m.ID, &m.UserID, &m.State, &m.RequestedAt,
		&m.CompletedAt, &m.Detail, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// ── Profile builder: draft / publish (doctor_profiles JSONB columns) ──────────

// GetProfileDraft returns the profile_draft + completed_steps JSONB.
func (r *Repository) GetProfileDraft(ctx context.Context, userID string) (*Profile, error) {
	return r.GetProfile(ctx, userID)
}

// SaveProfileDraft patch-merges the supplied JSON into profile_draft (jsonb || jsonb).
// Idempotent: an empty/replayed patch is a no-op merge.
func (r *Repository) SaveProfileDraft(ctx context.Context, userID string, patch []byte) (*Profile, error) {
	const q = `
		UPDATE doctor_profiles
		SET profile_draft = profile_draft || $2::jsonb, updated_at = now()
		WHERE user_id = $1`
	tag, err := r.db.Exec(ctx, q, userID, jsonOrEmptyObject(patch))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetProfile(ctx, userID)
}

// PublishProfile marks the profile live. Requires an approved verification (fail-closed).
func (r *Repository) PublishProfile(ctx context.Context, userID string) (*Profile, error) {
	const q = `
		UPDATE doctor_profiles SET is_published = true, updated_at = now()
		WHERE user_id = $1 AND verification = 'approved'`
	tag, err := r.db.Exec(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Either no profile row or verification not approved → caller maps to 403/404.
		return nil, ErrNotEligible
	}
	return r.GetProfile(ctx, userID)
}

// ListVerificationDocuments returns the document slots for the doctor.
func (r *Repository) ListVerificationDocuments(ctx context.Context, userID string) ([]VerificationDocument, error) {
	const q = `
		SELECT id, verification_id, user_id, doc_type, label, file_name, file_url,
		       mime_type, size_bytes, required, uploaded_at, created_at
		FROM doctor_verification_documents WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VerificationDocument{}
	for rows.Next() {
		d := VerificationDocument{}
		if err := rows.Scan(&d.ID, &d.VerificationID, &d.UserID, &d.DocType, &d.Label,
			&d.FileName, &d.FileURL, &d.MimeType, &d.SizeBytes, &d.Required,
			&d.UploadedAt, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ── Notifications: groups + preferences ──────────────────────────────────────

// ListNotificationGroups groups the doctor's notifications by group_key.
func (r *Repository) ListNotificationGroups(ctx context.Context, userID string) ([]NotificationGroup, error) {
	const q = `
		SELECT id, user_id, notif_type, title, body, read, read_at, detail, created_at, group_key
		FROM doctor_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	order := []string{}
	byKey := map[string]*NotificationGroup{}
	for rows.Next() {
		n := Notification{}
		var groupKey *string
		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &n.Read,
			&n.ReadAt, &n.Detail, &n.CreatedAt, &groupKey); err != nil {
			return nil, err
		}
		key := "ungrouped"
		if groupKey != nil && *groupKey != "" {
			key = *groupKey
		}
		g, ok := byKey[key]
		if !ok {
			g = &NotificationGroup{GroupKey: key, Items: []Notification{}}
			byKey[key] = g
			order = append(order, key)
		}
		g.Items = append(g.Items, n)
		g.Count++
		if !n.Read {
			g.Unread++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]NotificationGroup, 0, len(order))
	for _, k := range order {
		out = append(out, *byKey[k])
	}
	return out, nil
}

func (r *Repository) ListNotificationPreferences(ctx context.Context, userID string) ([]NotificationPreference, error) {
	const q = `
		SELECT id, user_id, channel, category, enabled, created_at, updated_at
		FROM doctor_notification_preferences WHERE user_id = $1 ORDER BY channel, category`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []NotificationPreference{}
	for rows.Next() {
		p := NotificationPreference{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.Channel, &p.Category, &p.Enabled,
			&p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpsertNotificationPreference toggles a channel/category preference. UNIQUE(user_id, channel, category).
func (r *Repository) UpsertNotificationPreference(ctx context.Context, userID string, req UpdateNotificationPreferenceRequest) (*NotificationPreference, error) {
	enabled := boolOrDefault(req.Enabled, true)
	const q = `
		INSERT INTO doctor_notification_preferences (user_id, channel, category, enabled, updated_at)
		VALUES ($1,$2,$3,$4, now())
		ON CONFLICT (user_id, channel, category) DO UPDATE SET
			enabled = EXCLUDED.enabled, updated_at = now()`
	if _, err := r.db.Exec(ctx, q, userID, req.Channel, req.Category, enabled); err != nil {
		return nil, err
	}
	const sel = `
		SELECT id, user_id, channel, category, enabled, created_at, updated_at
		FROM doctor_notification_preferences WHERE user_id = $1 AND channel = $2 AND category = $3`
	p := &NotificationPreference{}
	err := r.db.QueryRow(ctx, sel, userID, req.Channel, req.Category).Scan(&p.ID, &p.UserID,
		&p.Channel, &p.Category, &p.Enabled, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

// MarkAllNotificationsRead marks every unread notification for the doctor read.
func (r *Repository) MarkAllNotificationsRead(ctx context.Context, userID string) (int64, error) {
	const q = `UPDATE doctor_notifications SET read = true, read_at = now() WHERE user_id = $1 AND read = false`
	tag, err := r.db.Exec(ctx, q, userID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ── Support: tickets ─────────────────────────────────────────────────────────

func (r *Repository) ListSupportTickets(ctx context.Context, userID string) ([]SupportTicket, error) {
	const q = `
		SELECT id, user_id, ref, subject, category, status, last_reply, created_at, updated_at
		FROM doctor_support_tickets WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SupportTicket{}
	for rows.Next() {
		t := SupportTicket{}
		if err := rows.Scan(&t.ID, &t.UserID, &t.Ref, &t.Subject, &t.Category, &t.Status,
			&t.LastReply, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// InsertSupportTicket creates a ticket idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertSupportTicket(ctx context.Context, userID, idemKey string, req CreateSupportTicketRequest) (*SupportTicket, error) {
	id := uuid.New().String()
	ref := "TKT-" + id[0:8]
	const q = `
		INSERT INTO doctor_support_tickets (id, user_id, ref, subject, category, status, last_reply, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,'open',$6,$7)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, ref, req.Subject, req.Category, req.Body, idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getSupportTicketByIdem(ctx, userID, idemKey)
	}
	return r.getSupportTicketByID(ctx, userID, id)
}

func (r *Repository) getSupportTicketByID(ctx context.Context, userID, id string) (*SupportTicket, error) {
	const q = `
		SELECT id, user_id, ref, subject, category, status, last_reply, created_at, updated_at
		FROM doctor_support_tickets WHERE id = $1 AND user_id = $2`
	t := &SupportTicket{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&t.ID, &t.UserID, &t.Ref, &t.Subject,
		&t.Category, &t.Status, &t.LastReply, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

func (r *Repository) getSupportTicketByIdem(ctx context.Context, userID, idemKey string) (*SupportTicket, error) {
	const q = `
		SELECT id, user_id, ref, subject, category, status, last_reply, created_at, updated_at
		FROM doctor_support_tickets WHERE user_id = $1 AND idempotency_key = $2`
	t := &SupportTicket{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&t.ID, &t.UserID, &t.Ref, &t.Subject,
		&t.Category, &t.Status, &t.LastReply, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

// ── Support: disputes ────────────────────────────────────────────────────────

func (r *Repository) ListSupportDisputes(ctx context.Context, userID string) ([]SupportDispute, error) {
	const q = `
		SELECT id, user_id, status, subject, evidence, detail, created_at, updated_at
		FROM doctor_support_disputes WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SupportDispute{}
	for rows.Next() {
		d := SupportDispute{}
		if err := rows.Scan(&d.ID, &d.UserID, &d.Status, &d.Subject, &d.Evidence,
			&d.Detail, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *Repository) GetSupportDispute(ctx context.Context, userID, id string) (*SupportDispute, error) {
	const q = `
		SELECT id, user_id, status, subject, evidence, detail, created_at, updated_at
		FROM doctor_support_disputes WHERE id = $1 AND user_id = $2`
	d := &SupportDispute{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&d.ID, &d.UserID, &d.Status, &d.Subject,
		&d.Evidence, &d.Detail, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}

// InsertSupportDispute creates a dispute idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertSupportDispute(ctx context.Context, userID, idemKey string, req CreateDisputeRequest) (*SupportDispute, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_support_disputes (id, user_id, status, subject, detail, idempotency_key)
		VALUES ($1,$2,'open',$3,$4,$5)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, req.Subject, jsonOrEmptyObject(req.Detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getSupportDisputeByIdem(ctx, userID, idemKey)
	}
	return r.GetSupportDispute(ctx, userID, id)
}

func (r *Repository) getSupportDisputeByIdem(ctx context.Context, userID, idemKey string) (*SupportDispute, error) {
	const q = `
		SELECT id, user_id, status, subject, evidence, detail, created_at, updated_at
		FROM doctor_support_disputes WHERE user_id = $1 AND idempotency_key = $2`
	d := &SupportDispute{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&d.ID, &d.UserID, &d.Status, &d.Subject,
		&d.Evidence, &d.Detail, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}

// AppendDisputeEvidence appends an evidence element to the dispute's JSONB array (scoped).
func (r *Repository) AppendDisputeEvidence(ctx context.Context, userID, disputeID string, evidence []byte) (*SupportDispute, error) {
	const q = `
		UPDATE doctor_support_disputes
		SET evidence = evidence || $3::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, disputeID, userID, jsonOrEmptyArray(evidence))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetSupportDispute(ctx, userID, disputeID)
}

// ── Support: messages (threads) ──────────────────────────────────────────────

func (r *Repository) ListSupportMessages(ctx context.Context, userID, threadID string) ([]SupportMessage, error) {
	const q = `
		SELECT id, user_id, thread_id, ticket_id, author, body, created_at
		FROM doctor_support_messages WHERE user_id = $1 AND thread_id = $2 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, userID, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SupportMessage{}
	for rows.Next() {
		m := SupportMessage{}
		if err := rows.Scan(&m.ID, &m.UserID, &m.ThreadID, &m.TicketID, &m.Author,
			&m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertSupportMessage posts a message to a thread idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertSupportMessage(ctx context.Context, userID, threadID, idemKey string, req SendSupportMessageRequest) (*SupportMessage, error) {
	id := uuid.New().String()
	author := req.Author
	if author == "" {
		author = "doctor"
	}
	const q = `
		INSERT INTO doctor_support_messages (id, user_id, thread_id, author, body, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, threadID, author, req.Body, idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getSupportMessageByIdem(ctx, userID, idemKey)
	}
	return r.getSupportMessageByID(ctx, userID, id)
}

func (r *Repository) getSupportMessageByID(ctx context.Context, userID, id string) (*SupportMessage, error) {
	const q = `
		SELECT id, user_id, thread_id, ticket_id, author, body, created_at
		FROM doctor_support_messages WHERE id = $1 AND user_id = $2`
	m := &SupportMessage{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&m.ID, &m.UserID, &m.ThreadID, &m.TicketID,
		&m.Author, &m.Body, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

func (r *Repository) getSupportMessageByIdem(ctx context.Context, userID, idemKey string) (*SupportMessage, error) {
	const q = `
		SELECT id, user_id, thread_id, ticket_id, author, body, created_at
		FROM doctor_support_messages WHERE user_id = $1 AND idempotency_key = $2`
	m := &SupportMessage{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&m.ID, &m.UserID, &m.ThreadID, &m.TicketID,
		&m.Author, &m.Body, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// ── Compliance: audit trail / training / safety / privacy ────────────────────

// ListAuditTrail returns the doctor's immutable compliance-audit rows.
func (r *Repository) ListAuditTrail(ctx context.Context, userID string) ([]AuditEntry, error) {
	const q = `
		SELECT id, user_id, action, entity_type, entity_id, detail, created_at
		FROM doctor_compliance_audit WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		a := AuditEntry{}
		if err := rows.Scan(&a.ID, &a.UserID, &a.Action, &a.EntityType, &a.EntityID,
			&a.Detail, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repository) ListTraining(ctx context.Context, userID string) ([]TrainingModule, error) {
	const q = `
		SELECT id, user_id, module_id, title, status, completed_at, detail, created_at, updated_at
		FROM doctor_mandatory_training WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrainingModule{}
	for rows.Next() {
		t := TrainingModule{}
		if err := rows.Scan(&t.ID, &t.UserID, &t.ModuleID, &t.Title, &t.Status,
			&t.CompletedAt, &t.Detail, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// CompleteTraining marks a module completed idempotently. UNIQUE(idempotency_key)
// and UNIQUE(user_id, module_id) both protect against duplicates.
func (r *Repository) CompleteTraining(ctx context.Context, userID, moduleID, idemKey string, detail []byte) (*TrainingModule, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_mandatory_training (id, user_id, module_id, status, completed_at, detail, idempotency_key, updated_at)
		VALUES ($1,$2,$3,'completed', now(), $4,$5, now())
		ON CONFLICT (user_id, module_id) DO UPDATE SET
			status = 'completed', completed_at = now(), updated_at = now()`
	if _, err := r.db.Exec(ctx, q, id, userID, moduleID, jsonOrEmptyObject(detail), idemKey); err != nil {
		return nil, err
	}
	const sel = `
		SELECT id, user_id, module_id, title, status, completed_at, detail, created_at, updated_at
		FROM doctor_mandatory_training WHERE user_id = $1 AND module_id = $2`
	t := &TrainingModule{}
	err := r.db.QueryRow(ctx, sel, userID, moduleID).Scan(&t.ID, &t.UserID, &t.ModuleID,
		&t.Title, &t.Status, &t.CompletedAt, &t.Detail, &t.CreatedAt, &t.UpdatedAt)
	return t, err
}

func (r *Repository) ListSafetyIssues(ctx context.Context, userID string) ([]SafetyIssue, error) {
	const q = `
		SELECT id, user_id, severity, status, subject, detail, created_at, updated_at
		FROM doctor_safety_issues WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SafetyIssue{}
	for rows.Next() {
		s := SafetyIssue{}
		if err := rows.Scan(&s.ID, &s.UserID, &s.Severity, &s.Status, &s.Subject,
			&s.Detail, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// InsertSafetyIssue files a report idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertSafetyIssue(ctx context.Context, userID, idemKey string, req ReportSafetyIssueRequest) (*SafetyIssue, error) {
	severity := req.Severity
	if severity == "" {
		severity = "medium"
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_safety_issues (id, user_id, severity, status, subject, detail, idempotency_key)
		VALUES ($1,$2,$3,'open',$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, severity, req.Subject, jsonOrEmptyObject(req.Detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getSafetyIssueByIdem(ctx, userID, idemKey)
	}
	return r.getSafetyIssueByID(ctx, userID, id)
}

func (r *Repository) getSafetyIssueByID(ctx context.Context, userID, id string) (*SafetyIssue, error) {
	const q = `
		SELECT id, user_id, severity, status, subject, detail, created_at, updated_at
		FROM doctor_safety_issues WHERE id = $1 AND user_id = $2`
	s := &SafetyIssue{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&s.ID, &s.UserID, &s.Severity, &s.Status,
		&s.Subject, &s.Detail, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

func (r *Repository) getSafetyIssueByIdem(ctx context.Context, userID, idemKey string) (*SafetyIssue, error) {
	const q = `
		SELECT id, user_id, severity, status, subject, detail, created_at, updated_at
		FROM doctor_safety_issues WHERE user_id = $1 AND idempotency_key = $2`
	s := &SafetyIssue{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&s.ID, &s.UserID, &s.Severity, &s.Status,
		&s.Subject, &s.Detail, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// GetPrivacySettings returns (creating defaults if absent) the privacy settings row.
func (r *Repository) GetPrivacySettings(ctx context.Context, userID string) (*DataPrivacySettings, error) {
	const ins = `INSERT INTO doctor_data_privacy_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`
	if _, err := r.db.Exec(ctx, ins, userID); err != nil {
		return nil, err
	}
	return r.scanPrivacy(ctx, userID)
}

func (r *Repository) scanPrivacy(ctx context.Context, userID string) (*DataPrivacySettings, error) {
	const q = `
		SELECT id, user_id, settings, export_requested_at, deletion_requested_at, created_at, updated_at
		FROM doctor_data_privacy_settings WHERE user_id = $1`
	p := &DataPrivacySettings{}
	err := r.db.QueryRow(ctx, q, userID).Scan(&p.ID, &p.UserID, &p.Settings,
		&p.ExportRequestedAt, &p.DeletionRequestedAt, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// UpdatePrivacySettings patch-merges the settings JSONB.
func (r *Repository) UpdatePrivacySettings(ctx context.Context, userID string, patch []byte) (*DataPrivacySettings, error) {
	if _, err := r.GetPrivacySettings(ctx, userID); err != nil {
		return nil, err
	}
	const q = `
		UPDATE doctor_data_privacy_settings
		SET settings = settings || $2::jsonb, updated_at = now()
		WHERE user_id = $1`
	if _, err := r.db.Exec(ctx, q, userID, jsonOrEmptyObject(patch)); err != nil {
		return nil, err
	}
	return r.scanPrivacy(ctx, userID)
}

// ── Security: devices ────────────────────────────────────────────────────────

func (r *Repository) ListDevices(ctx context.Context, userID string) ([]Device, error) {
	const q = `
		SELECT id, user_id, device_label, platform, last_seen_at, revoked, revoked_at, detail, created_at
		FROM doctor_devices WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Device{}
	for rows.Next() {
		d := Device{}
		if err := rows.Scan(&d.ID, &d.UserID, &d.DeviceLabel, &d.Platform, &d.LastSeenAt,
			&d.Revoked, &d.RevokedAt, &d.Detail, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// RevokeDevice marks a device revoked (scoped to owner). Returns ErrNotFound if absent.
func (r *Repository) RevokeDevice(ctx context.Context, userID, deviceID string) error {
	const q = `
		UPDATE doctor_devices SET revoked = true, revoked_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, deviceID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Reputation / reviews ─────────────────────────────────────────────────────

// GetLatestQualityScore returns the most recent quality score row (ranking + recs).
func (r *Repository) GetLatestQualityScore(ctx context.Context, userID string) (*QualityScore, error) {
	const q = `
		SELECT id, user_id, score, period_label, ranking, recommendations, detail, created_at, updated_at
		FROM doctor_quality_scores WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`
	s := &QualityScore{}
	err := r.db.QueryRow(ctx, q, userID).Scan(&s.ID, &s.UserID, &s.Score, &s.PeriodLabel,
		&s.Ranking, &s.Recommendations, &s.Detail, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

func (r *Repository) ListConsultationFeedback(ctx context.Context, userID string) ([]ConsultationFeedback, error) {
	const q = `
		SELECT id, user_id, appointment_id, rating, comment, detail, created_at
		FROM doctor_consultation_feedback WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ConsultationFeedback{}
	for rows.Next() {
		f := ConsultationFeedback{}
		if err := rows.Scan(&f.ID, &f.UserID, &f.AppointmentID, &f.Rating, &f.Comment,
			&f.Detail, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *Repository) ListReviewDisputes(ctx context.Context, userID string) ([]ReviewDispute, error) {
	const q = `
		SELECT id, user_id, review_id, kind, status, reason, detail, created_at
		FROM doctor_review_disputes WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ReviewDispute{}
	for rows.Next() {
		d := ReviewDispute{}
		if err := rows.Scan(&d.ID, &d.UserID, &d.ReviewID, &d.Kind, &d.Status, &d.Reason,
			&d.Detail, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// InsertReviewDispute records a dispute/report/removal_request against a review,
// idempotently (UNIQUE idempotency_key). `kind` is dispute|removal_request|report.
func (r *Repository) InsertReviewDispute(ctx context.Context, userID, reviewID, kind, idemKey string, req ReviewActionRequest) (*ReviewDispute, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_review_disputes (id, user_id, review_id, kind, status, reason, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,'open',$5,$6,$7)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, reviewID, kind, req.Reason, jsonOrEmptyObject(req.Detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getReviewDisputeByIdem(ctx, userID, idemKey)
	}
	return r.getReviewDisputeByID(ctx, userID, id)
}

// MarkReviewReported flips the reported flag on a review owned by the doctor (best effort
// alongside the dispute row). Returns ErrNotFound if no such review for the doctor.
func (r *Repository) MarkReviewReported(ctx context.Context, userID, reviewID string) error {
	const q = `UPDATE doctor_reviews SET reported = true WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, reviewID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) getReviewDisputeByID(ctx context.Context, userID, id string) (*ReviewDispute, error) {
	const q = `
		SELECT id, user_id, review_id, kind, status, reason, detail, created_at
		FROM doctor_review_disputes WHERE id = $1 AND user_id = $2`
	d := &ReviewDispute{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&d.ID, &d.UserID, &d.ReviewID, &d.Kind,
		&d.Status, &d.Reason, &d.Detail, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}

func (r *Repository) getReviewDisputeByIdem(ctx context.Context, userID, idemKey string) (*ReviewDispute, error) {
	const q = `
		SELECT id, user_id, review_id, kind, status, reason, detail, created_at
		FROM doctor_review_disputes WHERE user_id = $1 AND idempotency_key = $2`
	d := &ReviewDispute{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&d.ID, &d.UserID, &d.ReviewID, &d.Kind,
		&d.Status, &d.Reason, &d.Detail, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}

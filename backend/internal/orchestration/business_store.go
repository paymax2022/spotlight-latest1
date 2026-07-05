package orchestration

// business_store.go — persistence for the FX "business admin" console (team,
// approvals + thresholds, activity/audit log, API keys, webhooks, settings,
// notifications). Backed by the same pgx pool as the other orch_* tables; these
// hold admin/console metadata + a money-approval DECISION record — NOT the money
// path (no ledger, no balances; the actual value movement stays on the
// transfer/conversion path).
//
// Tenant model: the FX account owner (the authenticated customer id) IS the
// business/tenant, so every query is scoped by business_id (= customerID(c)) for
// object-level authorization. A nil store makes handlers fall back to honest
// defaults so the app still renders in a DB-less dev setup.
//
// Requires migration 20260913000000_fx_business_admin.sql.

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── Contract-shaped records (camelCase JSON mirrors mobile fx.types.ts) ───────

// TeamMember is one RBAC seat under a business.
type TeamMember struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Email        string  `json:"email"`
	Role         string  `json:"role"`   // OWNER|ADMIN|APPROVER|INITIATOR|VIEWER
	Status       string  `json:"status"` // ACTIVE|INVITED|SUSPENDED
	LastActiveAt *string `json:"lastActiveAt"`
}

// ApprovalThreshold: above amount (minor units) a request needs N approvers.
type ApprovalThreshold struct {
	ID                string `json:"id"`
	Label             string `json:"label"`
	Currency          string `json:"currency"`
	Amount            int64  `json:"amount"` // minor units (kobo/cents)
	ApproversRequired int    `json:"approversRequired"`
}

// Approval is a pending/decided money-approval request. amount mirrors the
// mobile Money object { amount, currency }.
type Approval struct {
	ID          string        `json:"id"`
	Type        string        `json:"type"` // transfer|conversion|bulk_payout
	Reference   string        `json:"reference"`
	Amount      ApprovalMoney `json:"amount"`
	Destination string        `json:"destination"`
	Initiator   string        `json:"initiator"`
	CreatedAt   string        `json:"createdAt"`
	Status      string        `json:"status"`    // PENDING|APPROVED|REJECTED
	Threshold   int64         `json:"threshold"` // minor units that triggered approval
}

// ApprovalMoney is the { amount, currency } money object (minor units).
type ApprovalMoney struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

// ActivityEvent is one audit-log row.
type ActivityEvent struct {
	ID     string  `json:"id"`
	Actor  string  `json:"actor"`
	Action string  `json:"action"`
	Target *string `json:"target"`
	At     string  `json:"at"`
	Kind   string  `json:"kind"` // auth|payout|config|approval|security
}

// APIKey is a business API key. Plaintext is NEVER stored/returned except once at
// creation via the Secret field (populated only on create/rotate).
type APIKey struct {
	ID        string  `json:"id"`
	Label     string  `json:"label"`
	Prefix    string  `json:"prefix"`
	Mode      string  `json:"mode"` // live|sandbox
	CreatedAt string  `json:"createdAt"`
	LastUsed  *string `json:"lastUsed"`
	Secret    string  `json:"secret,omitempty"` // plaintext, returned once on create/rotate only
}

// Webhook is a per-business outbound webhook subscription.
type Webhook struct {
	ID      string   `json:"id"`
	URL     string   `json:"url"`
	Events  []string `json:"events"`
	Enabled bool     `json:"enabled"`
}

// Notification is one inbox item.
type Notification struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	Read      bool    `json:"read"`
	CreatedAt string  `json:"createdAt"`
	Deeplink  *string `json:"deeplink,omitempty"`
}

// ─── Store interface ──────────────────────────────────────────────────────────

// BusinessStore persists the FX business-admin console tables. An interface so
// handlers stay testable and so a nil store degrades to honest defaults.
type BusinessStore interface {
	// Team
	ListTeam(ctx context.Context, business string) ([]TeamMember, error)
	UpdateMemberRole(ctx context.Context, business, id, role string) (TeamMember, bool, error)

	// Approvals + thresholds
	ListApprovals(ctx context.Context, business string) ([]Approval, error)
	DecideApproval(ctx context.Context, business, id, decision, actor string) (Approval, bool, error)
	ListThresholds(ctx context.Context, business string) ([]ApprovalThreshold, error)
	UpdateThreshold(ctx context.Context, business, id string, amount int64, approvers int) (ApprovalThreshold, bool, error)

	// Activity / audit
	ListActivity(ctx context.Context, business string) ([]ActivityEvent, error)
	LogActivity(ctx context.Context, business, actor, action string, target *string, kind string) error

	// API keys (hash-only)
	ListAPIKeys(ctx context.Context, business string) ([]APIKey, error)
	CreateAPIKey(ctx context.Context, business, label, mode, prefix, hash, secret string) (APIKey, error)
	RotateAPIKey(ctx context.Context, business, id, prefix, hash, secret string) (APIKey, bool, error)

	// Webhooks
	ListWebhooks(ctx context.Context, business string) ([]Webhook, error)
	CreateWebhook(ctx context.Context, business, url string, events []string) (Webhook, error)
	UpdateWebhook(ctx context.Context, business, id string, enabled *bool, url *string, events []string) (Webhook, bool, error)
	DeleteWebhook(ctx context.Context, business, id string) error

	// Settings (upserted per business)
	GetSettings(ctx context.Context, business string) (FxSettings, error)
	UpdateSettings(ctx context.Context, business string, patch FxSettingsPatch) (FxSettings, error)

	// Notifications
	ListNotifications(ctx context.Context, business string) ([]Notification, error)
	MarkNotificationRead(ctx context.Context, business, id string) error
	MarkAllNotificationsRead(ctx context.Context, business string) error
}

// sqlBusinessStore is the Postgres-backed implementation.
type sqlBusinessStore struct {
	db *pgxpool.Pool
}

// NewBusinessStore returns a Postgres-backed business-admin store.
func NewBusinessStore(db *pgxpool.Pool) BusinessStore { return &sqlBusinessStore{db: db} }

func tsPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

// ─── Team ─────────────────────────────────────────────────────────────────────

func (s *sqlBusinessStore) ListTeam(ctx context.Context, business string) ([]TeamMember, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, name, email, role, status, last_active_at
		FROM orch_fx_team_members WHERE business_id=$1
		ORDER BY created_at ASC`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]TeamMember, 0)
	for rows.Next() {
		var m TeamMember
		var last *time.Time
		if err := rows.Scan(&m.ID, &m.Name, &m.Email, &m.Role, &m.Status, &last); err != nil {
			return nil, err
		}
		m.LastActiveAt = tsPtr(last)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *sqlBusinessStore) UpdateMemberRole(ctx context.Context, business, id, role string) (TeamMember, bool, error) {
	var m TeamMember
	var last *time.Time
	err := s.db.QueryRow(ctx, `
		UPDATE orch_fx_team_members SET role=$3, updated_at=now()
		WHERE id=$1 AND business_id=$2
		RETURNING id, name, email, role, status, last_active_at`,
		id, business, role,
	).Scan(&m.ID, &m.Name, &m.Email, &m.Role, &m.Status, &last)
	if errors.Is(err, pgx.ErrNoRows) {
		return TeamMember{}, false, nil
	}
	if err != nil {
		return TeamMember{}, false, err
	}
	m.LastActiveAt = tsPtr(last)
	return m, true, nil
}

// ─── Approvals + thresholds ───────────────────────────────────────────────────

func (s *sqlBusinessStore) ListApprovals(ctx context.Context, business string) ([]Approval, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, type, reference, amount_minor, currency, destination, initiator, threshold_minor, status, created_at
		FROM orch_fx_approvals WHERE business_id=$1
		ORDER BY created_at DESC`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Approval, 0)
	for rows.Next() {
		var a Approval
		var created time.Time
		if err := rows.Scan(&a.ID, &a.Type, &a.Reference, &a.Amount.Amount, &a.Amount.Currency,
			&a.Destination, &a.Initiator, &a.Threshold, &a.Status, &created); err != nil {
			return nil, err
		}
		a.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, a)
	}
	return out, rows.Err()
}

// DecideApproval transitions PENDING → APPROVED|REJECTED atomically. The guard
// `AND status='PENDING'` makes the transition idempotent-safe: a second decision
// (or a decision on an already-decided row) affects zero rows and returns ok=false.
// Persists WHO decided and WHEN. NOT money-path — no ledger entry here.
func (s *sqlBusinessStore) DecideApproval(ctx context.Context, business, id, decision, actor string) (Approval, bool, error) {
	var a Approval
	var created time.Time
	err := s.db.QueryRow(ctx, `
		UPDATE orch_fx_approvals
		SET status=$3, decided_by=$4, decided_at=now(), updated_at=now()
		WHERE id=$1 AND business_id=$2 AND status='PENDING'
		RETURNING id, type, reference, amount_minor, currency, destination, initiator, threshold_minor, status, created_at`,
		id, business, decision, actor,
	).Scan(&a.ID, &a.Type, &a.Reference, &a.Amount.Amount, &a.Amount.Currency,
		&a.Destination, &a.Initiator, &a.Threshold, &a.Status, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return Approval{}, false, nil
	}
	if err != nil {
		return Approval{}, false, err
	}
	a.CreatedAt = created.UTC().Format(time.RFC3339)
	return a, true, nil
}

func (s *sqlBusinessStore) ListThresholds(ctx context.Context, business string) ([]ApprovalThreshold, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, label, currency, amount_minor, approvers_required
		FROM orch_fx_approval_thresholds WHERE business_id=$1
		ORDER BY created_at ASC`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ApprovalThreshold, 0)
	for rows.Next() {
		var t ApprovalThreshold
		if err := rows.Scan(&t.ID, &t.Label, &t.Currency, &t.Amount, &t.ApproversRequired); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *sqlBusinessStore) UpdateThreshold(ctx context.Context, business, id string, amount int64, approvers int) (ApprovalThreshold, bool, error) {
	var t ApprovalThreshold
	err := s.db.QueryRow(ctx, `
		UPDATE orch_fx_approval_thresholds
		SET amount_minor=$3, approvers_required=$4, updated_at=now()
		WHERE id=$1 AND business_id=$2
		RETURNING id, label, currency, amount_minor, approvers_required`,
		id, business, amount, approvers,
	).Scan(&t.ID, &t.Label, &t.Currency, &t.Amount, &t.ApproversRequired)
	if errors.Is(err, pgx.ErrNoRows) {
		return ApprovalThreshold{}, false, nil
	}
	if err != nil {
		return ApprovalThreshold{}, false, err
	}
	return t, true, nil
}

// ─── Activity / audit ─────────────────────────────────────────────────────────

func (s *sqlBusinessStore) ListActivity(ctx context.Context, business string) ([]ActivityEvent, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, actor, action, target, kind, at
		FROM orch_fx_activity_log WHERE business_id=$1
		ORDER BY at DESC LIMIT 200`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ActivityEvent, 0)
	for rows.Next() {
		var e ActivityEvent
		var at time.Time
		if err := rows.Scan(&e.ID, &e.Actor, &e.Action, &e.Target, &e.Kind, &at); err != nil {
			return nil, err
		}
		e.At = at.UTC().Format(time.RFC3339)
		out = append(out, e)
	}
	return out, rows.Err()
}

// LogActivity appends an immutable audit row. Best-effort from the mutation
// handlers (a failed audit insert never rolls back the primary mutation, but it
// is logged by the caller).
func (s *sqlBusinessStore) LogActivity(ctx context.Context, business, actor, action string, target *string, kind string) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO orch_fx_activity_log (id, business_id, actor, action, target, kind)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		newID("act"), business, actor, action, target, kind)
	return err
}

// ─── API keys (hash-only) ─────────────────────────────────────────────────────

func (s *sqlBusinessStore) ListAPIKeys(ctx context.Context, business string) ([]APIKey, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, label, prefix, mode, created_at, last_used
		FROM orch_fx_api_keys WHERE business_id=$1 AND revoked_at IS NULL
		ORDER BY created_at DESC`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]APIKey, 0)
	for rows.Next() {
		var k APIKey
		var created time.Time
		var last *time.Time
		if err := rows.Scan(&k.ID, &k.Label, &k.Prefix, &k.Mode, &created, &last); err != nil {
			return nil, err
		}
		k.CreatedAt = created.UTC().Format(time.RFC3339)
		k.LastUsed = tsPtr(last)
		out = append(out, k)
	}
	return out, rows.Err()
}

// CreateAPIKey stores only the hash + non-secret prefix; the plaintext `secret`
// is returned once on the response and never persisted.
func (s *sqlBusinessStore) CreateAPIKey(ctx context.Context, business, label, mode, prefix, hash, secret string) (APIKey, error) {
	id := newID("key")
	var created time.Time
	err := s.db.QueryRow(ctx, `
		INSERT INTO orch_fx_api_keys (id, business_id, label, prefix, key_hash, mode)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING created_at`,
		id, business, label, prefix, hash, mode,
	).Scan(&created)
	if err != nil {
		return APIKey{}, err
	}
	return APIKey{
		ID: id, Label: label, Prefix: prefix, Mode: mode,
		CreatedAt: created.UTC().Format(time.RFC3339), Secret: secret,
	}, nil
}

// RotateAPIKey replaces the hash + prefix of an existing key (same label/mode),
// clears last_used, and returns the fresh plaintext once.
func (s *sqlBusinessStore) RotateAPIKey(ctx context.Context, business, id, prefix, hash, secret string) (APIKey, bool, error) {
	var k APIKey
	var created time.Time
	err := s.db.QueryRow(ctx, `
		UPDATE orch_fx_api_keys
		SET prefix=$3, key_hash=$4, last_used=NULL, created_at=now()
		WHERE id=$1 AND business_id=$2 AND revoked_at IS NULL
		RETURNING id, label, prefix, mode, created_at`,
		id, business, prefix, hash,
	).Scan(&k.ID, &k.Label, &k.Prefix, &k.Mode, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return APIKey{}, false, nil
	}
	if err != nil {
		return APIKey{}, false, err
	}
	k.CreatedAt = created.UTC().Format(time.RFC3339)
	k.Secret = secret
	return k, true, nil
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

func (s *sqlBusinessStore) ListWebhooks(ctx context.Context, business string) ([]Webhook, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, url, events, enabled
		FROM orch_fx_webhooks WHERE business_id=$1
		ORDER BY created_at DESC`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Webhook, 0)
	for rows.Next() {
		var w Webhook
		if err := rows.Scan(&w.ID, &w.URL, &w.Events, &w.Enabled); err != nil {
			return nil, err
		}
		if w.Events == nil {
			w.Events = []string{}
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *sqlBusinessStore) CreateWebhook(ctx context.Context, business, url string, events []string) (Webhook, error) {
	id := newID("wh")
	if events == nil {
		events = []string{}
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO orch_fx_webhooks (id, business_id, url, events, enabled)
		VALUES ($1,$2,$3,$4,true)`,
		id, business, url, events)
	if err != nil {
		return Webhook{}, err
	}
	return Webhook{ID: id, URL: url, Events: events, Enabled: true}, nil
}

// UpdateWebhook patches enabled/url/events (any nil arg is left untouched).
func (s *sqlBusinessStore) UpdateWebhook(ctx context.Context, business, id string, enabled *bool, url *string, events []string) (Webhook, bool, error) {
	var w Webhook
	err := s.db.QueryRow(ctx, `
		UPDATE orch_fx_webhooks
		SET enabled = COALESCE($3, enabled),
		    url     = COALESCE($4, url),
		    events  = COALESCE($5, events),
		    updated_at = now()
		WHERE id=$1 AND business_id=$2
		RETURNING id, url, events, enabled`,
		id, business, enabled, url, events,
	).Scan(&w.ID, &w.URL, &w.Events, &w.Enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return Webhook{}, false, nil
	}
	if err != nil {
		return Webhook{}, false, err
	}
	if w.Events == nil {
		w.Events = []string{}
	}
	return w, true, nil
}

func (s *sqlBusinessStore) DeleteWebhook(ctx context.Context, business, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM orch_fx_webhooks WHERE id=$1 AND business_id=$2`, id, business)
	return err
}

// ─── Settings ─────────────────────────────────────────────────────────────────

// FxSettings mirrors the mobile FxSettings contract.
type FxSettings struct {
	DefaultCurrency     string           `json:"defaultCurrency"`
	DisplayRate         string           `json:"displayRate"`
	Language            string           `json:"language"`
	Theme               string           `json:"theme"`
	BiometricEnabled    bool             `json:"biometricEnabled"`
	TwoFactorEnabled    bool             `json:"twoFactorEnabled"`
	Notifications       map[string]bool  `json:"notifications"`
	StablecoinAddresses []map[string]any `json:"stablecoinAddresses"`
}

// FxSettingsPatch carries a partial settings update; nil fields are untouched.
type FxSettingsPatch struct {
	DefaultCurrency     *string
	DisplayRate         *string
	Language            *string
	Theme               *string
	BiometricEnabled    *bool
	TwoFactorEnabled    *bool
	Notifications       map[string]bool
	StablecoinAddresses []map[string]any
}

func defaultFxSettings() FxSettings {
	return FxSettings{
		DefaultCurrency: "NGN", DisplayRate: "all_in", Language: "English", Theme: "system",
		BiometricEnabled: false, TwoFactorEnabled: false,
		Notifications: map[string]bool{
			"payouts": true, "conversions": true, "collections": true,
			"rateAlerts": true, "security": true, "approvals": true,
		},
		StablecoinAddresses: []map[string]any{},
	}
}

// GetSettings returns the business's settings, seeding defaults on first read.
func (s *sqlBusinessStore) GetSettings(ctx context.Context, business string) (FxSettings, error) {
	fs := defaultFxSettings()
	var notif, addrs []byte
	err := s.db.QueryRow(ctx, `
		SELECT default_currency, display_rate, language, theme, biometric_enabled, two_factor_enabled, notifications, stablecoin_addresses
		FROM orch_fx_settings WHERE business_id=$1`, business).
		Scan(&fs.DefaultCurrency, &fs.DisplayRate, &fs.Language, &fs.Theme,
			&fs.BiometricEnabled, &fs.TwoFactorEnabled, &notif, &addrs)
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultFxSettings(), nil // not yet persisted → contract defaults
	}
	if err != nil {
		return FxSettings{}, err
	}
	if len(notif) > 0 {
		_ = json.Unmarshal(notif, &fs.Notifications)
	}
	if len(addrs) > 0 {
		_ = json.Unmarshal(addrs, &fs.StablecoinAddresses)
	}
	if fs.StablecoinAddresses == nil {
		fs.StablecoinAddresses = []map[string]any{}
	}
	return fs, nil
}

// UpdateSettings upserts the row, applying only the provided (non-nil) fields.
func (s *sqlBusinessStore) UpdateSettings(ctx context.Context, business string, patch FxSettingsPatch) (FxSettings, error) {
	cur, err := s.GetSettings(ctx, business)
	if err != nil {
		return FxSettings{}, err
	}
	if patch.DefaultCurrency != nil {
		cur.DefaultCurrency = *patch.DefaultCurrency
	}
	if patch.DisplayRate != nil {
		cur.DisplayRate = *patch.DisplayRate
	}
	if patch.Language != nil {
		cur.Language = *patch.Language
	}
	if patch.Theme != nil {
		cur.Theme = *patch.Theme
	}
	if patch.BiometricEnabled != nil {
		cur.BiometricEnabled = *patch.BiometricEnabled
	}
	if patch.TwoFactorEnabled != nil {
		cur.TwoFactorEnabled = *patch.TwoFactorEnabled
	}
	if patch.Notifications != nil {
		cur.Notifications = patch.Notifications
	}
	if patch.StablecoinAddresses != nil {
		cur.StablecoinAddresses = patch.StablecoinAddresses
	}
	notif, _ := json.Marshal(cur.Notifications)
	addrs, _ := json.Marshal(cur.StablecoinAddresses)
	_, err = s.db.Exec(ctx, `
		INSERT INTO orch_fx_settings
			(business_id, default_currency, display_rate, language, theme, biometric_enabled, two_factor_enabled, notifications, stablecoin_addresses, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
		ON CONFLICT (business_id) DO UPDATE SET
			default_currency=EXCLUDED.default_currency,
			display_rate=EXCLUDED.display_rate,
			language=EXCLUDED.language,
			theme=EXCLUDED.theme,
			biometric_enabled=EXCLUDED.biometric_enabled,
			two_factor_enabled=EXCLUDED.two_factor_enabled,
			notifications=EXCLUDED.notifications,
			stablecoin_addresses=EXCLUDED.stablecoin_addresses,
			updated_at=now()`,
		business, cur.DefaultCurrency, cur.DisplayRate, cur.Language, cur.Theme,
		cur.BiometricEnabled, cur.TwoFactorEnabled, notif, addrs)
	if err != nil {
		return FxSettings{}, err
	}
	return cur, nil
}

// ─── Notifications ────────────────────────────────────────────────────────────

func (s *sqlBusinessStore) ListNotifications(ctx context.Context, business string) ([]Notification, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, kind, title, body, deeplink, read, created_at
		FROM orch_fx_notifications WHERE business_id=$1
		ORDER BY created_at DESC LIMIT 200`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Notification, 0)
	for rows.Next() {
		var n Notification
		var created time.Time
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.Deeplink, &n.Read, &created); err != nil {
			return nil, err
		}
		n.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *sqlBusinessStore) MarkNotificationRead(ctx context.Context, business, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE orch_fx_notifications SET read=true WHERE id=$1 AND business_id=$2`, id, business)
	return err
}

func (s *sqlBusinessStore) MarkAllNotificationsRead(ctx context.Context, business string) error {
	_, err := s.db.Exec(ctx, `UPDATE orch_fx_notifications SET read=true WHERE business_id=$1 AND read=false`, business)
	return err
}

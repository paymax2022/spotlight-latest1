package estate

// profile.go — estate identity, configuration history and ownership governance
// (UAT lane estate-a, module M02: EST-UAT-0023, 0031, 0032, 0035, 0036 — completes ESTA-D010).
//
// The lifecycle machine (lifecycle.go) made an estate a reviewable, suspendable object; this file
// gives it the profile and ownership rules the module cases ask for:
//   - a timezone the platform renders reminders and reports in, validated by the database as well
//     as here, because the BFF and an operator with psql write the same row;
//   - branding and a resident-facing notice, presentation only and never a privilege;
//   - an immutable version history of every governance rule / subscription change, written by a
//     trigger so no writer can slip past it;
//   - a two-party owner transfer: an estate's ownership moves only when the incoming owner accepts,
//     and the privilege change is one atomic statement set inside estate_owner_transfer_decide();
//   - duplicate detection at creation: a normalised (name, address) twin does not get a second live
//     estate, it gets the existing platform review queue with duplicate_suspected set.
//
// Schema: supabase/migrations/20271099000040_estate_profile_governance.sql.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"spotlight/backend/go-common/dbutil"
)

// DefaultEstateTimezone is the zone an estate that never configured one is read in. It is the
// platform's historical implicit behaviour, so applying the migration changes no existing read.
const DefaultEstateTimezone = "Africa/Lagos"

const maxEstateNoticeLen = 2000

// Owner transfer statuses (estate_owner_transfers.status CHECK).
const (
	OwnerTransferPending   = "pending"
	OwnerTransferAccepted  = "accepted"
	OwnerTransferDeclined  = "declined"
	OwnerTransferCancelled = "cancelled"
)

// NotifEstateOwnershipTransfer asks the incoming owner to accept or decline;
// NotifEstateOwnershipTransferred tells both parties what happened.
const (
	NotifEstateOwnershipTransfer    = "estate_ownership_transfer"
	NotifEstateOwnershipTransferred = "estate_ownership_transferred"
)

var (
	// ErrEstateProfileNotFound — no estates row for the id.
	ErrEstateProfileNotFound = errors.New("estate: estate not found")
	// ErrInvalidTimezone — not an IANA zone the database knows.
	ErrInvalidTimezone = errors.New("estate: invalid timezone")
	// ErrInvalidBranding — branding must be a JSON object of string values.
	ErrInvalidBranding = errors.New("estate: branding must be a JSON object")
	// ErrOwnerTransferNotFound — no transfer for that id in this estate.
	ErrOwnerTransferNotFound = errors.New("estate: owner transfer not found")
	// ErrOwnerTransferPending — a transfer is already awaiting a decision for this estate.
	ErrOwnerTransferPending = errors.New("estate: a transfer is already pending for this estate")
	// ErrOwnerTransferNotPending — the transfer was already decided.
	ErrOwnerTransferNotPending = errors.New("estate: this transfer has already been decided")
	// ErrOwnerTransferTarget — the acting user is not the party allowed to decide this way.
	ErrOwnerTransferTarget = errors.New("estate: only the incoming owner can accept a transfer")
	// ErrOwnerTransferParty — the acting user is neither party.
	ErrOwnerTransferParty = errors.New("estate: you are not a party to this transfer")
	// ErrOwnerTransferTargetNotMember — the incoming owner has no live membership.
	ErrOwnerTransferTargetNotMember = errors.New("estate: the incoming owner is not a member of this estate")
	// ErrOwnerTransferTargetBanned — the incoming owner is banned.
	ErrOwnerTransferTargetBanned = errors.New("estate: the incoming owner is banned from this estate")
	// ErrInvalidConfigColumn / ErrInvalidTransferFilter / ErrInvalidTransferTargetUser /
	// ErrOwnerTransferToSelf are caller mistakes on the governance routes. They are sentinels so the
	// handler answers 400: a bad query parameter or body field is a refused request, not a server
	// failure.
	ErrInvalidConfigColumn       = errors.New("estate: unknown config column")
	ErrInvalidTransferFilter     = errors.New("estate: unknown transfer status")
	ErrInvalidTransferTargetUser = errors.New("estate: a valid to_user_id is required")
	ErrOwnerTransferToSelf       = errors.New("estate: you already own this estate")

	// ErrNoticeTooLong — the resident-facing notice is bounded, in characters, not bytes.
	ErrNoticeTooLong = errors.New("estate: the notice is too long")

	whitespaceRe = regexp.MustCompile(`\s+`)
	hexColorRe   = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

// brandingMaxBytes caps the branding payload: it is theme values, not a document store.
const brandingMaxBytes = 4096

// brandingKeys is the allow-list of branding properties the clients read. Anything else is
// refused rather than silently stored, so a stray key cannot become an implicit contract.
var brandingKeys = map[string]bool{
	"logo_url":      true,
	"primary_color": true,
	"accent_color":  true,
	"banner_url":    true,
}

// normalizeEstateIdentity collapses whitespace and case the way the duplicate check does. The SQL
// side of the comparison is lower(btrim(regexp_replace(x,'\s+',' ','g'))) — keep the two in step.
func normalizeEstateIdentity(s string) string {
	return strings.ToLower(strings.TrimSpace(whitespaceRe.ReplaceAllString(s, " ")))
}

// EstateProfile is the estate's identity and presentation surface.
type EstateProfile struct {
	ID                 string          `json:"id"`
	Name               string          `json:"name"`
	Address            string          `json:"address,omitempty"`
	AdminID            string          `json:"admin_id"`
	Status             string          `json:"status"`
	Timezone           string          `json:"timezone"`
	Branding           json.RawMessage `json:"branding"`
	Notice             string          `json:"notice,omitempty"`
	DuplicateSuspected bool            `json:"duplicate_suspected,omitempty"`
	CreatedAt          time.Time       `json:"created_at"`
}

// UpdateEstateProfileRequest is the body for PATCH /estate/:id/info. Every field is optional;
// omitted fields keep their current value.
type UpdateEstateProfileRequest struct {
	Timezone *string          `json:"timezone,omitempty"`
	Branding *json.RawMessage `json:"branding,omitempty"`
	Notice   *string          `json:"notice,omitempty"`
}

// EstateConfigRevision is one version of one governance column. PreviousValue is NULL on version 1
// (the config had nothing before it).
type EstateConfigRevision struct {
	ID            string          `json:"id"`
	EstateID      string          `json:"estate_id"`
	ColumnName    string          `json:"column_name"`
	Version       int             `json:"version"`
	Value         json.RawMessage `json:"value"`
	PreviousValue json.RawMessage `json:"previous_value,omitempty"`
	ChangedBy     string          `json:"changed_by,omitempty"`
	ChangedAt     time.Time       `json:"changed_at"`
}

// OwnerTransfer is one estate-ownership handover request and its decision.
type OwnerTransfer struct {
	ID            string     `json:"id"`
	EstateID      string     `json:"estate_id"`
	FromUserID    string     `json:"from_user_id"`
	ToUserID      string     `json:"to_user_id"`
	Status        string     `json:"status"`
	Reason        string     `json:"reason,omitempty"`
	DecisionNote  string     `json:"decision_note,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	DecidedAt     *time.Time `json:"decided_at,omitempty"`
	OutgoingOwner string     `json:"outgoing_owner_name,omitempty"`
	IncomingOwner string     `json:"incoming_owner_name,omitempty"`
}

// RequestOwnerTransferBody is the body for POST /estate/:id/owner-transfer.
type RequestOwnerTransferBody struct {
	ToUserID string `json:"to_user_id" binding:"required"`
	Reason   string `json:"reason"`
}

// DecideOwnerTransferBody is the body for POST /estate/:id/owner-transfer/:transferId/decide.
type DecideOwnerTransferBody struct {
	Accept bool   `json:"accept"`
	Note   string `json:"note"`
}

// validateEstateTimezone accepts any IANA zone the server (and therefore the database, which checks
// pg_timezone_names) knows. Empty means "leave the stored value alone".
func validateEstateTimezone(tz string) error {
	if _, err := time.LoadLocation(tz); err != nil {
		return fmt.Errorf("%w: %s", ErrInvalidTimezone, tz)
	}
	return nil
}

// validateEstateBranding accepts a JSON object of string values limited to brandingKeys, with hex
// colours checked as colours. A null/empty object clears the branding back to defaults.
func validateEstateBranding(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}
	if len(raw) > brandingMaxBytes {
		return fmt.Errorf("%w: at most %d bytes", ErrInvalidBranding, brandingMaxBytes)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidBranding, err)
	}
	for k, v := range fields {
		if !brandingKeys[k] {
			return fmt.Errorf("%w: unknown field %q", ErrInvalidBranding, k)
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return fmt.Errorf("%w: %s must be a string", ErrInvalidBranding, k)
		}
		if strings.HasSuffix(k, "_color") && s != "" && !hexColorRe.MatchString(s) {
			return fmt.Errorf("%w: %s must be a #rrggbb colour", ErrInvalidBranding, k)
		}
		if strings.HasSuffix(k, "_url") && s != "" &&
			!strings.HasPrefix(s, "https://") && !strings.HasPrefix(s, "http://") {
			return fmt.Errorf("%w: %s must be an http(s) URL", ErrInvalidBranding, k)
		}
	}
	return nil
}

// UpdateEstateProfile writes the estate's timezone / branding / notice (estate admin only). The
// estate's lifecycle status is not reachable here — that is lifecycle.go's transition machine, so a
// profile edit can never publish or suspend an estate.
func (s *Service) UpdateEstateProfile(ctx context.Context, estateID, actorID string, req UpdateEstateProfileRequest) (*EstateProfile, error) {
	if err := s.assertEstateAdmin(ctx, estateID, actorID); err != nil {
		return nil, err
	}
	sets := []string{}
	changed := []string{}
	args := []any{estateID}
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}

	if req.Timezone != nil {
		tz := strings.TrimSpace(*req.Timezone)
		if tz == "" {
			return nil, fmt.Errorf("%w: timezone is required", ErrInvalidTimezone)
		}
		if err := validateEstateTimezone(tz); err != nil {
			return nil, err
		}
		sets = append(sets, "timezone="+arg(tz))
		changed = append(changed, "timezone")
	}
	if req.Branding != nil {
		raw := *req.Branding
		if err := validateEstateBranding(raw); err != nil {
			return nil, err
		}
		// "null" and an empty body both mean "back to the platform defaults"; storing JSON null
		// would break the object CHECK the database enforces on this column.
		if len(raw) == 0 || string(raw) == "null" {
			raw = json.RawMessage("{}")
		}
		sets = append(sets, "branding="+arg(raw))
		changed = append(changed, "branding")
	}
	if req.Notice != nil {
		notice := strings.TrimSpace(*req.Notice)
		// Runes, not bytes: the database limits this column with char_length().
		if utf8.RuneCountInString(notice) > maxEstateNoticeLen {
			return nil, fmt.Errorf("%w: at most %d characters", ErrNoticeTooLong, maxEstateNoticeLen)
		}
		sets = append(sets, "notice="+arg(notice))
		changed = append(changed, "notice")
	}
	if len(sets) == 0 {
		return s.GetEstateProfile(ctx, estateID, actorID)
	}

	q := `UPDATE estates SET ` + strings.Join(sets, ", ") + ` WHERE id=$1 RETURNING ` + estateProfileColumns
	if _, err := s.db.Exec(ctx, q, args...); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "22023" {
			return nil, fmt.Errorf("%w: the database does not know that timezone", ErrInvalidTimezone)
		}
		if errors.As(err, &pgErr) && (pgErr.Code == "23514") {
			return nil, fmt.Errorf("estate: %s", pgErr.Message)
		}
		return nil, fmt.Errorf("estate: update profile: %w", err)
	}
	_ = s.audit(ctx, estateID, actorID, "ESTATE_PROFILE_SET", "estate", estateID, map[string]any{
		"fields": changed,
	})
	return s.getProfile(ctx, estateID)
}

const estateProfileColumns = `id, name, coalesce(address,''), admin_id, status, timezone, branding, coalesce(notice,''), duplicate_suspected, created_at`

// GetEstateProfile reads the profile. Any member may read it: the timezone and the notice are what
// residents see, and nothing here is a privilege.
func (s *Service) GetEstateProfile(ctx context.Context, estateID, actorID string) (*EstateProfile, error) {
	if err := s.assertResident(ctx, estateID, actorID); err != nil {
		return nil, err
	}
	return s.getProfile(ctx, estateID)
}

func (s *Service) getProfile(ctx context.Context, estateID string) (*EstateProfile, error) {
	q := `SELECT ` + estateProfileColumns + ` FROM estates WHERE id=$1`
	var p EstateProfile
	err := s.db.QueryRow(ctx, q, estateID).Scan(
		&p.ID, &p.Name, &p.Address, &p.AdminID, &p.Status, &p.Timezone,
		&p.Branding, &p.Notice, &p.DuplicateSuspected, &p.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrEstateProfileNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("estate: read profile: %w", err)
	}
	if len(p.Branding) == 0 {
		p.Branding = json.RawMessage("{}")
	}
	return &p, nil
}

// estateDuplicateLookup finds a live estate with the same normalised name and address. It excludes
// closed estates so a rejected application never blocks a genuine new one.
func (s *Service) estateDuplicateLookup(ctx context.Context, name, address string) (string, bool, error) {
	const q = `
SELECT id FROM estates
WHERE status <> 'closed'
  AND lower(btrim(regexp_replace(coalesce(name,''), '\s+', ' ', 'g'))) = $1
  AND lower(btrim(regexp_replace(coalesce(address,''), '\s+', ' ', 'g'))) = $2
LIMIT 1`
	var id string
	err := s.db.QueryRow(ctx, q, normalizeEstateIdentity(name), normalizeEstateIdentity(address)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("estate: duplicate check: %w", err)
	}
	return id, true, nil
}

// GetEstateConfigHistory returns the governance rule / subscription versions for an estate,
// newest first (estate admin only). The rows are written by the estate_config trigger, so this is a
// record of what every writer did, not of what this service chose to log.
func (s *Service) GetEstateConfigHistory(ctx context.Context, estateID, actorID, column string, limit int) ([]EstateConfigRevision, error) {
	if err := s.assertEstateAdmin(ctx, estateID, actorID); err != nil {
		return nil, err
	}
	if column != "" && column != "rules" && column != "subscription_plan" {
		return nil, ErrInvalidConfigColumn
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `
SELECT id, estate_id, column_name, version, value, previous_value, coalesce(changed_by::text,''), changed_at
FROM estate_config_revisions
WHERE estate_id=$1 AND ($2::text IS NULL OR column_name=$2)
ORDER BY version DESC
LIMIT $3`
	rows, err := s.db.Query(ctx, q, estateID, dbutil.NullStr(column), limit)
	if err != nil {
		return nil, fmt.Errorf("estate: config history: %w", err)
	}
	defer rows.Close()

	out := []EstateConfigRevision{}
	for rows.Next() {
		var r EstateConfigRevision
		if err := rows.Scan(&r.ID, &r.EstateID, &r.ColumnName, &r.Version, &r.Value,
			&r.PreviousValue, &r.ChangedBy, &r.ChangedAt); err != nil {
			return nil, fmt.Errorf("estate: scan config history: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RequestOwnerTransfer opens a handover of the estate to an existing member. The estate does not
// move here — only estate_owner_transfer_decide() moves it, and only on the target's acceptance.
func (s *Service) RequestOwnerTransfer(ctx context.Context, estateID, actorID string, body RequestOwnerTransferBody) (*OwnerTransfer, error) {
	if err := s.assertEstateAdmin(ctx, estateID, actorID); err != nil {
		return nil, err
	}
	to := strings.TrimSpace(body.ToUserID)
	if to == "" {
		return nil, ErrInvalidTransferTargetUser
	}
	if _, err := uuid.Parse(to); err != nil {
		return nil, ErrInvalidTransferTargetUser
	}
	if to == actorID {
		return nil, ErrOwnerTransferToSelf
	}
	var banned bool
	err := s.db.QueryRow(ctx,
		`SELECT coalesce(banned_at IS NOT NULL, FALSE) FROM estate_residents
		 WHERE estate_id=$1 AND user_id=$2 AND deleted_at IS NULL`, estateID, to).Scan(&banned)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOwnerTransferTargetNotMember
	}
	if err != nil {
		return nil, fmt.Errorf("estate: read target membership: %w", err)
	}
	if banned {
		return nil, ErrOwnerTransferTargetBanned
	}

	reason := strings.TrimSpace(body.Reason)
	t := &OwnerTransfer{
		ID:         uuid.New().String(),
		EstateID:   estateID,
		FromUserID: actorID,
		ToUserID:   to,
		Status:     OwnerTransferPending,
		Reason:     reason,
		CreatedAt:  time.Now(),
	}
	const q = `
INSERT INTO estate_owner_transfers (id, estate_id, from_user_id, to_user_id, status, reason)
VALUES ($1,$2,$3,$4,'pending',NULLIF($5,''))
RETURNING created_at`
	if err := s.db.QueryRow(ctx, q, t.ID, estateID, actorID, to, reason).Scan(&t.CreatedAt); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrOwnerTransferPending
		}
		return nil, fmt.Errorf("estate: open owner transfer: %w", err)
	}
	_ = s.audit(ctx, estateID, actorID, "ESTATE_OWNER_TRANSFER_REQUESTED", "estate", estateID,
		map[string]any{"to_user_id": to, auditKeyReason: reason})
	s.notify(ctx, estateID, to, NotifEstateOwnershipTransfer, "Estate ownership transfer",
		"The owner of this estate has offered it to you. Accept or decline in estate settings.",
		map[string]any{"transfer_id": t.ID, "estate_id": estateID})
	return t, nil
}

// ListOwnerTransfers returns the estate's transfers. An estate admin sees everything; any other
// member sees only transfers addressed to them, so an offer is never visible to an unrelated
// resident.
func (s *Service) ListOwnerTransfers(ctx context.Context, estateID, actorID, status string) ([]OwnerTransfer, error) {
	if err := s.assertResident(ctx, estateID, actorID); err != nil {
		return nil, err
	}
	isAdmin := false
	if err := s.assertEstateAdmin(ctx, estateID, actorID); err == nil {
		isAdmin = true
	}
	if status != "" && status != OwnerTransferPending && status != OwnerTransferAccepted &&
		status != OwnerTransferDeclined && status != OwnerTransferCancelled {
		return nil, ErrInvalidTransferFilter
	}

	const base = `
SELECT t.id, t.estate_id, t.from_user_id, t.to_user_id, t.status, coalesce(t.reason,''),
       coalesce(t.decision_note,''), t.created_at, t.decided_at,
       coalesce(o.full_name,''), coalesce(i.full_name,'')
FROM estate_owner_transfers t
LEFT JOIN user_profiles o ON o.id = t.from_user_id
LEFT JOIN user_profiles i ON i.id = t.to_user_id
WHERE t.estate_id=$1`
	q := base
	args := []any{estateID}
	if !isAdmin {
		q += ` AND t.to_user_id=$2`
		args = append(args, actorID)
	} else if status != "" {
		q += ` AND t.status=$2`
		args = append(args, status)
	}
	q += ` ORDER BY t.created_at DESC LIMIT 100`

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("estate: list owner transfers: %w", err)
	}
	defer rows.Close()

	out := []OwnerTransfer{}
	for rows.Next() {
		var r OwnerTransfer
		if err := rows.Scan(&r.ID, &r.EstateID, &r.FromUserID, &r.ToUserID, &r.Status, &r.Reason,
			&r.DecisionNote, &r.CreatedAt, &r.DecidedAt, &r.OutgoingOwner, &r.IncomingOwner); err != nil {
			return nil, fmt.Errorf("estate: scan owner transfer: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// DecideOwnerTransfer accepts, declines or withdraws a handover. The single SQL writer performs the
// privilege move and its audit row atomically; this method only binds it to the estate in the path
// and turns the database's error codes into service errors.
func (s *Service) DecideOwnerTransfer(ctx context.Context, estateID, actorID, transferID string, accept bool, note string) (*OwnerTransfer, error) {
	if _, err := s.assertEstateExists(ctx, estateID); err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(transferID); err != nil {
		return nil, ErrOwnerTransferNotFound
	}
	const q = `SELECT out_status FROM estate_owner_transfer_decide($1,$2,$3,$4,$5)`
	var status string
	err := s.db.QueryRow(ctx, q, estateID, transferID, actorID, accept, strings.TrimSpace(note)).Scan(&status)
	if err != nil {
		return nil, mapOwnerTransferErr(err)
	}

	t := &OwnerTransfer{ID: transferID, EstateID: estateID, Status: status, DecisionNote: strings.TrimSpace(note)}
	const read = `SELECT from_user_id, to_user_id, coalesce(reason,''), created_at, decided_at
	             FROM estate_owner_transfers WHERE id=$1`
	if err := s.db.QueryRow(ctx, read, transferID).Scan(&t.FromUserID, &t.ToUserID, &t.Reason,
		&t.CreatedAt, &t.DecidedAt); err != nil {
		return nil, fmt.Errorf("estate: read decided transfer: %w", err)
	}

	if status == OwnerTransferAccepted {
		s.notify(ctx, estateID, t.FromUserID, NotifEstateOwnershipTransferred, "Ownership transferred",
			"You are no longer the owner of this estate.", map[string]any{"estate_id": estateID})
		s.notify(ctx, estateID, t.ToUserID, NotifEstateOwnershipTransferred, "Ownership transferred",
			"You are now the owner of this estate.", map[string]any{"estate_id": estateID})
	}
	return t, nil
}

// assertEstateExists keeps a transfer decision bound to a real estate, so an estate id in the path
// that no longer resolves cannot be answered with a bare 500.
func (s *Service) assertEstateExists(ctx context.Context, estateID string) (bool, error) {
	var one int
	err := s.db.QueryRow(ctx, `SELECT 1 FROM estates WHERE id=$1`, estateID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrEstateProfileNotFound
	}
	if err != nil {
		return false, fmt.Errorf("estate: read estate: %w", err)
	}
	return true, nil
}

func mapOwnerTransferErr(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return fmt.Errorf("estate: decide owner transfer: %w", err)
	}
	switch pgErr.Code {
	case "P0002":
		return ErrOwnerTransferNotFound
	case "42501":
		if strings.Contains(pgErr.Message, "banned") {
			return ErrOwnerTransferTargetBanned
		}
		if strings.Contains(pgErr.Message, "incoming owner") {
			return ErrOwnerTransferTarget
		}
		return ErrOwnerTransferParty
	case "55000":
		if strings.Contains(pgErr.Message, "member") {
			return ErrOwnerTransferTargetNotMember
		}
		return ErrOwnerTransferNotPending
	}
	return fmt.Errorf("estate: decide owner transfer: %w", err)
}

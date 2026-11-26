package connectvoting

// Rising Star edition configuration: winning positions, prizes, versioned rules,
// contestant rules-acceptance and winner declaration (ADDITIONAL MASTER
// REQUIREMENTS §1–§7). The "edition" is a public.connect_contests row, so every
// query below keys off connect_contests(id) and reuses this module's existing
// Repository/Service/Handler wiring and RBAC guards (connect.contests.view /
// connect.contests.manage). Nothing here moves money or touches voting tallies.
//
// Design notes that matter for correctness:
//   • Winners are NEVER auto-derived. Declaration and the results_status
//     lifecycle are deliberate admin mutations, audited via the existing Auditor.
//   • Rules are versioned; contestant_rules_acceptance pins the exact version a
//     contestant agreed to, so publishing a new version never rewrites history.
//   • Public reads (rules/winners) are gated in SQL by RLS *and* re-checked here
//     so the member-group JSON never leaks an unpublished winner.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// ── Models ────────────────────────────────────────────────────────────────────

// WinningPosition is one configurable award slot for an edition (§7).
type WinningPosition struct {
	ID                string `json:"id"`
	EditionID         string `json:"edition_id"`
	Title             string `json:"title"`
	Rank              int    `json:"rank"`
	DisplayOrder      int    `json:"display_order"`
	RecipientsAllowed int    `json:"recipients_allowed"`
	IsActive          bool   `json:"is_active"`
}

// EditionPrize is one prize line attached to a winning position (§7). A
// "package" combines cash (AmountKobo) and non-cash (Description) into one award.
type EditionPrize struct {
	ID                   string  `json:"id"`
	EditionID            string  `json:"edition_id"`
	PositionID           *string `json:"position_id,omitempty"`
	PrizeType            string  `json:"prize_type"`
	Title                string  `json:"title"`
	AmountKobo           *int64  `json:"amount_kobo,omitempty"`
	Currency             string  `json:"currency"`
	Description          string  `json:"description"`
	FulfilmentConditions string  `json:"fulfilment_conditions"`
	PresentationTiming   string  `json:"presentation_timing"`
	DisplayOrder         int     `json:"display_order"`
	IsActive             bool    `json:"is_active"`
}

// EditionRules is a versioned rules document for an edition (§4, §7). Content is
// the structured section A–I rule set, carried verbatim so the schema never
// hardcodes which restrictions apply.
type EditionRules struct {
	ID            string          `json:"id"`
	EditionID     string          `json:"edition_id"`
	Version       int             `json:"version"`
	Content       json.RawMessage `json:"content"`
	Status        string          `json:"status"`
	EffectiveDate *time.Time      `json:"effective_date,omitempty"`
	PublishedAt   *time.Time      `json:"published_at,omitempty"`
}

// RulesAcceptance is the immutable record that a registrant accepted a specific
// rules version (§5, §7). At registration-submit time the applicant is a USER
// with an application, not yet a promoted `contestants` row, so the record keys
// on user_id + edition + rules version (§5: capture User ID, Edition ID, Rules
// version, timestamp). application_id is the registration application it was
// captured against; contestant_id is filled later when the applicant is promoted
// to the roster (nullable, so a roster cleanup never erases the acceptance).
type RulesAcceptance struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	ApplicationID *string   `json:"application_id,omitempty"`
	ContestantID  *string   `json:"contestant_id,omitempty"`
	EditionID     string    `json:"edition_id"`
	RulesID       string    `json:"rules_id"`
	RulesVersion  int       `json:"rules_version"`
	AcceptedAt    time.Time `json:"accepted_at"`
}

// EditionWinner is a declared winner: a contestant assigned to a position (§2,§7).
type EditionWinner struct {
	ID                    string     `json:"id"`
	EditionID             string     `json:"edition_id"`
	ContestantID          string     `json:"contestant_id"`
	PositionID            *string    `json:"position_id,omitempty"`
	IsFinalist            bool       `json:"is_finalist"`
	DeclarationStatus     string     `json:"declaration_status"`
	AnnouncementDate      *time.Time `json:"announcement_date,omitempty"`
	PrizeFulfilmentStatus string     `json:"prize_fulfilment_status"`
	AdminNotes            string     `json:"admin_notes,omitempty"`
	DeclaredAt            *time.Time `json:"declared_at,omitempty"`
	DeclaredBy            *string    `json:"declared_by,omitempty"`
	// Denormalised display fields, filled by the public/admin read joins.
	ContestantName  string `json:"contestant_name,omitempty"`
	ContestantPhoto string `json:"contestant_photo,omitempty"`
	PositionTitle   string `json:"position_title,omitempty"`
	PositionRank    int    `json:"position_rank,omitempty"`
}

// EditionStatus is the edition-level winner lifecycle (connect_contests columns).
type EditionStatus struct {
	EditionID         string `json:"edition_id"`
	WinnerMethodology string `json:"winner_methodology"`
	ResultsStatus     string `json:"results_status"`
}

// ── Sentinel errors + validation ──────────────────────────────────────────────

var (
	ErrBadEditionConfig = errors.New("voting: invalid edition configuration")
	ErrRulesNotPublished = errors.New("voting: no published rules for this edition")
	ErrBadStatusTransition = errors.New("voting: illegal results-status transition")
	ErrJointWinnerCap = errors.New("voting: winning position is full (joint-winner limit reached)")
)

// validMethodologies / validResultsStatus mirror the SQL CHECK allowlists so a bad
// value is rejected in Go with a clean 400 rather than a 500 from Postgres.
var validMethodologies = map[string]bool{
	"public_voting": true, "judges_evaluation": true, "administrative_selection": true,
	"combined_voting_judges": true, "panel_evaluation": true, "other": true,
}

// resultsStatusOrder gives the forward-only lifecycle a rank so a transition can be
// validated as "not backwards". §2 lists the suggested statuses in this order.
var resultsStatusOrder = map[string]int{
	"not_declared":                0,
	"finalists_announced":         1,
	"winners_declared":            2,
	"results_published":           3,
	"prize_fulfilment_in_progress": 4,
	"prizes_fulfilled":            5,
}

// resultsPublishedSet are the statuses at which winners become publicly visible.
var resultsPublishedSet = map[string]bool{
	"results_published": true, "prize_fulfilment_in_progress": true, "prizes_fulfilled": true,
}

// CanTransition reports whether moving an edition's results_status from -> to is
// allowed. Forward-only (never regress), and 'to' must be a known status. Pure so
// it is unit-testable without a database.
func CanTransition(from, to string) bool {
	fromRank, fromOK := resultsStatusOrder[from]
	toRank, toOK := resultsStatusOrder[to]
	if !fromOK || !toOK {
		return false
	}
	return toRank >= fromRank
}

// ── Repository ────────────────────────────────────────────────────────────────

// GetEditionStatus reads the two edition-level lifecycle columns.
func (r *Repository) GetEditionStatus(ctx context.Context, editionID string) (*EditionStatus, error) {
	const q = `SELECT id, winner_methodology, results_status FROM connect_contests WHERE id = $1`
	var s EditionStatus
	err := r.db.QueryRow(ctx, q, editionID).Scan(&s.EditionID, &s.WinnerMethodology, &s.ResultsStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("voting: get edition status: %w", err)
	}
	return &s, nil
}

// SetResultsStatus moves the edition lifecycle forward (guarded by CanTransition)
// and optionally the methodology. Returns the post-update status.
func (r *Repository) SetResultsStatus(ctx context.Context, editionID, status, methodology string) (*EditionStatus, error) {
	cur, err := r.GetEditionStatus(ctx, editionID)
	if err != nil {
		return nil, err
	}
	if status != "" && !CanTransition(cur.ResultsStatus, status) {
		return nil, ErrBadStatusTransition
	}
	if methodology != "" && !validMethodologies[methodology] {
		return nil, ErrBadEditionConfig
	}
	const q = `UPDATE connect_contests SET
		results_status = COALESCE(NULLIF($2,''), results_status),
		winner_methodology = COALESCE(NULLIF($3,''), winner_methodology),
		updated_at = now()
		WHERE id = $1
		RETURNING id, winner_methodology, results_status`
	var out EditionStatus
	if err := r.db.QueryRow(ctx, q, editionID, status, methodology).
		Scan(&out.EditionID, &out.WinnerMethodology, &out.ResultsStatus); err != nil {
		return nil, fmt.Errorf("voting: set results status: %w", err)
	}
	return &out, nil
}

// ListWinningPositions returns an edition's award slots, ordered for display.
func (r *Repository) ListWinningPositions(ctx context.Context, editionID string, activeOnly bool) ([]WinningPosition, error) {
	q := `SELECT id, connect_contest_id, title, rank, display_order, recipients_allowed, is_active
		FROM edition_winning_positions WHERE connect_contest_id = $1`
	if activeOnly {
		q += ` AND is_active`
	}
	q += ` ORDER BY display_order, rank`
	rows, err := r.db.Query(ctx, q, editionID)
	if err != nil {
		return nil, fmt.Errorf("voting: list positions: %w", err)
	}
	defer rows.Close()
	out := []WinningPosition{}
	for rows.Next() {
		var p WinningPosition
		if err := rows.Scan(&p.ID, &p.EditionID, &p.Title, &p.Rank, &p.DisplayOrder, &p.RecipientsAllowed, &p.IsActive); err != nil {
			return nil, fmt.Errorf("voting: scan position: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreateWinningPosition inserts an award slot.
func (r *Repository) CreateWinningPosition(ctx context.Context, editionID, actorID string, p *WinningPosition) (*WinningPosition, error) {
	const q = `INSERT INTO edition_winning_positions
		(connect_contest_id, title, rank, display_order, recipients_allowed, created_by)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, connect_contest_id, title, rank, display_order, recipients_allowed, is_active`
	out := &WinningPosition{}
	err := r.db.QueryRow(ctx, q, editionID, p.Title, p.Rank, p.DisplayOrder, p.RecipientsAllowed, nilIfEmpty(actorID)).
		Scan(&out.ID, &out.EditionID, &out.Title, &out.Rank, &out.DisplayOrder, &out.RecipientsAllowed, &out.IsActive)
	if err != nil {
		return nil, fmt.Errorf("voting: create position: %w", err)
	}
	return out, nil
}

// DeleteWinningPosition removes an award slot (prizes/winners referencing it are
// SET NULL by FK, never cascade-deleted, so history survives a reorder).
func (r *Repository) DeleteWinningPosition(ctx context.Context, editionID, positionID string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM edition_winning_positions WHERE id = $1 AND connect_contest_id = $2`, positionID, editionID)
	if err != nil {
		return fmt.Errorf("voting: delete position: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListEditionPrizes returns the rich prize configuration for an edition.
func (r *Repository) ListEditionPrizes(ctx context.Context, editionID string, activeOnly bool) ([]EditionPrize, error) {
	q := `SELECT id, connect_contest_id, position_id, prize_type, title, amount_kobo, currency,
		description, fulfilment_conditions, presentation_timing, display_order, is_active
		FROM edition_prizes WHERE connect_contest_id = $1`
	if activeOnly {
		q += ` AND is_active`
	}
	q += ` ORDER BY display_order, created_at`
	rows, err := r.db.Query(ctx, q, editionID)
	if err != nil {
		return nil, fmt.Errorf("voting: list prizes: %w", err)
	}
	defer rows.Close()
	out := []EditionPrize{}
	for rows.Next() {
		var p EditionPrize
		if err := rows.Scan(&p.ID, &p.EditionID, &p.PositionID, &p.PrizeType, &p.Title, &p.AmountKobo,
			&p.Currency, &p.Description, &p.FulfilmentConditions, &p.PresentationTiming, &p.DisplayOrder, &p.IsActive); err != nil {
			return nil, fmt.Errorf("voting: scan prize: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreateEditionPrize inserts a prize line.
func (r *Repository) CreateEditionPrize(ctx context.Context, editionID, actorID string, p *EditionPrize) (*EditionPrize, error) {
	const q = `INSERT INTO edition_prizes
		(connect_contest_id, position_id, prize_type, title, amount_kobo, currency, description,
		 fulfilment_conditions, presentation_timing, display_order, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id, connect_contest_id, position_id, prize_type, title, amount_kobo, currency,
		 description, fulfilment_conditions, presentation_timing, display_order, is_active`
	out := &EditionPrize{}
	err := r.db.QueryRow(ctx, q, editionID, p.PositionID, p.PrizeType, p.Title, p.AmountKobo, p.Currency,
		p.Description, p.FulfilmentConditions, p.PresentationTiming, p.DisplayOrder, nilIfEmpty(actorID)).
		Scan(&out.ID, &out.EditionID, &out.PositionID, &out.PrizeType, &out.Title, &out.AmountKobo, &out.Currency,
			&out.Description, &out.FulfilmentConditions, &out.PresentationTiming, &out.DisplayOrder, &out.IsActive)
	if err != nil {
		return nil, fmt.Errorf("voting: create prize: %w", err)
	}
	return out, nil
}

// DeleteEditionPrize removes a prize line.
func (r *Repository) DeleteEditionPrize(ctx context.Context, editionID, prizeID string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM edition_prizes WHERE id = $1 AND connect_contest_id = $2`, prizeID, editionID)
	if err != nil {
		return fmt.Errorf("voting: delete prize: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetPublishedRules returns the single published rules version for an edition.
func (r *Repository) GetPublishedRules(ctx context.Context, editionID string) (*EditionRules, error) {
	const q = `SELECT id, connect_contest_id, version, content, status, effective_date, published_at
		FROM edition_rules WHERE connect_contest_id = $1 AND status = 'published'
		ORDER BY version DESC LIMIT 1`
	return scanRules(r.db.QueryRow(ctx, q, editionID))
}

// ListRulesVersions returns every rules version for an edition, newest first.
func (r *Repository) ListRulesVersions(ctx context.Context, editionID string) ([]EditionRules, error) {
	const q = `SELECT id, connect_contest_id, version, content, status, effective_date, published_at
		FROM edition_rules WHERE connect_contest_id = $1 ORDER BY version DESC`
	rows, err := r.db.Query(ctx, q, editionID)
	if err != nil {
		return nil, fmt.Errorf("voting: list rules: %w", err)
	}
	defer rows.Close()
	out := []EditionRules{}
	for rows.Next() {
		rr, err := scanRules(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rr)
	}
	return out, rows.Err()
}

// CreateRulesDraft inserts a new draft version. The version number is derived as
// max(existing)+1 so an admin never has to pick one and two drafts can't collide.
func (r *Repository) CreateRulesDraft(ctx context.Context, editionID, actorID string, content json.RawMessage, effective *time.Time) (*EditionRules, error) {
	if len(content) == 0 {
		content = json.RawMessage(`{}`)
	}
	const q = `INSERT INTO edition_rules (connect_contest_id, version, content, status, effective_date, created_by)
		VALUES ($1, COALESCE((SELECT MAX(version) FROM edition_rules WHERE connect_contest_id = $1), 0) + 1,
		        $2, 'draft', $3, $4)
		RETURNING id, connect_contest_id, version, content, status, effective_date, published_at`
	return scanRules(r.db.QueryRow(ctx, q, editionID, content, effective, nilIfEmpty(actorID)))
}

// PublishRules archives any currently-published version and publishes this one.
// Both writes happen in one transaction so the unique-published index can never
// observe two published rows.
func (r *Repository) PublishRules(ctx context.Context, editionID, rulesID, actorID string) (*EditionRules, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("voting: begin publish: %w", err)
	}
	defer tx.Rollback(context.Background()) //nolint:errcheck // best-effort
	if _, err := tx.Exec(ctx,
		`UPDATE edition_rules SET status='archived', updated_at=now()
		 WHERE connect_contest_id=$1 AND status='published' AND id<>$2`, editionID, rulesID); err != nil {
		return nil, fmt.Errorf("voting: archive prior rules: %w", err)
	}
	const q = `UPDATE edition_rules SET status='published', published_at=now(), updated_at=now()
		WHERE id=$1 AND connect_contest_id=$2
		RETURNING id, connect_contest_id, version, content, status, effective_date, published_at`
	out, err := scanRules(tx.QueryRow(ctx, q, rulesID, editionID))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("voting: commit publish: %w", err)
	}
	_ = actorID
	return out, nil
}

// EditionIDBySlug resolves a registration's contest_slug to the connect_contests
// UUID (the edition). The slug column is UNIQUE (migration 20260812010000), so
// this is a single-row lookup. Returns ErrNotFound when the slug has no edition —
// the registration gate then treats the edition as having no published rules and
// does not block (an edition that never configured rules keeps registering).
func (r *Repository) EditionIDBySlug(ctx context.Context, slug string) (string, error) {
	const q = `SELECT id FROM connect_contests WHERE slug = $1`
	var id string
	err := r.db.QueryRow(ctx, q, slug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("voting: resolve edition by slug: %w", err)
	}
	return id, nil
}

// RecordRulesAcceptance pins the accepted rules version for a registrant. The
// version is read from edition_rules so the caller cannot claim a version that
// does not match the rules row. Keyed on user_id (the authenticated registrant) +
// edition + rules version: at submit time there is no contestants row yet, so the
// application id is stored alongside and contestant_id is backfilled on promotion.
// Idempotent: re-accepting the same version is a no-op returning the original row.
func (r *Repository) RecordRulesAcceptance(ctx context.Context, userID, applicationID, editionID, rulesID string) (*RulesAcceptance, error) {
	const q = `INSERT INTO contestant_rules_acceptance (user_id, application_id, connect_contest_id, rules_id, rules_version)
		SELECT $1, NULLIF($2,'')::uuid, $3, er.id, er.version FROM edition_rules er WHERE er.id = $4 AND er.connect_contest_id = $3
		ON CONFLICT (user_id, connect_contest_id, rules_id) DO UPDATE SET rules_id = EXCLUDED.rules_id
		RETURNING id, user_id, application_id, contestant_id, connect_contest_id, rules_id, rules_version, accepted_at`
	var a RulesAcceptance
	err := r.db.QueryRow(ctx, q, userID, applicationID, editionID, rulesID).
		Scan(&a.ID, &a.UserID, &a.ApplicationID, &a.ContestantID, &a.EditionID, &a.RulesID, &a.RulesVersion, &a.AcceptedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound // rules row does not belong to this edition
	}
	if err != nil {
		return nil, fmt.Errorf("voting: record acceptance: %w", err)
	}
	return &a, nil
}

// GetRulesAcceptance returns a registrant's acceptance for an edition (latest).
func (r *Repository) GetRulesAcceptance(ctx context.Context, userID, editionID string) (*RulesAcceptance, error) {
	const q = `SELECT id, user_id, application_id, contestant_id, connect_contest_id, rules_id, rules_version, accepted_at
		FROM contestant_rules_acceptance WHERE user_id=$1 AND connect_contest_id=$2
		ORDER BY accepted_at DESC LIMIT 1`
	var a RulesAcceptance
	err := r.db.QueryRow(ctx, q, userID, editionID).
		Scan(&a.ID, &a.UserID, &a.ApplicationID, &a.ContestantID, &a.EditionID, &a.RulesID, &a.RulesVersion, &a.AcceptedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("voting: get acceptance: %w", err)
	}
	return &a, nil
}

// ListWinners returns declared winners for an edition. When publishedOnly is true
// the SQL filters to publicly-visible rows (declaration_status='published' AND the
// edition's results are published) — the same gate the public RLS policy applies,
// so the member-group JSON can never leak an unpublished winner.
func (r *Repository) ListWinners(ctx context.Context, editionID string, publishedOnly bool) ([]EditionWinner, error) {
	q := `SELECT w.id, w.connect_contest_id, w.contestant_id, w.position_id, w.is_finalist,
		w.declaration_status, w.announcement_date, w.prize_fulfilment_status, w.admin_notes,
		w.declared_at, w.declared_by,
		COALESCE(c.name,''), COALESCE(c.photo_url,''), COALESCE(p.title,''), COALESCE(p.rank,0)
		FROM edition_winners w
		LEFT JOIN contestants c ON c.id = w.contestant_id
		LEFT JOIN edition_winning_positions p ON p.id = w.position_id
		WHERE w.connect_contest_id = $1`
	if publishedOnly {
		q += ` AND w.declaration_status = 'published'
			AND EXISTS (SELECT 1 FROM connect_contests cc WHERE cc.id = w.connect_contest_id
				AND cc.results_status IN ('results_published','prize_fulfilment_in_progress','prizes_fulfilled'))`
	}
	q += ` ORDER BY COALESCE(p.rank, 999999), w.created_at`
	rows, err := r.db.Query(ctx, q, editionID)
	if err != nil {
		return nil, fmt.Errorf("voting: list winners: %w", err)
	}
	defer rows.Close()
	out := []EditionWinner{}
	for rows.Next() {
		var w EditionWinner
		if err := rows.Scan(&w.ID, &w.EditionID, &w.ContestantID, &w.PositionID, &w.IsFinalist,
			&w.DeclarationStatus, &w.AnnouncementDate, &w.PrizeFulfilmentStatus, &w.AdminNotes,
			&w.DeclaredAt, &w.DeclaredBy, &w.ContestantName, &w.ContestantPhoto, &w.PositionTitle, &w.PositionRank); err != nil {
			return nil, fmt.Errorf("voting: scan winner: %w", err)
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// DeclareWinner inserts (or upserts) a winner row for a contestant+position.
// Enforces the joint-winner cap: a position with recipients_allowed=N accepts at
// most N declared/published rows.
func (r *Repository) DeclareWinner(ctx context.Context, editionID, actorID string, w *EditionWinner) (*EditionWinner, error) {
	if w.PositionID != nil && *w.PositionID != "" {
		var allowed, taken int
		if err := r.db.QueryRow(ctx,
			`SELECT recipients_allowed FROM edition_winning_positions WHERE id=$1 AND connect_contest_id=$2`,
			*w.PositionID, editionID).Scan(&allowed); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrBadEditionConfig
			}
			return nil, fmt.Errorf("voting: read position cap: %w", err)
		}
		if err := r.db.QueryRow(ctx,
			`SELECT COUNT(*) FROM edition_winners WHERE position_id=$1 AND connect_contest_id=$2
			  AND contestant_id<>$3 AND declaration_status IN ('declared','published')`,
			*w.PositionID, editionID, w.ContestantID).Scan(&taken); err != nil {
			return nil, fmt.Errorf("voting: count position occupants: %w", err)
		}
		if taken >= allowed {
			return nil, ErrJointWinnerCap
		}
	}
	status := w.DeclarationStatus
	if status == "" {
		status = "declared"
	}
	const q = `INSERT INTO edition_winners
		(connect_contest_id, contestant_id, position_id, is_finalist, declaration_status,
		 announcement_date, prize_fulfilment_status, admin_notes, declared_at, declared_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9)
		ON CONFLICT (connect_contest_id, contestant_id, position_id) DO UPDATE SET
			position_id = EXCLUDED.position_id, is_finalist = EXCLUDED.is_finalist,
			declaration_status = EXCLUDED.declaration_status, announcement_date = EXCLUDED.announcement_date,
			prize_fulfilment_status = EXCLUDED.prize_fulfilment_status, admin_notes = EXCLUDED.admin_notes,
			declared_at = now(), declared_by = EXCLUDED.declared_by, updated_at = now()
		RETURNING id, connect_contest_id, contestant_id, position_id, is_finalist, declaration_status,
			announcement_date, prize_fulfilment_status, admin_notes, declared_at, declared_by`
	out := &EditionWinner{}
	err := r.db.QueryRow(ctx, q, editionID, w.ContestantID, nullableUUID(w.PositionID), w.IsFinalist, status,
		w.AnnouncementDate, defaultStr(w.PrizeFulfilmentStatus, "pending"), w.AdminNotes, nilIfEmpty(actorID)).
		Scan(&out.ID, &out.EditionID, &out.ContestantID, &out.PositionID, &out.IsFinalist, &out.DeclarationStatus,
			&out.AnnouncementDate, &out.PrizeFulfilmentStatus, &out.AdminNotes, &out.DeclaredAt, &out.DeclaredBy)
	if err != nil {
		return nil, fmt.Errorf("voting: declare winner: %w", err)
	}
	return out, nil
}

// scanRules scans one edition_rules row.
func scanRules(s rowScanner) (*EditionRules, error) {
	var rr EditionRules
	err := s.Scan(&rr.ID, &rr.EditionID, &rr.Version, &rr.Content, &rr.Status, &rr.EffectiveDate, &rr.PublishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("voting: scan rules: %w", err)
	}
	return &rr, nil
}

// ── small SQL helpers ─────────────────────────────────────────────────────────

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func defaultStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// nullableUUID turns an empty/absent *string into nil so the FK column is NULL.
func nullableUUID(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

// ── Service ───────────────────────────────────────────────────────────────────

// GetEditionStatus exposes the lifecycle columns.
func (s *Service) GetEditionStatus(ctx context.Context, editionID string) (*EditionStatus, error) {
	if err := notFoundIfBadUUID(editionID); err != nil {
		return nil, err
	}
	return s.repo.GetEditionStatus(ctx, editionID)
}

// SetResultsStatus is the audited lifecycle mutation.
func (s *Service) SetResultsStatus(ctx context.Context, editionID, actorID, status, methodology string) (*EditionStatus, error) {
	if err := notFoundIfBadUUID(editionID); err != nil {
		return nil, err
	}
	out, err := s.repo.SetResultsStatus(ctx, editionID, status, methodology)
	if err != nil {
		return nil, err
	}
	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "connect.edition.results_status", actorID, "connect_contest", editionID,
			map[string]any{"results_status": out.ResultsStatus, "winner_methodology": out.WinnerMethodology})
	}
	return out, nil
}

// ListWinningPositions / ListEditionPrizes — public reads (active rows only).
func (s *Service) ListWinningPositions(ctx context.Context, editionID string, activeOnly bool) ([]WinningPosition, error) {
	if err := notFoundIfBadUUID(editionID); err != nil {
		return nil, err
	}
	return s.repo.ListWinningPositions(ctx, editionID, activeOnly)
}

func (s *Service) ListEditionPrizes(ctx context.Context, editionID string, activeOnly bool) ([]EditionPrize, error) {
	if err := notFoundIfBadUUID(editionID); err != nil {
		return nil, err
	}
	return s.repo.ListEditionPrizes(ctx, editionID, activeOnly)
}

// GetPublishedRules returns the live rules document for the mobile rules screen.
func (s *Service) GetPublishedRules(ctx context.Context, editionID string) (*EditionRules, error) {
	if err := notFoundIfBadUUID(editionID); err != nil {
		return nil, err
	}
	rr, err := s.repo.GetPublishedRules(ctx, editionID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrRulesNotPublished
		}
		return nil, err
	}
	return rr, nil
}

// PublishRules publishes a draft and archives the prior version, audited.
func (s *Service) PublishRules(ctx context.Context, editionID, rulesID, actorID string) (*EditionRules, error) {
	if err := notFoundIfBadUUID(editionID); err != nil {
		return nil, err
	}
	out, err := s.repo.PublishRules(ctx, editionID, rulesID, actorID)
	if err != nil {
		return nil, err
	}
	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "connect.edition.rules_published", actorID, "edition_rules", rulesID,
			map[string]any{"edition_id": editionID, "version": out.Version})
	}
	return out, nil
}

// AcceptRules records a registrant's acceptance of the current published rules.
// The user is the AUTHENTICATED registrant (taken from the bearer token, never
// trusted from the body) and applicationID is the registration application the
// gate was captured against. The rules_id must be the published version;
// accepting an unpublished/old draft is refused so the registration gate always
// pins the live terms (§5).
func (s *Service) AcceptRules(ctx context.Context, editionID, userID, applicationID, rulesID string) (*RulesAcceptance, error) {
	if err := notFoundIfBadUUID(editionID); err != nil {
		return nil, err
	}
	if userID == "" {
		return nil, ErrBadEditionConfig
	}
	pub, err := s.repo.GetPublishedRules(ctx, editionID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrRulesNotPublished
		}
		return nil, err
	}
	if rulesID != "" && rulesID != pub.ID {
		return nil, ErrBadEditionConfig // registrant tried to accept a non-current version
	}
	return s.repo.RecordRulesAcceptance(ctx, userID, applicationID, editionID, pub.ID)
}

// GetPublishedRulesBySlug resolves a registration's contest_slug to its edition
// and returns the live published rules. The mobile registration gate only has the
// slug on the draft, so this is the lookup it uses to decide whether an
// acceptance checkbox is required at all (ErrRulesNotPublished → no gate).
func (s *Service) GetPublishedRulesBySlug(ctx context.Context, slug string) (*EditionRules, error) {
	editionID, err := s.repo.EditionIDBySlug(ctx, slug)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrRulesNotPublished
		}
		return nil, err
	}
	return s.GetPublishedRules(ctx, editionID)
}

// AcceptRulesBySlug is the registration-submit gate: resolve the edition from the
// draft's contest_slug, then record the authenticated user's acceptance.
func (s *Service) AcceptRulesBySlug(ctx context.Context, slug, userID, applicationID, rulesID string) (*RulesAcceptance, error) {
	editionID, err := s.repo.EditionIDBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	return s.AcceptRules(ctx, editionID, userID, applicationID, rulesID)
}

// GetRulesAcceptanceBySlug returns the authenticated user's acceptance for the
// edition a slug resolves to (latest), so the gate can show "already accepted".
func (s *Service) GetRulesAcceptanceBySlug(ctx context.Context, slug, userID string) (*RulesAcceptance, error) {
	editionID, err := s.repo.EditionIDBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	return s.repo.GetRulesAcceptance(ctx, userID, editionID)
}

// ListWinners returns winners; publishedOnly gates public visibility.
func (s *Service) ListWinners(ctx context.Context, editionID string, publishedOnly bool) ([]EditionWinner, error) {
	if err := notFoundIfBadUUID(editionID); err != nil {
		return nil, err
	}
	return s.repo.ListWinners(ctx, editionID, publishedOnly)
}

// DeclareWinner declares/updates a winner and writes the audit trail §2 requires.
func (s *Service) DeclareWinner(ctx context.Context, editionID, actorID string, w *EditionWinner) (*EditionWinner, error) {
	if err := notFoundIfBadUUID(editionID); err != nil {
		return nil, err
	}
	if w.ContestantID == "" {
		return nil, ErrBadEditionConfig
	}
	out, err := s.repo.DeclareWinner(ctx, editionID, actorID, w)
	if err != nil {
		return nil, err
	}
	if s.audit != nil {
		_ = s.audit.WriteAudit(ctx, "connect.edition.winner_declared", actorID, "edition_winner", out.ID,
			map[string]any{"edition_id": editionID, "contestant_id": out.ContestantID,
				"position_id": out.PositionID, "declaration_status": out.DeclarationStatus})
	}
	return out, nil
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// mapEditionError maps edition-config errors onto HTTP statuses.
func mapEditionError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "edition or resource not found"})
	case errors.Is(err, ErrRulesNotPublished):
		c.JSON(http.StatusNotFound, gin.H{"error": "no published rules for this edition"})
	case errors.Is(err, ErrBadEditionConfig), errors.Is(err, ErrBadStatusTransition),
		errors.Is(err, ErrJointWinnerCap):
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// GetEditionRules — GET /contests/:id/rules (member). The published rules only.
func (h *Handler) GetEditionRules(c *gin.Context) {
	rr, err := h.svc.GetPublishedRules(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rr})
}

// GetEditionWinners — GET /contests/:id/winners (member). Published winners only.
func (h *Handler) GetEditionWinners(c *gin.Context) {
	out, err := h.svc.ListWinners(c.Request.Context(), c.Param("id"), true)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetEditionPositions — GET /contests/:id/positions (member).
func (h *Handler) GetEditionPositions(c *gin.Context) {
	out, err := h.svc.ListWinningPositions(c.Request.Context(), c.Param("id"), true)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetEditionPrizes — GET /contests/:id/edition-prizes (member).
func (h *Handler) GetEditionPrizes(c *gin.Context) {
	out, err := h.svc.ListEditionPrizes(c.Request.Context(), c.Param("id"), true)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

type acceptRulesRequest struct {
	// The registration application the gate is captured against. Optional: a
	// registrant can accept the edition rules before/without a draft id, and the
	// acceptance still pins user + edition + rules version.
	ApplicationID string `json:"application_id"`
	RulesID       string `json:"rules_id"`
}

// AcceptEditionRules — POST /contests/:id/rules-acceptance (member). Records the
// AUTHENTICATED registrant's acceptance of the live rules. The user id comes from
// the bearer token (ginutil.UserID), never the body, so one user cannot record an
// acceptance for another.
func (h *Handler) AcceptEditionRules(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req acceptRulesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	a, err := h.svc.AcceptRules(c.Request.Context(), c.Param("id"), uid, req.ApplicationID, req.RulesID)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": a})
}

// GetEditionRulesAcceptance — GET /contests/:id/rules-acceptance (member). The
// authenticated user's own acceptance for this edition, so the gate can render
// "already accepted" without trusting a client flag. 404 when not yet accepted.
func (h *Handler) GetEditionRulesAcceptance(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	a, err := h.svc.repo.GetRulesAcceptance(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// ── Slug-based registration gate ──────────────────────────────────────────────
// The mobile registration draft carries contest_slug, not the connect_contests
// UUID, and these routes live on a separate /editions/by-slug/:slug prefix so they
// never collide with the /contests/:id param routes already registered above.

// GetEditionRulesBySlug — GET /editions/by-slug/:slug/rules (member). The
// published rules for the edition a registration slug resolves to. 404 when the
// slug has no edition or no published rules → the mobile gate is then skipped
// (an edition that never configured rules keeps registering unchanged).
func (h *Handler) GetEditionRulesBySlug(c *gin.Context) {
	rr, err := h.svc.GetPublishedRulesBySlug(c.Request.Context(), c.Param("slug"))
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rr})
}

// AcceptEditionRulesBySlug — POST /editions/by-slug/:slug/rules-acceptance
// (member). The registration-submit gate: resolve the edition from the draft's
// contest_slug and record the authenticated user's acceptance.
func (h *Handler) AcceptEditionRulesBySlug(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req acceptRulesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	a, err := h.svc.AcceptRulesBySlug(c.Request.Context(), c.Param("slug"), uid, req.ApplicationID, req.RulesID)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": a})
}

// GetEditionRulesAcceptanceBySlug — GET /editions/by-slug/:slug/rules-acceptance
// (member). The authenticated user's acceptance for the edition a slug resolves to.
func (h *Handler) GetEditionRulesAcceptanceBySlug(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	a, err := h.svc.GetRulesAcceptanceBySlug(c.Request.Context(), c.Param("slug"), uid)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// ── Admin handlers ────────────────────────────────────────────────────────────

// AdminListPositions — GET /contests/:id/positions (admin, view). Includes
// inactive rows so the console can manage the full ladder.
func (h *Handler) AdminListPositions(c *gin.Context) {
	out, err := h.svc.ListWinningPositions(c.Request.Context(), c.Param("id"), false)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminListPrizes — GET /contests/:id/edition-prizes (admin, view).
func (h *Handler) AdminListPrizes(c *gin.Context) {
	out, err := h.svc.ListEditionPrizes(c.Request.Context(), c.Param("id"), false)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

type setPositionRequest struct {
	Title             string `json:"title" binding:"required"`
	Rank              int    `json:"rank" binding:"required"`
	DisplayOrder      int    `json:"display_order"`
	RecipientsAllowed int    `json:"recipients_allowed"`
}

// AdminCreatePosition — POST /contests/:id/positions (admin, manage).
func (h *Handler) AdminCreatePosition(c *gin.Context) {
	var req setPositionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if req.Rank <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rank must be positive"})
		return
	}
	recip := req.RecipientsAllowed
	if recip <= 0 {
		recip = 1
	}
	p, err := h.svc.repo.CreateWinningPosition(c.Request.Context(), c.Param("id"), ginutil.UserID(c), &WinningPosition{
		Title: req.Title, Rank: req.Rank, DisplayOrder: req.DisplayOrder, RecipientsAllowed: recip,
	})
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// AdminDeletePosition — DELETE /contests/:id/positions/:positionId (admin).
func (h *Handler) AdminDeletePosition(c *gin.Context) {
	if err := h.svc.repo.DeleteWinningPosition(c.Request.Context(), c.Param("id"), c.Param("positionId")); err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminCreatePrize — POST /contests/:id/edition-prizes (admin, manage).
func (h *Handler) AdminCreatePrize(c *gin.Context) {
	var p EditionPrize
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if p.PrizeType == "" {
		p.PrizeType = "cash"
	}
	if p.Currency == "" {
		p.Currency = "NGN"
	}
	out, err := h.svc.repo.CreateEditionPrize(c.Request.Context(), c.Param("id"), ginutil.UserID(c), &p)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// AdminDeletePrize — DELETE /contests/:id/edition-prizes/:prizeId (admin).
func (h *Handler) AdminDeletePrize(c *gin.Context) {
	if err := h.svc.repo.DeleteEditionPrize(c.Request.Context(), c.Param("id"), c.Param("prizeId")); err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminListRules — GET /contests/:id/rules-versions (admin, view). All versions.
func (h *Handler) AdminListRules(c *gin.Context) {
	out, err := h.svc.repo.ListRulesVersions(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

type createRulesRequest struct {
	Content       json.RawMessage `json:"content"`
	EffectiveDate *time.Time      `json:"effective_date"`
}

// AdminCreateRules — POST /contests/:id/rules-versions (admin, manage). New draft.
func (h *Handler) AdminCreateRules(c *gin.Context) {
	var req createRulesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	rr, err := h.svc.repo.CreateRulesDraft(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req.Content, req.EffectiveDate)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": rr})
}

// AdminPublishRules — POST /contests/:id/rules-versions/:rulesId/publish (admin).
func (h *Handler) AdminPublishRules(c *gin.Context) {
	rr, err := h.svc.PublishRules(c.Request.Context(), c.Param("id"), c.Param("rulesId"), ginutil.UserID(c))
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rr})
}

// AdminListWinners — GET /contests/:id/winners-admin (admin, view). All rows.
func (h *Handler) AdminListWinners(c *gin.Context) {
	out, err := h.svc.ListWinners(c.Request.Context(), c.Param("id"), false)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminDeclareWinner — POST /contests/:id/winners (admin, manage).
func (h *Handler) AdminDeclareWinner(c *gin.Context) {
	var w EditionWinner
	if err := c.ShouldBindJSON(&w); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.DeclareWinner(c.Request.Context(), c.Param("id"), ginutil.UserID(c), &w)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

type setResultsStatusRequest struct {
	ResultsStatus     string `json:"results_status"`
	WinnerMethodology string `json:"winner_methodology"`
}

// AdminSetResultsStatus — POST /contests/:id/results-status (admin, manage).
func (h *Handler) AdminSetResultsStatus(c *gin.Context) {
	var req setResultsStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.SetResultsStatus(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req.ResultsStatus, req.WinnerMethodology)
	if err != nil {
		mapEditionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// RegisterEditionRoutes wires the member-facing edition reads onto the auth-gated
// member group. Kept separate from Register so the existing voting routes are
// untouched; called from Register.
func RegisterEditionRoutes(member gin.IRouter, h *Handler) {
	member.GET("/contests/:id/rules", h.GetEditionRules)
	member.GET("/contests/:id/winners", h.GetEditionWinners)
	member.GET("/contests/:id/positions", h.GetEditionPositions)
	member.GET("/contests/:id/edition-prizes", h.GetEditionPrizes)
	// The authenticated user's own acceptance for an edition (no :contestantId —
	// the user comes from the bearer token).
	member.POST("/contests/:id/rules-acceptance", h.AcceptEditionRules)
	member.GET("/contests/:id/rules-acceptance", h.GetEditionRulesAcceptance)

	// Registration gate keyed on the draft's contest_slug (mobile has the slug,
	// not the connect_contests UUID). A distinct /editions/by-slug/:slug prefix so
	// it never collides with the /contests/:id param routes above.
	member.GET("/editions/by-slug/:slug/rules", h.GetEditionRulesBySlug)
	member.POST("/editions/by-slug/:slug/rules-acceptance", h.AcceptEditionRulesBySlug)
	member.GET("/editions/by-slug/:slug/rules-acceptance", h.GetEditionRulesAcceptanceBySlug)
}

// RegisterEditionAdminRoutes wires the admin edition mutations behind their RBAC
// guards. Called from RegisterAdmin.
func RegisterEditionAdminRoutes(g *gin.RouterGroup, h *Handler, guard PermissionGuard) {
	// Admin reads (include inactive/draft rows the member endpoints hide).
	g.GET("/:id/positions", guard("connect.contests.view"), h.AdminListPositions)
	g.GET("/:id/edition-prizes", guard("connect.contests.view"), h.AdminListPrizes)
	g.POST("/:id/positions", guard("connect.contests.manage"), h.AdminCreatePosition)
	g.DELETE("/:id/positions/:positionId", guard("connect.contests.manage"), h.AdminDeletePosition)
	g.POST("/:id/edition-prizes", guard("connect.contests.manage"), h.AdminCreatePrize)
	g.DELETE("/:id/edition-prizes/:prizeId", guard("connect.contests.manage"), h.AdminDeletePrize)
	g.GET("/:id/rules-versions", guard("connect.contests.view"), h.AdminListRules)
	g.POST("/:id/rules-versions", guard("connect.contests.manage"), h.AdminCreateRules)
	g.POST("/:id/rules-versions/:rulesId/publish", guard("connect.contests.manage"), h.AdminPublishRules)
	g.GET("/:id/winners-admin", guard("connect.contests.view"), h.AdminListWinners)
	g.POST("/:id/winners", guard("connect.contests.manage"), h.AdminDeclareWinner)
	g.POST("/:id/results-status", guard("connect.contests.manage"), h.AdminSetResultsStatus)
}

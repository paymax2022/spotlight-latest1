package association

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Admin organisation management.
//
// Authorization model: every call resolves the target organisation first and
// then requires ManageMembers IN THAT ORG (requireCapInOrg, which already grants
// platform super-admins). Fail-closed — an admin of another organisation gets
// ErrForbidden, never a partial write.
//
// Money note: registration fees and dues tiers are integers in kobo. Mutating a
// dues tier does not move money by itself (it re-prices future invoices), but it
// is audited and requires an Idempotency-Key so a retried repricing cannot be
// mistaken for a second deliberate change.

var validGroupTypes = map[string]bool{
	"OPEN": true, "CLOSED": true, "INVITE_ONLY": true, "CODE_BASED": true, "PAID": true,
}

var validApprovalRules = map[string]bool{
	"AUTO": true, "ADMIN": true, "CHAPTER_THEN_NATIONAL": true, "PAYMENT_FIRST": true,
}

var validCadences = map[string]bool{
	"MONTHLY": true, "QUARTERLY": true, "ANNUAL": true, "ONE_OFF": true,
}

var validChapterLevels = map[string]bool{"REGION": true, "STATE": true, "LOCAL": true}

// requireOrgAdmin is the single gate for every mutation in this file.
func (s *Service) requireOrgAdmin(ctx context.Context, adminID, orgID string) error {
	return s.requireCapInOrg(ctx, adminID, orgID, func(c AdminCapabilities) bool { return c.ManageMembers })
}

// GetAdminOrganisation returns the full admin detail for one organisation,
// including its chapters, committees, dues tiers, rules and chapter leaders.
func (s *Service) GetAdminOrganisation(ctx context.Context, adminID, orgID string) (*AdminOrganisationDetail, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return nil, err
	}
	var d AdminOrganisationDetail
	var settings []byte
	const q = `
		SELECT o.id, o.name, o.acronym, o.category, o.description, o.logo_url, o.cover_url,
		       o.group_type, o.approval_rule, o.registration_fee_kobo, o.requires_payment,
		       o.founded_year, o.location, o.website, o.verified, o.published, o.status,
		       o.structure_type, o.created_by::text, o.created_at::text, o.suspended_at::text,
		       o.grace_days, o.disable_voting, o.disable_events, o.disable_chat, o.disable_card,
		       o.settings,
		       (SELECT count(*) FROM assoc_memberships m WHERE m.organisation_id=o.id),
		       (SELECT count(*) FROM assoc_memberships m WHERE m.organisation_id=o.id AND m.status='ACTIVE'),
		       (SELECT count(*) FROM assoc_memberships m WHERE m.organisation_id=o.id AND m.status='PENDING'),
		       (SELECT count(*) FROM assoc_chapters c WHERE c.organisation_id=o.id),
		       (SELECT count(*) FROM assoc_committees c WHERE c.organisation_id=o.id),
		       (SELECT count(*) FROM assoc_membership_categories c WHERE c.organisation_id=o.id)
		FROM assoc_organisations o WHERE o.id=$1`
	if err := s.db.QueryRow(ctx, q, orgID).Scan(
		&d.ID, &d.Name, &d.Acronym, &d.Category, &d.Description, &d.LogoURL, &d.CoverURL,
		&d.GroupType, &d.ApprovalRule, &d.RegistrationFeeKobo, &d.RequiresPayment,
		&d.FoundedYear, &d.Location, &d.Website, &d.Verified, &d.Published, &d.Status,
		&d.StructureType, &d.CreatedBy, &d.CreatedAt, &d.SuspendedAt,
		&d.Restrictions.GraceDays, &d.Restrictions.DisableVoting, &d.Restrictions.DisableEvents,
		&d.Restrictions.DisableChat, &d.Restrictions.DisableCard,
		&settings,
		&d.MemberCount, &d.ActiveCount, &d.PendingCount,
		&d.ChapterCount, &d.CommitteeCount, &d.CategoryCount,
	); err != nil {
		return nil, fmt.Errorf("association: organisation not found: %w", err)
	}
	// Uploaded logos are stored as R2 object keys; sign them so the admin console
	// renders the same image the mobile app does (see presign.go).
	d.LogoURL = s.resolveLogo(d.LogoURL)
	scanJSONB(settings, &d.Settings)
	if d.Settings == nil {
		d.Settings = map[string]any{}
	}

	d.Chapters = []Chapter{}
	// NOTE: these sub-lists used `if err == nil`, so a query error (or a per-row
	// scan error) produced a silently empty list rather than a failure. A wrong
	// column name therefore looked like "this org has no committees" while
	// committeeCount reported 2. Errors are returned now.
	if rows, err := s.db.Query(ctx, `
		SELECT id, name, level, parent_id,
		       (SELECT count(*) FROM assoc_memberships m WHERE m.chapter_id=c.id AND m.status='ACTIVE')
		FROM assoc_chapters c WHERE organisation_id=$1 ORDER BY name`, orgID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var c Chapter
			if err := rows.Scan(&c.ID, &c.Name, &c.Level, &c.ParentID, &c.MemberCount); err == nil {
				d.Chapters = append(d.Chapters, c)
			}
		}
	}

	d.Committees = []AdminCommittee{}
	if rows, err := s.db.Query(ctx, `
		SELECT id, name, purpose,
		       (SELECT count(*) FROM assoc_committee_members cm WHERE cm.committee_id=c.id AND cm.status='ACTIVE')
		FROM assoc_committees c WHERE organisation_id=$1 ORDER BY name`, orgID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var c AdminCommittee
			if err := rows.Scan(&c.ID, &c.Name, &c.Description, &c.MemberCount); err == nil {
				d.Committees = append(d.Committees, c)
			}
		}
	}

	d.Categories = []MembershipCategory{}
	if rows, err := s.db.Query(ctx,
		`SELECT id, label, description, dues_kobo, cadence FROM assoc_membership_categories
		 WHERE organisation_id=$1 ORDER BY label`, orgID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var c MembershipCategory
			if err := rows.Scan(&c.ID, &c.Label, &c.Description, &c.DuesKobo, &c.DuesCadence); err == nil {
				d.Categories = append(d.Categories, c)
			}
		}
	}

	d.Rules = []AdminOrgRule{}
	if rows, err := s.db.Query(ctx,
		`SELECT id, body, position FROM assoc_organisation_rules
		 WHERE organisation_id=$1 ORDER BY position, id`, orgID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var r AdminOrgRule
			if err := rows.Scan(&r.ID, &r.Body, &r.Position); err == nil {
				d.Rules = append(d.Rules, r)
			}
		}
	}

	d.Leaders = []AdminChapterLeader{}
	if rows, err := s.db.Query(ctx,
		`SELECT id, chapter_id::text, state_name, leader_name, leader_contact, can_approve_members
		 FROM assoc_chapter_leaders WHERE organisation_id=$1 ORDER BY state_name`, orgID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var l AdminChapterLeader
			if err := rows.Scan(&l.ID, &l.ChapterID, &l.StateName, &l.LeaderName, &l.LeaderContact, &l.CanApproveMembers); err == nil {
				d.Leaders = append(d.Leaders, l)
			}
		}
	}
	return &d, nil
}

// UpdateOrganisation patches an organisation. Builds the SET list dynamically so
// an unmentioned field is never overwritten.
func (s *Service) UpdateOrganisation(ctx context.Context, adminID, orgID string, req UpdateOrganisationRequest) (*AdminOrganisationDetail, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return nil, err
	}
	if req.GroupType != nil && !validGroupTypes[*req.GroupType] {
		return nil, fmt.Errorf("%w: association: invalid groupType %q", ErrInvalidInput, *req.GroupType)
	}
	if req.ApprovalRule != nil && !validApprovalRules[*req.ApprovalRule] {
		return nil, fmt.Errorf("%w: association: invalid approvalRule %q", ErrInvalidInput, *req.ApprovalRule)
	}
	if req.RegistrationFeeKobo != nil && *req.RegistrationFeeKobo < 0 {
		return nil, fmt.Errorf("%w: association: registrationFeeKobo must not be negative", ErrInvalidInput)
	}
	if req.GraceDays != nil && *req.GraceDays < 0 {
		return nil, fmt.Errorf("%w: association: graceDays must not be negative", ErrInvalidInput)
	}

	sets := []string{"updated_at = now()"}
	args := []any{orgID}
	add := func(col string, val any) {
		args = append(args, val)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}
	if req.Name != nil {
		if strings.TrimSpace(*req.Name) == "" {
			return nil, fmt.Errorf("%w: association: name must not be blank", ErrInvalidInput)
		}
		add("name", *req.Name)
	}
	if req.Acronym != nil {
		add("acronym", nilIfBlank(*req.Acronym))
	}
	if req.Category != nil {
		add("category", *req.Category)
	}
	if req.Description != nil {
		add("description", nilIfBlank(*req.Description))
	}
	if req.LogoURL != nil {
		add("logo_url", nilIfBlank(*req.LogoURL))
	}
	if req.CoverURL != nil {
		add("cover_url", nilIfBlank(*req.CoverURL))
	}
	if req.GroupType != nil {
		add("group_type", *req.GroupType)
	}
	if req.ApprovalRule != nil {
		add("approval_rule", *req.ApprovalRule)
	}
	if req.RegistrationFeeKobo != nil {
		add("registration_fee_kobo", *req.RegistrationFeeKobo)
		// Keep requires_payment consistent with the fee and the group type;
		// it used to be derived from fee>0 alone and could contradict a PAID org.
		gt := ""
		if req.GroupType != nil {
			gt = *req.GroupType
		}
		if gt != "" {
			add("requires_payment", *req.RegistrationFeeKobo > 0 || gt == "PAID")
		} else {
			args = append(args, *req.RegistrationFeeKobo)
			sets = append(sets, fmt.Sprintf("requires_payment = ($%d > 0 OR group_type = 'PAID')", len(args)))
		}
	}
	if req.FoundedYear != nil {
		add("founded_year", *req.FoundedYear)
	}
	if req.Location != nil {
		add("location", nilIfBlank(*req.Location))
	}
	if req.Website != nil {
		add("website", nilIfBlank(*req.Website))
	}
	if req.StructureType != nil {
		add("structure_type", nilIfBlank(*req.StructureType))
	}
	if req.GraceDays != nil {
		add("grace_days", *req.GraceDays)
	}
	if req.DisableVoting != nil {
		add("disable_voting", *req.DisableVoting)
	}
	if req.DisableEvents != nil {
		add("disable_events", *req.DisableEvents)
	}
	if req.DisableChat != nil {
		add("disable_chat", *req.DisableChat)
	}
	if req.DisableCard != nil {
		add("disable_card", *req.DisableCard)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	q := fmt.Sprintf(`UPDATE assoc_organisations SET %s WHERE id=$1`, strings.Join(sets, ", "))
	tag, err := tx.Exec(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("association: update organisation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("association: organisation not found")
	}
	if err := s.audit(ctx, tx, orgID, adminID, "ORG_UPDATE", "organisation", orgID,
		map[string]any{"fields": len(sets) - 1}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("association: commit: %w", err)
	}
	return s.GetAdminOrganisation(ctx, adminID, orgID)
}

// SetOrganisationFlag toggles verified / published / status. Verifying an
// organisation is a platform-trust decision, so it is restricted to platform
// super-admins rather than the organisation's own officers — an org admin must
// not be able to award their own verification badge.
func (s *Service) SetOrganisationFlag(ctx context.Context, adminID, orgID, flag string, on bool) error {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	var col, action string
	switch flag {
	case "verified":
		if !s.isPlatformSuperAdmin(ctx, adminID) {
			return ErrForbidden
		}
		col, action = "verified", "ORG_VERIFY"
	case "published":
		col, action = "published", "ORG_PUBLISH_TOGGLE"
	case "suspended":
		// Suspension flips status and stamps suspended_at in one statement.
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return fmt.Errorf("association: begin tx: %w", err)
		}
		defer tx.Rollback(ctx)
		status, at := "ACTIVE", "NULL"
		if on {
			status, at = "SUSPENDED", "now()"
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(
			`UPDATE assoc_organisations SET status=$2, suspended_at=%s, updated_at=now() WHERE id=$1`, at,
		), orgID, status); err != nil {
			return fmt.Errorf("association: suspend organisation: %w", err)
		}
		if err := s.audit(ctx, tx, orgID, adminID, "ORG_SUSPEND", "organisation", orgID,
			map[string]any{"suspended": on}); err != nil {
			return err
		}
		return tx.Commit(ctx)
	default:
		return fmt.Errorf("association: unknown flag %q", flag)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf(
		`UPDATE assoc_organisations SET %s=$2, updated_at=now() WHERE id=$1`, col), orgID, on); err != nil {
		return fmt.Errorf("association: set %s: %w", col, err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, action, "organisation", orgID,
		map[string]any{col: on}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// GetOrganisationSettings / UpdateOrganisationSettings are the per-association
// custom settings surface. Stored as a jsonb blob on the organisation so new
// knobs do not need a migration each; money-affecting knobs should graduate to
// typed columns.
func (s *Service) GetOrganisationSettings(ctx context.Context, adminID, orgID string) (map[string]any, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return nil, err
	}
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT settings FROM assoc_organisations WHERE id=$1`, orgID).Scan(&raw); err != nil {
		return nil, fmt.Errorf("association: organisation not found: %w", err)
	}
	out := map[string]any{}
	scanJSONB(raw, &out)
	if out == nil {
		out = map[string]any{}
	}
	return out, nil
}

// UpdateOrganisationSettings merges the supplied keys into the stored blob. A
// null value deletes its key, so a caller can remove a setting without having
// to resend the whole document.
func (s *Service) UpdateOrganisationSettings(ctx context.Context, adminID, orgID string, patch map[string]any) (map[string]any, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return nil, err
	}
	current, err := s.GetOrganisationSettings(ctx, adminID, orgID)
	if err != nil {
		return nil, err
	}
	for k, v := range patch {
		if v == nil {
			delete(current, k)
			continue
		}
		current[k] = v
	}
	blob, err := json.Marshal(current)
	if err != nil {
		return nil, fmt.Errorf("association: settings marshal: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE assoc_organisations SET settings=$2, updated_at=now() WHERE id=$1`, orgID, blob); err != nil {
		return nil, fmt.Errorf("association: update settings: %w", err)
	}
	keys := make([]string, 0, len(patch))
	for k := range patch {
		keys = append(keys, k)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "ORG_SETTINGS_UPDATE", "organisation", orgID,
		map[string]any{"keys": keys}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("association: commit: %w", err)
	}
	return current, nil
}

// ── Sub-entities: chapters, committees, dues categories, rules ───────────────

// orgOfChild resolves the owning organisation of a sub-entity so the caller can
// be authorized against it. `table` is always an internal constant.
func (s *Service) orgOfChild(ctx context.Context, table, id string) (string, error) {
	var orgID string
	q := fmt.Sprintf(`SELECT organisation_id FROM %s WHERE id=$1`, table)
	if err := s.db.QueryRow(ctx, q, id).Scan(&orgID); err != nil {
		return "", fmt.Errorf("association: not found: %w", err)
	}
	return orgID, nil
}

func (s *Service) CreateChapter(ctx context.Context, adminID, orgID string, req ChapterRequest) (string, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return "", err
	}
	level := nz(req.Level, "STATE")
	if !validChapterLevels[level] {
		return "", fmt.Errorf("%w: association: invalid chapter level %q", ErrInvalidInput, level)
	}
	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`INSERT INTO assoc_chapters (id, organisation_id, name, level) VALUES ($1,$2,$3,$4)`,
		id, orgID, req.Name, level); err != nil {
		return "", fmt.Errorf("association: create chapter: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "CHAPTER_CREATE", "chapter", id,
		map[string]any{"name": req.Name, "level": level}); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func (s *Service) UpdateChapter(ctx context.Context, adminID, chapterID string, req ChapterRequest) error {
	orgID, err := s.orgOfChild(ctx, "assoc_chapters", chapterID)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	level := nz(req.Level, "STATE")
	if !validChapterLevels[level] {
		return fmt.Errorf("%w: association: invalid chapter level %q", ErrInvalidInput, level)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE assoc_chapters SET name=$2, level=$3 WHERE id=$1`, chapterID, req.Name, level); err != nil {
		return fmt.Errorf("association: update chapter: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "CHAPTER_UPDATE", "chapter", chapterID,
		map[string]any{"name": req.Name, "level": level}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteChapter refuses while members still reference the chapter. These rows
// are FK targets and the repo's migrations are additive-only, so removal is a
// guarded hard delete of an unreferenced row rather than a cascade.
func (s *Service) DeleteChapter(ctx context.Context, adminID, chapterID string) error {
	orgID, err := s.orgOfChild(ctx, "assoc_chapters", chapterID)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	var inUse int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM assoc_memberships WHERE chapter_id=$1`, chapterID).Scan(&inUse); err != nil {
		return fmt.Errorf("association: chapter usage: %w", err)
	}
	if inUse > 0 {
		return fmt.Errorf("association: chapter still has %d member(s) — transfer them first", inUse)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE assoc_chapter_leaders SET chapter_id=NULL WHERE chapter_id=$1`, chapterID); err != nil {
		return fmt.Errorf("association: detach chapter leaders: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM assoc_chapters WHERE id=$1`, chapterID); err != nil {
		return fmt.Errorf("association: delete chapter: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "CHAPTER_DELETE", "chapter", chapterID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) CreateCommittee(ctx context.Context, adminID, orgID string, req CommitteeRequest) (string, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return "", err
	}
	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`INSERT INTO assoc_committees (id, organisation_id, name, purpose) VALUES ($1,$2,$3,$4)`,
		id, orgID, req.Name, req.Description); err != nil {
		return "", fmt.Errorf("association: create committee: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "COMMITTEE_CREATE", "committee", id,
		map[string]any{"name": req.Name}); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func (s *Service) UpdateCommittee(ctx context.Context, adminID, committeeID string, req CommitteeRequest) error {
	orgID, err := s.orgOfChild(ctx, "assoc_committees", committeeID)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE assoc_committees SET name=$2, purpose=$3 WHERE id=$1`,
		committeeID, req.Name, req.Description); err != nil {
		return fmt.Errorf("association: update committee: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "COMMITTEE_UPDATE", "committee", committeeID,
		map[string]any{"name": req.Name}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) DeleteCommittee(ctx context.Context, adminID, committeeID string) error {
	orgID, err := s.orgOfChild(ctx, "assoc_committees", committeeID)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM assoc_committee_members WHERE committee_id=$1`, committeeID); err != nil {
		return fmt.Errorf("association: clear committee members: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM assoc_committees WHERE id=$1`, committeeID); err != nil {
		return fmt.Errorf("association: delete committee: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "COMMITTEE_DELETE", "committee", committeeID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CreateCategory adds a dues tier. Money-path: DuesKobo is integer kobo and the
// call requires an Idempotency-Key so a retry cannot silently create a second
// tier at the same price.
func (s *Service) CreateCategory(ctx context.Context, adminID, orgID string, req CategoryRequest) (string, error) {
	if req.IdempotencyKey == "" {
		return "", ErrIdempotencyRequired
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return "", err
	}
	if req.DuesKobo < 0 {
		return "", fmt.Errorf("%w: association: duesKobo must not be negative", ErrInvalidInput)
	}
	cadence := nz(req.Cadence, "ANNUAL")
	if !validCadences[cadence] {
		return "", fmt.Errorf("%w: association: invalid cadence %q", ErrInvalidInput, cadence)
	}
	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`INSERT INTO assoc_membership_categories (id, organisation_id, label, description, dues_kobo, cadence)
		 VALUES ($1,$2,$3,$4,$5,$6)`,
		id, orgID, req.Label, req.Description, req.DuesKobo, cadence); err != nil {
		return "", fmt.Errorf("association: create category: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "CATEGORY_CREATE", "category", id,
		map[string]any{"label": req.Label, "duesKobo": req.DuesKobo, "cadence": cadence}); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

// UpdateCategory re-prices a dues tier. Existing unpaid invoices are NOT
// re-priced: they were issued at the old amount and rewriting a live invoice
// under a payer would change what they owe after the fact. New invoices pick up
// the new amount.
func (s *Service) UpdateCategory(ctx context.Context, adminID, categoryID string, req CategoryRequest) error {
	if req.IdempotencyKey == "" {
		return ErrIdempotencyRequired
	}
	orgID, err := s.orgOfChild(ctx, "assoc_membership_categories", categoryID)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	if req.DuesKobo < 0 {
		return fmt.Errorf("%w: association: duesKobo must not be negative", ErrInvalidInput)
	}
	cadence := nz(req.Cadence, "ANNUAL")
	if !validCadences[cadence] {
		return fmt.Errorf("%w: association: invalid cadence %q", ErrInvalidInput, cadence)
	}
	var prevKobo int64
	if err := s.db.QueryRow(ctx,
		`SELECT dues_kobo FROM assoc_membership_categories WHERE id=$1`, categoryID).Scan(&prevKobo); err != nil {
		return fmt.Errorf("association: category not found: %w", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE assoc_membership_categories SET label=$2, description=$3, dues_kobo=$4, cadence=$5 WHERE id=$1`,
		categoryID, req.Label, req.Description, req.DuesKobo, cadence); err != nil {
		return fmt.Errorf("association: update category: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "CATEGORY_UPDATE", "category", categoryID,
		map[string]any{
			"label": req.Label, "cadence": cadence,
			"fromKobo": prevKobo, "toKobo": req.DuesKobo,
		}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DeleteCategory refuses while members are still on the tier.
func (s *Service) DeleteCategory(ctx context.Context, adminID, categoryID string) error {
	orgID, err := s.orgOfChild(ctx, "assoc_membership_categories", categoryID)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	var inUse int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM assoc_memberships WHERE category_id=$1`, categoryID).Scan(&inUse); err != nil {
		return fmt.Errorf("association: category usage: %w", err)
	}
	if inUse > 0 {
		return fmt.Errorf("association: category still has %d member(s) — move them first", inUse)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM assoc_membership_categories WHERE id=$1`, categoryID); err != nil {
		return fmt.Errorf("association: delete category: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "CATEGORY_DELETE", "category", categoryID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) CreateRule(ctx context.Context, adminID, orgID string, req RuleRequest) (string, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return "", err
	}
	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`INSERT INTO assoc_organisation_rules (id, organisation_id, body, position) VALUES ($1,$2,$3,$4)`,
		id, orgID, req.Body, req.Position); err != nil {
		return "", fmt.Errorf("association: create rule: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "RULE_CREATE", "rule", id, nil); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func (s *Service) UpdateRule(ctx context.Context, adminID, ruleID string, req RuleRequest) error {
	orgID, err := s.orgOfChild(ctx, "assoc_organisation_rules", ruleID)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE assoc_organisation_rules SET body=$2, position=$3 WHERE id=$1`,
		ruleID, req.Body, req.Position); err != nil {
		return fmt.Errorf("association: update rule: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "RULE_UPDATE", "rule", ruleID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) DeleteRule(ctx context.Context, adminID, ruleID string) error {
	orgID, err := s.orgOfChild(ctx, "assoc_organisation_rules", ruleID)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM assoc_organisation_rules WHERE id=$1`, ruleID); err != nil {
		return fmt.Errorf("association: delete rule: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "RULE_DELETE", "rule", ruleID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// nilIfBlank maps an empty string to a NULL column value.
func nilIfBlank(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

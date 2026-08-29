package creator

// Campaign OWNER self-management: update, pause/resume, soft-delete, and the
// featured-rail request/withdraw/unfeature pair.
//
// Until this file the creator surface was entirely READ-ONLY for campaigns —
// the only mutations anywhere in the package were save/unsave bookmarks and
// reward-fulfilment status. A creator could not fix a typo, stop a campaign
// taking money, or remove a finished campaign.
//
// IRON RULES enforced here:
//
//   - OWNERSHIP ON EVERY MUTATION. The campaign id arrives from the client and
//     is never trusted. Every write reads creator_id under FOR UPDATE inside the
//     same transaction as the write, AND repeats `AND creator_id = $owner` in
//     the UPDATE's own WHERE clause. Two independent gates, because a missing
//     one here is an IDOR that lets any authenticated user edit or delete any
//     campaign on the platform.
//   - All money is int64 kobo. Raised totals are DERIVED from contributions on
//     every read — never a stored column.
//   - feature-request NEVER sets campaigns.featured. It records a request for an
//     admin to action. Only the admin flags endpoint may promote.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ─── Errors ──────────────────────────────────────────────────────────────────

var (
	// ErrNotOwner → 403. The caller authenticated fine but does not own the row.
	ErrNotOwner = errors.New("crowdfunding/creator: you do not own this campaign")

	// ErrNoFieldsSupplied → 400. A PATCH body with none of the editable keys.
	// Succeeding silently would make a typo'd field name read as a saved edit.
	ErrNoFieldsSupplied = errors.New("crowdfunding/creator: no editable field supplied")

	// ErrInvalidTitle → 400. Mirrors the campaigns.title CHECK (2..200 chars) so
	// a bad title is a clean validation error rather than a database 500.
	ErrInvalidTitle = errors.New("crowdfunding/creator: title must be between 2 and 200 characters")

	// ErrInvalidGoal → 400. Mirrors the campaigns.goal_kobo CHECK (>= 100).
	ErrInvalidGoal = errors.New("crowdfunding/creator: goalKobo must be at least 100 kobo")

	// ErrGoalBelowRaised → 409. Lowering the goal under what has already been
	// raised would render the campaign permanently over 100% funded, which is
	// how a stalled campaign is made to look successful to new contributors.
	ErrGoalBelowRaised = errors.New("crowdfunding/creator: goalKobo cannot be lower than the amount already raised")

	// ErrUnknownCategory → 400. An unknown slug silently drops the campaign out
	// of every category filter in discovery.
	ErrUnknownCategory = errors.New("crowdfunding/creator: unknown or disabled category")

	// ErrCampaignDeleted → 409. Every mutation refuses a soft-deleted campaign.
	ErrCampaignDeleted = errors.New("crowdfunding/creator: campaign has been deleted")

	// ErrAlreadyPaused / ErrNotPaused → 409.
	ErrAlreadyPaused = errors.New("crowdfunding/creator: campaign is already paused")
	ErrNotPaused     = errors.New("crowdfunding/creator: campaign is not paused")

	// ErrNotActive → 409. Pause/resume/feature-request only make sense for a
	// campaign that has cleared review and is (or was) publicly live.
	ErrNotActive = errors.New("crowdfunding/creator: campaign is not ACTIVE")

	// ErrCampaignHasFunds → 409. The delete guard.
	ErrCampaignHasFunds = errors.New("crowdfunding/creator: campaign has received contributions and cannot be deleted")

	// ErrFeatureRequestOpen → 409. One open request per campaign.
	ErrFeatureRequestOpen = errors.New("crowdfunding/creator: a feature request is already pending for this campaign")

	// ErrNoFeatureRequest → 404. Nothing open to withdraw.
	ErrNoFeatureRequest = errors.New("crowdfunding/creator: no pending feature request for this campaign")
)

// reviewStatusActive is the single review_status that counts as publicly live.
const reviewStatusActive = "ACTIVE"

// titleMin / titleMax mirror the campaigns.title CHECK constraint.
const (
	titleMin = 2
	titleMax = 200
)

// minGoalKobo mirrors the campaigns.goal_kobo CHECK constraint.
const minGoalKobo int64 = 100

// ─── Request DTOs ────────────────────────────────────────────────────────────

// CampaignUpdateRequest is the PATCH body for an owner editing their campaign.
//
// Every field is a POINTER. A nil field means the key was ABSENT from the JSON
// and that column is left untouched — which is what makes this a partial
// update. Plain (non-pointer) fields would make every omitted key read as an
// explicit zero value and blank the caller's title, summary and story the
// moment they patched only their cover image.
type CampaignUpdateRequest struct {
	Title      *string `json:"title"`
	Summary    *string `json:"summary"`
	Story      *string `json:"story"`
	Category   *string `json:"category"`
	CoverImage *string `json:"coverImage"`
	GoalKobo   *int64  `json:"goalKobo"`
}

// FeatureRequestInput is the optional body for POST .../feature-request.
type FeatureRequestInput struct {
	Note string `json:"note"`
}

// FeatureRequest is the queue row returned to the owner (and read by the admin
// featured-queue console).
type FeatureRequest struct {
	ID          string  `json:"id"`
	CampaignID  string  `json:"campaignId"`
	RequestedBy string  `json:"requestedBy"`
	Status      string  `json:"status"`
	Note        string  `json:"note"`
	AdminNote   *string `json:"adminNote"`
	CreatedAt   string  `json:"createdAt"`
}

// ─── Pure helpers (unit-tested without a database) ───────────────────────────

// assignment is one column := value write derived from a PATCH body.
type assignment struct {
	Column string
	Value  any
}

// updateAssignments returns, in a stable order, the column writes a body asks
// for. Absent (nil) fields produce no assignment — that is the whole mechanism
// by which a partial update leaves its siblings alone.
func updateAssignments(req CampaignUpdateRequest) []assignment {
	out := make([]assignment, 0, 6)
	if req.Title != nil {
		out = append(out, assignment{Column: "title", Value: strings.TrimSpace(*req.Title)})
	}
	if req.Summary != nil {
		out = append(out, assignment{Column: "summary", Value: *req.Summary})
	}
	if req.Story != nil {
		out = append(out, assignment{Column: "story", Value: *req.Story})
	}
	if req.Category != nil {
		out = append(out, assignment{Column: "category", Value: strings.TrimSpace(*req.Category)})
	}
	if req.CoverImage != nil {
		out = append(out, assignment{Column: "cover_url", Value: *req.CoverImage})
	}
	if req.GoalKobo != nil {
		out = append(out, assignment{Column: "goal_kobo", Value: *req.GoalKobo})
	}
	return out
}

// validateUpdate applies the field-level rules that mirror the table's CHECK
// constraints, so a bad value is a 400 instead of a database error surfacing as
// a 500. Only fields actually PRESENT in the body are validated.
func validateUpdate(req CampaignUpdateRequest) error {
	if req.Title != nil {
		n := len([]rune(strings.TrimSpace(*req.Title)))
		if n < titleMin || n > titleMax {
			return ErrInvalidTitle
		}
	}
	if req.GoalKobo != nil && *req.GoalKobo < minGoalKobo {
		return ErrInvalidGoal
	}
	if req.Category != nil && strings.TrimSpace(*req.Category) == "" {
		return ErrUnknownCategory
	}
	return nil
}

// guardGoalNotBelowRaised refuses a goal reduction that would put the campaign
// permanently past 100% funded. Both values are kobo; the comparison is integer.
func guardGoalNotBelowRaised(req CampaignUpdateRequest, raisedKobo int64) error {
	if req.GoalKobo == nil {
		return nil
	}
	if *req.GoalKobo < raisedKobo {
		return fmt.Errorf("%w (raised %d kobo)", ErrGoalBelowRaised, raisedKobo)
	}
	return nil
}

// buildCampaignUpdate renders the partial UPDATE. Column names are fixed
// literals from updateAssignments and are NEVER caller input; every value is
// bound as a positional parameter.
//
// The WHERE clause carries `creator_id = $owner` in addition to the id. The
// caller has already verified ownership under FOR UPDATE; repeating it here
// means even a future refactor that drops the explicit check cannot turn this
// into a cross-tenant write.
func buildCampaignUpdate(campaignID, ownerID string, req CampaignUpdateRequest) (sql string, args []any, ok bool) {
	as := updateAssignments(req)
	if len(as) == 0 {
		return "", nil, false
	}
	sets := make([]string, 0, len(as)+1)
	args = make([]any, 0, len(as)+2)
	for i, a := range as {
		sets = append(sets, fmt.Sprintf("%s=$%d", a.Column, i+1))
		args = append(args, a.Value)
	}
	sets = append(sets, "updated_at=NOW()")
	args = append(args, campaignID, ownerID)
	return fmt.Sprintf(
		"UPDATE campaigns SET %s WHERE id=$%d AND creator_id=$%d AND deleted_at IS NULL",
		strings.Join(sets, ", "), len(args)-1, len(args),
	), args, true
}

// auditUpdateTarget renders the audit target: which campaign and which columns
// moved. Values are deliberately omitted — story/summary are free text and the
// audit log is not the place to mirror user content — the column list is what
// makes a suspicious edit greppable.
func auditUpdateTarget(campaignID string, req CampaignUpdateRequest) string {
	as := updateAssignments(req)
	cols := make([]string, 0, len(as))
	for _, a := range as {
		cols = append(cols, a.Column)
	}
	return campaignID + " fields=" + strings.Join(cols, ",")
}

// campaignState is the locked snapshot every mutation gates on.
type campaignState struct {
	CreatorID    string
	ReviewStatus string
	PausedAt     *time.Time
	DeletedAt    *time.Time
	GoalKobo     int64
	Featured     bool
}

// guardOwned is the single ownership + liveness gate shared by every mutation.
// Ownership is checked BEFORE existence is disclosed in any other way, and a
// soft-deleted campaign is inert for all owner mutations.
func guardOwned(st campaignState, callerID string) error {
	// An empty caller id means the auth middleware did not run (or set no
	// user_id). Fail closed rather than letting "" match "" and hand a mutation
	// to an unauthenticated request.
	if strings.TrimSpace(callerID) == "" {
		return ErrNotOwner
	}
	if st.CreatorID != callerID {
		return ErrNotOwner
	}
	if st.DeletedAt != nil {
		return ErrCampaignDeleted
	}
	return nil
}

// guardPause: only a live ACTIVE campaign can be paused, and only once.
func guardPause(st campaignState) error {
	if st.ReviewStatus != reviewStatusActive {
		return fmt.Errorf("%w (campaign is %s)", ErrNotActive, st.ReviewStatus)
	}
	if st.PausedAt != nil {
		return ErrAlreadyPaused
	}
	return nil
}

// guardResume: must currently be paused, and must STILL be ACTIVE.
//
// The review_status re-check matters: if an admin froze or rejected the
// campaign while it was paused, resume must not be the creator's way to put it
// back on a public rail behind the moderator's back.
func guardResume(st campaignState) error {
	if st.PausedAt == nil {
		return ErrNotPaused
	}
	if st.ReviewStatus != reviewStatusActive {
		return fmt.Errorf("%w (campaign is %s)", ErrNotActive, st.ReviewStatus)
	}
	return nil
}

// guardDelete refuses any campaign that has EVER held money.
//
// hasContributions is deliberately "a contributions row exists in ANY status",
// not "the escrowed+released total is zero". A row with status='refunded' means
// the campaign DID receive funds and they were sent back — the money history is
// real and must survive. Summing only ('escrowed','released') would score that
// campaign as never-funded and let its creator delete the refund trail.
func guardDelete(st campaignState, hasContributions bool) error {
	if hasContributions {
		return ErrCampaignHasFunds
	}
	return nil
}

// guardFeatureRequest mirrors the ADMIN promotion guard in
// internal/crowdfunding/adminext/featured.go: only an ACTIVE campaign may be
// promoted, so only an ACTIVE campaign may ASK to be. A paused campaign is
// refused too — asking for a rail you are currently hidden from is incoherent.
func guardFeatureRequest(st campaignState) error {
	if st.ReviewStatus != reviewStatusActive {
		return fmt.Errorf("%w (campaign is %s)", ErrNotActive, st.ReviewStatus)
	}
	if st.PausedAt != nil {
		return ErrAlreadyPaused
	}
	return nil
}

// ─── Locked read ─────────────────────────────────────────────────────────────

// lockCampaign reads the campaign state under FOR UPDATE inside tx.
//
// FOR UPDATE is doing real work beyond serialising sibling mutations: PostgreSQL
// enforces the contributions.campaign_id foreign key by taking a FOR KEY SHARE
// lock on the referenced campaigns row for every INSERT into contributions, and
// FOR KEY SHARE conflicts with FOR UPDATE. So while this transaction holds the
// lock, no new contribution can COMMIT against this campaign — which is what
// makes the derived "has this campaign ever received funds?" check in
// DeleteCampaign a decision the delete can actually rely on.
//
// Verified against PostgreSQL 17, not merely assumed: with this SELECT ... FOR
// UPDATE held open, a concurrent contributions INSERT blocks and times out with
//
//	ERROR: canceling statement due to lock timeout
//	CONTEXT: while locking tuple (0,1) in relation "campaigns"
//	  SQL statement: SELECT 1 FROM ONLY "public"."campaigns" x
//	                 WHERE "id" = $1 FOR KEY SHARE OF x
//
// which is the FK check itself queuing behind this lock.
//
// Any error (including a malformed non-UUID id) resolves to ErrNotFound so a
// probe cannot distinguish "bad id" from "someone else's campaign".
func lockCampaign(ctx context.Context, tx pgx.Tx, campaignID string) (campaignState, error) {
	var st campaignState
	err := tx.QueryRow(ctx, `
		SELECT creator_id::text, review_status, paused_at, deleted_at, goal_kobo, featured
		FROM campaigns WHERE id = $1 FOR UPDATE`, campaignID).
		Scan(&st.CreatorID, &st.ReviewStatus, &st.PausedAt, &st.DeletedAt, &st.GoalKobo, &st.Featured)
	if err != nil {
		return st, ErrNotFound
	}
	return st, nil
}

// audit records an owner mutation in the shared crowdfunding audit log, inside
// the same transaction as the write so an audited change can never be committed
// without its audit row (or vice versa).
func (s *Service) audit(ctx context.Context, tx pgx.Tx, actor, action, target string) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO cf_audit_logs (actor, action, target, ip) VALUES ($1,$2,$3,$4)`,
		actor, action, target, "")
	return err
}

// latestFeatureRequestStatusCol is the campaign's most recent feature-request
// status, or NULL when it has never asked. Defined once and shared by every
// owner-facing projection so the single-campaign response and the list response
// can never disagree about whether a request is pending.
//
// "Latest" is by created_at: a campaign may ask again after a rejection or a
// withdrawal (the partial unique index only forbids two OPEN requests), so
// several rows can exist and only the newest describes the current state.
const latestFeatureRequestStatusCol = `
	(SELECT fr.status FROM cf_feature_requests fr
	 WHERE fr.campaign_id = c.id
	 ORDER BY fr.created_at DESC LIMIT 1)`

// ownedSummaryCols is the single-campaign projection, matching GetMyCampaigns so
// the mobile client gets an identically-shaped object back from every mutation.
// raised_kobo and the contributor count are DERIVED, never stored.
const ownedSummaryCols = `
	c.id::text, c.title, COALESCE(c.summary,''), c.type, c.review_status,
	c.category, c.cover_url, c.goal_kobo,
	COALESCE((SELECT SUM(co.amount_kobo) FROM contributions co
	          WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0),
	c.currency,
	COALESCE((SELECT COUNT(DISTINCT co.contributor_id) FROM contributions co
	          WHERE co.campaign_id = c.id AND co.status IN ('escrowed','released')), 0),
	c.deadline, c.verified, c.featured, c.trending, c.urgent, c.location,
	c.paused_at,` + latestFeatureRequestStatusCol

// readOwnedSummary reads one campaign in the list-card shape. q is a pool or a
// tx, so the post-write read runs INSIDE the mutating transaction and the
// response is exactly what was committed.
func readOwnedSummary(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, campaignID string) (*CampaignSummary, error) {
	var (
		sum      CampaignSummary
		deadline time.Time
		pausedAt *time.Time
	)
	err := q.QueryRow(ctx,
		`SELECT `+ownedSummaryCols+` FROM campaigns c WHERE c.id = $1`, campaignID).
		Scan(&sum.ID, &sum.Title, &sum.Summary, &sum.Type, &sum.Status,
			&sum.Category, &sum.CoverImage, &sum.GoalKobo, &sum.RaisedKobo, &sum.Currency,
			&sum.ContributorCount, &deadline, &sum.Verified, &sum.Featured, &sum.Trending,
			&sum.Urgent, &sum.Location, &pausedAt, &sum.FeatureRequestStatus)
	if err != nil {
		return nil, ErrNotFound
	}
	sum.CategoryLabel = categoryLabel(sum.Category)
	if !deadline.IsZero() {
		sum.Deadline = ptr(rfc3339(deadline))
	}
	sum.Paused = pausedAt != nil
	sum.CreatorType = "INDIVIDUAL"
	sum.CreatorVerification = "KYC"
	return &sum, nil
}

// finishOwnedMutation reads the campaign back inside tx, commits, and stamps the
// creator display name (resolved outside the tx — it is auth.users metadata,
// unrelated to the row being written).
func (s *Service) finishOwnedMutation(ctx context.Context, tx pgx.Tx, campaignID, ownerID string) (*CampaignSummary, error) {
	out, err := readOwnedSummary(ctx, tx, campaignID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	out.CreatorName = s.creatorDisplayName(ctx, ownerID)
	return out, nil
}

// ─── UpdateCampaign ──────────────────────────────────────────────────────────

// UpdateCampaign applies a PARTIAL edit to a campaign the caller owns. Only the
// keys present in the body change; siblings are untouched.
//
// Editing stays permitted while a campaign is ACTIVE on purpose — creators need
// to fix typos and add progress to the story of a live fundraiser — so every
// edit writes an audit row naming the columns that moved.
func (s *Service) UpdateCampaign(ctx context.Context, ownerID, campaignID string, req CampaignUpdateRequest) (*CampaignSummary, error) {
	if err := validateUpdate(req); err != nil {
		return nil, err
	}
	updateSQL, args, ok := buildCampaignUpdate(campaignID, ownerID, req)
	if !ok {
		return nil, ErrNoFieldsSupplied
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	st, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return nil, err
	}
	if err := guardOwned(st, ownerID); err != nil {
		return nil, err
	}

	// A category the discovery filters do not know about would make the campaign
	// unreachable through every category browse.
	if req.Category != nil {
		var enabled bool
		if err := tx.QueryRow(ctx,
			`SELECT enabled FROM crowdfunding_categories WHERE slug = $1`,
			strings.TrimSpace(*req.Category)).Scan(&enabled); err != nil || !enabled {
			return nil, ErrUnknownCategory
		}
	}

	// Raised is derived, and read INSIDE the locked transaction so the goal we
	// validate against is the total we are actually writing beside.
	if req.GoalKobo != nil {
		var raised int64
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount_kobo), 0) FROM contributions
			WHERE campaign_id = $1 AND status IN ('escrowed','released')`, campaignID).Scan(&raised); err != nil {
			return nil, err
		}
		if err := guardGoalNotBelowRaised(req, raised); err != nil {
			return nil, err
		}
	}

	if _, err := tx.Exec(ctx, updateSQL, args...); err != nil {
		return nil, err
	}
	if err := s.audit(ctx, tx, ownerID, "campaign.owner.update", auditUpdateTarget(campaignID, req)); err != nil {
		return nil, err
	}
	return s.finishOwnedMutation(ctx, tx, campaignID, ownerID)
}

// ─── Pause / Resume ──────────────────────────────────────────────────────────

// SetPaused pauses (paused=true) or resumes (paused=false) a campaign the caller
// owns.
//
// Pause is stored in campaigns.paused_at, NOT in review_status — see the
// migration header (20270112000000) for the full reasoning: review_status is the
// moderator's column, its CHECK has no PAUSED value, and overloading it would
// let a creator's resume clear an admin's FROZEN.
//
// Pausing also stops the campaign ACCEPTING money, not just hides it from the
// rails: Contribute() refuses a paused campaign. An owner who pauses a fundraiser
// means "stop", and a campaign that vanished from discovery while still taking
// contributions from anyone holding a direct link would be the surprising
// reading.
func (s *Service) SetPaused(ctx context.Context, ownerID, campaignID string, paused bool) (*CampaignSummary, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	st, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return nil, err
	}
	if err := guardOwned(st, ownerID); err != nil {
		return nil, err
	}

	action := "campaign.owner.resume"
	set := "paused_at=NULL"
	if paused {
		action = "campaign.owner.pause"
		set = "paused_at=NOW()"
		if err := guardPause(st); err != nil {
			return nil, err
		}
	} else if err := guardResume(st); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx,
		`UPDATE campaigns SET `+set+`, updated_at=NOW() WHERE id=$1 AND creator_id=$2 AND deleted_at IS NULL`,
		campaignID, ownerID); err != nil {
		return nil, err
	}
	if err := s.audit(ctx, tx, ownerID, action, campaignID); err != nil {
		return nil, err
	}
	return s.finishOwnedMutation(ctx, tx, campaignID, ownerID)
}

// ─── Delete (soft) ───────────────────────────────────────────────────────────

// DeleteCampaign SOFT-deletes a campaign the caller owns, permitted only when
// the campaign has never received a contribution.
//
// WHY SOFT: every foreign key referencing campaigns(id) is ON DELETE CASCADE
// (contributions, cf_withdrawals, campaign_reviews, milestones, reward tiers,
// saved campaigns, recently-viewed, CSR matches). A hard DELETE therefore does
// not fail loudly on a campaign with history — it silently destroys it. Two
// concrete losses: campaign_reviews is the moderation audit trail, and a
// REJECTED campaign has zero contributions, so it would pass the funds guard and
// its creator could erase the rejection record at will; and the settlement rows
// that reference the campaign by the TEXT ref 'campaign:<id>:contributor:<id>'
// have no FK at all, so they are orphaned rather than cascaded.
//
// RACE SAFETY: the existence check and the write are ONE transaction, and the
// FOR UPDATE taken by lockCampaign conflicts with the FOR KEY SHARE that
// PostgreSQL takes on the parent row for every contributions INSERT. So a
// contribution racing this delete either committed before the lock (and the
// EXISTS check sees it, and the delete is refused) or blocks until this
// transaction ends. Contribute() additionally refuses a soft-deleted campaign,
// which rejects any contribution that starts after the delete commits.
//
// The one residual window — a Contribute() that read the campaign as live, then
// blocked on the FK lock behind this delete, and inserts after it commits — is
// precisely why this is a soft delete and not a hard one. In that case the
// contribution row and the campaign row both still exist and the payment is
// fully recoverable by clearing deleted_at. A hard delete would have cascaded
// that real, settled payment out of existence.
func (s *Service) DeleteCampaign(ctx context.Context, ownerID, campaignID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	st, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return err
	}
	if err := guardOwned(st, ownerID); err != nil {
		return err
	}

	// ANY contributions row, in ANY status — a 'refunded' row proves the
	// campaign once held money.
	var hasContributions bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM contributions WHERE campaign_id = $1)`, campaignID).
		Scan(&hasContributions); err != nil {
		return err
	}
	if err := guardDelete(st, hasContributions); err != nil {
		return err
	}

	// Clearing the placement flags matters: a deleted campaign left with
	// featured=TRUE keeps occupying an admin rail and shows up in the placement
	// report forever.
	if _, err := tx.Exec(ctx, `
		UPDATE campaigns
		SET deleted_at=NOW(), featured=FALSE, trending=FALSE, urgent=FALSE, updated_at=NOW()
		WHERE id=$1 AND creator_id=$2 AND deleted_at IS NULL`, campaignID, ownerID); err != nil {
		return err
	}
	// Any open feature request dies with the campaign.
	if _, err := tx.Exec(ctx,
		`UPDATE cf_feature_requests SET status='WITHDRAWN', updated_at=NOW()
		 WHERE campaign_id=$1 AND status='PENDING'`, campaignID); err != nil {
		return err
	}
	if err := s.audit(ctx, tx, ownerID, "campaign.owner.delete", campaignID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── Feature requests ────────────────────────────────────────────────────────

// RequestFeature records an owner's request to be placed on the featured rail.
//
// It NEVER sets campaigns.featured. Promotion stays exclusively with the admin
// flags endpoint — a creator who could self-promote would be publishing
// themselves straight onto the app's most prominent surface.
func (s *Service) RequestFeature(ctx context.Context, ownerID, campaignID, note string) (*FeatureRequest, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	st, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return nil, err
	}
	if err := guardOwned(st, ownerID); err != nil {
		return nil, err
	}
	if err := guardFeatureRequest(st); err != nil {
		return nil, err
	}

	var (
		fr        FeatureRequest
		createdAt time.Time
	)
	err = tx.QueryRow(ctx, `
		INSERT INTO cf_feature_requests (campaign_id, requested_by, note)
		VALUES ($1, $2, $3)
		RETURNING id::text, campaign_id::text, requested_by::text, status, note, admin_note, created_at`,
		campaignID, ownerID, note).
		Scan(&fr.ID, &fr.CampaignID, &fr.RequestedBy, &fr.Status, &fr.Note, &fr.AdminNote, &createdAt)
	if err != nil {
		// The partial unique index (one PENDING row per campaign) is the actual
		// guard against a double request — checking first and inserting second
		// would race with the owner's own second tap.
		if isUniqueViolation(err) {
			return nil, ErrFeatureRequestOpen
		}
		return nil, err
	}
	fr.CreatedAt = rfc3339(createdAt)

	if err := s.audit(ctx, tx, ownerID, "campaign.owner.feature_request", campaignID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &fr, nil
}

// WithdrawFeatureRequest retracts the owner's pending request.
//
// The row is marked WITHDRAWN rather than deleted, so the admin queue keeps a
// record that the request existed and was pulled — and so the partial unique
// index frees up for a fresh request later.
func (s *Service) WithdrawFeatureRequest(ctx context.Context, ownerID, campaignID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	st, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return err
	}
	if err := guardOwned(st, ownerID); err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
		UPDATE cf_feature_requests SET status='WITHDRAWN', updated_at=NOW()
		WHERE campaign_id=$1 AND requested_by=$2 AND status='PENDING'`, campaignID, ownerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNoFeatureRequest
	}
	if err := s.audit(ctx, tx, ownerID, "campaign.owner.feature_request.withdraw", campaignID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Unfeature removes the owner's OWN campaign from the featured rail.
//
// Always allowed, no approval and no status gate — this mirrors the admin
// module's rule that DEMOTION is never status-gated (adminext/featured.go).
// Removing yourself from a rail needs nobody's permission, and a campaign that
// has left ACTIVE (frozen, say) is exactly when getting off the rail matters
// most. Idempotent: unfeaturing an unfeatured campaign succeeds.
func (s *Service) Unfeature(ctx context.Context, ownerID, campaignID string) (*CampaignSummary, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	st, err := lockCampaign(ctx, tx, campaignID)
	if err != nil {
		return nil, err
	}
	if err := guardOwned(st, ownerID); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx,
		`UPDATE campaigns SET featured=FALSE, updated_at=NOW()
		 WHERE id=$1 AND creator_id=$2 AND deleted_at IS NULL`, campaignID, ownerID); err != nil {
		return nil, err
	}
	// A pending request to be featured is incoherent once the owner has opted
	// out; retire it in the same transaction.
	if _, err := tx.Exec(ctx,
		`UPDATE cf_feature_requests SET status='WITHDRAWN', updated_at=NOW()
		 WHERE campaign_id=$1 AND status='PENDING'`, campaignID); err != nil {
		return nil, err
	}
	if err := s.audit(ctx, tx, ownerID, "campaign.owner.unfeature", campaignID); err != nil {
		return nil, err
	}
	return s.finishOwnedMutation(ctx, tx, campaignID, ownerID)
}

// isUniqueViolation reports whether err is a PostgreSQL unique-constraint
// violation (SQLSTATE 23505).
func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}

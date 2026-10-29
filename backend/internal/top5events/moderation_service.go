package top5events

// Events-commerce moderation and governance.
//
// The lifecycle enum (events.state) already decides what may be sold. What was
// missing is the review layer on top of it: why an event was submitted, who decided
// it, what they said, and what happens to the organiser when they decide again.
//
// Two rules shape this file:
//
//  1. events.state is not rewritten to carry review. A rejected or changes-requested
//     event goes back to DRAFT, where the organiser can actually fix and resubmit
//     it, and the outcome lives in events.moderation_status. That keeps a single
//     lifecycle CHECK (owned by 20271032000000) instead of widening it, and it means
//     a resubmission cannot be confused with a first submission.
//  2. Every decision is also a row in event_moderation_decisions. The column says
//     where an event stands now; the trail says how it got there, and it is
//     append-only — an audit trail you can edit is not one.
//
// The platform fee (event_fee_settings) is here too, because a fee change is the
// same kind of act: a platform decision that must leave a trail.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	// Reinstating an event that is not suspended is a state refusal, not bad
	// input — 409, the same family as ErrRefundWindow.
	ErrNotSuspended       = errors.New("events: the event is not suspended")
	ErrOrganiserSuspended = fmt.Errorf("%w: events: this organiser account is suspended", ErrForbidden)
)

// Moderation decision actions (event_moderation_decisions.action CHECK).
const (
	ModerationActSubmit         = "SUBMIT"
	ModerationActApprove        = "APPROVE"
	ModerationActReject         = "REJECT"
	ModerationActRequestChanges = "REQUEST_CHANGES"
	ModerationActSuspend        = "SUSPEND"
	ModerationActReinstate      = "REINSTATE"
	ModerationActFeeSet         = "FEE_SET"
)

// maxDecisionReasonLen bounds a reviewer's note. Long enough for a real
// explanation, short enough that a queue is readable.
const maxDecisionReasonLen = 500

// moderationStatusFor maps a decision to the review status the events columns
// become. A suspension moves no review status (the note carries the why); a fee
// change and an organiser sanction concern no single event at all.
func moderationStatusFor(action string) string {
	switch action {
	case ModerationActSubmit:
		return ModerationPending
	case ModerationActApprove:
		return ModerationApproved
	case ModerationActReject:
		return ModerationRejected
	case ModerationActRequestChanges:
		return ModerationChangesRequested
	case ModerationActReinstate:
		return ModerationApproved
	}
	return ""
}

// afterTransition records the review consequence of a lifecycle move. Called after
// the state transition has committed, so a refused transition (illegal from-state,
// wrong owner) leaves no trail at all.
//
// from/to are the lifecycle states the guarded transition actually moved between,
// passed by the caller that asked for it rather than re-derived here — a trail that
// reads the row after the fact would record the same state twice and tell nothing.
// eventID empty means a platform-wide decision (a fee change, an organiser
// sanction): it has a trail row but no event column to set.
func (s *Service) afterTransition(ctx context.Context, actorID, eventID, action string, from, to EventState, note string) error {
	if !s.commerceReads {
		return nil
	}
	// actor_id is NOT NULL and FK-bound in the trail: an unattributable governance
	// decision is a bug at the call site, not a row to write with a hole in it.
	if actorID == "" {
		return fmt.Errorf("%w: events: a governance decision must name its actor", ErrValidation)
	}
	note = clampTrim(note, maxDecisionReasonLen)
	status := moderationStatusFor(action)
	if eventID != "" {
		var q string
		var args []any
		if action == ModerationActSubmit {
			q = `UPDATE events SET moderation_status=$2, moderation_note='', submitted_at=now(),
			            moderation_decided_by=NULL, moderation_decided_at=NULL WHERE id=$1`
			args = []any{eventID, status}
		} else if status != "" {
			q = `UPDATE events SET moderation_status=$2, moderation_note=$3, moderation_decided_by=$4,
			            moderation_decided_at=now() WHERE id=$1`
			args = []any{eventID, status, note, actorID}
		} else { // a suspension moves no review status
			q = `UPDATE events SET moderation_note=$2, moderation_decided_by=$3, moderation_decided_at=now() WHERE id=$1`
			args = []any{eventID, note, actorID}
		}
		if _, err := s.db.Exec(ctx, q, args...); err != nil {
			return fmt.Errorf("events: moderation columns: %w", err)
		}
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO event_moderation_decisions (id, event_id, actor_id, action, from_state, to_state, reason, note)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,'')`,
		uuid.New().String(), nullIfEmpty(eventID), actorID, action, string(from), string(to), note); err != nil {
		return fmt.Errorf("events: moderation trail: %w", err)
	}
	return nil
}

// eventState is the lifecycle state of an event, for callers that must inspect it
// before asking for a guarded transition.
func (s *Service) eventState(ctx context.Context, eventID string) (string, error) {
	if eventID == "" {
		return "", nil
	}
	var state string
	if err := s.db.QueryRow(ctx, `SELECT state FROM events WHERE id=$1`, eventID).Scan(&state); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("events: state lookup: %w", err)
	}
	return state, nil
}

// notifyOrganiser tells an event's organiser the outcome of a review. Best-effort
// by design (notify never fails a caller).
func (s *Service) notifyOrganiser(ctx context.Context, eventID, title, body string) {
	var organiserID string
	if err := s.db.QueryRow(ctx, `SELECT organiser_id FROM events WHERE id=$1`, eventID).Scan(&organiserID); err != nil {
		return
	}
	s.notify(ctx, organiserID, NotifyModeration, title, body, eventID, "", "")
}

// SubmitForReview moves DRAFT -> SUBMITTED and opens a review. With the commerce
// flag on it also stamps submitted_at and sets moderation_status=PENDING; with it
// off it is exactly the pre-commerce transition.
func (s *Service) SubmitForReview(ctx context.Context, organiserID, eventID string) error {
	if err := s.Submit(ctx, organiserID, eventID); err != nil {
		return err
	}
	return s.afterTransition(ctx, organiserID, eventID, ModerationActSubmit, EventDraft, EventSubmitted, "")
}

// ReviewApprove moves SUBMITTED -> APPROVED and records the reviewer.
func (s *Service) ReviewApprove(ctx context.Context, adminID, eventID string) error {
	if err := s.Approve(ctx, adminID, eventID); err != nil {
		return err
	}
	if err := s.afterTransition(ctx, adminID, eventID, ModerationActApprove, EventSubmitted, EventApproved, ""); err != nil {
		return err
	}
	s.notifyOrganiser(ctx, eventID, "Event approved", "Your event passed review and can now be published.")
	return nil
}

// ReviewReject moves SUBMITTED -> DRAFT with moderation_status=REJECTED. The event
// returns to the organiser's draft list rather than to a terminal review state:
// they must be able to fix it and resubmit, and DRAFT is the only state the
// lifecycle permits that from.
func (s *Service) ReviewReject(ctx context.Context, adminID, eventID, reason string) error {
	reason = clampTrim(reason, maxDecisionReasonLen)
	if reason == "" {
		return fmt.Errorf("%w: events: a rejection needs a reason the organiser can act on", ErrValidation)
	}
	if err := s.transition(ctx, eventID, EventSubmitted, EventDraft, nil, "events.reject"); err != nil {
		return err
	}
	if err := s.afterTransition(ctx, adminID, eventID, ModerationActReject, EventSubmitted, EventDraft, reason); err != nil {
		return err
	}
	s.notifyOrganiser(ctx, eventID, "Event rejected", reason)
	return nil
}

// ReviewRequestChanges moves SUBMITTED -> DRAFT asking for edits. Same lifecycle
// shape as a rejection; the distinction is what the organiser is told and that the
// platform expects a resubmission rather than an end.
func (s *Service) ReviewRequestChanges(ctx context.Context, adminID, eventID, note string) error {
	note = clampTrim(note, maxDecisionReasonLen)
	if note == "" {
		return fmt.Errorf("%w: events: requesting changes needs a note", ErrValidation)
	}
	if err := s.transition(ctx, eventID, EventSubmitted, EventDraft, nil, "events.changes_requested"); err != nil {
		return err
	}
	if err := s.afterTransition(ctx, adminID, eventID, ModerationActRequestChanges, EventSubmitted, EventDraft, note); err != nil {
		return err
	}
	s.notifyOrganiser(ctx, eventID, "Changes requested", note)
	return nil
}

// SuspendEvent moves a running event to SUSPENDED and records why. SuspendEvent is
// the governed wrapper around the pre-existing Suspend transition.
func (s *Service) SuspendEvent(ctx context.Context, adminID, eventID, reason string) error {
	reason = clampTrim(reason, maxDecisionReasonLen)
	from, err := s.eventState(ctx, eventID)
	if err != nil {
		return err
	}
	if err := s.Suspend(ctx, adminID, eventID); err != nil {
		return err
	}
	if err := s.afterTransition(ctx, adminID, eventID, ModerationActSuspend, EventState(from), EventSuspended, reason); err != nil {
		return err
	}
	s.notifyOrganiser(ctx, eventID, "Event suspended", reason)
	return nil
}

// ReinstateEvent returns a SUSPENDED event to APPROVED (never straight to LIVE: the
// organiser publishes again, so the decision to sell is theirs and is auditable).
func (s *Service) ReinstateEvent(ctx context.Context, adminID, eventID, reason string) error {
	reason = clampTrim(reason, maxDecisionReasonLen)
	state, err := s.eventState(ctx, eventID)
	if err != nil {
		return err
	}
	if EventState(state) != EventSuspended {
		return ErrNotSuspended
	}
	if err := s.transition(ctx, eventID, EventSuspended, EventApproved, nil, "events.reinstate"); err != nil {
		return err
	}
	if err := s.afterTransition(ctx, adminID, eventID, ModerationActReinstate, EventSuspended, EventApproved, reason); err != nil {
		return err
	}
	s.notifyOrganiser(ctx, eventID, "Event reinstated", reason)
	return nil
}

// ModerationDecision is one row of the trail.
type ModerationDecision struct {
	ID        string    `json:"id"`
	EventID   string    `json:"event_id,omitempty"`
	ActorID   string    `json:"actor_id,omitempty"`
	ActorName string    `json:"actor_name,omitempty"`
	Action    string    `json:"action"`
	FromState string    `json:"from_state,omitempty"`
	ToState   string    `json:"to_state,omitempty"`
	Reason    string    `json:"reason,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// ListModerationDecisions is the trail behind one event. The caller must manage the
// event (organiser or MANAGER); an admin queue uses AdminListModerationDecisions
// with its own RBAC guard, so no service method trusts a bare role claim.
func (s *Service) ListModerationDecisions(ctx context.Context, callerID, eventID string) ([]ModerationDecision, error) {
	if _, err := s.authorizeManage(ctx, callerID, eventID); err != nil {
		return nil, err
	}
	return s.moderationDecisions(ctx, "d.event_id = $1", eventID)
}

// AdminListModerationDecisions reads the trail of any event, for the review console
// (route-guarded by events.moderate).
func (s *Service) AdminListModerationDecisions(ctx context.Context, eventID string) ([]ModerationDecision, error) {
	if eventID == "" {
		return nil, ErrValidation
	}
	return s.moderationDecisions(ctx, "d.event_id = $1", eventID)
}

func (s *Service) moderationDecisions(ctx context.Context, where string, arg any) ([]ModerationDecision, error) {
	rows, err := s.db.Query(ctx, `
		SELECT d.id, COALESCE(d.event_id::text,''), COALESCE(d.actor_id::text,''), COALESCE(up.full_name,''),
		       d.action, d.from_state, d.to_state, d.reason, d.created_at
		  FROM event_moderation_decisions d
		  LEFT JOIN user_profiles up ON up.id = d.actor_id
		 WHERE `+where+`
		 ORDER BY d.created_at DESC, d.id DESC
		 LIMIT 200`, arg)
	if err != nil {
		return nil, fmt.Errorf("events: moderation trail: %w", err)
	}
	defer rows.Close()

	out := []ModerationDecision{}
	for rows.Next() {
		var d ModerationDecision
		if err := rows.Scan(&d.ID, &d.EventID, &d.ActorID, &d.ActorName, &d.Action, &d.FromState,
			&d.ToState, &d.Reason, &d.CreatedAt); err != nil {
			return nil, fmt.Errorf("events: moderation trail scan: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// --- Platform fee ---

// FeeSettings is the platform-wide event fee and who last changed it.
type FeeSettings struct {
	FeeBps    int        `json:"fee_bps"`
	UpdatedBy string     `json:"updated_by,omitempty"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

// GetFeeSettings reads the ops-set fee for the admin screen. A missing row is not
// an error: the migration seeds it, and an unseeded database still gets the
// documented default the create path uses.
func (s *Service) GetFeeSettings(ctx context.Context) (*FeeSettings, error) {
	var (
		out FeeSettings
		by  *string
	)
	err := s.db.QueryRow(ctx, `SELECT fee_bps, updated_by::text, updated_at FROM event_fee_settings WHERE id = 1`).
		Scan(&out.FeeBps, &by, &out.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return &FeeSettings{FeeBps: defaultFeeBps}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("events: fee settings: %w", err)
	}
	if by != nil {
		out.UpdatedBy = *by
	}
	return &out, nil
}

// SetFeeBps changes the platform fee. It affects settlement from the next purchase
// onward; existing orders and refunds keep the fee they were quoted at, because the
// split is snapshotted on those rows (event_refunds.fee_kobo, event_orders).
//
// The route is RBAC-gated (events.fees, super-admin only). A new event's fee is read
// from here at create time, so the value must be validated, not clamped: a silently
// truncated rate would misprice every event created afterwards.
func (s *Service) SetFeeBps(ctx context.Context, adminID string, bps int, reason string) (*FeeSettings, error) {
	if adminID == "" {
		return nil, ErrValidation
	}
	if bps < 0 || bps > 10000 {
		return nil, fmt.Errorf("%w: events: fee_bps must be between 0 and 10000", ErrValidation)
	}
	reason = clampTrim(reason, maxDecisionReasonLen)
	tag, err := s.db.Exec(ctx,
		`UPDATE event_fee_settings SET fee_bps=$1, updated_by=$2, updated_at=now() WHERE id=1`,
		bps, adminID)
	if err != nil {
		return nil, fmt.Errorf("events: set fee: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Nothing seeded yet: create the singleton so the first read is the value that
		// was set, not the fallback default.
		if _, err := s.db.Exec(ctx,
			`INSERT INTO event_fee_settings (id, fee_bps, updated_by, updated_at) VALUES (1,$1,$2,now())
			 ON CONFLICT (id) DO NOTHING`, bps, adminID); err != nil {
			return nil, fmt.Errorf("events: seed fee settings: %w", err)
		}
	}
	if err := s.afterTransition(ctx, adminID, "", ModerationActFeeSet, "", "",
		fmt.Sprintf("fee_bps=%d %s", bps, reason)); err != nil {
		return nil, err
	}
	s.log(adminID, "events.fee.set", "platform", map[string]any{"fee_bps": bps, "reason": reason})
	return s.GetFeeSettings(ctx)
}

// --- Organiser sanctions ---

// OrganiserSanction is the platform's standing decision about an organiser account.
// An absent row means in good standing (organiser_profiles is created lazily, so it
// could not carry this).
type OrganiserSanction struct {
	OrganiserID string     `json:"organiser_id"`
	Name        string     `json:"name,omitempty"`
	Suspended   bool       `json:"suspended"`
	Reason      string     `json:"reason,omitempty"`
	DecidedBy   string     `json:"decided_by,omitempty"`
	DecidedAt   *time.Time `json:"decided_at,omitempty"`

	// Standing, for the admin list: what the organiser currently has running.
	EventTotal  int `json:"event_total"`
	EventLive   int `json:"event_live"`
	UnderReview int `json:"event_under_review"`
	TicketsSold int `json:"tickets_sold"`
}

// SanctionOrganiser suspends or reinstates an organiser account. A suspension stops
// the account from creating, duplicating, submitting or publishing events (checked
// in requireOrganiser, so every gated path gets it); it does not silently pull live
// events off sale — suspending an event is a separate, per-event decision the admin
// makes explicitly, because buyers already hold tickets for it.
func (s *Service) SanctionOrganiser(ctx context.Context, adminID, organiserID string, suspend bool, reason string) (*OrganiserSanction, error) {
	if adminID == "" || organiserID == "" {
		return nil, ErrValidation
	}
	reason = clampTrim(reason, maxDecisionReasonLen)
	if suspend && reason == "" {
		return nil, fmt.Errorf("%w: events: suspending an organiser needs a stated reason", ErrValidation)
	}
	if _, err := uuid.Parse(organiserID); err != nil {
		return nil, ErrNotFound
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO event_organiser_sanctions (organiser_id, suspended, reason, decided_by, decided_at, updated_at)
		 VALUES ($1,$2,$3,$4,now(),now())
		 ON CONFLICT (organiser_id) DO UPDATE
		   SET suspended=EXCLUDED.suspended, reason=EXCLUDED.reason,
		       decided_by=EXCLUDED.decided_by, decided_at=EXCLUDED.decided_at, updated_at=EXCLUDED.updated_at`,
		organiserID, suspend, reason, adminID); err != nil {
		return nil, fmt.Errorf("events: sanction organiser: %w", err)
	}
	action := ModerationActReinstate
	title := "Organiser account reinstated"
	if suspend {
		action = ModerationActSuspend
		title = "Organiser account suspended"
	}
	if err := s.afterTransition(ctx, adminID, "", action, "", "",
		fmt.Sprintf("organiser=%s %s", organiserID, reason)); err != nil {
		return nil, err
	}
	s.log(adminID, "events.organiser.sanction", organiserID, map[string]any{"suspended": suspend, "reason": reason})
	s.notify(ctx, organiserID, NotifyModeration, title, reason, "", "", "")
	return s.GetOrganiserSanction(ctx, organiserID)
}

// GetOrganiserSanction reads one organiser's standing (and their event counts). An
// organiser with no events and no sanction row still returns: "in good standing,
// nothing running" is the answer the register needs, not a 404.
func (s *Service) GetOrganiserSanction(ctx context.Context, organiserID string) (*OrganiserSanction, error) {
	// The $1::uuid casts below would raise a 42846/22P02 for a malformed id; a bad
	// id is a 404 (there is no such organiser), not a server fault.
	if _, err := uuid.Parse(organiserID); err != nil {
		return nil, ErrNotFound
	}
	out := &OrganiserSanction{OrganiserID: organiserID}
	err := s.db.QueryRow(ctx, `
		SELECT COALESCE(up.full_name,''),
		       COALESCE(ss.suspended, false), COALESCE(ss.reason,''), COALESCE(ss.decided_by::text,''), ss.decided_at,
		       COUNT(e.id),
		       COUNT(e.id) FILTER (WHERE e.state = 'LIVE'),
		       COUNT(e.id) FILTER (WHERE e.state IN ('SUBMITTED','APPROVED')),
		       COALESCE((SELECT SUM(t.sold) FROM event_ticket_tiers t WHERE t.event_id IN
		                  (SELECT id FROM events WHERE organiser_id = $1)), 0)
		  FROM (SELECT $1::uuid AS id) q
		  LEFT JOIN public.user_profiles up ON up.id = q.id
		  LEFT JOIN public.events e ON e.organiser_id = q.id
		  LEFT JOIN public.event_organiser_sanctions ss ON ss.organiser_id = q.id
		 GROUP BY up.full_name, ss.suspended, ss.reason, ss.decided_by, ss.decided_at`, organiserID).
		Scan(&out.Name, &out.Suspended, &out.Reason, &out.DecidedBy, &out.DecidedAt,
			&out.EventTotal, &out.EventLive, &out.UnderReview, &out.TicketsSold)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("events: organiser standing: %w", err)
	}
	return out, nil
}

// ListOrganiserSanctions is the admin's organiser register: everyone who has ever
// owned an event, with their standing and counts, suspended first.
func (s *Service) ListOrganiserSanctions(ctx context.Context, q string, limit, offset int) ([]OrganiserSanction, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	args := []any{}
	where := ""
	if term := clampTrim(q, 100); term != "" {
		args = append(args, "%"+term+"%")
		where = `WHERE COALESCE(up.full_name,'') ILIKE $1 OR o.organiser_id::text = $1`
	}
	rows, err := s.db.Query(ctx, `
		SELECT o.organiser_id, COALESCE(up.full_name,''),
		       COALESCE(ss.suspended, false), COALESCE(ss.reason,''), COALESCE(ss.decided_by::text,''), ss.decided_at,
		       o.event_total, o.live_total, o.review_total
		  FROM (SELECT organiser_id, COUNT(*) AS event_total,
		               COUNT(*) FILTER (WHERE state='LIVE') AS live_total,
		               COUNT(*) FILTER (WHERE state IN ('SUBMITTED','APPROVED')) AS review_total
		          FROM events GROUP BY organiser_id) o
		  LEFT JOIN public.user_profiles up ON up.id = o.organiser_id
		  LEFT JOIN public.event_organiser_sanctions ss ON ss.organiser_id = o.organiser_id
		  `+where+`
		 ORDER BY COALESCE(ss.suspended, false) DESC, o.event_total DESC, o.organiser_id
		 LIMIT $`+fmt.Sprint(len(args)+1)+` OFFSET $`+fmt.Sprint(len(args)+2),
		append(args, limit, offset)...)
	if err != nil {
		return nil, fmt.Errorf("events: organiser register: %w", err)
	}
	defer rows.Close()

	out := []OrganiserSanction{}
	for rows.Next() {
		var r OrganiserSanction
		if err := rows.Scan(&r.OrganiserID, &r.Name, &r.Suspended, &r.Reason, &r.DecidedBy, &r.DecidedAt,
			&r.EventTotal, &r.EventLive, &r.UnderReview); err != nil {
			return nil, fmt.Errorf("events: organiser register scan: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// isOrganiserSuspended is the suspension check requireOrganiser adds. A missing row
// is in good standing; a read error fails closed (the caller cannot organise),
// because a sanction the module cannot confirm is not a sanction that is absent.
func (s *Service) isOrganiserSuspended(ctx context.Context, organiserID string) (bool, error) {
	var suspended bool
	err := s.db.QueryRow(ctx, `SELECT suspended FROM event_organiser_sanctions WHERE organiser_id = $1::uuid`, organiserID).Scan(&suspended)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("events: organiser sanction lookup: %w", err)
	}
	return suspended, nil
}

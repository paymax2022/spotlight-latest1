package association

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
)

const (
	valSuspended = "SUSPENDED"
	valActive    = "ACTIVE"
	valOverdue   = "OVERDUE"
)

// Gap-fill service methods: single-record detail reads, partial profile update,
// admin audit-log read, ai-note summary regeneration, and chat message
// reactions. All are DB-backed (persist / read the assoc_* schema). Admin
// mutations write an assoc_audit_log row; detail reads are scoped to the
// caller's organisation membership. Amounts remain kobo. Separate file to limit
// merge surface.

// GetAnnouncement returns one announcement (full body) visible to the caller.
func (s *Service) GetAnnouncement(ctx context.Context, userID, id string) (*AnnouncementDetail, error) {
	var d AnnouncementDetail
	const q = `
		SELECT a.id, a.title, COALESCE(a.body,''), COALESCE(a.audience,''), a.posted_at::text,
		       COALESCE(a.author,''), a.urgent, a.requires_ack,
		       EXISTS(SELECT 1 FROM assoc_announcement_reads r WHERE r.announcement_id=a.id AND r.membership_id=m.id AND r.read_at IS NOT NULL),
		       EXISTS(SELECT 1 FROM assoc_announcement_reads r WHERE r.announcement_id=a.id AND r.membership_id=m.id AND r.acknowledged_at IS NOT NULL)
		FROM assoc_announcements a
		JOIN assoc_memberships m ON m.organisation_id=a.organisation_id
		WHERE a.id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
		LIMIT 1`
	if err := s.db.QueryRow(ctx, q, id, userID).Scan(
		&d.ID, &d.Title, &d.Body, &d.Audience, &d.PostedAt,
		&d.Author, &d.Urgent, &d.RequiresAck, &d.Read, &d.Acknowledged,
	); err != nil {
		return nil, fmt.Errorf("association: announcement not found: %w", err)
	}
	d.Preview = d.Body
	if len(d.Preview) > 120 {
		d.Preview = d.Preview[:120]
	}
	return &d, nil
}

// GetMeeting returns one meeting with the caller's RSVP/attendance state.
func (s *Service) GetMeeting(ctx context.Context, userID, id string) (*MeetingDetail, error) {
	var d MeetingDetail
	var agenda []byte
	var rsvp *string
	var checkedIn bool
	const q = `
		SELECT mt.id, mt.title, mt.mode, mt.starts_at::text, mt.ends_at::text, mt.location,
		       CASE WHEN mt.starts_at > now() THEN 'UPCOMING'
		            WHEN mt.ends_at IS NULL OR mt.ends_at > now() THEN 'LIVE'
		            ELSE 'PAST' END,
		       (SELECT count(*) FROM assoc_meeting_attendance ma WHERE ma.meeting_id=mt.id),
		       COALESCE(mt.description,''), mt.agenda,
		       att.rsvp, (att.checked_in_at IS NOT NULL)
		FROM assoc_meetings mt
		JOIN assoc_memberships m ON m.organisation_id=mt.organisation_id
		LEFT JOIN assoc_meeting_attendance att ON att.meeting_id=mt.id AND att.membership_id=m.id
		WHERE mt.id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
		LIMIT 1`
	if err := s.db.QueryRow(ctx, q, id, userID).Scan(
		&d.ID, &d.Title, &d.Mode, &d.StartsAt, &d.EndsAt, &d.Location,
		&d.State, &d.AttendeeCount, &d.Description, &agenda, &rsvp, &checkedIn,
	); err != nil {
		return nil, fmt.Errorf("association: meeting not found: %w", err)
	}
	scanJSONB(agenda, &d.Agenda)
	if d.Agenda == nil {
		d.Agenda = []map[string]any{}
	}
	d.MyRsvp = rsvp
	d.CheckedIn = checkedIn
	return &d, nil
}

// GetTask returns one task assigned to (or in the org of) the caller.
func (s *Service) GetTask(ctx context.Context, userID, id string) (*TaskDetail, error) {
	var d TaskDetail
	var checklist []byte
	const q = `
		SELECT t.id, t.title, t.status, t.priority, t.due_date::text,
		       COALESCE(mp.full_name,'Unassigned'), c.name,
		       COALESCE(t.description,''), t.checklist
		FROM assoc_tasks t
		JOIN assoc_memberships viewer ON viewer.user_id=$2 AND viewer.organisation_id=t.organisation_id AND viewer.status='ACTIVE'
		LEFT JOIN assoc_memberships ma ON ma.id=t.assignee_id
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=ma.id
		LEFT JOIN assoc_committees c ON c.id=t.committee_id
		WHERE t.id=$1
		LIMIT 1`
	if err := s.db.QueryRow(ctx, q, id, userID).Scan(
		&d.ID, &d.Title, &d.Status, &d.Priority, &d.DueDate,
		&d.AssigneeName, &d.Committee, &d.Description, &checklist,
	); err != nil {
		return nil, fmt.Errorf("association: task not found: %w", err)
	}
	scanJSONB(checklist, &d.Checklist)
	if d.Checklist == nil {
		d.Checklist = []map[string]any{}
	}
	return &d, nil
}

// GetDocument returns one document's metadata for the caller's organisation.
func (s *Service) GetDocument(ctx context.Context, userID, id string) (*DocumentDetail, error) {
	var d DocumentDetail
	const q = `
		SELECT d.id, d.title, d.category, d.kind, COALESCE(d.size_label,''), d.updated_at::text,
		       d.restricted, d.requires_ack,
		       EXISTS(SELECT 1 FROM assoc_document_acks a WHERE a.document_id=d.id AND a.membership_id=m.id),
		       d.version, COALESCE(d.ai_summary,''), d.storage_key
		FROM assoc_documents d
		JOIN assoc_memberships m ON m.organisation_id=d.organisation_id
		WHERE d.id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
		LIMIT 1`
	if err := s.db.QueryRow(ctx, q, id, userID).Scan(
		&d.ID, &d.Title, &d.Category, &d.Kind, &d.SizeLabel, &d.UpdatedAt,
		&d.Restricted, &d.RequiresAck, &d.Acknowledged,
		&d.Version, &d.AiSummary, &d.StorageKey,
	); err != nil {
		return nil, fmt.Errorf("association: document not found: %w", err)
	}
	return &d, nil
}

// GetCommittee returns one committee with its member roster for the caller's org.
func (s *Service) GetCommittee(ctx context.Context, userID, id string) (*CommitteeDetail, error) {
	var d CommitteeDetail
	const q = `
		SELECT c.id, c.name, COALESCE(c.purpose,''),
		       (SELECT count(*) FROM assoc_committee_members cm WHERE cm.committee_id=c.id),
		       COALESCE((SELECT cm2.status FROM assoc_committee_members cm2
		                 JOIN assoc_memberships m2 ON m2.id=cm2.membership_id
		                 WHERE cm2.committee_id=c.id AND m2.user_id=$2 LIMIT 1),'NONE'),
		       (SELECT cm3.role FROM assoc_committee_members cm3
		        JOIN assoc_memberships m3 ON m3.id=cm3.membership_id
		        WHERE cm3.committee_id=c.id AND m3.user_id=$2 LIMIT 1)
		FROM assoc_committees c
		JOIN assoc_memberships m ON m.organisation_id=c.organisation_id
		WHERE c.id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
		LIMIT 1`
	if err := s.db.QueryRow(ctx, q, id, userID).Scan(
		&d.ID, &d.Name, &d.Purpose, &d.MemberCount, &d.JoinStatus, &d.MyRole,
	); err != nil {
		return nil, fmt.Errorf("association: committee not found: %w", err)
	}
	d.Members = []CommitteeMemberEntry{}
	rows, err := s.db.Query(ctx, `
		SELECT cm.membership_id, COALESCE(mp.full_name,''), cm.role, cm.status, mp.photo_url
		FROM assoc_committee_members cm
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=cm.membership_id
		WHERE cm.committee_id=$1
		ORDER BY cm.role, mp.full_name LIMIT 200`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var e CommitteeMemberEntry
			if err := rows.Scan(&e.MembershipID, &e.FullName, &e.Role, &e.Status, &e.PhotoURL); err == nil {
				d.Members = append(d.Members, e)
			}
		}
	}
	return &d, nil
}

// GetEvent returns one event with the caller's RSVP/registration state.
func (s *Service) GetEvent(ctx context.Context, userID, id string) (*EventDetail, error) {
	var d EventDetail
	var rsvp, ticket *string
	var registered bool
	const q = `
		SELECT e.id, e.title, e.starts_at::text, COALESCE(e.location,''),
		       CASE WHEN e.starts_at > now() THEN 'UPCOMING' ELSE 'PAST' END,
		       e.paid, e.fee_kobo, e.cover_url,
		       COALESCE(e.description,''), e.ends_at::text, e.capacity, e.organiser,
		       er.rsvp, COALESCE(er.registered,false), er.ticket_code
		FROM assoc_events e
		JOIN assoc_memberships m ON m.organisation_id=e.organisation_id
		LEFT JOIN assoc_event_registrations er ON er.event_id=e.id AND er.membership_id=m.id
		WHERE e.id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
		LIMIT 1`
	if err := s.db.QueryRow(ctx, q, id, userID).Scan(
		&d.ID, &d.Title, &d.StartsAt, &d.Location, &d.State,
		&d.Paid, &d.FeeKobo, &d.CoverURL,
		&d.Description, &d.EndsAt, &d.Capacity, &d.Organiser,
		&rsvp, &registered, &ticket,
	); err != nil {
		return nil, fmt.Errorf("association: event not found: %w", err)
	}
	d.MyRsvp = rsvp
	d.Registered = registered
	d.TicketCode = ticket
	if registered {
		d.EventSummary.Registered = true
	}
	return &d, nil
}

// UpdateProfile applies a partial update to the caller's member profile and
// returns the refreshed profile. Only non-nil fields are written.
func (s *Service) UpdateProfile(ctx context.Context, userID string, in UpdateProfileInput) (*MyProfile, error) {
	mid, err := s.profileMembershipID(ctx, userID)
	if err != nil {
		return nil, err
	}
	// COALESCE keeps the existing value when the incoming field is nil, so this
	// is a genuine partial update (no accidental blanking).
	var emergency, nextOfKin []byte
	if in.Emergency != nil {
		if emergency, err = json.Marshal(*in.Emergency); err != nil {
			return nil, fmt.Errorf("association: marshal emergency: %w", err)
		}
	}
	if in.NextOfKin != nil {
		if nextOfKin, err = json.Marshal(*in.NextOfKin); err != nil {
			return nil, fmt.Errorf("association: marshal next_of_kin: %w", err)
		}
	}
	const q = `
		UPDATE assoc_member_profiles SET
			phone      = COALESCE($2, phone),
			profession = COALESCE($3, profession),
			location   = COALESCE($4, location),
			bio        = COALESCE($5, bio),
			photo_url  = COALESCE($6, photo_url),
			emergency  = COALESCE($7::jsonb, emergency),
			next_of_kin= COALESCE($8::jsonb, next_of_kin),
			updated_at = now()
		WHERE membership_id=$1`
	var emg, nok any
	if emergency != nil {
		emg = emergency
	}
	if nextOfKin != nil {
		nok = nextOfKin
	}
	if _, err := s.db.Exec(ctx, q, mid, in.Phone, in.Profession, in.Location, in.Bio, in.PhotoURL, emg, nok); err != nil {
		return nil, fmt.Errorf("association: update profile: %w", err)
	}
	return s.GetProfile(ctx, userID)
}

// GetAuditLog returns recent audit entries scoped to the resolved org (see
// resolveOrgID; plus org-less entries the admin actioned), optionally
// filtered by action.
func (s *Service) GetAuditLog(ctx context.Context, adminID, action, orgIDOverride string) ([]AuditLogEntry, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	orgID, err := s.resolveOrgID(ctx, adminID, orgIDOverride)
	if err != nil {
		return nil, err
	}
	// Strictly org-scoped. The `OR actor_id=$2` disjunction that used to be here
	// defeated the org filter entirely: selecting org A returned org B's rows
	// whenever the same admin had acted in both. It existed only because eight
	// audit call sites wrote a NULL organisation_id; those now pass their real
	// org, so the filter can be exact.
	q := `
		SELECT a.id, COALESCE(a.actor_id::text,''), a.action, COALESCE(a.subject_type,''),
		       COALESCE(a.subject_id,''), a.metadata, a.created_at::text,
		       COALESCE(NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''), u.email, 'System')
		FROM assoc_audit_log a
		LEFT JOIN platform_users u ON u.id = a.actor_id
		WHERE a.organisation_id=$1`
	args := []any{orgID}
	if action != "" && action != "all" && action != "ALL" {
		args = append(args, action)
		q += fmt.Sprintf(` AND a.action=$%d`, len(args))
	}
	q += ` ORDER BY a.created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("association: audit log: %w", err)
	}
	defer rows.Close()
	out := []AuditLogEntry{}
	for rows.Next() {
		var e AuditLogEntry
		var meta []byte
		if err := rows.Scan(&e.ID, &e.ActorID, &e.Action, &e.SubjectType, &e.SubjectID, &meta, &e.CreatedAt, &e.ActorName); err != nil {
			// A scan failure here used to be swallowed, which silently dropped the
			// row from the caller's list; surface it instead (matches GetEvents).
			return nil, fmt.Errorf("association: audit log: scan: %w", err)
		}
		e.At = e.CreatedAt
		e.Summary = auditActionLabel(e.Action)
		e.Subject = strings.TrimSpace(e.SubjectType + " " + e.SubjectID)
		scanJSONB(meta, &e.Metadata)
		if e.Metadata == nil {
			e.Metadata = map[string]any{}
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// RegenerateAiNoteSummary re-queues a note for summary generation (PROCESSING)
// and audits the request. Idempotent: safe to call repeatedly.
func (s *Service) RegenerateAiNoteSummary(ctx context.Context, adminID, noteID string) error {
	// Authorization (was previously ABSENT — any authenticated user could flip
	// any organisation's minutes back to PROCESSING and write an audit row in
	// their own name). Mirrors SetAiNoteStatus: resolve the note's org, then
	// require an admin OF THAT ORG. Fail-closed; a missing note is "not found".
	var noteOrg string
	if err := s.db.QueryRow(ctx, `SELECT organisation_id FROM assoc_ai_notes WHERE id=$1`, noteID).Scan(&noteOrg); err != nil {
		return fmt.Errorf("association: ai note not found: %w", err)
	}
	if err := s.requireAdminInOrg(ctx, adminID, noteOrg); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE assoc_ai_notes SET status='PROCESSING' WHERE id=$1`, noteID)
	if err != nil {
		return fmt.Errorf("association: regenerate ai note: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("association: ai note not found")
	}
	if err := s.audit(ctx, tx, noteOrg, adminID, "MINUTES_REGENERATE", "ai_note", noteID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ReactToMessage toggles the caller's emoji reaction on a chat message. A
// repeated call with the same emoji removes it (toggle). Persisted in
// assoc_chat_message_reactions.
func (s *Service) ReactToMessage(ctx context.Context, userID, threadID, messageID, emoji string) error {
	mid, _, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return err
	}
	// Object-level + cross-group check (CH-005 / §4.9): the message must belong to
	// the named thread AND the caller must hold an ACTIVE membership in the thread's
	// organisation. A foreign-org caller is rejected (fail-closed) before any write.
	var owned bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM assoc_chat_messages msg
			JOIN assoc_chat_threads t ON t.id = msg.thread_id
			JOIN assoc_memberships v ON v.organisation_id = t.organisation_id
			WHERE msg.id=$1 AND msg.thread_id=$2 AND v.user_id=$3 AND v.status='ACTIVE')`,
		messageID, threadID, userID).Scan(&owned); err != nil || !owned {
		return ErrForbidden
	}
	// Toggle: delete if the exact (message, member, emoji) reaction exists, else insert.
	tag, err := s.db.Exec(ctx,
		`DELETE FROM assoc_chat_message_reactions WHERE message_id=$1 AND membership_id=$2 AND emoji=$3`,
		messageID, mid, emoji)
	if err != nil {
		return fmt.Errorf("association: react (remove): %w", err)
	}
	if tag.RowsAffected() > 0 {
		return nil // reaction removed
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO assoc_chat_message_reactions (message_id, membership_id, emoji)
		 VALUES ($1,$2,$3) ON CONFLICT (message_id, membership_id, emoji) DO NOTHING`,
		messageID, mid, emoji); err != nil {
		return fmt.Errorf("association: react (add): %w", err)
	}
	return nil
}

// Membership-card QR verification (MC-003/004/005). The QR is a compact,
// HMAC-signed token so a scanned card is tamper-evident and verifiable
// server-side. Format:
//
//	AMC1.<b64url(payload)>.<b64url(hmac_sha256(key, "AMC1."+b64url(payload)))>
//
// payload = {"m":membershipID,"c":memberCode,"o":orgID,"t":issuedUnix}. The token
// authenticates card authenticity; VerifyCard then does a LIVE status/standing
// lookup, so a revoked/expired/arrears card fails even with a genuine signature.
const cardTokenVersion = "AMC1"

// defaultDevCardKey is a fixed dev/local signing key. Production wiring MUST call
// SetCardSigningSecret to override it; if it isn't, cards signed on one host will
// still verify on another only while both use this default (dev convenience).
var defaultDevCardKey = func() []byte {
	sum := sha256.Sum256([]byte("assoc-card-hmac-dev-key-v1"))
	return sum[:]
}()

// SetCardSigningSecret derives the card HMAC key from a server secret (SHA-256,
// domain-separated). An empty secret is ignored so a misconfiguration cannot
// silently switch every card over to an empty-key signature.
func (s *Service) SetCardSigningSecret(secret string) {
	if strings.TrimSpace(secret) == "" {
		return
	}
	sum := sha256.Sum256([]byte("assoc-card-hmac-v1|" + secret))
	s.cardKey = sum[:]
}

func (s *Service) cardSigningKey() []byte {
	if len(s.cardKey) == 0 {
		return defaultDevCardKey
	}
	return s.cardKey
}

type cardTokenPayload struct {
	M string `json:"m"` // membership id (uuid) — the verify lookup key
	C string `json:"c"` // member code (display)
	O string `json:"o"` // organisation id
	T int64  `json:"t"` // issued-at, unix seconds
}

func (s *Service) signCardData(signingInput string) string {
	mac := hmac.New(sha256.New, s.cardSigningKey())
	mac.Write([]byte(signingInput))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// SignCardToken produces a signed QR token for a membership. Exported so GetCard
// and tests share one implementation.
func (s *Service) SignCardToken(membershipID, memberCode, orgID string) string {
	raw, _ := json.Marshal(cardTokenPayload{M: membershipID, C: memberCode, O: orgID, T: time.Now().Unix()})
	signingInput := cardTokenVersion + "." + base64.RawURLEncoding.EncodeToString(raw)
	return signingInput + "." + s.signCardData(signingInput)
}

// parseAndVerifyCardToken validates the token's structure + HMAC (constant-time)
// and returns the decoded payload. Fail-closed on any structural/signature error.
func (s *Service) parseAndVerifyCardToken(token string) (*cardTokenPayload, bool) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 || parts[0] != cardTokenVersion {
		return nil, false
	}
	signingInput := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(s.signCardData(signingInput)), []byte(parts[2])) {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	var p cardTokenPayload
	if err := json.Unmarshal(raw, &p); err != nil || p.M == "" {
		return nil, false
	}
	return &p, true
}

// VerifyCard authenticates a scanned card QR token and returns the member's LIVE
// verification result. A structurally/cryptographically invalid token yields
// {Valid:false, Reason:"INVALID_SIGNATURE"} (a normal verification outcome, not an
// error). Only a DB failure returns an error. Because the status/standing is read
// live, a revoked/expired/arrears card fails even with a genuine signature
// (MC-002/004/005, EC-007).
func (s *Service) VerifyCard(ctx context.Context, token string) (*CardVerification, error) {
	res := &CardVerification{VerifiedAt: time.Now().UTC().Format(time.RFC3339)}
	p, ok := s.parseAndVerifyCardToken(token)
	if !ok {
		res.Reason = "INVALID_SIGNATURE"
		return res, nil
	}
	const q = `
		SELECT m.member_code, m.status, m.payment_standing,
		       (m.valid_through IS NOT NULL AND m.valid_through < now()) AS expired,
		       m.valid_through::text,
		       COALESCE(mp.full_name,''), o.name, o.acronym, COALESCE(mc.label,'Member')
		FROM assoc_memberships m
		JOIN assoc_organisations o ON o.id=m.organisation_id
		LEFT JOIN assoc_membership_categories mc ON mc.id=m.category_id
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		WHERE m.id=$1`
	var expired bool
	if err := s.db.QueryRow(ctx, q, p.M).Scan(
		&res.MemberID, &res.Status, &res.PaymentStanding, &expired, &res.ValidThrough,
		&res.FullName, &res.OrganisationName, &res.OrganisationAcronym, &res.CategoryLabel,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			res.Reason = "NOT_FOUND"
			return res, nil
		}
		return nil, fmt.Errorf("association: verify card lookup: %w", err)
	}

	// Authentic signature is necessary but NOT sufficient — the live record decides.
	switch {
	case res.Status == valSuspended:
		res.Reason = valSuspended
	case res.Status == "EXPIRED" || expired:
		res.Reason = "EXPIRED"
	case res.Status != valActive:
		res.Reason = "REVOKED"
	case res.PaymentStanding == valOverdue:
		res.Reason = "ARREARS"
	default:
		res.Valid = true
	}
	return res, nil
}

package claims

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// refSpec describes one of the three referral-like tables behind a common shape.
type refSpec struct {
	kind        string
	table       string
	alias       string
	counterpart string // SQL expression
	reason      string // SQL expression
	extraWhere  string // SQL fragment starting with AND, or ""
}

var (
	specOutgoing = refSpec{
		kind: "outgoing", table: "doctor_referrals", alias: "r",
		counterpart: `COALESCE(r.specialist_id, '')`, reason: `COALESCE(left(r.reason, 300), '')`,
		extraWhere: ` AND r.direction = 'outgoing'`,
	}
	specIncoming = refSpec{
		kind: "incoming", table: "doctor_incoming_referrals", alias: "r",
		counterpart: `COALESCE(r.referring_doctor, '')`, reason: `COALESCE(left(r.reason, 300), '')`,
	}
	specOpinion = refSpec{
		kind: "opinion", table: "doctor_opinion_requests", alias: "r",
		counterpart: `''`, reason: `COALESCE(left(r.question, 300), '')`,
	}
)

func (sp refSpec) cols() string {
	return `r.id::text, r.user_id::text, COALESCE(d.name, 'Unknown clinician'), ` + sp.counterpart +
		`, r.patient_id, r.status, ` + sp.reason + `, r.created_at, r.updated_at`
}

func (sp refSpec) scan(row pgx.Row, extra ...any) (Referral, error) {
	var rf Referral
	var pid *string
	dest := append([]any{&rf.ID, &rf.DoctorUserID, &rf.DoctorName, &rf.Counterpart, &pid, &rf.Status, &rf.Reason, &rf.CreatedAt, &rf.UpdatedAt}, extra...)
	err := row.Scan(dest...)
	rf.Kind = sp.kind
	rf.PatientMasked = maskPatient(pid)
	return rf, err
}

func (s *store) listReferrals(ctx context.Context, sp refSpec, q ListQuery) ([]Referral, int, error) {
	where := `WHERE ($1::text = '' OR r.status = $1)
		AND ($2::text = '' OR d.name ILIKE $2` + likeEscape + ` OR r.id::text ILIKE $2` + likeEscape + `)` + sp.extraWhere
	from := ` FROM ` + sp.table + ` r ` + join("r") + ` `
	pat := searchPattern(q.Q)
	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*)`+from+where, q.Status, pat).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("claims: count %s: %w", sp.kind, err)
	}
	rows, err := s.db.Query(ctx, `SELECT `+sp.cols()+from+where+` ORDER BY r.created_at DESC LIMIT $3 OFFSET $4`,
		q.Status, pat, q.Limit, q.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("claims: list %s: %w", sp.kind, err)
	}
	defer rows.Close()
	out := []Referral{}
	for rows.Next() {
		rf, err := sp.scan(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("claims: scan %s: %w", sp.kind, err)
		}
		out = append(out, rf)
	}
	return out, total, rows.Err()
}

func (s *store) getReferral(ctx context.Context, sp refSpec, id string) (*ReferralDetail, error) {
	if !validID(id) {
		return nil, ErrNotFound
	}
	var raw []byte
	rf, err := sp.scan(s.db.QueryRow(ctx,
		`SELECT `+sp.cols()+`, r.detail FROM `+sp.table+` r `+join("r")+` WHERE r.id = $1`+sp.extraWhere, id), &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("claims: get %s: %w", sp.kind, err)
	}
	return &ReferralDetail{Referral: rf, Detail: sanitizeDetail(raw)}, nil
}

func (s *store) referralsSummary(ctx context.Context) (*ReferralsSummary, error) {
	var out ReferralsSummary
	var err error
	if out.OutgoingByStatus, out.OutgoingTotal, err = s.groupCounts(ctx,
		`SELECT status, COUNT(*)::int FROM doctor_referrals WHERE direction = 'outgoing' GROUP BY status`); err != nil {
		return nil, fmt.Errorf("claims: summary outgoing: %w", err)
	}
	if out.IncomingByStatus, out.IncomingTotal, err = s.groupCounts(ctx,
		`SELECT status, COUNT(*)::int FROM doctor_incoming_referrals GROUP BY status`); err != nil {
		return nil, fmt.Errorf("claims: summary incoming: %w", err)
	}
	if out.OpinionsByStatus, out.OpinionsTotal, err = s.groupCounts(ctx,
		`SELECT status, COUNT(*)::int FROM doctor_opinion_requests GROUP BY status`); err != nil {
		return nil, fmt.Errorf("claims: summary opinions: %w", err)
	}
	return &out, nil
}

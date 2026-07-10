package feesadminapi

// Package feesadminapi provides the READ-HEAVY admin oversight surface for the EdTech
// School-Fees module — the flat /api/academy/admin/fees/* namespace the school-admin
// console (frontend-admin/src/services/academyFeesService.ts) calls. These are
// list/aggregate views ACROSS schools (or filtered by ?schoolId=), distinct from the
// member per-school nested routes under /api/finance/academy/*.
//
// It owns NO money path: every mutation that moves money or advances a guarded state
// machine already lives in the per-school member/admin packages (feesschedule,
// feespromotion, feesexport, …). This package only reads the existing academy_fees
// tables (migrations 20260918000000 + 20260918000100) and adds two thin, low-risk
// config mutations that have real backing tables:
//   - create a DRAFT fee schedule (feeschedule.create), and lock/issue it (SF-1),
//   - set a per-category government-export opt-in (academy_school_compliance_optins).
//
// All monetary amounts are integers in minor units (kobo). Response DTOs use snake_case
// JSON tags to match the console's mock fixtures verbatim (see handler.go), and every
// list is returned inside the gin.H{"data": …} envelope used by the sibling fees handlers.

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is a pgx-backed reader over the academy_fees tables. It is intentionally
// query-only plus the two config writes noted above; no ledger, no balance mutation.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository builds the admin oversight repository.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// ── Schools directory (SU-01) ─────────────────────────────────────────────────
// Reads public.academy_schools (base cols + fees extension: verification_tier, level,
// owner_user_id). owner_email / bank_account / state are NOT columns on this table, so
// they are omitted (the console's types mark them optional).

func (r *Repository) ListSchools(ctx context.Context) ([]School, error) {
	const q = `
		SELECT s.id, s.name, COALESCE(s.verification_tier,'unverified'), s.status, s.created_at
		FROM public.academy_schools s
		ORDER BY s.created_at DESC`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []School{}
	for rows.Next() {
		var s School
		if err := rows.Scan(&s.ID, &s.Name, &s.VerificationTier, &s.Status, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── Sessions ──────────────────────────────────────────────────────────────────
// Reads public.academy_sessions. schoolID optional filter.

func (r *Repository) ListSessions(ctx context.Context, schoolID string) ([]Session, error) {
	const q = `
		SELECT id, school_id, name, start_date, end_date, status
		FROM public.academy_sessions
		WHERE ($1 = '' OR school_id = $1::uuid)
		ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		var s Session
		var starts, ends *time.Time
		if err := rows.Scan(&s.ID, &s.SchoolID, &s.Name, &starts, &ends, &s.Status); err != nil {
			return nil, err
		}
		s.StartsOn = dateOrEmpty(starts)
		s.EndsOn = dateOrEmpty(ends)
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── Classes ───────────────────────────────────────────────────────────────────
// Reads public.academy_fee_classes with a live student count from academy_students.

func (r *Repository) ListClasses(ctx context.Context, schoolID string) ([]Class, error) {
	const q = `
		SELECT c.id, c.school_id, COALESCE(c.session_id::text,''), c.name, COALESCE(c.level,''),
		       (SELECT COUNT(*) FROM public.academy_students st WHERE st.class_id = c.id)
		FROM public.academy_fee_classes c
		WHERE ($1 = '' OR c.school_id = $1::uuid)
		ORDER BY c.created_at DESC`
	rows, err := r.pool.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Class{}
	for rows.Next() {
		var c Class
		if err := rows.Scan(&c.ID, &c.SchoolID, &c.SessionID, &c.Name, &c.CurriculumClass, &c.Students); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ── Fee schedules ─────────────────────────────────────────────────────────────
// Reads public.academy_fee_schedules (fees extension cols). SF-1: `locked=true` is the
// issued/immutable state; the console models status as 'draft' | 'issued'.

func (r *Repository) ListFeeSchedules(ctx context.Context, schoolID, classID string) ([]FeeSchedule, error) {
	const q = `
		SELECT id, school_id, COALESCE(session_id::text,''), COALESCE(class_id::text,''),
		       COALESCE(term,''), COALESCE(name,''), amount_minor, due_date, locked, created_at,
		       COALESCE(fee_items::text,'[]'), COALESCE(installment_policy::text,'{}')
		FROM public.academy_fee_schedules
		WHERE ($1 = '' OR school_id = $1::uuid)
		  AND ($2 = '' OR class_id = $2::uuid)
		ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, schoolID, classID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FeeSchedule{}
	for rows.Next() {
		var fs FeeSchedule
		var due *time.Time
		var locked bool
		var created time.Time
		if err := rows.Scan(&fs.ID, &fs.SchoolID, &fs.SessionID, &fs.ClassID, &fs.Term, &fs.Name,
			&fs.AmountMinor, &due, &locked, &created, &fs.FeeItemsRaw, &fs.InstallmentPolicyRaw); err != nil {
			return nil, err
		}
		fs.DueDate = dateOrEmpty(due)
		fs.Locked = locked
		if locked {
			fs.Status = "issued"
			issued := created
			fs.IssuedAt = &issued
		} else {
			fs.Status = "draft"
		}
		out = append(out, fs)
	}
	return out, rows.Err()
}

// CreateFeeSchedule inserts a DRAFT fee schedule (config only, no money moves). Returns
// the new id + created_at. The structured fee_items / installment_policy JSON are stored
// verbatim from the request (kobo integers inside).
func (r *Repository) CreateFeeSchedule(ctx context.Context, in CreateFeeScheduleParams) (string, time.Time, error) {
	const q = `
		INSERT INTO public.academy_fee_schedules
		  (school_id, session_id, class_id, term, name, amount_minor, currency, due_date, status,
		   fee_items, installment_policy, locked)
		VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6, 'NGN',
		        NULLIF($7,'')::date, 'active', $8::jsonb, $9::jsonb, false)
		RETURNING id, created_at`
	var id string
	var created time.Time
	err := r.pool.QueryRow(ctx, q,
		in.SchoolID, in.SessionID, in.ClassID, in.Term, in.Name, in.AmountMinor,
		in.DueDate, in.FeeItemsJSON, in.InstallmentPolicyJSON,
	).Scan(&id, &created)
	return id, created, err
}

// IssueFeeSchedule locks a draft schedule (SF-1: once issued it is immutable — the DB
// trigger academy_fee_schedule_immutable_when_locked backstops the money-shaping cols).
// Returns the issued_at timestamp (created_at proxy — no separate issued_at column here).
func (r *Repository) IssueFeeSchedule(ctx context.Context, scheduleID string) (time.Time, bool, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE public.academy_fee_schedules SET locked = true WHERE id = $1::uuid`, scheduleID)
	if err != nil {
		return time.Time{}, false, err
	}
	if tag.RowsAffected() == 0 {
		return time.Time{}, false, nil
	}
	return time.Now().UTC(), true, nil
}

// ── Collections aggregate (SC-33) ───────────────────────────────────────────────
// Aggregates academy_invoices + academy_invoice_payments across a school (or all
// schools when schoolID == ""). Billed = SUM(total_amount_minor) of non-draft invoices;
// collected = SUM(succeeded payment amounts); outstanding = billed - collected.

func (r *Repository) CollectionsOverview(ctx context.Context, schoolID string) (CollectionsOverview, error) {
	var c CollectionsOverview
	const q = `
		WITH inv AS (
		  SELECT i.id, i.total_amount_minor, i.status, i.due_date
		  FROM public.academy_invoices i
		  JOIN public.academy_students s ON s.id = i.student_id
		  WHERE i.status <> 'draft' AND ($1 = '' OR s.school_id = $1::uuid)
		),
		pay AS (
		  SELECT p.invoice_id, COALESCE(SUM(p.amount_minor),0) AS paid
		  FROM public.academy_invoice_payments p
		  WHERE p.status = 'succeeded' AND p.invoice_id IN (SELECT id FROM inv)
		  GROUP BY p.invoice_id
		)
		SELECT
		  COUNT(*)                                                              AS issued,
		  COUNT(*) FILTER (WHERE inv.status = 'paid')                           AS paid,
		  COUNT(*) FILTER (WHERE inv.status = 'partially_paid')                 AS partial,
		  COUNT(*) FILTER (WHERE inv.status = 'overdue'
		                    OR (inv.status NOT IN ('paid') AND inv.due_date IS NOT NULL AND inv.due_date < now())) AS overdue,
		  COALESCE(SUM(inv.total_amount_minor),0)                               AS billed,
		  COALESCE(SUM(COALESCE(pay.paid,0)),0)                                 AS collected
		FROM inv
		LEFT JOIN pay ON pay.invoice_id = inv.id`
	err := r.pool.QueryRow(ctx, q, schoolID).Scan(
		&c.InvoicesIssued, &c.InvoicesPaid, &c.InvoicesPartial, &c.InvoicesOverdue,
		&c.BilledKobo, &c.CollectedKobo,
	)
	if err != nil {
		return CollectionsOverview{}, err
	}
	c.OutstandingKobo = c.BilledKobo - c.CollectedKobo
	if c.OutstandingKobo < 0 {
		c.OutstandingKobo = 0
	}
	return c, nil
}

// ── Invoices list (SC-33) ───────────────────────────────────────────────────────
// Per-invoice rows across a school (or all), with the derived paid amount (SF-2: paid is
// SUM of succeeded payments, never a stored column). status optional filter.

func (r *Repository) ListInvoices(ctx context.Context, schoolID, status string) ([]InvoiceRow, error) {
	const q = `
		SELECT i.id,
		       COALESCE(a.student_name, s.admission_number, s.id::text) AS student_name,
		       COALESCE(cl.name,'')                                     AS class_name,
		       COALESCE(gu.email,'')                                    AS guardian_email,
		       i.total_amount_minor,
		       COALESCE((SELECT SUM(p.amount_minor) FROM public.academy_invoice_payments p
		                 WHERE p.invoice_id = i.id AND p.status = 'succeeded'),0) AS paid,
		       i.status, i.due_date, i.issued_at, i.created_at
		FROM public.academy_invoices i
		JOIN public.academy_students s ON s.id = i.student_id
		LEFT JOIN public.academy_fee_classes cl ON cl.id = s.class_id
		LEFT JOIN public.academy_edupay_accounts a ON a.id = s.edupay_account_id
		LEFT JOIN auth.users gu ON gu.id = (s.guardian_user_ids)[1]
		WHERE i.status <> 'draft'
		  AND ($1 = '' OR s.school_id = $1::uuid)
		  AND ($2 = '' OR i.status = $2)
		ORDER BY i.created_at DESC`
	rows, err := r.pool.Query(ctx, q, schoolID, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvoiceRow{}
	for rows.Next() {
		var iv InvoiceRow
		var due *time.Time
		var issuedAt *time.Time
		var created time.Time
		if err := rows.Scan(&iv.ID, &iv.StudentName, &iv.ClassName, &iv.GuardianEmail,
			&iv.BilledKobo, &iv.PaidKobo, &iv.Status, &due, &issuedAt, &created); err != nil {
			return nil, err
		}
		iv.DueDate = dateOrEmpty(due)
		if issuedAt != nil {
			iv.IssuedAt = *issuedAt
		} else {
			iv.IssuedAt = created
		}
		out = append(out, iv)
	}
	return out, rows.Err()
}

// ── Promotions list (SC-35/36) ──────────────────────────────────────────────────
// Aggregates academy_promotion_records into per (school, session, from→to class) batches
// with promoted/retained counts + the SF-3 two-approval state. The approve/apply
// mutations already exist per-school; this is the LIST only.

func (r *Repository) ListPromotions(ctx context.Context, schoolID string) ([]PromotionBatch, error) {
	const q = `
		SELECT s.school_id,
		       COALESCE(pr.session_id::text,'')                          AS session_id,
		       COALESCE(fc.name,'')                                      AS from_class,
		       COALESCE(tc.name,'')                                      AS to_class,
		       COUNT(*)                                                  AS total,
		       COUNT(*) FILTER (WHERE pr.decision = 'promoted')          AS promoted,
		       COUNT(*) FILTER (WHERE pr.decision = 'repeated')          AS retained,
		       MIN(pr.state)                                             AS state,
		       MAX(pr.teacher_approved_by::text)                        AS teacher_by,
		       MAX(pr.teacher_approved_at)                              AS teacher_at,
		       MAX(pr.admin_approved_by::text)                          AS admin_by,
		       MAX(pr.admin_approved_at)                                AS admin_at,
		       MIN(pr.created_at)                                        AS computed_at
		FROM public.academy_promotion_records pr
		JOIN public.academy_students s ON s.id = pr.student_id
		LEFT JOIN public.academy_fee_classes fc ON fc.id = pr.from_class_id
		LEFT JOIN public.academy_fee_classes tc ON tc.id = pr.to_class_id
		WHERE ($1 = '' OR s.school_id = $1::uuid)
		GROUP BY s.school_id, pr.session_id, fc.name, tc.name
		ORDER BY computed_at DESC`
	rows, err := r.pool.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PromotionBatch{}
	for rows.Next() {
		var p PromotionBatch
		var teacherBy, adminBy *string
		var teacherAt, adminAt *time.Time
		if err := rows.Scan(&p.SchoolID, &p.SessionID, &p.FromClass, &p.ToClass,
			&p.StudentsTotal, &p.StudentsPromoted, &p.StudentsRetained, &p.Status,
			&teacherBy, &teacherAt, &adminBy, &adminAt, &p.ComputedAt); err != nil {
			return nil, err
		}
		p.ID = deriveBatchID(p.SchoolID, p.SessionID, p.FromClass, p.ToClass)
		p.TeacherApprovedBy = teacherBy
		p.TeacherApprovedAt = teacherAt
		p.HeadApprovedBy = adminBy
		p.HeadApprovedAt = adminAt
		out = append(out, p)
	}
	return out, rows.Err()
}

// ── Competitions (SC-37) ────────────────────────────────────────────────────────
// Reads public.academy_competitions with derived registered_schools / registered_students
// counts. registered_students is approximated by the registration count (no per-team
// student roster table exists yet — see report "still-mocked").

func (r *Repository) ListCompetitions(ctx context.Context) ([]Competition, error) {
	const q = `
		SELECT c.id, c.name, COALESCE(c.subject,''), c.scope, c.status, c.start_date, c.end_date,
		       (SELECT COUNT(*) FROM public.academy_competition_registrations rg WHERE rg.competition_id = c.id) AS reg_schools
		FROM public.academy_competitions c
		ORDER BY c.created_at DESC`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Competition{}
	for rows.Next() {
		var c Competition
		var start, end *time.Time
		if err := rows.Scan(&c.ID, &c.Name, &c.Subject, &c.Scope, &c.Status, &start, &end, &c.RegisteredSchools); err != nil {
			return nil, err
		}
		c.StartsOn = dateOrEmpty(start)
		c.RegistrationCloses = dateOrEmpty(end)
		c.RegisteredStudents = 0 // no student-count column; teams roster not tracked in schema
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListCompetitionRegistrations returns registrations, optionally filtered by competition.
// The schema tracks (competition_id, school_id, registered_at) only — team_name / students
// have no backing columns, so they are returned empty/zero.
func (r *Repository) ListCompetitionRegistrations(ctx context.Context, competitionID string) ([]CompetitionRegistration, error) {
	const q = `
		SELECT id, competition_id, school_id, registered_at
		FROM public.academy_competition_registrations
		WHERE ($1 = '' OR competition_id = $1::uuid)
		ORDER BY registered_at DESC`
	rows, err := r.pool.Query(ctx, q, competitionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CompetitionRegistration{}
	for rows.Next() {
		var rg CompetitionRegistration
		if err := rows.Scan(&rg.ID, &rg.CompetitionID, &rg.SchoolID, &rg.RegisteredAt); err != nil {
			return nil, err
		}
		rg.Status = "confirmed" // registrations are terminal once inserted (unique constraint)
		out = append(out, rg)
	}
	return out, rows.Err()
}

// ── Government export opt-ins (SC-38, SF-11) ────────────────────────────────────
// Reads / upserts public.academy_school_compliance_optins (one row per school+category).

func (r *Repository) ListGovOptIns(ctx context.Context, schoolID string) ([]GovOptIn, error) {
	const q = `
		SELECT school_id, data_category, true, opted_in_at
		FROM public.academy_school_compliance_optins
		WHERE ($1 = '' OR school_id = $1::uuid)
		ORDER BY opted_in_at DESC`
	rows, err := r.pool.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GovOptIn{}
	for rows.Next() {
		var o GovOptIn
		if err := rows.Scan(&o.SchoolID, &o.Category, &o.OptedIn, &o.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// SetGovOptIn records or clears a per-category opt-in. opted_in=true upserts a row;
// opted_in=false deletes it (the table models presence = opted-in). Returns the effective
// state + timestamp.
func (r *Repository) SetGovOptIn(ctx context.Context, schoolID, category, actorID string, optedIn bool) (GovOptIn, error) {
	o := GovOptIn{SchoolID: schoolID, Category: category, OptedIn: optedIn, UpdatedAt: time.Now().UTC()}
	if optedIn {
		const up = `
			INSERT INTO public.academy_school_compliance_optins (school_id, data_category, opted_in_by, opted_in_at)
			VALUES ($1::uuid, $2, NULLIF($3,'')::uuid, now())
			ON CONFLICT (school_id, data_category) DO UPDATE
			  SET opted_in_by = EXCLUDED.opted_in_by, opted_in_at = now()
			RETURNING opted_in_at`
		if err := r.pool.QueryRow(ctx, up, schoolID, category, actorID).Scan(&o.UpdatedAt); err != nil {
			return GovOptIn{}, err
		}
		return o, nil
	}
	const del = `DELETE FROM public.academy_school_compliance_optins WHERE school_id = $1::uuid AND data_category = $2`
	if _, err := r.pool.Exec(ctx, del, schoolID, category); err != nil {
		return GovOptIn{}, err
	}
	return o, nil
}

// ── Staff role grants (SC-40) ───────────────────────────────────────────────────
// Cross-school (or single-school) projection of the RBAC user_roles for the fees staff
// roles. Mirrors feesroles.ListStaffForSchool but supports the all-schools list the
// console's /fees/roles endpoint needs. Reads canonical RBAC tables (never drifts).

func (r *Repository) ListRoleGrants(ctx context.Context, schoolID string) ([]RoleGrant, error) {
	// user_roles.scope_id is TEXT (holds the school id string); user_roles.user_id
	// references public.platform_users(id), which carries the email.
	const q = `
		SELECT ur.id::text, COALESCE(ur.scope_id,''), COALESCE(u.email,''), r.slug,
		       COALESCE(ur.assigned_by::text,''), ur.created_at,
		       CASE WHEN ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
		            THEN 'active' ELSE 'revoked' END
		FROM public.user_roles ur
		JOIN public.roles r ON r.id = ur.role_id
		LEFT JOIN public.platform_users u ON u.id = ur.user_id
		WHERE ur.scope_type = 'school'
		  AND r.slug IN ('school-owner','bursar','class-teacher','head-teacher')
		  AND ($1 = '' OR ur.scope_id = $1)
		ORDER BY ur.scope_id, r.slug, ur.created_at`
	rows, err := r.pool.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RoleGrant{}
	for rows.Next() {
		var g RoleGrant
		if err := rows.Scan(&g.ID, &g.SchoolID, &g.UserEmail, &g.Role, &g.GrantedBy, &g.GrantedAt, &g.Status); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ── helpers ─────────────────────────────────────────────────────────────────────

func dateOrEmpty(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("2006-01-02")
}

// deriveBatchID builds a stable, human-readable id for a promotion batch aggregate
// (promotion records are per-student; the console models a per-cohort batch).
func deriveBatchID(schoolID, sessionID, fromClass, toClass string) string {
	return "pr_" + shortHash(schoolID+"|"+sessionID+"|"+fromClass+"|"+toClass)
}

// Package platform is the READ-ONLY platform SUPER-ADMIN oversight surface for the
// EdTech (academy fees) module — the backend for the /admin/platform/edtech console
// (SU-01..SU-12). It is authorized PURELY by the seeded RBAC capability
// `platform_edtech_admin`; no school-level role reaches it.
//
// SCOPE — READ + LIGHT OVERSIGHT ONLY. Nothing here posts a ledger entry or moves
// money. The two write endpoints (trust-score override, school verify) mutate ONLY
// the existing guarded, money-free tables (academy_fees_trust_overrides append-only
// history; academy_schools.verification_tier advance) — never the ledger, never a
// balance. All monetary amounts are integers in minor units (kobo).
//
// Cross-tenant by design: a platform operator reads ACROSS every school via the pgx
// pool, authorized by platform RBAC alone (mirrors estate_admin_routes.go). Where a
// screen has NO backing table, the handler returns a DOCUMENTED empty/placeholder
// shape (never fabricated money) so a single missing table cannot break the group.
package platform

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repo holds the shared read-only pool. It deliberately does NOT embed any fees
// service: those self-gate on school membership, which is the wrong authorization
// model for a platform operator (see estate_admin_routes.go header for the same
// reasoning).
type Repo struct{ pool *pgxpool.Pool }

// NewRepo builds the platform oversight repo over the shared pgx pool.
func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

// ── SU-01 — Platform School Directory ─────────────────────────────────────────
//
// Reads public.academy_schools (base spine + the fees-integration ALTERs:
// verification_tier, level, owner_user_id). GMV = SUM of succeeded invoice payments
// across the school's students (academy_invoice_payments → academy_invoices →
// academy_students). Student count = active enrollments. Trust score comes from the
// latest academy_fees_trust_overrides row when present, else a neutral default
// (never fabricated — the computed score lives in the fees/trustscore service; here
// we surface the override or a documented neutral 0-if-unknown fallback resolved in
// the handler).
//
// NOTE the base academy_schools table has NO geographic "state" column and no
// "gov_sync opt-in" flag; those fields in the console fixture map to, respectively,
// academy_schools.level (best available locality descriptor, may be empty) and the
// existence of any academy_school_compliance_optins row for the school.
type SchoolRow struct {
	ID              string
	Name            string
	State           string // mapped from academy_schools.level (no geo column exists)
	OwnerIdentityID string // academy_schools.owner_user_id (nullable)
	VerificationTier string
	Status          string
	Students        int64
	GMVKobo         int64
	TrustScore      float64
	GovSyncOptIn    bool
	CreatedAt       time.Time
}

func (r *Repo) ListSchools(ctx context.Context) ([]SchoolRow, error) {
	const q = `
SELECT
  s.id::text,
  s.name,
  COALESCE(s.level, ''),
  COALESCE(s.owner_user_id::text, ''),
  COALESCE(s.verification_tier, 'unverified'),
  COALESCE(s.status, 'active'),
  (SELECT COUNT(*) FROM public.academy_students st
     WHERE st.school_id = s.id AND st.status = 'active'),
  COALESCE((
     SELECT SUM(p.amount_minor)
       FROM public.academy_invoice_payments p
       JOIN public.academy_invoices i ON i.id = p.invoice_id
       JOIN public.academy_students st ON st.id = i.student_id
      WHERE st.school_id = s.id AND p.status = 'succeeded'
  ), 0),
  COALESCE((
     SELECT o.score FROM public.academy_fees_trust_overrides o
      WHERE o.school_id = s.id ORDER BY o.created_at DESC LIMIT 1
  ), 0),
  EXISTS (SELECT 1 FROM public.academy_school_compliance_optins c WHERE c.school_id = s.id),
  s.created_at
FROM public.academy_schools s
ORDER BY s.created_at DESC
LIMIT 500`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SchoolRow, 0, 64)
	for rows.Next() {
		var s SchoolRow
		if err := rows.Scan(&s.ID, &s.Name, &s.State, &s.OwnerIdentityID, &s.VerificationTier,
			&s.Status, &s.Students, &s.GMVKobo, &s.TrustScore, &s.GovSyncOptIn, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── SU-02 — Verification Queue ────────────────────────────────────────────────
//
// There is NO dedicated verification-submission table (no CAC/references entity in
// the schema). The pending-verification QUEUE is therefore derived from
// academy_schools whose verification_tier is not yet terminal ('verified'/'premium').
// CAC number / doc / references have no backing columns, so those fixture fields are
// returned empty (documented). The advance action writes verification_tier only.
type VerificationRow struct {
	SchoolID        string
	SchoolName      string
	CurrentTier     string
	Status          string // pending (derived)
	SubmittedAt     time.Time
}

func (r *Repo) ListVerificationQueue(ctx context.Context) ([]VerificationRow, error) {
	const q = `
SELECT s.id::text, s.name, COALESCE(s.verification_tier,'unverified'), s.created_at
FROM public.academy_schools s
WHERE COALESCE(s.verification_tier,'unverified') IN ('unverified','pending')
ORDER BY s.created_at DESC
LIMIT 500`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]VerificationRow, 0, 32)
	for rows.Next() {
		var v VerificationRow
		if err := rows.Scan(&v.SchoolID, &v.SchoolName, &v.CurrentTier, &v.SubmittedAt); err != nil {
			return nil, err
		}
		v.Status = "pending"
		out = append(out, v)
	}
	return out, rows.Err()
}

// VerifySchool advances a school's verification_tier. This is a guarded oversight
// mutation on the EXISTING money-free academy_schools column (the same column the
// fees/school verify path owns) — it posts NO ledger entry and moves NO money. The
// CHECK constraint (unverified/pending/verified/premium) is enforced at the DB.
func (r *Repo) VerifySchool(ctx context.Context, schoolID, grantedTier string) (VerificationRow, error) {
	const q = `
UPDATE public.academy_schools
   SET verification_tier = $2
 WHERE id = $1
RETURNING id::text, name, COALESCE(verification_tier,'unverified'), created_at`
	var v VerificationRow
	err := r.pool.QueryRow(ctx, q, schoolID, grantedTier).
		Scan(&v.SchoolID, &v.SchoolName, &v.CurrentTier, &v.SubmittedAt)
	if err != nil {
		return VerificationRow{}, err
	}
	v.Status = "approved"
	return v, nil
}

// ── SU-03 — Platform-Wide Collections ─────────────────────────────────────────
//
// Aggregates real GMV + invoice counts across ALL schools. GMV = succeeded payments;
// invoices_issued = non-draft invoices; invoices_paid = status 'paid'. Reconciliation
// health is a best-effort projection read (matched = succeeded payments, pending =
// pending payments, drift_flagged = reversed payments); there is no nightly-recon
// table (SF-8 is a job), so those are the payment-status projections, not a stored
// recon run. Per-school top GMV rides the ListSchools aggregation.
type CollectionsAgg struct {
	GMVKobo        int64
	GMVTodayKobo   int64
	ActiveSchools  int64
	InvoicesIssued int64
	InvoicesPaid   int64
	Matched        int64
	Pending        int64
	DriftFlagged   int64
}

func (r *Repo) CollectionsOverview(ctx context.Context) (CollectionsAgg, error) {
	const q = `
SELECT
  COALESCE((SELECT SUM(amount_minor) FROM public.academy_invoice_payments WHERE status='succeeded'),0),
  COALESCE((SELECT SUM(amount_minor) FROM public.academy_invoice_payments
              WHERE status='succeeded' AND created_at >= date_trunc('day', now())),0),
  (SELECT COUNT(*) FROM public.academy_schools WHERE COALESCE(status,'active')='active'),
  (SELECT COUNT(*) FROM public.academy_invoices WHERE status <> 'draft'),
  (SELECT COUNT(*) FROM public.academy_invoices WHERE status = 'paid'),
  (SELECT COUNT(*) FROM public.academy_invoice_payments WHERE status='succeeded'),
  (SELECT COUNT(*) FROM public.academy_invoice_payments WHERE status='pending'),
  (SELECT COUNT(*) FROM public.academy_invoice_payments WHERE status='reversed')`
	var a CollectionsAgg
	err := r.pool.QueryRow(ctx, q).Scan(
		&a.GMVKobo, &a.GMVTodayKobo, &a.ActiveSchools, &a.InvoicesIssued,
		&a.InvoicesPaid, &a.Matched, &a.Pending, &a.DriftFlagged)
	return a, err
}

// GMVTrend returns per-day succeeded-payment totals for the last n days.
type TrendPoint struct {
	Date      string
	ValueKobo int64
}

func (r *Repo) GMVTrend(ctx context.Context, days int) ([]TrendPoint, error) {
	const q = `
SELECT to_char(d.day,'YYYY-MM-DD') AS date,
       COALESCE(SUM(p.amount_minor),0) AS value_kobo
FROM generate_series(date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
                     date_trunc('day', now()), interval '1 day') AS d(day)
LEFT JOIN public.academy_invoice_payments p
       ON p.status='succeeded' AND date_trunc('day', p.created_at) = d.day
GROUP BY d.day
ORDER BY d.day`
	rows, err := r.pool.Query(ctx, q, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]TrendPoint, 0, days)
	for rows.Next() {
		var t TrendPoint
		if err := rows.Scan(&t.Date, &t.ValueKobo); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ── SU-04 — Fraud & Risk (best-effort heuristic reads) ────────────────────────
//
// No fraud-case table exists. This is a best-effort heuristic read over real data:
//   - reversed payments (chargeback-like) → one risk row each
// It fabricates no money; amount_kobo is the real reversed payment amount. Disputed
// promotions have no dispute column, so none are synthesized here (documented gap).
type RiskRow struct {
	ID         string
	Kind       string
	SchoolID   string
	SchoolName string
	AmountKobo int64
	OpenedAt   time.Time
}

func (r *Repo) ListRiskCases(ctx context.Context) ([]RiskRow, error) {
	const q = `
SELECT p.id::text, 'chargeback', st.school_id::text, sc.name, p.amount_minor, p.created_at
FROM public.academy_invoice_payments p
JOIN public.academy_invoices i ON i.id = p.invoice_id
JOIN public.academy_students st ON st.id = i.student_id
JOIN public.academy_schools sc ON sc.id = st.school_id
WHERE p.status = 'reversed'
ORDER BY p.created_at DESC
LIMIT 200`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RiskRow, 0, 32)
	for rows.Next() {
		var rr RiskRow
		if err := rows.Scan(&rr.ID, &rr.Kind, &rr.SchoolID, &rr.SchoolName, &rr.AmountKobo, &rr.OpenedAt); err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// ── SU-05 — Gov Sync + Compliance Exports (SF-11 immutable log) ───────────────
//
// GovSync opt-in state per school = the set of academy_school_compliance_optins
// categories; export count/last export come from academy_compliance_exports.
type GovSyncRow struct {
	SchoolID     string
	SchoolName   string
	OptedIn      bool
	Categories   []string
	Regulator    string
	LastExportAt *time.Time
	ExportCount  int64
}

func (r *Repo) ListGovSync(ctx context.Context) ([]GovSyncRow, error) {
	const q = `
SELECT s.id::text, s.name,
  COALESCE(ARRAY(SELECT DISTINCT data_category FROM public.academy_school_compliance_optins o
                  WHERE o.school_id = s.id ORDER BY data_category), '{}') AS cats,
  COALESCE(s.level,'') AS regulator,
  (SELECT MAX(generated_at) FROM public.academy_compliance_exports e WHERE e.school_id = s.id),
  (SELECT COUNT(*) FROM public.academy_compliance_exports e WHERE e.school_id = s.id)
FROM public.academy_schools s
ORDER BY s.name
LIMIT 500`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]GovSyncRow, 0, 64)
	for rows.Next() {
		var g GovSyncRow
		if err := rows.Scan(&g.SchoolID, &g.SchoolName, &g.Categories, &g.Regulator, &g.LastExportAt, &g.ExportCount); err != nil {
			return nil, err
		}
		g.OptedIn = len(g.Categories) > 0
		out = append(out, g)
	}
	return out, rows.Err()
}

// ComplianceExportRow reads the SF-11 append-only immutable export log.
type ComplianceExportRow struct {
	ID          string
	SchoolID    string
	SchoolName  string
	ReportType  string
	Period      string
	Categories  []string
	GeneratedAt time.Time
	GeneratedBy string
	PayloadRef  string // stands in for the fixture's immutable_hash (append-only anchor)
}

func (r *Repo) ListComplianceExports(ctx context.Context) ([]ComplianceExportRow, error) {
	const q = `
SELECT e.id::text, e.school_id::text, sc.name, e.report_type, COALESCE(e.period,''),
       COALESCE(e.data_categories,'{}'), e.generated_at,
       COALESCE(e.requested_by::text,''), COALESCE(e.payload_ref,'')
FROM public.academy_compliance_exports e
JOIN public.academy_schools sc ON sc.id = e.school_id
ORDER BY e.generated_at DESC
LIMIT 500`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ComplianceExportRow, 0, 32)
	for rows.Next() {
		var e ComplianceExportRow
		if err := rows.Scan(&e.ID, &e.SchoolID, &e.SchoolName, &e.ReportType, &e.Period,
			&e.Categories, &e.GeneratedAt, &e.GeneratedBy, &e.PayloadRef); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ── SU-06 — Competitions (real table academy_competitions) ────────────────────
type CompetitionRow struct {
	ID                  string
	Name                string
	Scope               string
	Status              string
	ParticipatingSchools int64
	Sponsor             string
	StartDate           *time.Time
	EndDate             *time.Time
}

func (r *Repo) ListCompetitions(ctx context.Context) ([]CompetitionRow, error) {
	const q = `
SELECT c.id::text, c.name, c.scope, c.status,
  COALESCE(array_length(c.participating_school_ids,1),0)
    + (SELECT COUNT(*) FROM public.academy_competition_registrations r WHERE r.competition_id = c.id
        AND NOT (r.school_id = ANY(c.participating_school_ids))),
  COALESCE(c.sponsor,''), c.start_date, c.end_date
FROM public.academy_competitions c
ORDER BY c.created_at DESC
LIMIT 500`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CompetitionRow, 0, 32)
	for rows.Next() {
		var c CompetitionRow
		if err := rows.Scan(&c.ID, &c.Name, &c.Scope, &c.Status, &c.ParticipatingSchools,
			&c.Sponsor, &c.StartDate, &c.EndDate); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ── SU-07 — Trust Scores (+ override) ─────────────────────────────────────────
//
// Per-school trust: the latest academy_fees_trust_overrides row is authoritative
// when present (overridden=true). When absent, a documented neutral fallback is
// returned (score 0, overridden=false) — the real computed score lives in the
// fees/trustscore service and is NOT recomputed here to avoid a second source of
// truth. Components mirror the console's weighting labels with the override/neutral
// value so the UI renders.
type TrustRow struct {
	SchoolID     string
	SchoolName   string
	Score        float64
	Overridden   bool
	OverrideReason string
	UpdatedAt    time.Time
}

func (r *Repo) ListTrustScores(ctx context.Context) ([]TrustRow, error) {
	const q = `
SELECT s.id::text, s.name,
  o.score, o.reason, o.created_at
FROM public.academy_schools s
LEFT JOIN LATERAL (
  SELECT score, reason, created_at
  FROM public.academy_fees_trust_overrides ov
  WHERE ov.school_id = s.id
  ORDER BY ov.created_at DESC LIMIT 1
) o ON true
ORDER BY s.name
LIMIT 500`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]TrustRow, 0, 64)
	for rows.Next() {
		var t TrustRow
		var score *float64
		var reason *string
		var updated *time.Time
		if err := rows.Scan(&t.SchoolID, &t.SchoolName, &score, &reason, &updated); err != nil {
			return nil, err
		}
		if score != nil {
			t.Score = *score
			t.Overridden = true
			if reason != nil {
				t.OverrideReason = *reason
			}
			if updated != nil {
				t.UpdatedAt = *updated
			}
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// SaveTrustOverride appends an override row (append-only history, latest wins) —
// this is the SAME store the fees/trustscore admin path writes (money-free). No
// ledger entry. Returns the resulting authoritative row.
func (r *Repo) SaveTrustOverride(ctx context.Context, schoolID, actorID string, score float64, reason string) (TrustRow, error) {
	var actor any
	if actorID != "" {
		actor = actorID
	}
	const ins = `
INSERT INTO public.academy_fees_trust_overrides (school_id, actor_id, score, reason)
VALUES ($1,$2,$3,$4)
RETURNING created_at`
	var created time.Time
	if err := r.pool.QueryRow(ctx, ins, schoolID, actor, score, reason).Scan(&created); err != nil {
		return TrustRow{}, err
	}
	var name string
	_ = r.pool.QueryRow(ctx, `SELECT name FROM public.academy_schools WHERE id=$1`, schoolID).Scan(&name)
	return TrustRow{
		SchoolID: schoolID, SchoolName: name, Score: score,
		Overridden: true, OverrideReason: reason, UpdatedAt: created,
	}, nil
}

// ── SU-08 — Scholarships (fund-flow audit) ────────────────────────────────────
//
// Reads academy_scholarship_pledges (the pledge spine). ledger_ref = fund_ledger_ref
// (every settled leg posts to the finance ledger; a still-pledged row has none).
// target_student_ref is the student id (minor-safe ref, not PII) per SF-7.
type ScholarshipRow struct {
	ID              string
	SponsorIdentity string
	TargetStudentRef string
	SchoolName      string
	AmountKobo      int64
	State           string
	LedgerRef       string
	CreatedAt       time.Time
}

func (r *Repo) ListScholarships(ctx context.Context) ([]ScholarshipRow, error) {
	const q = `
SELECT p.id::text,
       COALESCE(p.sponsor_identity_id::text,''),
       p.target_student_id::text,
       COALESCE(sc.name,''),
       p.amount_minor, p.state,
       COALESCE(p.fund_ledger_ref,''),
       p.created_at
FROM public.academy_scholarship_pledges p
LEFT JOIN public.academy_students st ON st.id = p.target_student_id
LEFT JOIN public.academy_schools sc ON sc.id = st.school_id
ORDER BY p.created_at DESC
LIMIT 500`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ScholarshipRow, 0, 32)
	for rows.Next() {
		var s ScholarshipRow
		if err := rows.Scan(&s.ID, &s.SponsorIdentity, &s.TargetStudentRef, &s.SchoolName,
			&s.AmountKobo, &s.State, &s.LedgerRef, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── SU-11 — Audit search (academy_commerce_audit) ─────────────────────────────
//
// Searches the append-only academy_commerce_audit trail (module-scoped to academy).
// The generic public.audit_logs is keyed on platform_users (a different identity
// space per 20260815001000 header), so the academy-native commerce audit is the
// correct immutable trail for this console. entity filter maps to entity_type; the
// school_id filter is best-effort (commerce audit is not school-partitioned, so it
// is applied against detail->>'school_id' when present).
type AuditRow struct {
	ID        string
	Module    string
	Entity    string
	EntityID  string
	Action    string
	Actor     string
	SchoolID  string
	At        time.Time
	Detail    map[string]any
}

func (r *Repo) SearchAudit(ctx context.Context, entity, schoolID string, limit int) ([]AuditRow, error) {
	q := `
SELECT a.id::text, 'academy' AS module, a.entity_type, COALESCE(a.entity_id::text,''),
       a.action, COALESCE(a.actor_id::text,''),
       COALESCE(a.detail->>'school_id',''), a.created_at, a.detail
FROM public.academy_commerce_audit a
WHERE 1=1`
	args := []any{}
	if entity != "" {
		args = append(args, entity)
		q += " AND a.entity_type = $" + itoa(len(args))
	}
	if schoolID != "" {
		args = append(args, schoolID)
		q += " AND a.detail->>'school_id' = $" + itoa(len(args))
	}
	args = append(args, limit)
	q += " ORDER BY a.created_at DESC LIMIT $" + itoa(len(args))
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AuditRow, 0, 64)
	for rows.Next() {
		var a AuditRow
		if err := rows.Scan(&a.ID, &a.Module, &a.Entity, &a.EntityID, &a.Action,
			&a.Actor, &a.SchoolID, &a.At, &a.Detail); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ── SU-12 — Compliance posture (Model-A) drift signals ────────────────────────
//
// Model-A means Paymax never fronts fees. A best-effort drift read flags schools
// whose fee schedules carry a non-empty installment_policy referencing advance /
// financing structures (factoring-like). This is a heuristic over real config, not a
// stored posture record; it fabricates nothing.
type DriftRow struct {
	ID         string
	SchoolName string
	Signal     string
	DetectedAt time.Time
}

func (r *Repo) DriftSignals(ctx context.Context) ([]DriftRow, error) {
	const q = `
SELECT f.id::text, COALESCE(s.name,''),
       'Fee schedule installment_policy references an advance/financing structure (Model-A drift)',
       COALESCE(f.created_at, now())
FROM public.academy_fee_schedules f
JOIN public.academy_schools s ON s.id = f.school_id
WHERE f.installment_policy IS NOT NULL
  AND f.installment_policy::text <> '{}'
  AND (f.installment_policy::text ILIKE '%advance%'
       OR f.installment_policy::text ILIKE '%financing%'
       OR f.installment_policy::text ILIKE '%factor%')
ORDER BY f.created_at DESC
LIMIT 200`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DriftRow, 0, 8)
	for rows.Next() {
		var d DriftRow
		if err := rows.Scan(&d.ID, &d.SchoolName, &d.Signal, &d.DetectedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ── SU-10 — Feature flags (config-backed; no per-scope override table) ─────────
//
// There is no tenant feature-flag override table in the schema. The set of flags is
// therefore read from the seeded academy fees RBAC permissions namespace as a
// documented, read-only placeholder projection (each academy.fees.* capability is a
// flag-like capability). PUT/toggle has no persistence target and is a documented
// no-op that echoes the requested state (see handler). No fabricated money.
type FlagRow struct {
	Key         string
	Label       string
	Description string
}

func (r *Repo) ListFlagPlaceholders(ctx context.Context) ([]FlagRow, error) {
	const q = `
SELECT slug, name, COALESCE(description,'')
FROM public.permissions
WHERE slug LIKE 'academy.fees.%' OR slug = 'platform_edtech_admin'
ORDER BY slug`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		// permissions table absent ⇒ documented empty placeholder, never an error to the console.
		return []FlagRow{}, nil
	}
	defer rows.Close()
	out := make([]FlagRow, 0, 16)
	for rows.Next() {
		var f FlagRow
		if err := rows.Scan(&f.Key, &f.Label, &f.Description); err != nil {
			return out, nil
		}
		out = append(out, f)
	}
	return out, nil
}

// itoa is a tiny local strconv.Itoa to keep the repo import surface minimal.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

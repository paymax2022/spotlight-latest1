package savings

// Read-only admin queries for the savings ops console.
//
// WHY THIS EXISTS. The console (frontend-admin /admin/savings/*) needed eight
// endpoints and the backend exposed exactly one — GET /api/savings/admin/circles/:id
// — so every other view ran on fixtures: invented vault balances, invented float
// reconciliation, invented default queues. This file backs the read-only half
// with real queries so those views can stop making numbers up.
//
// BALANCES ARE PROJECTIONS (NL-8). savings_vaults has no balance column by
// design; a vault's balance is the sum of its ledger rows. Every balance below is
// computed that way rather than read from a cached field, so the console cannot
// disagree with the ledger.
//
// VOCABULARY DIFFERS FROM THE OLD FIXTURES, and the differences are not cosmetic.
// The DB stores kind FLEX|LOCK and circle state FORMING|ACTIVE|COMPLETED|CANCELLED;
// the console's types were written against an imagined API using 'LOCKED' and
// 'closed'. Mapping is done here, once, rather than left to the client — an
// unmapped value renders as an empty badge, which reads as "no status" rather
// than "unknown status".

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AdminRepository struct{ pool *pgxpool.Pool }

func NewAdminRepository(pool *pgxpool.Pool) *AdminRepository { return &AdminRepository{pool: pool} }

// AdminDashboard carries only figures derivable from the savings tables.
//
// Fields the console once showed that have NO source here — custody float,
// ledger-vs-custody delta, auto-save runs/failures today, force-unlocks in the
// last 30 days — are deliberately absent rather than returned as zero. A zero
// delta asserts "reconciled" and a zero failure count asserts "nothing failed";
// neither is something this data can support, and the fixtures asserted both.
type AdminDashboard struct {
	VaultsTotal   int64 `json:"vaults_total"`
	VaultsLocked  int64 `json:"vaults_locked"`
	VaultsFlex    int64 `json:"vaults_flex"`
	VaultsMatured int64 `json:"vaults_matured"`
	// Sum of CREDIT minus DEBIT across every vault ledger row.
	VaultBalanceKobo int64 `json:"vault_balance_kobo"`

	CirclesTotal   int64 `json:"circles_total"`
	CirclesForming int64 `json:"circles_forming"`
	CirclesActive  int64 `json:"circles_active"`

	// Cycles awaiting payout, and what they are worth.
	PayoutQueueCount     int64 `json:"payout_queue_count"`
	PayoutQueueValueKobo int64 `json:"payout_queue_value_kobo"`
	Collections30dKobo   int64 `json:"circle_collections_30d_kobo"`

	MembersTotal  int64 `json:"members_total"`
	DefaultsOpen  int64 `json:"defaults_open"`
	MembersAtRisk int64 `json:"members_at_risk"`
	MissedTotal   int64 `json:"missed_contributions_total"`
}

func (r *AdminRepository) Dashboard(ctx context.Context) (AdminDashboard, error) {
	var d AdminDashboard
	err := r.pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FROM public.savings_vaults),
		  (SELECT count(*) FROM public.savings_vaults WHERE kind='LOCK'),
		  (SELECT count(*) FROM public.savings_vaults WHERE kind='FLEX'),
		  (SELECT count(*) FROM public.savings_vaults WHERE state='MATURED'),
		  -- NL-8: the balance IS the ledger, never a stored column.
		  (SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_kobo ELSE -amount_kobo END), 0)
		     FROM public.savings_vault_ledger),
		  (SELECT count(*) FROM public.ajo_circles),
		  (SELECT count(*) FROM public.ajo_circles WHERE state='FORMING'),
		  (SELECT count(*) FROM public.ajo_circles WHERE state='ACTIVE'),
		  (SELECT count(*) FROM public.ajo_cycles WHERE status IN ('PENDING','RUNNING')),
		  (SELECT COALESCE(SUM(payout_kobo),0) FROM public.ajo_cycles WHERE status IN ('PENDING','RUNNING')),
		  (SELECT COALESCE(SUM(collected_kobo),0) FROM public.ajo_cycles
		    WHERE paid_at IS NOT NULL AND paid_at > now() - interval '30 days'),
		  (SELECT count(*) FROM public.ajo_members),
		  (SELECT count(*) FROM public.ajo_members WHERE state='DEFAULTED'),
		  -- Not yet defaulted but has missed at least one contribution.
		  (SELECT count(*) FROM public.ajo_members WHERE state<>'DEFAULTED' AND missed_count > 0),
		  (SELECT COALESCE(SUM(missed_count),0) FROM public.ajo_members)
	`).Scan(&d.VaultsTotal, &d.VaultsLocked, &d.VaultsFlex, &d.VaultsMatured, &d.VaultBalanceKobo,
		&d.CirclesTotal, &d.CirclesForming, &d.CirclesActive,
		&d.PayoutQueueCount, &d.PayoutQueueValueKobo, &d.Collections30dKobo,
		&d.MembersTotal, &d.DefaultsOpen, &d.MembersAtRisk, &d.MissedTotal)
	return d, err
}

type AdminVault struct {
	ID          string `json:"id"`
	OwnerMasked string `json:"owner_masked"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`  // FLEX | LOCK, verbatim from the DB
	State       string `json:"state"` // OPEN | MATURED | CLOSED, verbatim
	BalanceKobo int64  `json:"balance_kobo"`
	TargetKobo  *int64 `json:"target_kobo"`
	// NL-2: savings earn nothing, and savings_vault_ledger CHECKs that no row may
	// carry reason 'interest' or 'yield'. Constant zero here is the invariant
	// itself, not a placeholder for a number we could not find.
	YieldKobo       int64   `json:"yield_kobo"`
	AutoSaveEnabled bool    `json:"auto_save_enabled"`
	MaturesAt       *string `json:"matures_at"`
	CreatedAt       string  `json:"created_at"`
}

// Vaults lists vaults with ledger-projected balances, newest first.
func (r *AdminRepository) Vaults(ctx context.Context, state string, limit int) ([]AdminVault, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT v.id::text,
		       -- Owner is masked here, not in the client: the console has no need
		       -- for the raw id and it should not travel over the wire.
		       'user-' || right(v.owner_user_id::text, 6),
		       v.name, v.kind, v.state, v.target_kobo,
		       COALESCE(l.bal, 0),
		       (v.autosave_job_id IS NOT NULL),
		       to_char(v.matures_at, 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       to_char(v.created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ')
		  FROM public.savings_vaults v
		  LEFT JOIN (
		        SELECT vault_id,
		               SUM(CASE WHEN direction='CREDIT' THEN amount_kobo ELSE -amount_kobo END) AS bal
		          FROM public.savings_vault_ledger GROUP BY vault_id
		  ) l ON l.vault_id = v.id
		 WHERE ($1 = '' OR v.state = $1)
		 ORDER BY v.created_at DESC
		 LIMIT $2`, state, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AdminVault{}
	for rows.Next() {
		var v AdminVault
		if err := rows.Scan(&v.ID, &v.OwnerMasked, &v.Name, &v.Kind, &v.State, &v.TargetKobo,
			&v.BalanceKobo, &v.AutoSaveEnabled, &v.MaturesAt, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

type AdminCircle struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	CreatorMasked    string `json:"creator_masked"`
	State            string `json:"state"` // FORMING | ACTIVE | COMPLETED | CANCELLED
	ContributionKobo int64  `json:"contribution_kobo"`
	CurrentCycle     int    `json:"current_cycle"`
	TotalCycles      int    `json:"total_cycles"`
	IntervalSecs     int64  `json:"interval_secs"`
	MembersTotal     int64  `json:"members_total"`
	MembersDefaulted int64  `json:"members_defaulted"`
	CollectedKobo    int64  `json:"collected_kobo"`
	CreatedAt        string `json:"created_at"`
}

func (r *AdminRepository) Circles(ctx context.Context, state string, limit int) ([]AdminCircle, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT c.id::text, c.name, 'user-' || right(c.creator_user_id::text, 6),
		       c.state, c.contribution_kobo, c.current_cycle, c.total_cycles, c.interval_secs,
		       COALESCE(m.total, 0), COALESCE(m.defaulted, 0), COALESCE(y.collected, 0),
		       to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ')
		  FROM public.ajo_circles c
		  LEFT JOIN (
		        SELECT circle_id, count(*) AS total,
		               count(*) FILTER (WHERE state='DEFAULTED') AS defaulted
		          FROM public.ajo_members GROUP BY circle_id
		  ) m ON m.circle_id = c.id
		  LEFT JOIN (
		        SELECT circle_id, SUM(collected_kobo) AS collected
		          FROM public.ajo_cycles GROUP BY circle_id
		  ) y ON y.circle_id = c.id
		 WHERE ($1 = '' OR c.state = $1)
		 ORDER BY c.created_at DESC
		 LIMIT $2`, state, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AdminCircle{}
	for rows.Next() {
		var c AdminCircle
		if err := rows.Scan(&c.ID, &c.Name, &c.CreatorMasked, &c.State, &c.ContributionKobo,
			&c.CurrentCycle, &c.TotalCycles, &c.IntervalSecs,
			&c.MembersTotal, &c.MembersDefaulted, &c.CollectedKobo, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

type AdminDefault struct {
	MemberID      string `json:"member_id"`
	CircleID      string `json:"circle_id"`
	CircleName    string `json:"circle_name"`
	UserMasked    string `json:"user_masked"`
	State         string `json:"state"` // DEFAULTED, or ACTIVE/INVITED with misses
	MissedCount   int    `json:"missed_count"`
	RotationOrder int    `json:"rotation_order"`
	// What the member owes: contribution × misses. NL-7 — Paymax is never the
	// lender, so this is peer exposure, not a platform receivable.
	ExposureKobo int64  `json:"exposure_kobo"`
	JoinedAt     string `json:"joined_at"`
}

// Defaults lists members who have missed at least one contribution, worst first.
func (r *AdminRepository) Defaults(ctx context.Context, limit int) ([]AdminDefault, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT m.id::text, c.id::text, c.name,
		       'user-' || right(m.user_id::text, 6),
		       m.state, m.missed_count, m.rotation_order,
		       (m.missed_count::bigint * c.contribution_kobo),
		       to_char(m.joined_at, 'YYYY-MM-DD"T"HH24:MI:SSZ')
		  FROM public.ajo_members m
		  JOIN public.ajo_circles c ON c.id = m.circle_id
		 WHERE m.state = 'DEFAULTED' OR m.missed_count > 0
		 ORDER BY m.missed_count DESC, m.joined_at ASC
		 LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AdminDefault{}
	for rows.Next() {
		var d AdminDefault
		if err := rows.Scan(&d.MemberID, &d.CircleID, &d.CircleName, &d.UserMasked,
			&d.State, &d.MissedCount, &d.RotationOrder, &d.ExposureKobo, &d.JoinedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

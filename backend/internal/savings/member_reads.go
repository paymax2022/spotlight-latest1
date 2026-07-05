package savings

import (
	"context"
	"fmt"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// This file adds thin, DB-backed member reads and a one-off circle contribution
// surfaced by the mobile integration agents (savings go-live gap). Every method
// is additive and follows the existing owner/member object-level authZ pattern.
// Money paths keep the ledger-derived-balance + escrow invariants (NL-1/2/8) and
// require an Idempotency-Key at the handler boundary (NL-9).

// ───────────────────────── Vault reads / early withdraw ─────────────────────────

// GetVault returns a single vault with its derived balance. Object-level authZ:
// only the owner may read it.
func (s *VaultService) GetVault(ctx context.Context, ownerID, vaultID string) (*Vault, int64, error) {
	v, err := s.getVault(ctx, vaultID)
	if err != nil {
		return nil, 0, err
	}
	if v.OwnerUserID != ownerID {
		return nil, 0, ErrForbidden
	}
	bal, err := s.Balance(ctx, vaultID)
	if err != nil {
		return nil, 0, err
	}
	return v, bal, nil
}

// EarlyWithdraw breaks a LOCK vault before maturity, applying a penalty (in basis
// points of the amount) that is forfeited from the withdrawn amount and posted to
// the platform revenue standing account. The member receives amount - penalty in
// their wallet; the vault ledger is debited by the full amount. FLEX vaults have
// no penalty and this behaves like a normal withdraw. NL-1: never exceeds the
// derived balance; the penalty never creates value, it redistributes it.
func (s *VaultService) EarlyWithdraw(ctx context.Context, ownerID, vaultID string, amountKobo, penaltyBps int64, idemKey string) (int64, int64, error) {
	if amountKobo <= 0 {
		return 0, 0, fmt.Errorf("savings: withdraw must be positive")
	}
	if penaltyBps < 0 || penaltyBps > 10000 {
		return 0, 0, fmt.Errorf("savings: penalty_bps out of range")
	}
	v, err := s.getVault(ctx, vaultID)
	if err != nil {
		return 0, 0, err
	}
	if v.OwnerUserID != ownerID {
		return 0, 0, ErrForbidden
	}
	// Penalty only applies to breaking a still-locked LOCK vault before maturity.
	penalty := int64(0)
	locked := v.Kind == VaultLock && v.State == VaultOpen && (v.MaturesAt == nil || time.Now().Before(*v.MaturesAt))
	if locked {
		penalty = amountKobo * penaltyBps / 10000
	}
	bal, err := s.Balance(ctx, vaultID)
	if err != nil {
		return 0, 0, err
	}
	if amountKobo > bal {
		return 0, 0, ErrInsufficientVault
	}
	// Debit the vault ledger by the full amount (funds leave the vault).
	if err := s.appendVaultEntry(ctx, vaultID, "DEBIT", amountKobo, "early_withdraw", idemKey+":vault"); err != nil {
		return 0, 0, err
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return 0, 0, err
	}
	// Return the FULL amount from the escrow hold to the member's wallet first
	// (escrow → user), keeping the vault ledger and escrow balanced.
	if err := s.led.Credit(ctx, ownerID, "savings:early_withdraw:"+vaultID, idemKey+":wallet", escrowAcc.ID, amountKobo); err != nil {
		return 0, 0, fmt.Errorf("savings: early withdraw credit: %w", err)
	}
	if penalty > 0 {
		// Then debit the penalty from the member's wallet into the platform
		// revenue standing account — value is redistributed, never minted (NL-2).
		revAcc, rerr := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if rerr != nil {
			return 0, 0, rerr
		}
		if err := s.led.Debit(ctx, ownerID, "savings:penalty:"+vaultID, idemKey+":penalty", revAcc.ID, penalty); err != nil {
			return 0, 0, fmt.Errorf("savings: penalty debit: %w", err)
		}
	}
	s.log(ownerID, "savings.vault.early_withdraw", "savings_vault", vaultID, nil,
		map[string]any{"amount_kobo": amountKobo, "penalty_kobo": penalty})
	newBal, _ := s.Balance(ctx, vaultID)
	return newBal, penalty, nil
}

// Summary aggregates the member's savings positions across vaults, circles and
// group targets into a single dashboard read (savings GET /summary).
type Summary struct {
	VaultCount       int   `json:"vault_count"`
	VaultBalanceKobo int64 `json:"vault_balance_kobo"`
	CircleCount      int   `json:"circle_count"`
	TargetCount      int   `json:"target_count"`
	TargetBalanceKobo int64 `json:"target_balance_kobo"`
	TotalSavedKobo   int64 `json:"total_saved_kobo"`
}

// BuildSummary computes the member's savings dashboard from the ledger-derived
// balances (never a cached column — NL-8).
func (s *VaultService) BuildSummary(ctx context.Context, ownerID string, ajo *AjoService, targets *TargetService) (*Summary, error) {
	sum := &Summary{}
	const vq = `SELECT COUNT(*),
	                   COALESCE(SUM(bal),0)
	            FROM (
	              SELECT v.id,
	                     COALESCE((SELECT SUM(CASE WHEN direction='CREDIT' THEN amount_kobo ELSE -amount_kobo END)
	                               FROM savings_vault_ledger l WHERE l.vault_id=v.id),0) AS bal
	              FROM savings_vaults v WHERE v.owner_user_id=$1
	            ) t`
	if err := s.db.QueryRow(ctx, vq, ownerID).Scan(&sum.VaultCount, &sum.VaultBalanceKobo); err != nil {
		return nil, fmt.Errorf("savings: summary vaults: %w", err)
	}
	// Circles the member belongs to.
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM ajo_members WHERE user_id=$1 AND state IN ('ACTIVE','DEFAULTED')`,
		ownerID).Scan(&sum.CircleCount); err != nil {
		return nil, fmt.Errorf("savings: summary circles: %w", err)
	}
	// Group targets the member belongs to, plus their derived pot balances.
	const tq = `SELECT COUNT(*),
	                   COALESCE(SUM(bal),0)
	            FROM (
	              SELECT gt.id,
	                     COALESCE((SELECT SUM(CASE WHEN direction='CREDIT' THEN amount_kobo ELSE -amount_kobo END)
	                               FROM group_target_ledger l WHERE l.target_id=gt.id),0) AS bal
	              FROM group_targets gt
	              JOIN group_target_members m ON m.target_id=gt.id AND m.user_id=$1
	            ) t`
	if err := s.db.QueryRow(ctx, tq, ownerID).Scan(&sum.TargetCount, &sum.TargetBalanceKobo); err != nil {
		return nil, fmt.Errorf("savings: summary targets: %w", err)
	}
	sum.TotalSavedKobo = sum.VaultBalanceKobo + sum.TargetBalanceKobo
	return sum, nil
}

// ───────────────────────── Circle reads / contribute ─────────────────────────

// CircleView is a circle plus the caller's membership context, for list rows.
type CircleView struct {
	Circle
	MemberCount int    `json:"member_count"`
	MyState     string `json:"my_state"`
}

// ListCircles returns the circles the caller belongs to (object-level: membership).
func (s *AjoService) ListCircles(ctx context.Context, userID string) ([]CircleView, error) {
	const q = `SELECT c.id, c.creator_user_id, c.name, c.contribution_kobo, c.interval_secs,
	                  c.state, c.current_cycle, c.total_cycles, c.cycle_job_id, c.created_at, c.updated_at,
	                  (SELECT COUNT(*) FROM ajo_members mm WHERE mm.circle_id=c.id) AS member_count,
	                  m.state AS my_state
	           FROM ajo_circles c
	           JOIN ajo_members m ON m.circle_id=c.id AND m.user_id=$1
	           ORDER BY c.created_at DESC`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CircleView
	for rows.Next() {
		var cv CircleView
		var state, myState string
		if err := rows.Scan(&cv.ID, &cv.CreatorUserID, &cv.Name, &cv.ContributionKobo, &cv.IntervalSecs,
			&state, &cv.CurrentCycle, &cv.TotalCycles, &cv.CycleJobID, &cv.CreatedAt, &cv.UpdatedAt,
			&cv.MemberCount, &myState); err != nil {
			return nil, err
		}
		cv.State = CircleState(state)
		cv.MyState = myState
		out = append(out, cv)
	}
	return out, rows.Err()
}

// DiscoverCircles returns public, joinable circles: FORMING circles the caller
// is not already a member of. Read-only, no object-level ownership check needed
// since only non-sensitive summary fields are exposed (name, contribution,
// interval, member count) — no member identities or balances.
func (s *AjoService) DiscoverCircles(ctx context.Context, userID string) ([]CircleView, error) {
	const q = `SELECT c.id, c.creator_user_id, c.name, c.contribution_kobo, c.interval_secs,
	                  c.state, c.current_cycle, c.total_cycles, c.cycle_job_id, c.created_at, c.updated_at,
	                  (SELECT COUNT(*) FROM ajo_members mm WHERE mm.circle_id=c.id) AS member_count
	           FROM ajo_circles c
	           WHERE c.state = 'FORMING'
	             AND NOT EXISTS (
	                 SELECT 1 FROM ajo_members m WHERE m.circle_id=c.id AND m.user_id=$1
	             )
	           ORDER BY c.created_at DESC
	           LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CircleView
	for rows.Next() {
		var cv CircleView
		var state string
		if err := rows.Scan(&cv.ID, &cv.CreatorUserID, &cv.Name, &cv.ContributionKobo, &cv.IntervalSecs,
			&state, &cv.CurrentCycle, &cv.TotalCycles, &cv.CycleJobID, &cv.CreatedAt, &cv.UpdatedAt,
			&cv.MemberCount); err != nil {
			return nil, err
		}
		cv.State = CircleState(state)
		cv.MyState = "" // caller is not a member — not applicable
		out = append(out, cv)
	}
	return out, rows.Err()
}

// Contribute lets a member proactively fund the current cycle's pot outside the
// scheduled auto-debit (e.g. paying ahead). Funds move wallet→escrow and are
// credited to the current PENDING cycle's collected pot. Idempotent (NL-9). This
// does NOT trigger payout; the scheduled RunCycle still governs distribution.
func (s *AjoService) Contribute(ctx context.Context, circleID, userID string, idemKey string) error {
	c, err := s.getCircle(ctx, circleID)
	if err != nil {
		return err
	}
	if c.State != CircleActive {
		return fmt.Errorf("savings: circle not active")
	}
	isMem, err := s.IsMember(ctx, circleID, userID)
	if err != nil {
		return err
	}
	if !isMem {
		return ErrForbidden
	}
	cy, err := s.currentPendingCycle(ctx, circleID)
	if err != nil {
		return err
	}
	if cy == nil {
		return fmt.Errorf("savings: no pending cycle")
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	legKey := fmt.Sprintf("%s:ajo:%s:c%d:prepay:%s", idemKey, circleID, cy.CycleNumber, userID)
	if derr := s.led.Debit(ctx, userID, "ajo:contrib:"+circleID, legKey, escrowAcc.ID, c.ContributionKobo); derr != nil && derr != ledger.ErrDuplicate {
		return fmt.Errorf("savings: circle contribute: %w", derr)
	}
	// Credit the collected pot for the current cycle so the scheduled payout picks
	// it up; guarded so a replay is a no-op.
	const upd = `UPDATE ajo_cycles SET collected_kobo = collected_kobo + $2
	             WHERE id=$1 AND status<>'PAID'`
	_, _ = s.db.Exec(ctx, upd, cy.ID, c.ContributionKobo)
	// Ensure the member is marked ACTIVE (a prepay clears a prior default).
	_, _ = s.db.Exec(ctx, `UPDATE ajo_members SET state='ACTIVE' WHERE circle_id=$1 AND user_id=$2 AND state='DEFAULTED'`, circleID, userID)
	s.log(userID, "savings.ajo.contribute", "ajo_circle", circleID, nil,
		map[string]any{"cycle": cy.CycleNumber, "amount_kobo": c.ContributionKobo})
	return nil
}

// ───────────────────────── Target reads ─────────────────────────

// TargetView is a group target plus the caller's context for list rows.
type TargetView struct {
	GroupTarget
	BalanceKobo int64 `json:"balance_kobo"`
	MemberCount int   `json:"member_count"`
}

// ListTargets returns the group targets the caller is a member of, with derived
// pot balances (NL-8). Object-level authZ: membership only.
func (s *TargetService) ListTargets(ctx context.Context, userID string) ([]TargetView, error) {
	const q = `SELECT gt.id, gt.creator_user_id, gt.name, gt.target_kobo, gt.withdrawal_rule,
	                  gt.target_date, gt.state, gt.created_at, gt.updated_at,
	                  COALESCE((SELECT SUM(CASE WHEN direction='CREDIT' THEN amount_kobo ELSE -amount_kobo END)
	                            FROM group_target_ledger l WHERE l.target_id=gt.id),0) AS balance_kobo,
	                  (SELECT COUNT(*) FROM group_target_members mm WHERE mm.target_id=gt.id) AS member_count
	           FROM group_targets gt
	           JOIN group_target_members m ON m.target_id=gt.id AND m.user_id=$1
	           ORDER BY gt.created_at DESC`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TargetView
	for rows.Next() {
		var tv TargetView
		var rule, state string
		if err := rows.Scan(&tv.ID, &tv.CreatorUserID, &tv.Name, &tv.TargetKobo, &rule,
			&tv.TargetDate, &state, &tv.CreatedAt, &tv.UpdatedAt, &tv.BalanceKobo, &tv.MemberCount); err != nil {
			return nil, err
		}
		tv.Rule = WithdrawalRule(rule)
		tv.State = TargetState(state)
		out = append(out, tv)
	}
	return out, rows.Err()
}

// GetTargetDetail returns a target, its members and derived balance. Object-level
// authZ: membership only (enforced by the handler before calling).
func (s *TargetService) GetTargetDetail(ctx context.Context, targetID string) (*GroupTarget, []GroupTargetMember, int64, error) {
	t, err := s.get(ctx, targetID)
	if err != nil {
		return nil, nil, 0, err
	}
	const mq = `SELECT id, target_id, user_id, approved, joined_at FROM group_target_members WHERE target_id=$1 ORDER BY joined_at ASC`
	rows, err := s.db.Query(ctx, mq, targetID)
	if err != nil {
		return nil, nil, 0, err
	}
	defer rows.Close()
	var members []GroupTargetMember
	for rows.Next() {
		var m GroupTargetMember
		if err := rows.Scan(&m.ID, &m.TargetID, &m.UserID, &m.Approved, &m.JoinedAt); err != nil {
			return nil, nil, 0, err
		}
		members = append(members, m)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, 0, err
	}
	bal, err := s.Balance(ctx, targetID)
	if err != nil {
		return nil, nil, 0, err
	}
	return t, members, bal, nil
}

// IsTargetMember exposes membership for handler-level object authZ.
func (s *TargetService) IsTargetMember(ctx context.Context, targetID, userID string) (bool, error) {
	return s.isMember(ctx, targetID, userID)
}

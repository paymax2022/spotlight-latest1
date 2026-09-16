package savings

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// TargetService implements Group Target savings: a shared pot many members fund
// toward a goal. Balance is ledger-derived from group_target contributions held
// in the escrow standing account (NL-8). NL-2: no yield. Withdrawal is guarded by
// the configured rule: ON_DATE (only after target_date) or MAJORITY (> half of
// members approve). On release the full pot returns to the creator's wallet (the
// pot organiser disburses off-ledger or per agreement) — Paymax never lends and
// never adds value (NL-1/NL-2).
type TargetService struct {
	db    *pgxpool.Pool
	led   *ledger.Service
	audit Auditor
}

func NewTargetService(db *pgxpool.Pool, led *ledger.Service, audit Auditor) *TargetService {
	return &TargetService{db: db, led: led, audit: audit}
}

// Create opens a group target with the creator as the first member.
func (s *TargetService) Create(ctx context.Context, creatorID, name string, targetKobo int64, rule WithdrawalRule, targetDate *time.Time) (*GroupTarget, error) {
	if creatorID == "" || name == "" {
		return nil, fmt.Errorf("savings: creator and name required")
	}
	if targetKobo <= 0 {
		return nil, fmt.Errorf("savings: target must be positive")
	}
	if rule == RuleOnDate && targetDate == nil {
		return nil, fmt.Errorf("savings: ON_DATE rule requires a target date")
	}
	if rule != RuleOnDate && rule != RuleMajority {
		return nil, fmt.Errorf("savings: unknown withdrawal rule")
	}
	t := &GroupTarget{
		ID: uuid.New().String(), CreatorUserID: creatorID, Name: name, TargetKobo: targetKobo,
		Rule: rule, TargetDate: targetDate, State: TargetOpen, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	const insT = `INSERT INTO group_targets (id, creator_user_id, name, target_kobo, withdrawal_rule, target_date, state)
	              VALUES ($1,$2,$3,$4,$5,$6,'OPEN')`
	if _, err := tx.Exec(ctx, insT, t.ID, t.CreatorUserID, t.Name, t.TargetKobo, string(t.Rule), t.TargetDate); err != nil {
		return nil, fmt.Errorf("savings: insert target: %w", err)
	}
	const insM = `INSERT INTO group_target_members (id, target_id, user_id) VALUES ($1,$2,$3)`
	if _, err := tx.Exec(ctx, insM, uuid.New().String(), t.ID, creatorID); err != nil {
		return nil, fmt.Errorf("savings: insert target member: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.log(creatorID, "savings.target.create", "group_target", t.ID, nil, map[string]any{"rule": rule})
	return t, nil
}

// Join adds a member to an OPEN target.
func (s *TargetService) Join(ctx context.Context, targetID, userID string) error {
	t, err := s.get(ctx, targetID)
	if err != nil {
		return err
	}
	if t.State != TargetOpen {
		return fmt.Errorf("savings: target not open")
	}
	const ins = `INSERT INTO group_target_members (id, target_id, user_id) VALUES ($1,$2,$3)
	             ON CONFLICT (target_id, user_id) DO NOTHING`
	_, err = s.db.Exec(ctx, ins, uuid.New().String(), targetID, userID)
	if err != nil {
		return fmt.Errorf("savings: join target: %w", err)
	}
	s.log(userID, "savings.target.join", "group_target", targetID, nil, nil)
	return nil
}

// Balance returns the derived pot balance in kobo (NL-8).
// BalanceForMember is the ONLY pot-balance read that may be reached from a
// request handler. Balance() below takes no caller identity and so cannot be
// authorized; exposing it directly let any authenticated user read any pot's
// balance by id. RLS does not cover this — the backend connects as table owner.
func (s *TargetService) BalanceForMember(ctx context.Context, userID, targetID string) (int64, error) {
	ok, err := s.isMember(ctx, targetID, userID)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, ErrForbidden
	}
	return s.Balance(ctx, targetID)
}

// Balance is UNAUTHORIZED by construction — see BalanceForMember.
func (s *TargetService) Balance(ctx context.Context, targetID string) (int64, error) {
	const q = `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_kobo ELSE -amount_kobo END),0)
	           FROM group_target_ledger WHERE target_id=$1`
	var bal int64
	if err := s.db.QueryRow(ctx, q, targetID).Scan(&bal); err != nil {
		return 0, fmt.Errorf("savings: target balance: %w", err)
	}
	return bal, nil
}

// Contribute moves money from a member's wallet into the pot. Member must belong
// to the target (object-level authZ). idemKey makes it replay-safe (NL-9).
func (s *TargetService) Contribute(ctx context.Context, targetID, userID string, amountKobo int64, idemKey string) (int64, error) {
	if amountKobo <= 0 {
		return 0, fmt.Errorf("savings: contribution must be positive")
	}
	t, err := s.get(ctx, targetID)
	if err != nil {
		return 0, err
	}
	if t.State != TargetOpen && t.State != TargetReached {
		return 0, fmt.Errorf("savings: target not accepting contributions")
	}
	member, err := s.isMember(ctx, targetID, userID)
	if err != nil {
		return 0, err
	}
	if !member {
		return 0, ErrForbidden
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return 0, err
	}
	if err := s.led.Debit(ctx, userID, "target:contrib:"+targetID, idemKey+":wallet", escrowAcc.ID, amountKobo); err != nil {
		return 0, fmt.Errorf("savings: contribute debit: %w", err)
	}
	const ins = `INSERT INTO group_target_ledger (id, target_id, user_id, direction, amount_kobo, idempotency_key)
	             VALUES ($1,$2,$3,'CREDIT',$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, uuid.New().String(), targetID, userID, amountKobo, idemKey+":pot"); err != nil {
		return 0, fmt.Errorf("savings: contribute entry: %w", err)
	}
	bal, _ := s.Balance(ctx, targetID)
	// Mark REACHED once the goal is met (guarded; OPEN→REACHED).
	if bal >= t.TargetKobo && t.State == TargetOpen {
		_, _ = s.db.Exec(ctx, `UPDATE group_targets SET state='REACHED', updated_at=now() WHERE id=$1 AND state='OPEN'`, targetID)
	}
	s.log(userID, "savings.target.contribute", "group_target", targetID, nil, map[string]any{"amount_kobo": amountKobo})
	return bal, nil
}

// Approve records a member's approval for a MAJORITY-rule release.
func (s *TargetService) Approve(ctx context.Context, targetID, userID string) error {
	member, err := s.isMember(ctx, targetID, userID)
	if err != nil {
		return err
	}
	if !member {
		return ErrForbidden
	}
	const q = `UPDATE group_target_members SET approved=true WHERE target_id=$1 AND user_id=$2`
	_, err = s.db.Exec(ctx, q, targetID, userID)
	if err != nil {
		return fmt.Errorf("savings: approve: %w", err)
	}
	s.log(userID, "savings.target.approve", "group_target", targetID, nil, nil)
	return nil
}

// Release disburses the full pot to the creator's wallet once the rule is met.
// ON_DATE: now >= target_date. MAJORITY: > half of members approved. Guarded
// transition OPEN|REACHED → RELEASED; the pot balance returns from escrow (NL-8).
func (s *TargetService) Release(ctx context.Context, actorID, targetID, idemKey string) error {
	t, err := s.get(ctx, targetID)
	if err != nil {
		return err
	}
	if t.CreatorUserID != actorID {
		return ErrForbidden
	}
	if !canTarget(t.State, TargetReleased) {
		return fmt.Errorf("savings: cannot release from %s", t.State)
	}
	switch t.Rule {
	case RuleOnDate:
		if t.TargetDate == nil || time.Now().Before(*t.TargetDate) {
			return ErrReleaseRuleUnmet
		}
	case RuleMajority:
		ok, err := s.majorityApproved(ctx, targetID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrReleaseRuleUnmet
		}
	}
	bal, err := s.Balance(ctx, targetID)
	if err != nil {
		return err
	}
	if bal <= 0 {
		return fmt.Errorf("savings: empty pot")
	}
	// Flip state first (guarded), then post the escrow→creator credit.
	const upd = `UPDATE group_targets SET state='RELEASED', updated_at=now() WHERE id=$1 AND state IN ('OPEN','REACHED')`
	ct, err := s.db.Exec(ctx, upd, targetID)
	if err != nil || ct.RowsAffected() == 0 {
		return fmt.Errorf("savings: release transition failed")
	}
	const drain = `INSERT INTO group_target_ledger (id, target_id, user_id, direction, amount_kobo, idempotency_key)
	               VALUES ($1,$2,$3,'DEBIT',$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, drain, uuid.New().String(), targetID, t.CreatorUserID, bal, idemKey+":drain"); err != nil {
		return fmt.Errorf("savings: release drain: %w", err)
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	if err := s.led.Credit(ctx, t.CreatorUserID, "target:release:"+targetID, idemKey+":wallet", escrowAcc.ID, bal); err != nil {
		return fmt.Errorf("savings: release credit: %w", err)
	}
	s.log(actorID, "savings.target.release", "group_target", targetID,
		map[string]any{"state": string(t.State)}, map[string]any{"state": "RELEASED", "amount_kobo": bal})
	return nil
}

func (s *TargetService) majorityApproved(ctx context.Context, targetID string) (bool, error) {
	var total, approved int
	if err := s.db.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE approved) FROM group_target_members WHERE target_id=$1`, targetID).Scan(&total, &approved); err != nil {
		return false, err
	}
	return total > 0 && approved*2 > total, nil
}

func (s *TargetService) isMember(ctx context.Context, targetID, userID string) (bool, error) {
	var n int
	err := s.db.QueryRow(ctx, `SELECT count(*) FROM group_target_members WHERE target_id=$1 AND user_id=$2`, targetID, userID).Scan(&n)
	return n > 0, err
}

func (s *TargetService) get(ctx context.Context, targetID string) (*GroupTarget, error) {
	const q = `SELECT id, creator_user_id, name, target_kobo, withdrawal_rule, target_date, state
	           FROM group_targets WHERE id=$1`
	var t GroupTarget
	var rule, state string
	if err := s.db.QueryRow(ctx, q, targetID).Scan(&t.ID, &t.CreatorUserID, &t.Name,
		&t.TargetKobo, &rule, &t.TargetDate, &state); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	t.Rule = WithdrawalRule(rule)
	t.State = TargetState(state)
	return &t, nil
}

// Get returns a target (object-level authZ enforced by handler/RLS).
func (s *TargetService) Get(ctx context.Context, targetID string) (*GroupTarget, error) {
	return s.get(ctx, targetID)
}

func (s *TargetService) log(actor, action, resType, resID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "savings", resType, resID, oldV, newV, "", "", "info")
}

// Sentinel errors specific to targets.
var ErrReleaseRuleUnmet = fmt.Errorf("savings: withdrawal rule not yet satisfied")

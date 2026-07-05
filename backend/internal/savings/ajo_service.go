package savings

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/scheduler"
)

// AjoCycleJobType is the scheduler handler key driving per-cycle auto-debit + payout.
const AjoCycleJobType = "savings.ajo_cycle"

// AjoService implements the Ajo/Esusu rotation engine.
//
// NL-7 (peer rotation): every cycle, each ACTIVE member is auto-debited the
// contribution and the pooled total is paid to the ONE scheduled recipient for
// that cycle; the rotation order then advances. Paymax is ONLY the ledger +
// escrow — it never advances its own capital (NL-1) and is never a guarantor:
// if a member fails to fund, the pool simply pays out what was actually
// collected (the recipient bears the peer shortfall, not Paymax), the missing
// member is marked DEFAULTED, and the make-good policy lets them restore. NL-2:
// no yield — a recipient receives exactly the sum of peer contributions, never
// more. Money flows wallet→escrow on debit and escrow→recipient on payout, all
// ledger-derived (NL-8) and idempotent per cycle (NL-9).
type AjoService struct {
	db    *pgxpool.Pool
	led   *ledger.Service
	sched *scheduler.Service
	audit Auditor
}

func NewAjoService(db *pgxpool.Pool, led *ledger.Service, sched *scheduler.Service, audit Auditor) *AjoService {
	return &AjoService{db: db, led: led, sched: sched, audit: audit}
}

// RegisterCycleRunner wires the per-cycle auto-debit+payout handler.
func (s *AjoService) RegisterCycleRunner() {
	if s.sched == nil {
		return
	}
	s.sched.RegisterJobType(AjoCycleJobType, s.cycleRunner())
}

func (s *AjoService) cycleRunner() scheduler.HandlerFunc {
	return func(jc scheduler.HandlerCtx) error {
		return s.RunCycle(jc.Context(), jc.Job().EntityRef(), jc.IdemKey())
	}
}

// CreateCircle creates a FORMING circle with the creator as the first member.
func (s *AjoService) CreateCircle(ctx context.Context, creatorID, name string, contributionKobo, intervalSecs int64) (*Circle, error) {
	if creatorID == "" || name == "" {
		return nil, fmt.Errorf("savings: creator and name required")
	}
	if contributionKobo <= 0 || intervalSecs <= 0 {
		return nil, fmt.Errorf("savings: contribution and interval must be positive")
	}
	c := &Circle{
		ID: uuid.New().String(), CreatorUserID: creatorID, Name: name,
		ContributionKobo: contributionKobo, IntervalSecs: intervalSecs,
		State: CircleForming, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	const insC = `INSERT INTO ajo_circles (id, creator_user_id, name, contribution_kobo, interval_secs, state)
	              VALUES ($1,$2,$3,$4,$5,'FORMING')`
	if _, err := tx.Exec(ctx, insC, c.ID, c.CreatorUserID, c.Name, c.ContributionKobo, c.IntervalSecs); err != nil {
		return nil, fmt.Errorf("savings: insert circle: %w", err)
	}
	const insM = `INSERT INTO ajo_members (id, circle_id, user_id, rotation_order, state)
	              VALUES ($1,$2,$3,0,'ACTIVE')`
	if _, err := tx.Exec(ctx, insM, uuid.New().String(), c.ID, creatorID); err != nil {
		return nil, fmt.Errorf("savings: insert creator member: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.log(creatorID, "savings.ajo.create", "ajo_circle", c.ID, nil, map[string]any{"name": name})
	return c, nil
}

// Join adds a member (INVITED→ACTIVE on accept). Only allowed while FORMING.
// Rotation order is assigned sequentially by join time (deterministic).
func (s *AjoService) Join(ctx context.Context, circleID, userID string) (*CircleMember, error) {
	c, err := s.getCircle(ctx, circleID)
	if err != nil {
		return nil, err
	}
	if c.State != CircleForming {
		return nil, fmt.Errorf("savings: circle no longer accepting members")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var nextOrder int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(rotation_order)+1,0) FROM ajo_members WHERE circle_id=$1`, circleID).Scan(&nextOrder); err != nil {
		return nil, err
	}
	m := &CircleMember{ID: uuid.New().String(), CircleID: circleID, UserID: userID, RotationOrder: nextOrder, State: MemberActive, JoinedAt: time.Now()}
	const ins = `INSERT INTO ajo_members (id, circle_id, user_id, rotation_order, state)
	             VALUES ($1,$2,$3,$4,'ACTIVE')
	             ON CONFLICT (circle_id, user_id) DO NOTHING`
	ct, err := tx.Exec(ctx, ins, m.ID, circleID, userID, nextOrder)
	if err != nil {
		return nil, fmt.Errorf("savings: join: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, fmt.Errorf("savings: already a member")
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.log(userID, "savings.ajo.join", "ajo_circle", circleID, nil, map[string]any{"order": nextOrder})
	return m, nil
}

// Activate locks the membership, fixes total_cycles = active member count, seeds
// the first cycle's recipient and schedules the recurring cycle job.
func (s *AjoService) Activate(ctx context.Context, actorID, circleID string) error {
	c, err := s.getCircle(ctx, circleID)
	if err != nil {
		return err
	}
	if c.CreatorUserID != actorID {
		return ErrForbidden
	}
	if !canCircle(c.State, CircleActive) {
		return fmt.Errorf("savings: cannot activate from %s", c.State)
	}
	members, err := s.activeMembers(ctx, circleID)
	if err != nil {
		return err
	}
	if len(members) < 2 {
		return fmt.Errorf("savings: circle needs at least 2 members")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	const upd = `UPDATE ajo_circles SET state='ACTIVE', total_cycles=$2, current_cycle=1, updated_at=now()
	             WHERE id=$1 AND state='FORMING'`
	ct, err := tx.Exec(ctx, upd, circleID, len(members))
	if err != nil || ct.RowsAffected() == 0 {
		return fmt.Errorf("savings: activate failed")
	}
	// Seed cycle 1 (recipient = rotation_order 0).
	first := members[0]
	scheduledFor := time.Now().Add(time.Duration(c.IntervalSecs) * time.Second)
	const insCy = `INSERT INTO ajo_cycles (id, circle_id, cycle_number, recipient_id, status, scheduled_for)
	               VALUES ($1,$2,1,$3,'PENDING',$4) ON CONFLICT (circle_id, cycle_number) DO NOTHING`
	if _, err := tx.Exec(ctx, insCy, uuid.New().String(), circleID, first.UserID, scheduledFor); err != nil {
		return fmt.Errorf("savings: seed cycle: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	// Schedule the recurring cycle runner.
	if s.sched != nil {
		job, jerr := s.sched.Schedule(ctx, scheduler.Job{
			JobType:      AjoCycleJobType,
			OwnerUserID:  c.CreatorUserID,
			EntityRef:    circleID,
			IntervalSecs: c.IntervalSecs,
			NextRunAt:    scheduledFor,
			MaxRuns:      int64(len(members)),
		})
		if jerr == nil {
			_, _ = s.db.Exec(ctx, `UPDATE ajo_circles SET cycle_job_id=$2 WHERE id=$1`, circleID, job.ID)
		}
	}
	s.log(actorID, "savings.ajo.activate", "ajo_circle", circleID,
		map[string]any{"state": "FORMING"}, map[string]any{"state": "ACTIVE", "cycles": len(members)})
	return nil
}

// RunCycle executes the current PENDING cycle: auto-debit every ACTIVE member into
// escrow, pay the collected total to the scheduled recipient, advance rotation.
// idemKey (the scheduler run key) makes the whole cycle replay-safe (NL-9).
func (s *AjoService) RunCycle(ctx context.Context, circleID, idemKey string) error {
	c, err := s.getCircle(ctx, circleID)
	if err != nil {
		return err
	}
	if c.State != CircleActive {
		return nil // nothing to do; completed/cancelled circles are no-ops
	}
	cy, err := s.currentPendingCycle(ctx, circleID)
	if err != nil {
		return err
	}
	if cy == nil {
		return nil
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	members, err := s.activeMembers(ctx, circleID)
	if err != nil {
		return err
	}

	var collected int64
	for _, m := range members {
		legKey := fmt.Sprintf("%s:ajo:%s:c%d:debit:%s", idemKey, circleID, cy.CycleNumber, m.UserID)
		// NL-1: peer funds only — Debit fails closed on insufficient balance; the
		// shortfall is NOT covered by Paymax. A failing member is marked DEFAULTED.
		derr := s.led.Debit(ctx, m.UserID, "ajo:contrib:"+circleID, legKey, escrowAcc.ID, c.ContributionKobo)
		if derr == ledger.ErrDuplicate {
			collected += c.ContributionKobo // already debited on a prior attempt
			continue
		}
		if derr != nil {
			s.markDefault(ctx, circleID, m.UserID)
			continue
		}
		collected += c.ContributionKobo
	}

	// NL-7/NL-2: recipient receives EXACTLY what peers funded — never more, never
	// a Paymax-funded guarantee of the full ring amount.
	payoutKey := fmt.Sprintf("%s:ajo:%s:c%d:payout", idemKey, circleID, cy.CycleNumber)
	if collected > 0 {
		if perr := s.led.Credit(ctx, cy.RecipientID, "ajo:payout:"+circleID, payoutKey, escrowAcc.ID, collected); perr != nil && perr != ledger.ErrDuplicate {
			return fmt.Errorf("savings: ajo payout: %w", perr)
		}
	}

	if err := s.completeCycleAndRotate(ctx, c, cy, collected, members); err != nil {
		return err
	}
	s.log(c.CreatorUserID, "savings.ajo.cycle_paid", "ajo_cycle", cy.ID,
		nil, map[string]any{"cycle": cy.CycleNumber, "recipient": cy.RecipientID, "collected_kobo": collected})
	return nil
}

// completeCycleAndRotate marks the cycle PAID and seeds the next cycle (or
// completes the circle when the rotation is exhausted).
func (s *AjoService) completeCycleAndRotate(ctx context.Context, c *Circle, cy *Cycle, collected int64, members []CircleMember) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	const payCy = `UPDATE ajo_cycles SET status='PAID', collected_kobo=$2, payout_kobo=$2, paid_at=now()
	               WHERE id=$1 AND status<>'PAID'`
	if _, err := tx.Exec(ctx, payCy, cy.ID, collected); err != nil {
		return fmt.Errorf("savings: mark cycle paid: %w", err)
	}

	nextNum := cy.CycleNumber + 1
	if nextNum > len(members) {
		const done = `UPDATE ajo_circles SET state='COMPLETED', current_cycle=$2, updated_at=now() WHERE id=$1`
		if _, err := tx.Exec(ctx, done, c.ID, cy.CycleNumber); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	// Next recipient = next rotation_order in the original join order.
	next := members[nextNum-1]
	scheduledFor := time.Now().Add(time.Duration(c.IntervalSecs) * time.Second)
	const insCy = `INSERT INTO ajo_cycles (id, circle_id, cycle_number, recipient_id, status, scheduled_for)
	               VALUES ($1,$2,$3,$4,'PENDING',$5) ON CONFLICT (circle_id, cycle_number) DO NOTHING`
	if _, err := tx.Exec(ctx, insCy, uuid.New().String(), c.ID, nextNum, next.UserID, scheduledFor); err != nil {
		return err
	}
	const advance = `UPDATE ajo_circles SET current_cycle=$2, updated_at=now() WHERE id=$1`
	if _, err := tx.Exec(ctx, advance, c.ID, nextNum); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// MakeGood lets a DEFAULTED member restore by paying the missed contribution into
// escrow for the cycle they missed (peer make-good policy). NL-1: their own funds.
func (s *AjoService) MakeGood(ctx context.Context, circleID, userID string, cycleNumber int, idemKey string) error {
	c, err := s.getCircle(ctx, circleID)
	if err != nil {
		return err
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	key := fmt.Sprintf("%s:ajo:%s:c%d:makegood:%s", idemKey, circleID, cycleNumber, userID)
	if derr := s.led.Debit(ctx, userID, "ajo:makegood:"+circleID, key, escrowAcc.ID, c.ContributionKobo); derr != nil && derr != ledger.ErrDuplicate {
		return fmt.Errorf("savings: makegood debit: %w", derr)
	}
	// Restore membership DEFAULTED→ACTIVE (guarded).
	const restore = `UPDATE ajo_members SET state='ACTIVE' WHERE circle_id=$1 AND user_id=$2 AND state='DEFAULTED'`
	_, _ = s.db.Exec(ctx, restore, circleID, userID)
	s.log(userID, "savings.ajo.makegood", "ajo_circle", circleID, nil, map[string]any{"cycle": cycleNumber})
	return nil
}

func (s *AjoService) markDefault(ctx context.Context, circleID, userID string) {
	const q = `UPDATE ajo_members SET state='DEFAULTED', missed_count=missed_count+1
	           WHERE circle_id=$1 AND user_id=$2 AND state='ACTIVE'`
	_, _ = s.db.Exec(ctx, q, circleID, userID)
	s.log(userID, "savings.ajo.default", "ajo_circle", circleID, nil, map[string]any{"user": userID})
}

func (s *AjoService) getCircle(ctx context.Context, circleID string) (*Circle, error) {
	const q = `SELECT id, creator_user_id, name, contribution_kobo, interval_secs, state, current_cycle, total_cycles, cycle_job_id
	           FROM ajo_circles WHERE id=$1`
	var c Circle
	var state string
	if err := s.db.QueryRow(ctx, q, circleID).Scan(&c.ID, &c.CreatorUserID, &c.Name,
		&c.ContributionKobo, &c.IntervalSecs, &state, &c.CurrentCycle, &c.TotalCycles, &c.CycleJobID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.State = CircleState(state)
	return &c, nil
}

func (s *AjoService) activeMembers(ctx context.Context, circleID string) ([]CircleMember, error) {
	const q = `SELECT id, circle_id, user_id, rotation_order, state, missed_count, joined_at
	           FROM ajo_members WHERE circle_id=$1 AND state IN ('ACTIVE','DEFAULTED')
	           ORDER BY rotation_order ASC`
	rows, err := s.db.Query(ctx, q, circleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CircleMember
	for rows.Next() {
		var m CircleMember
		var st string
		if err := rows.Scan(&m.ID, &m.CircleID, &m.UserID, &m.RotationOrder, &st, &m.MissedCount, &m.JoinedAt); err != nil {
			return nil, err
		}
		m.State = MemberState(st)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *AjoService) currentPendingCycle(ctx context.Context, circleID string) (*Cycle, error) {
	const q = `SELECT id, circle_id, cycle_number, recipient_id, collected_kobo, payout_kobo, status, scheduled_for, paid_at
	           FROM ajo_cycles WHERE circle_id=$1 AND status<>'PAID' ORDER BY cycle_number ASC LIMIT 1`
	var cy Cycle
	var st string
	if err := s.db.QueryRow(ctx, q, circleID).Scan(&cy.ID, &cy.CircleID, &cy.CycleNumber,
		&cy.RecipientID, &cy.CollectedKobo, &cy.PayoutKobo, &st, &cy.ScheduledFor, &cy.PaidAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	cy.Status = CycleStatus(st)
	return &cy, nil
}

// GetCircle returns circle + members + cycles for display (object-level authZ in handler).
func (s *AjoService) GetCircle(ctx context.Context, circleID string) (*Circle, []CircleMember, error) {
	c, err := s.getCircle(ctx, circleID)
	if err != nil {
		return nil, nil, err
	}
	m, err := s.activeMembers(ctx, circleID)
	return c, m, err
}

// IsMember reports whether userID belongs to the circle (object-level authZ).
func (s *AjoService) IsMember(ctx context.Context, circleID, userID string) (bool, error) {
	var n int
	err := s.db.QueryRow(ctx, `SELECT count(*) FROM ajo_members WHERE circle_id=$1 AND user_id=$2`, circleID, userID).Scan(&n)
	return n > 0, err
}

func (s *AjoService) log(actor, action, resType, resID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "savings", resType, resID, oldV, newV, "", "", "info")
}

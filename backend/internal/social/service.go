package social

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/finance/ledger"
)

// Auditor is the immutable-audit slice the social module needs (NL-12). nil-safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Service implements Social Pay: P2P send/request on cashtag, split-bill and
// group pool. All money moves through the finance ledger (NL-8), is idempotent
// (NL-9) and is subject to AML velocity limits (NL-10). Object-level authZ is
// enforced in every method (you cannot request as someone else, cannot pay a
// request that is not addressed to you, cannot pay out a pool you do not own).
type Service struct {
	db    *pgxpool.Pool
	led   *ledger.Service
	tags  *cashtag.Service
	aml   *AML
	audit Auditor
}

func NewService(db *pgxpool.Pool, led *ledger.Service, tags *cashtag.Service, aml *AML, audit Auditor) *Service {
	return &Service{db: db, led: led, tags: tags, aml: aml, audit: audit}
}

// ───────────────────────── P2P send ─────────────────────────

// Send transfers amountKobo from senderID to the user behind recipientHandle.
// Wallet→wallet via the ledger (commission account is NOT used — this is a pure
// peer transfer). idemKey makes it replay-safe (NL-9). AML checked first (NL-10).
func (s *Service) Send(ctx context.Context, senderID, recipientHandle, note, idemKey string, amountKobo int64) (*Payment, error) {
	if senderID == "" || idemKey == "" {
		return nil, fmt.Errorf("social: sender and idempotency key required")
	}
	recipientID, err := s.tags.Resolve(ctx, recipientHandle)
	if err != nil {
		return nil, err
	}
	if recipientID == senderID {
		return nil, fmt.Errorf("social: cannot send to yourself")
	}
	if err := s.aml.Check(ctx, senderID, amountKobo); err != nil {
		return nil, err
	}

	// Replay-safe: existing payment for this key short-circuits.
	if p, err := s.paymentByIdem(ctx, idemKey); err == nil && p != nil {
		return p, nil
	}

	// Move money: debit sender -> escrow standing, credit escrow -> recipient.
	// (Escrow account is used as the neutral transit bucket; net zero, no float
	// retained, no yield — NL-2.)
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	if err := s.led.Debit(ctx, senderID, "p2p:"+idemKey, idemKey+":dr", escrowAcc.ID, amountKobo); err != nil {
		return nil, fmt.Errorf("social: send debit: %w", err)
	}
	if err := s.led.Credit(ctx, recipientID, "p2p:"+idemKey, idemKey+":cr", escrowAcc.ID, amountKobo); err != nil {
		return nil, fmt.Errorf("social: send credit: %w", err)
	}

	p := &Payment{
		ID: uuid.New().String(), SenderID: senderID, RecipientID: recipientID,
		AmountKobo: amountKobo, Note: note, IdempotencyKey: idemKey, CreatedAt: time.Now(),
	}
	const ins = `INSERT INTO social_payments (id, sender_id, recipient_id, amount_kobo, note, idempotency_key)
	             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, p.ID, p.SenderID, p.RecipientID, p.AmountKobo, p.Note, p.IdempotencyKey); err != nil {
		return nil, fmt.Errorf("social: record payment: %w", err)
	}
	s.log(senderID, recipientID, "social.p2p.send", "social_payment", p.ID, nil, map[string]any{"amount_kobo": amountKobo})
	return p, nil
}

// ───────────────────────── Requests ─────────────────────────

// CreateRequest creates a money request. Object-level authZ: requesterID is the
// CALLER (set by the handler from the session) — a user can never request as
// someone else. The payer is resolved from a cashtag.
func (s *Service) CreateRequest(ctx context.Context, requesterID, payerHandle, note string, amountKobo int64) (*Request, error) {
	if amountKobo <= 0 {
		return nil, fmt.Errorf("social: amount must be positive")
	}
	payerID, err := s.tags.Resolve(ctx, payerHandle)
	if err != nil {
		return nil, err
	}
	if payerID == requesterID {
		return nil, fmt.Errorf("social: cannot request from yourself")
	}
	r := &Request{
		ID: uuid.New().String(), RequesterID: requesterID, PayerID: payerID,
		AmountKobo: amountKobo, Note: note, State: RequestPending, CreatedAt: time.Now(),
	}
	const ins = `INSERT INTO social_requests (id, requester_id, payer_id, amount_kobo, note, state)
	             VALUES ($1,$2,$3,$4,$5,'PENDING')`
	if _, err := s.db.Exec(ctx, ins, r.ID, r.RequesterID, r.PayerID, r.AmountKobo, r.Note); err != nil {
		return nil, fmt.Errorf("social: create request: %w", err)
	}
	s.log(requesterID, payerID, "social.request.create", "social_request", r.ID, nil, map[string]any{"amount_kobo": amountKobo})
	return r, nil
}

// PayRequest fulfils a request. Object-level authZ: ONLY the named payer may pay,
// and only a PENDING request. The transfer is idempotent on the request id.
func (s *Service) PayRequest(ctx context.Context, payerID, requestID string) error {
	r, err := s.getRequest(ctx, requestID)
	if err != nil {
		return err
	}
	if r.PayerID != payerID {
		return ErrForbidden // cannot pay a request not addressed to you
	}
	if !canRequest(r.State, RequestPaid) {
		return fmt.Errorf("social: request not payable (state %s)", r.State)
	}
	// AML applies to the implied send.
	if err := s.aml.Check(ctx, payerID, r.AmountKobo); err != nil {
		return err
	}
	// Flip state guarded first, then move money keyed off the request id.
	const upd = `UPDATE social_requests SET state='PAID', resolved_at=now() WHERE id=$1 AND state='PENDING'`
	ct, err := s.db.Exec(ctx, upd, requestID)
	if err != nil || ct.RowsAffected() == 0 {
		return fmt.Errorf("social: request state transition failed")
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	key := "req:" + requestID
	if err := s.led.Debit(ctx, payerID, key, key+":dr", escrowAcc.ID, r.AmountKobo); err != nil {
		return fmt.Errorf("social: pay request debit: %w", err)
	}
	if err := s.led.Credit(ctx, r.RequesterID, key, key+":cr", escrowAcc.ID, r.AmountKobo); err != nil {
		return fmt.Errorf("social: pay request credit: %w", err)
	}
	s.log(payerID, r.RequesterID, "social.request.pay", "social_request", requestID,
		map[string]any{"state": "PENDING"}, map[string]any{"state": "PAID"})
	return nil
}

// DeclineRequest: only the payer may decline (PENDING→DECLINED).
func (s *Service) DeclineRequest(ctx context.Context, payerID, requestID string) error {
	return s.resolveRequest(ctx, requestID, payerID, false, RequestDeclined, "social.request.decline")
}

// CancelRequest: only the requester may cancel (PENDING→CANCELLED).
func (s *Service) CancelRequest(ctx context.Context, requesterID, requestID string) error {
	return s.resolveRequest(ctx, requestID, requesterID, true, RequestCancelled, "social.request.cancel")
}

func (s *Service) resolveRequest(ctx context.Context, requestID, actorID string, actorIsRequester bool, to RequestState, action string) error {
	r, err := s.getRequest(ctx, requestID)
	if err != nil {
		return err
	}
	if actorIsRequester && r.RequesterID != actorID {
		return ErrForbidden
	}
	if !actorIsRequester && r.PayerID != actorID {
		return ErrForbidden
	}
	if !canRequest(r.State, to) {
		return fmt.Errorf("social: illegal request transition %s -> %s", r.State, to)
	}
	const upd = `UPDATE social_requests SET state=$2, resolved_at=now() WHERE id=$1 AND state='PENDING'`
	ct, err := s.db.Exec(ctx, upd, requestID, string(to))
	if err != nil || ct.RowsAffected() == 0 {
		return fmt.Errorf("social: request transition failed")
	}
	s.log(actorID, "", action, "social_request", requestID,
		map[string]any{"state": "PENDING"}, map[string]any{"state": string(to)})
	return nil
}

// ───────────────────────── Split bill ─────────────────────────

// ShareInput is one participant's cashtag + (custom) amount.
type ShareInput struct {
	Handle     string `json:"handle"`
	AmountKobo int64  `json:"amount_kobo"` // ignored for EQUAL
}

// CreateSplit creates a split-bill across participants. EQUAL divides totalKobo
// evenly (remainder to organiser's share); CUSTOM uses the per-share amounts,
// which MUST sum to totalKobo (invariant). Each non-organiser share becomes a
// PENDING request the participant settles.
func (s *Service) CreateSplit(ctx context.Context, organiserID, title string, totalKobo int64, mode SplitMode, shares []ShareInput) (*SplitBill, []SplitShare, error) {
	if totalKobo <= 0 {
		return nil, nil, fmt.Errorf("social: total must be positive")
	}
	if len(shares) == 0 {
		return nil, nil, fmt.Errorf("social: at least one participant required")
	}

	// Resolve participants.
	type resolved struct {
		userID string
		amount int64
	}
	parts := make([]resolved, 0, len(shares))
	switch mode {
	case SplitEqual:
		n := int64(len(shares))
		base := totalKobo / n
		rem := totalKobo - base*n
		for i, sh := range shares {
			uid, err := s.tags.Resolve(ctx, sh.Handle)
			if err != nil {
				return nil, nil, err
			}
			amt := base
			if int64(i) == n-1 {
				amt += rem // remainder absorbed by last share — kobo always balances
			}
			parts = append(parts, resolved{userID: uid, amount: amt})
		}
	case SplitCustom:
		var sum int64
		for _, sh := range shares {
			uid, err := s.tags.Resolve(ctx, sh.Handle)
			if err != nil {
				return nil, nil, err
			}
			if sh.AmountKobo <= 0 {
				return nil, nil, fmt.Errorf("social: custom share must be positive")
			}
			sum += sh.AmountKobo
			parts = append(parts, resolved{userID: uid, amount: sh.AmountKobo})
		}
		if sum != totalKobo {
			return nil, nil, fmt.Errorf("social: custom shares must sum to total (%d != %d)", sum, totalKobo)
		}
	default:
		return nil, nil, fmt.Errorf("social: unknown split mode")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	bill := &SplitBill{
		ID: uuid.New().String(), OrganiserID: organiserID, Title: title,
		TotalKobo: totalKobo, Mode: mode, State: SplitOpen, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	const insB = `INSERT INTO split_bills (id, organiser_id, title, total_kobo, mode, state)
	              VALUES ($1,$2,$3,$4,$5,'OPEN')`
	if _, err := tx.Exec(ctx, insB, bill.ID, bill.OrganiserID, bill.Title, bill.TotalKobo, string(bill.Mode)); err != nil {
		return nil, nil, fmt.Errorf("social: insert split: %w", err)
	}
	out := make([]SplitShare, 0, len(parts))
	for _, p := range parts {
		sh := SplitShare{ID: uuid.New().String(), SplitID: bill.ID, UserID: p.userID, AmountKobo: p.amount, State: SharePending}
		// The organiser's own share is auto-settled (they fronted the bill).
		if p.userID == organiserID {
			sh.State = SharePaid
			now := time.Now()
			sh.PaidAt = &now
		}
		const insS = `INSERT INTO split_shares (id, split_id, user_id, amount_kobo, state, paid_at)
		              VALUES ($1,$2,$3,$4,$5,$6)`
		var paidAt any
		if sh.PaidAt != nil {
			paidAt = *sh.PaidAt
		}
		if _, err := tx.Exec(ctx, insS, sh.ID, sh.SplitID, sh.UserID, sh.AmountKobo, string(sh.State), paidAt); err != nil {
			return nil, nil, fmt.Errorf("social: insert share: %w", err)
		}
		out = append(out, sh)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	s.log(organiserID, "", "social.split.create", "split_bill", bill.ID, nil, map[string]any{"total_kobo": totalKobo, "mode": mode})
	return bill, out, nil
}

// PayShare settles a participant's split share (object-level: only that
// participant may pay their own share). Transfers the share amount to the
// organiser. Marks the bill SETTLED when all shares are paid.
func (s *Service) PayShare(ctx context.Context, payerID, shareID, idemKey string) error {
	var sh SplitShare
	var state string
	const q = `SELECT id, split_id, user_id, amount_kobo, state FROM split_shares WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, shareID).Scan(&sh.ID, &sh.SplitID, &sh.UserID, &sh.AmountKobo, &state); err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	sh.State = ShareState(state)
	if sh.UserID != payerID {
		return ErrForbidden
	}
	if sh.State == SharePaid {
		return nil // idempotent
	}
	bill, err := s.getSplit(ctx, sh.SplitID)
	if err != nil {
		return err
	}
	if err := s.aml.Check(ctx, payerID, sh.AmountKobo); err != nil {
		return err
	}
	const upd = `UPDATE split_shares SET state='PAID', paid_at=now() WHERE id=$1 AND state='PENDING'`
	ct, err := s.db.Exec(ctx, upd, shareID)
	if err != nil || ct.RowsAffected() == 0 {
		return fmt.Errorf("social: share transition failed")
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	key := "split:" + shareID
	if idemKey != "" {
		key = idemKey
	}
	if err := s.led.Debit(ctx, payerID, "split:"+sh.SplitID, key+":dr", escrowAcc.ID, sh.AmountKobo); err != nil {
		return fmt.Errorf("social: pay share debit: %w", err)
	}
	if err := s.led.Credit(ctx, bill.OrganiserID, "split:"+sh.SplitID, key+":cr", escrowAcc.ID, sh.AmountKobo); err != nil {
		return fmt.Errorf("social: pay share credit: %w", err)
	}
	// Settle the bill when no PENDING shares remain.
	var pending int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM split_shares WHERE split_id=$1 AND state='PENDING'`, sh.SplitID).Scan(&pending)
	if pending == 0 {
		_, _ = s.db.Exec(ctx, `UPDATE split_bills SET state='SETTLED', updated_at=now() WHERE id=$1 AND state='OPEN'`, sh.SplitID)
	}
	s.log(payerID, bill.OrganiserID, "social.split.pay", "split_share", shareID, nil, map[string]any{"amount_kobo": sh.AmountKobo})
	return nil
}

// GetSplit returns a bill + its shares (object-level authZ in handler).
func (s *Service) GetSplit(ctx context.Context, splitID string) (*SplitBill, []SplitShare, error) {
	bill, err := s.getSplit(ctx, splitID)
	if err != nil {
		return nil, nil, err
	}
	const q = `SELECT id, split_id, user_id, amount_kobo, state, paid_at FROM split_shares WHERE split_id=$1 ORDER BY amount_kobo DESC`
	rows, err := s.db.Query(ctx, q, splitID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var shares []SplitShare
	for rows.Next() {
		var sh SplitShare
		var st string
		if err := rows.Scan(&sh.ID, &sh.SplitID, &sh.UserID, &sh.AmountKobo, &st, &sh.PaidAt); err != nil {
			return nil, nil, err
		}
		sh.State = ShareState(st)
		shares = append(shares, sh)
	}
	return bill, shares, rows.Err()
}

// IsSplitParticipant reports membership for object-level authZ.
func (s *Service) IsSplitParticipant(ctx context.Context, splitID, userID string) (bool, error) {
	var n int
	err := s.db.QueryRow(ctx, `SELECT count(*) FROM split_shares WHERE split_id=$1 AND user_id=$2`, splitID, userID).Scan(&n)
	if err != nil {
		return false, err
	}
	if n > 0 {
		return true, nil
	}
	// organiser is always a participant
	b, err := s.getSplit(ctx, splitID)
	if err != nil {
		return false, err
	}
	return b.OrganiserID == userID, nil
}

// ───────────────────────── Group pool ─────────────────────────

// CreatePool opens a group pool. Beneficiary defaults to the organiser.
func (s *Service) CreatePool(ctx context.Context, organiserID, title string, beneficiaryID *string) (*GroupPool, error) {
	p := &GroupPool{ID: uuid.New().String(), OrganiserID: organiserID, Title: title, BeneficiaryID: beneficiaryID, State: PoolOpen, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	const ins = `INSERT INTO group_pools (id, organiser_id, title, beneficiary_id, state) VALUES ($1,$2,$3,$4,'OPEN')`
	if _, err := s.db.Exec(ctx, ins, p.ID, p.OrganiserID, p.Title, p.BeneficiaryID); err != nil {
		return nil, fmt.Errorf("social: create pool: %w", err)
	}
	s.log(organiserID, "", "social.pool.create", "group_pool", p.ID, nil, nil)
	return p, nil
}

// PoolBalance returns the derived pool balance in kobo (NL-8). Contributions are
// positive rows and the payout drain is a single negative row, so SUM is the live
// balance (zero after payout).
func (s *Service) PoolBalance(ctx context.Context, poolID string) (int64, error) {
	const q = `SELECT COALESCE(SUM(amount_kobo),0) FROM pool_contributions WHERE pool_id=$1`
	var bal int64
	if err := s.db.QueryRow(ctx, q, poolID).Scan(&bal); err != nil {
		return 0, err
	}
	return bal, nil
}

// ContributePool moves money from a contributor's wallet into the pool.
func (s *Service) ContributePool(ctx context.Context, userID, poolID string, amountKobo int64, idemKey string) (int64, error) {
	if amountKobo <= 0 {
		return 0, fmt.Errorf("social: contribution must be positive")
	}
	p, err := s.getPool(ctx, poolID)
	if err != nil {
		return 0, err
	}
	if p.State != PoolOpen {
		return 0, fmt.Errorf("social: pool not open")
	}
	if err := s.aml.Check(ctx, userID, amountKobo); err != nil {
		return 0, err
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return 0, err
	}
	if err := s.led.Debit(ctx, userID, "pool:contrib:"+poolID, idemKey+":dr", escrowAcc.ID, amountKobo); err != nil {
		return 0, fmt.Errorf("social: pool contribute debit: %w", err)
	}
	const ins = `INSERT INTO pool_contributions (id, pool_id, user_id, amount_kobo, idempotency_key)
	             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, uuid.New().String(), poolID, userID, amountKobo, idemKey); err != nil {
		return 0, fmt.Errorf("social: pool contribute record: %w", err)
	}
	s.log(userID, "", "social.pool.contribute", "group_pool", poolID, nil, map[string]any{"amount_kobo": amountKobo})
	return s.PoolBalance(ctx, poolID)
}

// PayoutPool drains the pool to the beneficiary (object-level: organiser only).
// Guarded OPEN→PAID_OUT. NL-8: payout equals the derived balance; nothing added.
func (s *Service) PayoutPool(ctx context.Context, organiserID, poolID, idemKey string) error {
	p, err := s.getPool(ctx, poolID)
	if err != nil {
		return err
	}
	if p.OrganiserID != organiserID {
		return ErrForbidden
	}
	if !canPool(p.State, PoolPaidOut) {
		return fmt.Errorf("social: cannot pay out from %s", p.State)
	}
	bal, err := s.PoolBalance(ctx, poolID)
	if err != nil {
		return err
	}
	if bal <= 0 {
		return fmt.Errorf("social: empty pool")
	}
	beneficiary := p.OrganiserID
	if p.BeneficiaryID != nil {
		beneficiary = *p.BeneficiaryID
	}
	const upd = `UPDATE group_pools SET state='PAID_OUT', updated_at=now() WHERE id=$1 AND state='OPEN'`
	ct, err := s.db.Exec(ctx, upd, poolID)
	if err != nil || ct.RowsAffected() == 0 {
		return fmt.Errorf("social: pool payout transition failed")
	}
	// Record the drain as a negative contribution so balance reflects zero.
	const drain = `INSERT INTO pool_contributions (id, pool_id, user_id, amount_kobo, idempotency_key)
	               VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, drain, uuid.New().String(), poolID, beneficiary, -bal, "payout:"+poolID); err != nil {
		return fmt.Errorf("social: pool drain record: %w", err)
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	if err := s.led.Credit(ctx, beneficiary, "pool:payout:"+poolID, idemKey+":cr", escrowAcc.ID, bal); err != nil {
		return fmt.Errorf("social: pool payout credit: %w", err)
	}
	s.log(organiserID, beneficiary, "social.pool.payout", "group_pool", poolID,
		map[string]any{"state": "OPEN"}, map[string]any{"state": "PAID_OUT", "amount_kobo": bal})
	return nil
}

// GetPool returns a pool (object-level authZ in handler/RLS).
func (s *Service) GetPool(ctx context.Context, poolID string) (*GroupPool, error) {
	return s.getPool(ctx, poolID)
}

// ───────────────────────── helpers ─────────────────────────

func (s *Service) paymentByIdem(ctx context.Context, idemKey string) (*Payment, error) {
	const q = `SELECT id, sender_id, recipient_id, amount_kobo, note, idempotency_key, created_at FROM social_payments WHERE idempotency_key=$1`
	var p Payment
	if err := s.db.QueryRow(ctx, q, idemKey).Scan(&p.ID, &p.SenderID, &p.RecipientID, &p.AmountKobo, &p.Note, &p.IdempotencyKey, &p.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (s *Service) getRequest(ctx context.Context, requestID string) (*Request, error) {
	const q = `SELECT id, requester_id, payer_id, amount_kobo, note, state FROM social_requests WHERE id=$1`
	var r Request
	var state string
	if err := s.db.QueryRow(ctx, q, requestID).Scan(&r.ID, &r.RequesterID, &r.PayerID, &r.AmountKobo, &r.Note, &state); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	r.State = RequestState(state)
	return &r, nil
}

func (s *Service) getSplit(ctx context.Context, splitID string) (*SplitBill, error) {
	const q = `SELECT id, organiser_id, title, total_kobo, mode, state FROM split_bills WHERE id=$1`
	var b SplitBill
	var mode, state string
	if err := s.db.QueryRow(ctx, q, splitID).Scan(&b.ID, &b.OrganiserID, &b.Title, &b.TotalKobo, &mode, &state); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	b.Mode = SplitMode(mode)
	b.State = SplitState(state)
	return &b, nil
}

func (s *Service) getPool(ctx context.Context, poolID string) (*GroupPool, error) {
	const q = `SELECT id, organiser_id, title, beneficiary_id, state FROM group_pools WHERE id=$1`
	var p GroupPool
	var state string
	if err := s.db.QueryRow(ctx, q, poolID).Scan(&p.ID, &p.OrganiserID, &p.Title, &p.BeneficiaryID, &state); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	p.State = PoolState(state)
	return &p, nil
}

func (s *Service) log(actor, target, action, resType, resID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "social", resType, resID, oldV, newV, "", "", "info")
}

// Sentinel errors.
var (
	ErrForbidden = fmt.Errorf("social: forbidden")
	ErrNotFound  = fmt.Errorf("social: not found")
)

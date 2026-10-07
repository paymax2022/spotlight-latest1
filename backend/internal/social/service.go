package social

import (
	"context"
	"errors"
	"fmt"
	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor is the immutable-audit slice the social module needs (NL-12). nil-safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// walletDebitLimiter is the minimal seam the Social Pay money path depends on
// for the fail-closed KYC-tier / daily-debit gate. *tiers.Service satisfies it
// in production; unit tests inject a fake via WithTiers. Modeled as a local
// interface — mirrors transport's tierLimiter — so the package never depends on
// more of tiers than this one method. Every social debit is a wallet DEBIT
// (send / pay-request / split share / pool contribution), so the STRICT gate
// is used: these move cash between users, not a checkout purchase, so the
// Tier-0 checkout allowance (ADR-043) deliberately does NOT apply here.
type walletDebitLimiter interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// ErrTierGateUnwired is returned when a Service has no tier gate — a nil gate
// must fail CLOSED, never debit ungated (mirrors groups.ErrTierGateUnwired).
var ErrTierGateUnwired = errors.New("social: money path requires a tier gate (not wired)")

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
	tiers walletDebitLimiter
}

func NewService(db *pgxpool.Pool, led *ledger.Service, tags *cashtag.Service, aml *AML, audit Auditor) *Service {
	s := &Service{db: db, led: led, tags: tags, aml: aml, audit: audit}
	// The tier-limit gate is constructed from the same pool (tiers.NewService
	// needs only the DB), so no extra wiring is required at the call site —
	// same convention as transport.NewService. A nil pool leaves the gate nil,
	// and enforceDebitLimit then fails closed via ErrTierGateUnwired.
	if db != nil {
		s.tiers = tiers.NewService(db)
	}
	return s
}

// WithTiers injects a pre-configured tier gate (app-wiring / tests). A nil
// argument is ignored so an unwired injection can never strip the gate.
func (s *Service) WithTiers(t walletDebitLimiter) *Service {
	if t != nil {
		s.tiers = t
	}
	return s
}

// enforceDebitLimit is the fail-closed guard applied before EVERY social wallet
// debit (E2E-FIN-041): the same EnforceWalletDebitLimit the canonical transfer
// rail (finance/transfers) runs. Tier 0 → ErrWalletDisabled, over daily cap →
// ErrDailyLimitExceeded, gate/db errors refuse, and a missing gate refuses via
// ErrTierGateUnwired. The error is propagated UNWRAPPED so handlers map the
// tier sentinels to 403 via errors.Is.
func (s *Service) enforceDebitLimit(ctx context.Context, userID string, amountKobo int64) error {
	if s.tiers == nil {
		return ErrTierGateUnwired
	}
	return s.tiers.EnforceWalletDebitLimit(ctx, userID, amountKobo)
}

// Send transfers amountKobo from senderID to the user behind recipientHandle.
// Wallet→wallet via the ledger (commission account is NOT used — this is a pure
// peer transfer). idemKey makes it replay-safe (NL-9). AML checked first (NL-10).
func (s *Service) Send(ctx context.Context, senderID, recipientHandle, note, idemKey string, amountKobo int64) (*Payment, error) {
	if senderID == "" || idemKey == "" {
		return nil, errors.New("social: sender and idempotency key required")
	}
	recipientID, err := s.tags.Resolve(ctx, recipientHandle)
	if err != nil {
		return nil, err
	}
	if recipientID == senderID {
		return nil, errors.New("social: cannot send to yourself")
	}
	if err := s.aml.Check(ctx, senderID, amountKobo); err != nil {
		return nil, err
	}

	// Replay-safe: an existing payment for this key AND THIS SENDER
	// short-circuits. The lookup is caller-scoped — an idempotency key another
	// user already used must NOT replay their payment back to this caller
	// (that would leak their sender/recipient/amount); it falls through to the
	// insert, where the unique constraint and the ledger leg keys stop the
	// cross-user reuse as an error instead.
	if p, err := s.paymentByIdem(ctx, senderID, idemKey); err == nil && p != nil {
		return p, nil
	}

	// Tier guard (fail-closed, E2E-FIN-041): a cashtag send is a wallet debit, so
	// it runs the same EnforceWalletDebitLimit the transfer rail applies — Tier 0
	// and over-daily-cap senders are refused. Placed AFTER the replay short-
	// circuit (same ordering rule as transfers.walletPreflight): once a send has
	// completed, re-running the gate could only refuse a request whose money
	// already moved — telling the caller it failed invites a fresh-key retry,
	// which is a real second debit.
	if err := s.enforceDebitLimit(ctx, senderID, amountKobo); err != nil {
		return nil, err
	}

	// Move money: debit sender -> escrow standing, credit escrow -> recipient.
	// (Escrow account is used as the neutral transit bucket; net zero, no float
	// retained, no yield — NL-2.)
	// Journal keys are namespaced ("social:p2p:") so a caller key can never be
	// absorbed by a journal posted under another rail's purpose — the same
	// convention groups.dues uses (S2).
	journalKey := "social:p2p:" + idemKey
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	if err := s.led.Debit(ctx, senderID, "p2p:"+idemKey, journalKey+":dr", escrowAcc.ID, amountKobo); err != nil {
		return nil, fmt.Errorf("social: send debit: %w", err)
	}
	if err := s.led.Credit(ctx, recipientID, "p2p:"+idemKey, journalKey+":cr", escrowAcc.ID, amountKobo); err != nil {
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

// CreateRequest creates a money request. Object-level authZ: requesterID is the
// CALLER (set by the handler from the session) — a user can never request as
// someone else. The payer is resolved from a cashtag.
func (s *Service) CreateRequest(ctx context.Context, requesterID, payerHandle, note string, amountKobo int64) (*Request, error) {
	if amountKobo <= 0 {
		return nil, errors.New("social: amount must be positive")
	}
	payerID, err := s.tags.Resolve(ctx, payerHandle)
	if err != nil {
		return nil, err
	}
	if payerID == requesterID {
		return nil, errors.New("social: cannot request from yourself")
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

// legPosted reports whether a ledger entry of entryType for amountKobo exists
// on userID's user_wallet under reference. The ledger is the source of truth
// for "did this payment actually move money" — the social row's state column
// is only a claim, and a claim can outlive the legs it was supposed to cover
// (crash or failed debit between the flip and the posting).
func (s *Service) legPosted(ctx context.Context, userID, reference string, entryType ledger.EntryType, amountKobo int64) (bool, error) {
	const q = `SELECT EXISTS(
		SELECT 1 FROM ledger_entries e
		JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id = $1 AND a.type = 'user_wallet'
		  AND e.reference = $2 AND e.type = $3 AND e.amount_kobo = $4)`
	var ok bool
	if err := s.db.QueryRow(ctx, q, userID, reference, string(entryType), amountKobo).Scan(&ok); err != nil {
		return false, fmt.Errorf("social: verify posted leg: %w", err)
	}
	return ok, nil
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
	key := "req:" + requestID
	if r.State == RequestPaid {
		// Re-entry onto a settled row — idempotent when the ledger backs it,
		// but a stale claim can also read PAID: a crash (or a failed debit
		// under the old ordering) between the claim-flip and the legs left
		// rows marked PAID with no money moved, and the old early-return
		// answered "not payable" to every retry. The ledger decides:
		//   requester credit posted  → genuinely paid, return nil;
		//   payer debit only         → complete the missing credit under the
		//                              deterministic key (idempotent no-op if
		//                              a concurrent caller beat us to it);
		//   no legs at all           → stale claim — revert to PENDING and pay
		//                              through the normal path below.
		settled, err := s.legPosted(ctx, r.RequesterID, key, ledger.EntryCredit, r.AmountKobo)
		if err != nil {
			return err
		}
		if settled {
			return nil
		}
		debited, err := s.legPosted(ctx, payerID, key, ledger.EntryDebit, r.AmountKobo)
		if err != nil {
			return err
		}
		if debited {
			escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
			if err != nil {
				return err
			}
			if err := s.led.Credit(ctx, r.RequesterID, key, key+":cr", escrowAcc.ID, r.AmountKobo); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
				return fmt.Errorf("social: pay request credit: %w", err)
			}
			return nil
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE social_requests SET state='PENDING', resolved_at=NULL WHERE id=$1 AND state='PAID'`,
			requestID); err != nil {
			return fmt.Errorf("social: revert stale request claim: %w", err)
		}
		r.State = RequestPending
	}
	if !canRequest(r.State, RequestPaid) {
		return fmt.Errorf("social: request not payable (state %s)", r.State)
	}
	// AML applies to the implied send.
	if err := s.aml.Check(ctx, payerID, r.AmountKobo); err != nil {
		return err
	}
	// Tier guard (fail-closed, E2E-FIN-041) BEFORE the state flip: a refused
	// payer must leave the request PENDING, never PAID-without-money.
	if err := s.enforceDebitLimit(ctx, payerID, r.AmountKobo); err != nil {
		return err
	}
	// Claim PENDING→PAID first (single-flight — it also preserves the
	// pay-vs-cancel ordering), then move money keyed off the request id.
	// A ledger failure REVERTS the claim: a failed debit must never leave a
	// settled-looking row the payer can no longer pay.
	const upd = `UPDATE social_requests SET state='PAID', resolved_at=now() WHERE id=$1 AND state='PENDING'`
	ct, err := s.db.Exec(ctx, upd, requestID)
	if err != nil || ct.RowsAffected() == 0 {
		return errors.New("social: request state transition failed")
	}
	unclaim := func() {
		_, _ = s.db.Exec(ctx,
			`UPDATE social_requests SET state='PENDING', resolved_at=NULL WHERE id=$1 AND state='PAID'`,
			requestID)
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		unclaim()
		return err
	}
	if err := s.led.Debit(ctx, payerID, key, key+":dr", escrowAcc.ID, r.AmountKobo); err != nil {
		unclaim()
		return fmt.Errorf("social: pay request debit: %w", err)
	}
	if err := s.led.Credit(ctx, r.RequesterID, key, key+":cr", escrowAcc.ID, r.AmountKobo); err != nil {
		unclaim()
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
		return errors.New("social: request transition failed")
	}
	s.log(actorID, "", action, "social_request", requestID,
		map[string]any{"state": "PENDING"}, map[string]any{"state": string(to)})
	return nil
}

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
		return nil, nil, errors.New("social: total must be positive")
	}
	if len(shares) == 0 {
		return nil, nil, errors.New("social: at least one participant required")
	}

	parts, err := s.resolveShares(ctx, mode, totalKobo, shares)
	if err != nil {
		return nil, nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

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

// resolvedShare is a participant handle resolved to a user id plus the
// minor-unit amount that share owes.
type resolvedShare struct {
	userID string
	amount int64
}

// resolveShares resolves share handles to user ids and assigns minor-unit
// amounts per the split mode. Equal splits absorb any division remainder in the
// last share — kobo always balances.
func (s *Service) resolveShares(ctx context.Context, mode SplitMode, totalKobo int64, shares []ShareInput) ([]resolvedShare, error) {
	parts := make([]resolvedShare, 0, len(shares))
	switch mode {
	case SplitEqual:
		n := int64(len(shares))
		base := totalKobo / n
		rem := totalKobo - base*n
		for i, sh := range shares {
			uid, err := s.tags.Resolve(ctx, sh.Handle)
			if err != nil {
				return nil, err
			}
			amt := base
			if int64(i) == n-1 {
				amt += rem // remainder absorbed by last share — kobo always balances
			}
			parts = append(parts, resolvedShare{userID: uid, amount: amt})
		}
	case SplitCustom:
		var sum int64
		for _, sh := range shares {
			uid, err := s.tags.Resolve(ctx, sh.Handle)
			if err != nil {
				return nil, err
			}
			if sh.AmountKobo <= 0 {
				return nil, errors.New("social: custom share must be positive")
			}
			sum += sh.AmountKobo
			parts = append(parts, resolvedShare{userID: uid, amount: sh.AmountKobo})
		}
		if sum != totalKobo {
			return nil, fmt.Errorf("social: custom shares must sum to total (%d != %d)", sum, totalKobo)
		}
	default:
		return nil, errors.New("social: unknown split mode")
	}
	return parts, nil
}

// PayShare settles a participant's split share (object-level: only that
// participant may pay their own share). Transfers the share amount to the
// organiser. Marks the bill SETTLED when all shares are paid.
func (s *Service) PayShare(ctx context.Context, payerID, shareID, idemKey string) error {
	var sh SplitShare
	var state string
	const q = `SELECT id, split_id, user_id, amount_kobo, state FROM split_shares WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, shareID).Scan(&sh.ID, &sh.SplitID, &sh.UserID, &sh.AmountKobo, &state); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	sh.State = ShareState(state)
	if sh.UserID != payerID {
		return ErrForbidden
	}
	bill, err := s.getSplit(ctx, sh.SplitID)
	if err != nil {
		return err
	}
	// The ledger keys are DERIVED from the share, not the caller's
	// Idempotency-Key (idemKey is accepted for API compatibility but the
	// share itself is the idempotency unit — it can only ever be paid once).
	// A retry under a NEW caller key must replay onto the same legs; keying
	// the legs off the caller key would let one retry post a second debit.
	key := "split:" + shareID
	ref := "split:" + sh.SplitID
	if sh.State == SharePaid {
		// Re-entry onto a settled share — idempotent when the ledger backs
		// it, but a stale claim can also read PAID: a crash (or a failed
		// debit under the old claim-first ordering) between the flip and the
		// legs left shares marked PAID with no money moved, and the old
		// early-return answered nil to every retry — the share became
		// settled-looking and unpayable. The ledger decides:
		//   organiser credit posted → genuinely paid, return nil;
		//   payer debit only        → complete the missing credit under the
		//                             deterministic key (idempotent no-op if
		//                             a concurrent caller beat us to it);
		//   no legs at all          → stale claim — revert to PENDING and pay
		//                             through the normal path below.
		settled, err := s.legPosted(ctx, bill.OrganiserID, ref, ledger.EntryCredit, sh.AmountKobo)
		if err != nil {
			return err
		}
		if settled {
			return nil
		}
		debited, err := s.legPosted(ctx, payerID, ref, ledger.EntryDebit, sh.AmountKobo)
		if err != nil {
			return err
		}
		if debited {
			escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
			if err != nil {
				return err
			}
			if err := s.led.Credit(ctx, bill.OrganiserID, ref, key+":cr", escrowAcc.ID, sh.AmountKobo); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
				return fmt.Errorf("social: pay share credit: %w", err)
			}
			return nil
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE split_shares SET state='PENDING', paid_at=NULL WHERE id=$1 AND state='PAID'`,
			shareID); err != nil {
			return fmt.Errorf("social: revert stale share claim: %w", err)
		}
		sh.State = SharePending
	}
	if err := s.aml.Check(ctx, payerID, sh.AmountKobo); err != nil {
		return err
	}
	// Tier guard (fail-closed, E2E-FIN-041) BEFORE the PENDING→PAID flip: a
	// refused payer must leave the share collectible, not marked paid.
	if err := s.enforceDebitLimit(ctx, payerID, sh.AmountKobo); err != nil {
		return err
	}
	// Claim PENDING→PAID first (single-flight), then move money. A ledger
	// failure REVERTS the claim so a failed debit never leaves a settled-
	// looking share the payer can no longer pay.
	const upd = `UPDATE split_shares SET state='PAID', paid_at=now() WHERE id=$1 AND state='PENDING'`
	ct, err := s.db.Exec(ctx, upd, shareID)
	if err != nil || ct.RowsAffected() == 0 {
		return errors.New("social: share transition failed")
	}
	unclaim := func() {
		_, _ = s.db.Exec(ctx,
			`UPDATE split_shares SET state='PENDING', paid_at=NULL WHERE id=$1 AND state='PAID'`,
			shareID)
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		unclaim()
		return err
	}
	if err := s.led.Debit(ctx, payerID, ref, key+":dr", escrowAcc.ID, sh.AmountKobo); err != nil {
		unclaim()
		return fmt.Errorf("social: pay share debit: %w", err)
	}
	if err := s.led.Credit(ctx, bill.OrganiserID, ref, key+":cr", escrowAcc.ID, sh.AmountKobo); err != nil {
		unclaim()
		return fmt.Errorf("social: pay share credit: %w", err)
	}
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
		return 0, errors.New("social: contribution must be positive")
	}
	p, err := s.getPool(ctx, poolID)
	if err != nil {
		return 0, err
	}
	if p.State != PoolOpen {
		return 0, errors.New("social: pool not open")
	}
	if err := s.aml.Check(ctx, userID, amountKobo); err != nil {
		return 0, err
	}
	// Tier guard (fail-closed, E2E-FIN-041): a pool contribution is a wallet
	// debit and runs the same EnforceWalletDebitLimit as the transfer rail.
	if err := s.enforceDebitLimit(ctx, userID, amountKobo); err != nil {
		return 0, err
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return 0, err
	}
	// The journal key is namespaced AND pool-scoped ("social:pool:<pool>:"):
	// a caller key can never be absorbed by a journal another rail — or
	// another pool — already posted under the same raw key (S2). This path is
	// debit-only, so without the scope a same-amount collision on a different
	// account would satisfy the ledger's replay check while posting NOTHING
	// here — and the ON CONFLICT row insert below would swallow the lie,
	// leaving a phantom "contributed" state.
	journalKey := "social:pool:" + poolID + ":" + idemKey
	if err := s.led.Debit(ctx, userID, "pool:contrib:"+poolID, journalKey+":dr", escrowAcc.ID, amountKobo); err != nil {
		return 0, fmt.Errorf("social: pool contribute debit: %w", err)
	}
	// Verify the debit leg posted on THIS contributor's wallet (S2): compare
	// account + key + amount, not merely key existence. A key colliding with
	// another user's contribution is refused — a no-op "success" would record
	// a contribution nobody paid for.
	wallet, err := s.led.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("social: pool contribute wallet lookup: %w", err)
	}
	posted, ok, err := s.led.EntryAmount(ctx, wallet.ID, journalKey+":dr:debit")
	if err != nil {
		return 0, fmt.Errorf("social: pool contribute verify: %w", err)
	}
	if !ok || posted != amountKobo {
		return 0, errors.New("social: contribution replayed under a colliding idempotency key — use a fresh Idempotency-Key")
	}
	const ins = `INSERT INTO pool_contributions (id, pool_id, user_id, amount_kobo, idempotency_key)
	             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, uuid.New().String(), poolID, userID, amountKobo, idemKey); err != nil {
		return 0, fmt.Errorf("social: pool contribute record: %w", err)
	}
	s.log(userID, "", "social.pool.contribute", "group_pool", poolID, nil, map[string]any{"amount_kobo": amountKobo})
	return s.PoolBalance(ctx, poolID)
}

// payoutAmount reconstructs the amount a pool payout moved (or should have
// moved): the sum of the POSITIVE contribution rows. The negative drain row
// never inflates it, so it reads the same whether or not the drain was
// recorded — which is what lets the PAID_OUT re-entry path recover the
// intended payout on stale rows (S4).
func (s *Service) payoutAmount(ctx context.Context, poolID string) (int64, error) {
	const q = `SELECT COALESCE(SUM(amount_kobo),0) FROM pool_contributions WHERE pool_id=$1 AND amount_kobo > 0`
	var amt int64
	if err := s.db.QueryRow(ctx, q, poolID).Scan(&amt); err != nil {
		return 0, fmt.Errorf("social: payout amount: %w", err)
	}
	return amt, nil
}

// PayoutPool drains the pool to the beneficiary (object-level: organiser only).
// Guarded OPEN→PAID_OUT. NL-8: payout equals the derived balance; nothing added.
//
// Ordering (S4): the beneficiary is credited BEFORE the drain row is recorded.
// The old order flipped the pool to PAID_OUT and wrote the drain first, so a
// failed credit left the pool marked drained-but-unpaid — canPool blocked
// every retry and nothing healed it. Now a failed credit reverts the claim
// (pool stays OPEN, retriable), and a PAID_OUT re-entry converges on the
// ledger the same way PayRequest/PayShare do.
//
// The ledger key is DETERMINISTIC ("pool:payout:"+poolID), not derived from
// the caller's Idempotency-Key — the pool itself is the idempotency unit (it
// pays out exactly once), so a retry under a NEW caller key replays onto the
// same legs (same convention as PayShare's "split:"+shareID). The drain row's
// idempotency_key "payout:"+poolID is likewise deterministic and upserted.
func (s *Service) PayoutPool(ctx context.Context, organiserID, poolID, idemKey string) error {
	p, err := s.getPool(ctx, poolID)
	if err != nil {
		return err
	}
	if p.OrganiserID != organiserID {
		return ErrForbidden
	}
	beneficiary := p.OrganiserID
	if p.BeneficiaryID != nil {
		beneficiary = *p.BeneficiaryID
	}
	key := "pool:payout:" + poolID
	const drainIns = `INSERT INTO pool_contributions (id, pool_id, user_id, amount_kobo, idempotency_key)
	                  VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`

	if p.State == PoolPaidOut {
		// Re-entry convergence — the ledger decides, not the state claim:
		//   beneficiary credit posted → genuinely paid, return nil;
		//   credit missing            → post it under the deterministic key
		//                               (ErrDuplicate no-ops if a concurrent
		//                               retry beat us) and ensure the drain
		//                               row exists. This is the heal path for
		//                               PAID_OUT-but-unpaid residue the old
		//                               ordering could leave behind (S4).
		paid, err := s.payoutAmount(ctx, poolID)
		if err != nil {
			return err
		}
		if paid <= 0 {
			return nil // nothing was ever contributed — nothing owed
		}
		credited, err := s.legPosted(ctx, beneficiary, key, ledger.EntryCredit, paid)
		if err != nil {
			return err
		}
		if !credited {
			escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
			if err != nil {
				return err
			}
			if err := s.led.Credit(ctx, beneficiary, key, key+":cr", escrowAcc.ID, paid); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
				return fmt.Errorf("social: pool payout credit: %w", err)
			}
		}
		// Ensure the drain row — without it PoolBalance keeps reading
		// positive on a paid-out pool (crash between credit and drain).
		if _, err := s.db.Exec(ctx, drainIns, uuid.New().String(), poolID, beneficiary, -paid, "payout:"+poolID); err != nil {
			return fmt.Errorf("social: pool drain record: %w", err)
		}
		return nil
	}
	if !canPool(p.State, PoolPaidOut) {
		return fmt.Errorf("social: cannot pay out from %s", p.State)
	}

	// Claim OPEN→PAID_OUT first (single-flight): after the flip ContributePool
	// refuses new money, so the balance read below is the frozen payout
	// amount. A losing concurrent call errors here; its retry converges
	// through the PAID_OUT path above.
	const upd = `UPDATE group_pools SET state='PAID_OUT', updated_at=now() WHERE id=$1 AND state='OPEN'`
	ct, err := s.db.Exec(ctx, upd, poolID)
	if err != nil || ct.RowsAffected() == 0 {
		return errors.New("social: pool payout transition failed")
	}
	unclaim := func() {
		_, _ = s.db.Exec(ctx,
			`UPDATE group_pools SET state='OPEN', updated_at=now() WHERE id=$1 AND state='PAID_OUT'`,
			poolID)
	}
	bal, err := s.PoolBalance(ctx, poolID)
	if err != nil {
		unclaim()
		return err
	}
	if bal <= 0 {
		unclaim()
		return errors.New("social: empty pool")
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		unclaim()
		return err
	}
	// Credit FIRST: a failed credit must leave the pool OPEN and collectible —
	// PAID_OUT-but-unpaid was the S4 wedge. ErrDuplicate is tolerated: it can
	// only mean a prior attempt already paid out under the deterministic key.
	if err := s.led.Credit(ctx, beneficiary, key, key+":cr", escrowAcc.ID, bal); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		unclaim()
		return fmt.Errorf("social: pool payout credit: %w", err)
	}
	// Money has moved — do NOT unclaim past this point. If the drain insert
	// fails we leave PAID_OUT and return the error; the re-entry path records
	// the missing drain (and re-verifies the credit) on the next call.
	if _, err := s.db.Exec(ctx, drainIns, uuid.New().String(), poolID, beneficiary, -bal, "payout:"+poolID); err != nil {
		return fmt.Errorf("social: pool drain record: %w", err)
	}
	s.log(organiserID, beneficiary, "social.pool.payout", "group_pool", poolID,
		map[string]any{"state": "OPEN"}, map[string]any{"state": "PAID_OUT", "amount_kobo": bal})
	return nil
}

// GetPool returns a pool (object-level authZ in handler/RLS).
func (s *Service) GetPool(ctx context.Context, poolID string) (*GroupPool, error) {
	return s.getPool(ctx, poolID)
}

func (s *Service) paymentByIdem(ctx context.Context, senderID, idemKey string) (*Payment, error) {
	const q = `SELECT id, sender_id, recipient_id, amount_kobo, note, idempotency_key, created_at FROM social_payments WHERE idempotency_key=$1 AND sender_id=$2`
	var p Payment
	if err := s.db.QueryRow(ctx, q, idemKey, senderID).Scan(&p.ID, &p.SenderID, &p.RecipientID, &p.AmountKobo, &p.Note, &p.IdempotencyKey, &p.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (s *Service) getRequest(ctx context.Context, requestID string) (*Request, error) {
	const q = `SELECT id, requester_id, payer_id, amount_kobo, note, state, created_at, resolved_at FROM social_requests WHERE id=$1`
	var r Request
	var state string
	if err := s.db.QueryRow(ctx, q, requestID).Scan(&r.ID, &r.RequesterID, &r.PayerID, &r.AmountKobo, &r.Note, &state, &r.CreatedAt, &r.ResolvedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	r.State = RequestState(state)
	return &r, nil
}

func (s *Service) getSplit(ctx context.Context, splitID string) (*SplitBill, error) {
	const q = `SELECT id, organiser_id, title, total_kobo, mode, state, created_at, updated_at FROM split_bills WHERE id=$1`
	var b SplitBill
	var mode, state string
	if err := s.db.QueryRow(ctx, q, splitID).Scan(&b.ID, &b.OrganiserID, &b.Title, &b.TotalKobo, &mode, &state, &b.CreatedAt, &b.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	b.Mode = SplitMode(mode)
	b.State = SplitState(state)
	return &b, nil
}

func (s *Service) getPool(ctx context.Context, poolID string) (*GroupPool, error) {
	const q = `SELECT id, organiser_id, title, beneficiary_id, state, created_at, updated_at FROM group_pools WHERE id=$1`
	var p GroupPool
	var state string
	if err := s.db.QueryRow(ctx, q, poolID).Scan(&p.ID, &p.OrganiserID, &p.Title, &p.BeneficiaryID, &state, &p.CreatedAt, &p.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
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
	ErrForbidden = errors.New("social: forbidden")
	ErrNotFound  = errors.New("social: not found")
)

// AMLConfig is versioned velocity policy for P2P sends (NL-10). Defaults are
// conservative; admin tooling can override per-tier in later phases.
type AMLConfig struct {
	MaxSendsPerDay  int   // count cap in a rolling 24h window
	MaxAmountPerDay int64 // total kobo cap in a rolling 24h window
	MaxSingleKobo   int64 // single-transfer cap
}

// DefaultAMLConfig is the closed-loop default applied when none is supplied.
func DefaultAMLConfig() AMLConfig {
	return AMLConfig{
		MaxSendsPerDay:  50,
		MaxAmountPerDay: 50000000, // ₦500,000 / day
		MaxSingleKobo:   20000000, // ₦200,000 single
	}
}

// AML enforces send velocity / structuring limits against the recorded P2P
// payment history (NL-10). It fails CLOSED: a DB error blocks the transfer.
type AML struct {
	db  *pgxpool.Pool
	cfg AMLConfig
}

func NewAML(db *pgxpool.Pool, cfg AMLConfig) *AML {
	if cfg.MaxSendsPerDay == 0 {
		cfg = DefaultAMLConfig()
	}
	return &AML{db: db, cfg: cfg}
}

// Check verifies a proposed send of amountKobo by senderID is within limits.
func (a *AML) Check(ctx context.Context, senderID string, amountKobo int64) error {
	if amountKobo <= 0 {
		return errors.New("social: amount must be positive")
	}
	if amountKobo > a.cfg.MaxSingleKobo {
		return ErrAMLSingleLimit
	}
	const q = `
		SELECT COALESCE(COUNT(*),0), COALESCE(SUM(amount_kobo),0)
		FROM social_payments
		WHERE sender_id=$1 AND created_at > now() - interval '24 hours'`
	var cnt int
	var sum int64
	if err := a.db.QueryRow(ctx, q, senderID).Scan(&cnt, &sum); err != nil {
		return fmt.Errorf("social: aml check failed (fail-closed): %w", err)
	}
	if cnt+1 > a.cfg.MaxSendsPerDay {
		return ErrAMLCountLimit
	}
	if sum+amountKobo > a.cfg.MaxAmountPerDay {
		return ErrAMLAmountLimit
	}
	return nil
}

var (
	ErrAMLSingleLimit = errors.New("social: transfer exceeds single-send limit")
	ErrAMLCountLimit  = errors.New("social: daily transfer count limit reached")
	ErrAMLAmountLimit = errors.New("social: daily transfer amount limit reached")
)

// P2P PAYMENT — an in-chat send. Sender -> recipient (resolved via cashtag).
// Money moves wallet→wallet through the finance ledger (NL-8), idempotent (NL-9).
// AML velocity limits applied per sender (NL-10).

type Payment struct {
	ID             string    `json:"id"`
	SenderID       string    `json:"sender_id"`
	RecipientID    string    `json:"recipient_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	Note           string    `json:"note"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// PAYMENT REQUEST — "request N from @handle". The REQUESTER asks the PAYER.
// Object-level authZ: a user can only create a request as THEMSELVES (requester
// State: PENDING → PAID | DECLINED | CANCELLED.

type RequestState string

const (
	RequestPending   RequestState = "PENDING"
	RequestPaid      RequestState = "PAID"
	RequestDeclined  RequestState = "DECLINED"
	RequestCancelled RequestState = "CANCELLED"
)

var requestTransitions = map[RequestState]map[RequestState]bool{
	RequestPending:   {RequestPaid: true, RequestDeclined: true, RequestCancelled: true},
	RequestPaid:      {},
	RequestDeclined:  {},
	RequestCancelled: {},
}

type Request struct {
	ID          string       `json:"id"`
	RequesterID string       `json:"requester_id"` // who is owed
	PayerID     string       `json:"payer_id"`     // who must pay
	AmountKobo  int64        `json:"amount_kobo"`
	Note        string       `json:"note"`
	State       RequestState `json:"state"`
	CreatedAt   time.Time    `json:"created_at"`
	ResolvedAt  *time.Time   `json:"resolved_at,omitempty"`
}

// SPLIT BILL — one organiser splits a total across participants (EQUAL or
// CUSTOM per-share). Each share is itself a payment request that the participant
// settles; the engine tracks paid/outstanding.

type SplitMode string

const (
	SplitEqual  SplitMode = "EQUAL"
	SplitCustom SplitMode = "CUSTOM"
)

type SplitState string

const (
	SplitOpen     SplitState = "OPEN"
	SplitSettled  SplitState = "SETTLED"
	SplitCanceled SplitState = "CANCELLED"
)

type SplitBill struct {
	ID          string     `json:"id"`
	OrganiserID string     `json:"organiser_id"`
	Title       string     `json:"title"`
	TotalKobo   int64      `json:"total_kobo"`
	Mode        SplitMode  `json:"mode"`
	State       SplitState `json:"state"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type ShareState string

const (
	SharePending ShareState = "PENDING"
	SharePaid    ShareState = "PAID"
)

type SplitShare struct {
	ID         string     `json:"id"`
	SplitID    string     `json:"split_id"`
	UserID     string     `json:"user_id"`
	AmountKobo int64      `json:"amount_kobo"`
	State      ShareState `json:"state"`
	PaidAt     *time.Time `json:"paid_at,omitempty"`
}

// GROUP POOL — many contributors fund one pot; organiser pays it out. Balance
// is ledger-derived (NL-8). NL-2: no yield.
// State: OPEN → PAID_OUT | CLOSED.

type PoolState string

const (
	PoolOpen    PoolState = "OPEN"
	PoolPaidOut PoolState = "PAID_OUT"
	PoolClosed  PoolState = "CLOSED"
)

var poolTransitions = map[PoolState]map[PoolState]bool{
	PoolOpen:    {PoolPaidOut: true, PoolClosed: true},
	PoolPaidOut: {PoolClosed: true},
	PoolClosed:  {},
}

type GroupPool struct {
	ID            string    `json:"id"`
	OrganiserID   string    `json:"organiser_id"`
	Title         string    `json:"title"`
	BeneficiaryID *string   `json:"beneficiary_id,omitempty"` // defaults to organiser at payout
	State         PoolState `json:"state"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type PoolContribution struct {
	ID         string    `json:"id"`
	PoolID     string    `json:"pool_id"`
	UserID     string    `json:"user_id"`
	AmountKobo int64     `json:"amount_kobo"`
	CreatedAt  time.Time `json:"created_at"`
}

func canRequest(from, to RequestState) bool { return requestTransitions[from][to] }
func canPool(from, to PoolState) bool       { return poolTransitions[from][to] }

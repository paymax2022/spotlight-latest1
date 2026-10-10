package escrow

import (
	"context"
	"errors"
	"fmt"
	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/fsm"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor is the minimal slice of services.AuditService the escrow core needs.
// It is satisfied by the existing immutable audit service (NL-12); nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// walletDebitLimiter is the minimal seam the Hold money path depends on for
// the fail-closed KYC-tier / daily-debit gate. *tiers.Service satisfies it in
// production; unit tests inject a fake via WithTiers. Modeled as a local
// interface — mirrors social's walletDebitLimiter. A hold debits the payer's
// wallet, so the STRICT gate is used: it is not a checkout purchase, so the
// Tier-0 checkout allowance (ADR-043) does NOT apply here.
type walletDebitLimiter interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
	// EnforceWalletDebitLimitTx is the SAME check evaluated inside the debiting
	// transaction under the wallet advisory lock — the authoritative half of
	// the gate (F7). Satisfies ledger.DebitGuard.
	EnforceWalletDebitLimitTx(ctx context.Context, tx pgx.Tx, userID string, amountKobo int64) error
}

// ErrTierGateUnwired is returned when a Service has no tier gate — a nil gate
// must fail CLOSED, never debit ungated (mirrors social.ErrTierGateUnwired).
var ErrTierGateUnwired = errors.New("escrow: money path requires a tier gate (not wired)")

// ErrReconPending marks a transient ledger/idempotency inconsistency: a store
// reported ErrDuplicate for a key whose journal is NOT durably posted (e.g.
// the Redis idem-lock TTL outliving a failed post). It is RETRYABLE — callers
// should map it to a 503-style response so the client retries; a later attempt
// either posts the leg or heals it (same convention as ErrTierGateUnwired ->
// 503 in p2pmarket/handler.go). Distinct from ledger.ErrDuplicate, which is a
// permanent identity conflict and must stay non-retryable.
var ErrReconPending = errors.New("escrow: ledger reported duplicate but the journal is not posted — retryable inconsistency")

// ErrDisputeRequired is returned by Release/Refund on a DISPUTED hold: contested
// funds may only leave through Arbitrate so the dispute row is always closed
// with the recorded ruling — a direct resolve would move the money and strand
// the dispute bookkeeping OPEN forever (F6d). Fail closed, not retryable.
var ErrDisputeRequired = errors.New("escrow: hold is DISPUTED — resolve via Arbitrate")

// Service is a generic, ledger-backed funds-hold state machine reusable by
// social / events / creators. It extends the finance ledger directly: a HELD
// hold debits the payer's wallet into the shared escrow standing account; RELEASE
// credits the payee from escrow; REFUND credits the payer back. Every money leg
// is idempotent (NL-9) and every transition is audited (NL-12). Paymax never
// lends (NL-1/NL-6) and never pays yield on the held float (NL-2).
type Service struct {
	db    *pgxpool.Pool
	led   *ledger.Service
	audit Auditor
	tiers walletDebitLimiter
}

// NewService builds the escrow service. The tier-limit gate is constructed
// from the same pool (tiers.NewService needs only the DB), so no extra wiring
// is required at the call site — same convention as social.NewService. A nil
// pool leaves the gate nil, and Hold then fails closed via ErrTierGateUnwired.
func NewService(db *pgxpool.Pool, led *ledger.Service, audit Auditor) *Service {
	s := &Service{db: db, led: led, audit: audit}
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

// enforceDebitLimit is the fail-closed guard applied before the Hold wallet
// debit (E2E-FIN-046): the same EnforceWalletDebitLimit the canonical transfer
// rail (finance/transfers) runs. Tier 0 → ErrWalletDisabled, over daily cap →
// ErrDailyLimitExceeded, gate/db errors refuse, and a missing gate refuses via
// ErrTierGateUnwired. The error is propagated UNWRAPPED so callers can map the
// tier sentinels to 403 via errors.Is.
func (s *Service) enforceDebitLimit(ctx context.Context, userID string, amountKobo int64) error {
	if s.tiers == nil {
		return ErrTierGateUnwired
	}
	return s.tiers.EnforceWalletDebitLimit(ctx, userID, amountKobo)
}

// Hold debits the payer's wallet into the escrow account and records a HELD
// hold with no pinned counterparty (payee chosen at Release time). Callers that
// already know who the funds are owed to — e.g. p2pmarket knows the seller at
// checkout — should use HoldWithPayee so a later DISPUTED hold can still be
// arbitrated to RELEASE.
func (s *Service) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (*Hold, error) {
	return s.hold(ctx, payerID, "", reference, moduleType, idemKey, amountKobo)
}

// HoldWithPayee is Hold plus the intended counterparty recorded at hold time.
// Pinning the payee makes Arbitrate(DecisionRelease) reachable on a disputed
// hold (the pre-fix flow only wrote payee_id at RELEASE commit, so every real
// arbitration could only ever REFUND — F2). Once pinned, Release must credit
// exactly that payee; a mismatched payee argument fails closed.
func (s *Service) HoldWithPayee(ctx context.Context, payerID, payeeID, reference, moduleType, idemKey string, amountKobo int64) (*Hold, error) {
	return s.hold(ctx, payerID, payeeID, reference, moduleType, idemKey, amountKobo)
}

// hold is the shared funds-hold money path behind Hold / HoldWithPayee.
// idemKey makes the whole operation replay-safe: the ledger debit is suffixed
// per-leg ("<idemKey>:hold") and the hold row carries a UNIQUE idempotency_key.
//
// Commit ordering (same constraint as resolve): the ledger API opens its own
// transaction, so the debit posts BEFORE the escrow_holds insert rather than
// atomically with it. A crash between the two leaves the payer's money parked
// in the escrow standing account with no hold row — and a naive retry then
// wedges twice: the Redis idem-lock reports ErrDuplicate inside its TTL, and
// the tier gate re-counts the already-posted debit against today's cap
// (getDailyDebited sums ledger_entries), refusing the very replay meant to
// heal. The replay converges by probing the ledger of record FIRST: an
// already-posted leg skips both the gate and the re-debit, is verified to be
// THIS journal, and the missing row is healed by the insert below.
func (s *Service) hold(ctx context.Context, payerID, payeeID, reference, moduleType, idemKey string, amountKobo int64) (*Hold, error) {
	if amountKobo <= 0 {
		return nil, fmt.Errorf("escrow: amount must be positive kobo, got %d", amountKobo)
	}
	if payerID == "" || idemKey == "" {
		return nil, errors.New("escrow: payer and idempotency key required")
	}
	if payeeID != "" && payeeID == payerID {
		return nil, errors.New("escrow: payee cannot be the payer")
	}

	// Replay: if a hold already exists for this key, return it (no double-debit).
	// A NULL payee is healed when THIS payer replays with a counterparty — a
	// mid-flight hold created before payee pinning (or by a Hold caller) can
	// still gain one, so its eventual arbitration keeps RELEASE reachable.
	if existing, err := s.getByIdem(ctx, idemKey); err == nil && existing != nil {
		s.maybePinPayee(ctx, existing, payerID, payeeID)
		return existing, nil
	}

	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}

	holdKey := idemKey + ":hold"
	posted, err := s.led.Posted(ctx, holdKey)
	if err != nil {
		return nil, fmt.Errorf("escrow: verify hold debit: %w", err)
	}
	if posted {
		// Heal path: the debit committed on a prior attempt that died before the
		// insert. Confirm the recorded pair is THIS journal — BOTH legs, since
		// the credit leg (escrow standing account) is identical for every payer —
		// then skip both the tier gate (the money already moved; re-counting it
		// would refuse a same-day replay on the daily cap) and the re-debit, and
		// let the row insert below heal the missing hold.
		if err := s.verifyHoldDebitLeg(ctx, payerID, holdKey, reference, escrowAcc.ID, amountKobo); err != nil {
			return nil, err
		}
	} else {
		// Tier gate (fail-closed, E2E-FIN-046): a hold is a wallet debit, so the
		// same EnforceWalletDebitLimit the transfer rail applies runs BEFORE
		// money moves — a refused attempt posts zero ledger legs and no hold
		// row. This pooled call is the ADVISORY half only (fast early refusal);
		// postHoldDebit re-runs the same check inside the debit tx under the
		// wallet advisory lock via ledger.DebitWithGuard — the authoritative
		// half that closes F7 (two concurrent holds can both pass the pooled
		// read; the serialised in-tx read admits only one). Fresh attempts
		// only: replays of a completed key already returned the existing hold
		// above, and replays of a debit-only crash take the heal branch — the
		// in-tx guard is skipped on a verified committed replay by the
		// ledger's replay-first ordering, so a retry is never refused by
		// re-counting its own posted legs.
		if err := s.enforceDebitLimit(ctx, payerID, amountKobo); err != nil {
			return nil, err
		}
		// NL-1: ledger.Debit fails closed on insufficient funds — no negative balance.
		if err := s.postHoldDebit(ctx, payerID, reference, holdKey, escrowAcc.ID, amountKobo); err != nil {
			return nil, err
		}
	}

	h := &Hold{
		ID:             uuid.New().String(),
		Reference:      reference,
		ModuleType:     moduleType,
		PayerID:        payerID,
		AmountKobo:     amountKobo,
		State:          StateHeld,
		IdempotencyKey: idemKey,
		HeldAt:         time.Now(),
	}
	var payeeArg any
	if payeeID != "" {
		p := payeeID
		h.PayeeID = &p
		payeeArg = payeeID
	}
	const ins = `
		INSERT INTO escrow_holds (id, reference, module_type, payer_id, payee_id, amount_kobo, state, idempotency_key, held_at)
		VALUES ($1,$2,$3,$4,$5,$6,'HELD',$7,$8)`
	if _, err := s.db.Exec(ctx, ins, h.ID, h.Reference, h.ModuleType, h.PayerID, payeeArg, h.AmountKobo, h.IdempotencyKey, h.HeldAt); err != nil {
		// A concurrent Hold with the same key won the insert race — converge on
		// its persisted row instead of surfacing a raw unique violation (the
		// shared ledger leg is keyed on idemKey, so the winner's row correctly
		// represents the posted debit either way).
		if dbutil.IsUniqueViolation(err) {
			if existing, gerr := s.getByIdem(ctx, idemKey); gerr == nil && existing != nil {
				s.maybePinPayee(ctx, existing, payerID, payeeID)
				return existing, nil
			}
		}
		return nil, fmt.Errorf("escrow: insert hold: %w", err)
	}
	s.logTransition("", h, StateHeld, "escrow.hold")
	return h, nil
}

// maybePinPayee heals a NULL payee_id on a replayed hold — but only when the
// replaying caller IS the stored payer and supplies a counterparty. A replay by
// anyone else (or one carrying no payee) leaves the row untouched, so a foreign
// claimant can never attach a beneficiary to someone else's hold. Best-effort:
// on failure the hold still returns — a NULL payee simply keeps arbitration
// refund-only (fail closed), never misdirects funds. The UPDATE's IS NULL guard
// means a pinned payee can never be overwritten by a replay.
func (s *Service) maybePinPayee(ctx context.Context, h *Hold, payerID, payeeID string) {
	if payeeID == "" || h.PayerID != payerID || (h.PayeeID != nil && *h.PayeeID != "") {
		return
	}
	ct, err := s.db.Exec(ctx,
		`UPDATE escrow_holds SET payee_id=$2 WHERE id=$1 AND payee_id IS NULL`, h.ID, payeeID)
	if err == nil && ct.RowsAffected() > 0 {
		p := payeeID
		h.PayeeID = &p
		if s.audit != nil {
			s.audit.LogAction(h.PayerID, "", "escrow.payee.pin", "escrow", "escrow_hold", h.ID,
				nil,
				map[string]any{"payee_id": payeeID},
				"", "", "info")
		}
	}
}

// postHoldDebit posts the payer->escrow debit leg for a fresh hold. On
// ledger.ErrDuplicate the ledger of record is re-probed — the Redis idem-lock
// can report a duplicate within its TTL for a posting the DB never recorded,
// and a racing poster may have committed the identical journal. A durably
// posted matching leg is a no-op success; a foreign claim under the key fails
// closed via verifyHoldDebitLeg (mirrors ensureResolutionCredit).
func (s *Service) postHoldDebit(ctx context.Context, payerID, reference, holdKey, escrowAccID string, amountKobo int64) error {
	if s.tiers == nil {
		return ErrTierGateUnwired
	}
	// DebitWithGuard carries the tier check INTO the posting tx: the daily-cap
	// sum is evaluated under pg_advisory_xact_lock("wallet:"+payerID) — the same
	// lock every gated wallet debit takes — immediately before the legs insert,
	// so concurrent holds on one wallet cannot collectively overshoot the cap
	// (F7). The guard runs after the repo's replay verification, so a committed
	// prior journal under holdKey converges without re-gating.
	err := s.led.DebitWithGuard(ctx, payerID, "escrow:"+reference, holdKey, escrowAccID, amountKobo,
		s.tiers.EnforceWalletDebitLimitTx)
	if err == nil {
		return nil
	}
	if !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("escrow: hold debit: %w", err)
	}
	posted, perr := s.led.Posted(ctx, holdKey)
	if perr != nil {
		return fmt.Errorf("escrow: verify hold debit after duplicate: %w", perr)
	}
	if !posted {
		return fmt.Errorf("%w: hold debit for key %s", ErrReconPending, holdKey)
	}
	return s.verifyHoldDebitLeg(ctx, payerID, holdKey, reference, escrowAccID, amountKobo)
}

// verifyHoldDebitLeg confirms the balanced pair under holdKey is THIS hold's
// journal, checking BOTH legs (the in-repo standard set by
// repository.journalLegsMatchTx):
//   - "<holdKey>:credit" must credit the escrow standing account the exact
//     amount under the "escrow:<reference>" reference;
//   - "<holdKey>:debit" must debit THIS caller's user_wallet — the credit leg
//     is constant across payers, so checking it alone would let a replay
//     carrying another payer's key adopt THEIR parked debit and write a hold
//     row naming this caller as payer_id, handing them RaiseDispute/Refund
//     control over funds they never paid.
//
// The payer's wallet resolves via GetOrCreateUserWallet — the same path Debit
// uses internally — so the comparison is against the account the debit would
// have hit. Any mismatch fails closed with ErrDuplicate semantics: never heal
// a hold onto a caller whose debit wasn't theirs.
func (s *Service) verifyHoldDebitLeg(ctx context.Context, payerID, holdKey, reference, escrowAccID string, amountKobo int64) error {
	credit, found, err := s.led.EntryByKey(ctx, holdKey+":credit")
	if err != nil {
		return fmt.Errorf("escrow: read hold credit leg: %w", err)
	}
	if !found || credit.AccountID != escrowAccID || credit.Type != ledger.EntryCredit ||
		credit.Reference != "escrow:"+reference || credit.AmountKobo != amountKobo {
		return fmt.Errorf("%w: key %s held by a different journal — refusing to attach a hold row",
			ledger.ErrDuplicate, holdKey)
	}
	payerAcc, err := s.led.GetOrCreateUserWallet(ctx, payerID)
	if err != nil {
		return fmt.Errorf("escrow: resolve payer wallet for debit-leg verification: %w", err)
	}
	debit, found, err := s.led.EntryByKey(ctx, holdKey+":debit")
	if err != nil {
		return fmt.Errorf("escrow: read hold debit leg: %w", err)
	}
	if !found || debit.AccountID != payerAcc.ID || debit.Type != ledger.EntryDebit ||
		debit.Reference != "escrow:"+reference || debit.AmountKobo != amountKobo {
		return fmt.Errorf("%w: key %s debit leg is not this payer's journal — refusing to attach a hold row",
			ledger.ErrDuplicate, holdKey)
	}
	return nil
}

// Release moves the held amount from escrow to the payee (HELD → RELEASED).
// A DISPUTED hold refuses: contested funds may only leave through Arbitrate, so
// a direct release/refund can never bypass dispute bookkeeping (F6d).
func (s *Service) Release(ctx context.Context, escrowID, payeeID string) error {
	return s.resolve(ctx, escrowID, StateReleased, payeeID, "escrow.release", false)
}

// Refund returns the held amount to the original payer (HELD → REFUNDED).
// A DISPUTED hold refuses: contested funds may only leave through Arbitrate.
func (s *Service) Refund(ctx context.Context, escrowID string) error {
	return s.resolve(ctx, escrowID, StateRefunded, "", "escrow.refund", false)
}

// resolveArbitrated is the arbitration-only lane of resolve: Arbitrate calls it
// after its own dispute checks, so a DISPUTED hold may transition to its ruled
// terminal state. The same FSM, the same money leg, the same heal semantics —
// only the DISPUTED source guard differs.
func (s *Service) resolveArbitrated(ctx context.Context, escrowID string, to State, payeeID string) error {
	action := "escrow.release"
	if to == StateRefunded {
		action = "escrow.refund"
	}
	return s.resolve(ctx, escrowID, to, payeeID, action, true)
}

// resolve performs the guarded transition + the matching ledger credit. The row
// state flips FOR UPDATE first (rejecting illegal / repeated transitions), then —
// after the commit — the ledger credit posts under a per-state idempotency key.
//
// The ledger API opens its own transaction (no pgx.Tx posting seam), so the two
// writes cannot share one DB tx. What makes the gap safe is that the idempotent
// early-return does NOT skip the money leg: a replay on an already-terminal hold
// runs ensureResolutionCredit, which verifies the credit against the ledger of
// record (ledger.Posted) and posts it if it is missing — so a process that dies
// between the state commit and the credit leaves the beneficiary unpaid only
// until the next resolve call, which heals it (never a permanently unpaid
// RELEASED/REFUNDED state, and never a double-pay: the per-leg key dedups a
// racing poster, and a committed terminal state means the OPPOSITE leg can no
// longer be attempted — the FSM rejects it before any money moves).
func (s *Service) resolve(ctx context.Context, escrowID string, to State, payeeID, action string, viaArbitration bool) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("escrow: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var h Hold
	var state string
	const sel = `SELECT id, reference, payer_id, payee_id, amount_kobo, state, idempotency_key
	             FROM escrow_holds WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, sel, escrowID).Scan(
		&h.ID, &h.Reference, &h.PayerID, &h.PayeeID, &h.AmountKobo, &state, &h.IdempotencyKey,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("escrow: hold not found")
		}
		return fmt.Errorf("escrow: fetch hold: %w", err)
	}
	from := State(state)
	if from == to {
		// Idempotent re-resolve: already in the target terminal state — but the
		// credit posts AFTER the commit, so a crashed prior attempt may have left
		// the beneficiary unpaid. Verify (and heal) the money leg before
		// reporting success; the beneficiary is taken from the STORED row, never
		// the replay's payee argument, so a re-resolve cannot redirect funds.
		posted, err := s.ensureResolutionCredit(ctx, &h, to)
		if err != nil {
			return err
		}
		if posted {
			// A healed credit is still a money mutation — audit it (distinct
			// action so recon can tell a heal from a first-pass resolve).
			hh := h
			hh.State = to
			s.logTransition(string(from), &hh, to, action+".credit_heal")
		}
		return nil
	}
	if !canTransition(from, to) {
		return fmt.Errorf("escrow: illegal transition %s -> %s", from, to)
	}
	if from == StateDisputed && !viaArbitration {
		// Fail closed (F6d): a direct Release/Refund on a DISPUTED hold would
		// move the money while the dispute row stays OPEN — contested funds may
		// only be resolved through Arbitrate, which closes the dispute with the
		// recorded decision + arbiter.
		return fmt.Errorf("%w: hold %s", ErrDisputeRequired, escrowID)
	}

	// COALESCE keeps a payee pinned at hold time on the REFUND path — refunding
	// must not erase the counterparty record the dispute/arbitration relied on.
	const upd = `UPDATE escrow_holds SET state=$2, payee_id=COALESCE($3, payee_id), resolved_at=now() WHERE id=$1`
	var payeeArg any
	if to == StateReleased {
		effective := payeeID
		if h.PayeeID != nil && *h.PayeeID != "" {
			// The payee was pinned at hold time — release must credit exactly
			// that counterparty. A different payee argument fails closed rather
			// than redirect the funds; an empty one just uses the pin.
			if effective == "" {
				effective = *h.PayeeID
			} else if effective != *h.PayeeID {
				return fmt.Errorf("escrow: hold %s payee is pinned — cannot release to a different payee", escrowID)
			}
		}
		if effective == "" {
			return errors.New("escrow: payee required to release")
		}
		payeeArg = effective
		h.PayeeID = &effective
	}
	if _, err := tx.Exec(ctx, upd, escrowID, string(to), payeeArg); err != nil {
		return fmt.Errorf("escrow: update state: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("escrow: commit transition: %w", err)
	}

	// Money leg: credit escrow -> payee (release) or escrow -> payer (refund).
	if _, err := s.ensureResolutionCredit(ctx, &h, to); err != nil {
		return err
	}

	hh := h
	hh.State = to
	s.logTransition(string(from), &hh, to, action)
	return nil
}

// ensureResolutionCredit makes the beneficiary's credit leg for a resolved hold
// durable: if the balanced entry for this hold's per-state key is not posted, it
// posts it. Called both on the fresh path (right after the state commit) and on
// the from==to replay path (to heal a hold that committed its terminal state but
// died before the credit). Idempotent via the "<hold idemKey>:release|refund"
// key — a retry or a racing poster dedups to ledger.ErrDuplicate. Returns
// posted=true only when this call wrote a NEW credit (callers use it to emit
// the audit event on the heal path; the fresh path audits regardless).
func (s *Service) ensureResolutionCredit(ctx context.Context, h *Hold, to State) (bool, error) {
	leg := "refund"
	beneficiary := h.PayerID
	if to == StateReleased {
		leg = "release"
		if h.PayeeID == nil || *h.PayeeID == "" {
			return false, errors.New("escrow: released hold has no recorded payee — refusing to guess the beneficiary")
		}
		beneficiary = *h.PayeeID
	}
	key := h.IdempotencyKey + ":" + leg
	posted, err := s.led.Posted(ctx, key)
	if err != nil {
		return false, fmt.Errorf("escrow: verify %s credit: %w", leg, err)
	}
	if posted {
		return false, nil
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return false, err
	}
	if err := s.led.Credit(ctx, beneficiary, leg+":"+h.Reference, key, escrowAcc.ID, h.AmountKobo); err != nil {
		if errors.Is(err, ledger.ErrDuplicate) {
			// ErrDuplicate can also surface from the Redis idem-lock TTL window,
			// not only a durable journal row — recheck the ledger of record
			// before reporting the credit as applied.
			posted, perr := s.led.Posted(ctx, key)
			if perr != nil {
				return false, fmt.Errorf("escrow: verify %s credit after duplicate: %w", leg, perr)
			}
			if !posted {
				return false, fmt.Errorf("%w: %s credit for key %s", ErrReconPending, leg, key)
			}
			return false, nil
		}
		return false, fmt.Errorf("escrow: %s credit: %w", leg, err)
	}
	return true, nil
}

// Get returns a hold by id (object-level authZ enforced by callers/RLS).
func (s *Service) Get(ctx context.Context, escrowID string) (*Hold, error) {
	var h Hold
	var state string
	const q = `SELECT id, reference, module_type, payer_id, payee_id, amount_kobo, state, idempotency_key, held_at, resolved_at
	           FROM escrow_holds WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, escrowID).Scan(
		&h.ID, &h.Reference, &h.ModuleType, &h.PayerID, &h.PayeeID, &h.AmountKobo,
		&state, &h.IdempotencyKey, &h.HeldAt, &h.ResolvedAt,
	); err != nil {
		return nil, err
	}
	h.State = State(state)
	return &h, nil
}

func (s *Service) getByIdem(ctx context.Context, idemKey string) (*Hold, error) {
	var h Hold
	var state string
	const q = `SELECT id, reference, module_type, payer_id, payee_id, amount_kobo, state, idempotency_key, held_at, resolved_at
	           FROM escrow_holds WHERE idempotency_key=$1`
	if err := s.db.QueryRow(ctx, q, idemKey).Scan(
		&h.ID, &h.Reference, &h.ModuleType, &h.PayerID, &h.PayeeID, &h.AmountKobo,
		&state, &h.IdempotencyKey, &h.HeldAt, &h.ResolvedAt,
	); err != nil {
		return nil, err
	}
	h.State = State(state)
	return &h, nil
}

func (s *Service) logTransition(from string, h *Hold, to State, action string) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(h.PayerID, "", action, "escrow", "escrow_hold", h.ID,
		map[string]any{"state": from},
		map[string]any{"state": string(to), "amount_kobo": h.AmountKobo},
		"", "", "info")
}

// State is the funds-hold lifecycle. DISPUTED is reserved for Phase 3; the
// allowed-transition table here already tolerates it so P3 only adds the entry
// path, never a schema change.
type State string

const (
	StateHeld     State = "HELD"
	StateReleased State = "RELEASED"
	StateRefunded State = "REFUNDED"
	StateDisputed State = "DISPUTED" // P3
)

// allowedTransitions encodes the guarded state machine. Any transition not
// listed is rejected (NL-12 / "state machines, not status fields").
var allowedTransitions = fsm.Table[State]{
	StateHeld:     {StateReleased: true, StateRefunded: true, StateDisputed: true},
	StateDisputed: {StateReleased: true, StateRefunded: true}, // P3 arbitration
	StateReleased: {},
	StateRefunded: {},
}

func canTransition(from, to State) bool { return allowedTransitions.Can(from, to) }

// Hold is a single funds-hold. The held amount lives in the shared ledger escrow
// standing account (NL-6/NL-8) — there is no balance column. PayerID funds it on
// Hold; on Release it credits PayeeID; on Refund it credits PayerID back. Paymax
// never advances principal (NL-1) and never pays yield on the float (NL-2).
type Hold struct {
	ID             string     `json:"id"`
	Reference      string     `json:"reference"`   // domain ref (split id, pool id, order id…)
	ModuleType     string     `json:"module_type"` // social | events | creators …
	PayerID        string     `json:"payer_id"`    // FK auth.users(id)
	PayeeID        *string    `json:"payee_id,omitempty"`
	AmountKobo     int64      `json:"amount_kobo"`
	State          State      `json:"state"`
	IdempotencyKey string     `json:"idempotency_key"`
	HeldAt         time.Time  `json:"held_at"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`
}

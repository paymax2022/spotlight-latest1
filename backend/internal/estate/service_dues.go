package estate

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/finance/ledger"
)

// LedgerPoster is the subset of the finance ledger the estate dues money path
// needs. Satisfied by *ledger.Service. Kept as an interface so the estate
// package stays decoupled and unit-testable.
type LedgerPoster interface {
	GetOrCreateStandingAccount(ctx context.Context, accountType ledger.AccountType) (*ledger.Account, error)
	Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error
	// Credit posts a balanced entry that increases the user's wallet, debiting the
	// given standing account. Used for vendor payouts (Block 42).
	Credit(ctx context.Context, userID, reference, idempotencyKey, debitAccountID string, amountKobo int64) error
	// PostJournal posts an arbitrary balanced DEBIT/CREDIT pair between two
	// standing accounts — used ONLY by payDues' external-funding branch to move
	// money DR provider-clearing / CR settlement with NO wallet leg at all (see
	// PayDuesPaystackFunded). The wallet-funded branch keeps using Debit.
	PostJournal(ctx context.Context, j ledger.JournalEntry) error
}

// TierEnforcer fail-closes a wallet debit against the payer's KYC tier limit.
// Satisfied by *tiers.Service.
type TierEnforcer interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
	// Dues are a resident paying for a service, so they use the checkout gate:
	// identical for Tier 1+, capped-but-permitted for Tier 0 (ADR-043).
	EnforceCheckoutDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// WithLedger wires the ledger so the dues money path can post balanced
// double-entry journals.
func (s *Service) WithLedger(l LedgerPoster) *Service {
	s.ledger = l
	return s
}

// WithTiers wires the tier-limit enforcer (fail-closed on every wallet debit).
func (s *Service) WithTiers(t TierEnforcer) *Service {
	s.tiers = t
	return s
}

// ── Block 29: Dues / Rent / Subscriptions ────────────────────────────────────

// CreateInvoice bills a resident (estate admin only).
func (s *Service) CreateInvoice(ctx context.Context, estateID, adminID string, req CreateInvoiceRequest) (*DuesInvoice, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if req.AmountKobo <= 0 {
		return nil, fmt.Errorf("estate: invoice amount must be positive kobo")
	}
	inv := &DuesInvoice{
		ID:         uuid.New().String(),
		EstateID:   estateID,
		ResidentID: req.ResidentID,
		Category:   req.Category,
		AmountKobo: req.AmountKobo,
		DueDate:    req.DueDate,
		Status:     "pending",
		CreatedAt:  time.Now(),
	}
	if req.PropertyID != "" {
		inv.PropertyID = &req.PropertyID
	}
	const q = `
		INSERT INTO estate_dues_invoices (id, estate_id, property_id, resident_id, category, amount_kobo, due_date, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`
	if _, err := s.db.Exec(ctx, q, inv.ID, inv.EstateID, inv.PropertyID, inv.ResidentID, inv.Category, inv.AmountKobo, inv.DueDate); err != nil {
		return nil, fmt.Errorf("estate: insert invoice: %w", err)
	}
	// Block 30/43: notify the billed resident. Fire-and-forget.
	s.notify(ctx, estateID, req.ResidentID, NotifPaymentDue, "New invoice",
		fmt.Sprintf("You have a new %s invoice of ₦%.2f", inv.Category, float64(inv.AmountKobo)/100),
		map[string]any{"invoice_id": inv.ID, "amount_kobo": inv.AmountKobo})
	return inv, nil
}

// ListInvoices returns the caller's own invoices, or (admin) all estate invoices.
func (s *Service) ListInvoices(ctx context.Context, estateID, userID, status string) ([]DuesInvoice, error) {
	role, err := s.roleIn(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	q := `SELECT id, estate_id, property_id, resident_id, category, amount_kobo, due_date, status, created_at
		FROM estate_dues_invoices WHERE estate_id=$1`
	args := []any{estateID}
	if role != "estate_admin" {
		q += fmt.Sprintf(" AND resident_id=$%d", len(args)+1)
		args = append(args, userID)
	}
	if status != "" {
		q += fmt.Sprintf(" AND status=$%d", len(args)+1)
		args = append(args, status)
	}
	q += " ORDER BY due_date DESC LIMIT 200"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DuesInvoice
	for rows.Next() {
		var inv DuesInvoice
		if err := rows.Scan(&inv.ID, &inv.EstateID, &inv.PropertyID, &inv.ResidentID, &inv.Category, &inv.AmountKobo, &inv.DueDate, &inv.Status, &inv.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

// ErrDuesExternalAmountMismatch guards the Paystack-funded dues path: the
// verified charge amount must equal the invoice amount this function
// independently reloads at payment time. See payDues' external-funding
// cross-check.
var ErrDuesExternalAmountMismatch = fmt.Errorf("estate: verified payment amount no longer matches the invoice amount")

// resolveDuesInvoiceAmount loads and validates an invoice the same way
// payDues does (scoped to estate + payer, not paid/waived), without moving
// any money. Shared by payDues itself and QuoteDuesInvoice (a pre-payment
// amount check for the Paystack-checkout initiate step) so the two can never
// disagree about what an invoice costs.
//
// alreadyPaid is non-nil when the invoice is already settled — the canonical
// receipt for it — so a caller (payDues) can treat that as its own idempotent
// success instead of an error; QuoteDuesInvoice surfaces it as a plain error
// since there is nothing to quote for an already-paid invoice.
func (s *Service) resolveDuesInvoiceAmount(ctx context.Context, estateID, payerID, invoiceID string) (amount int64, alreadyPaid *DuesPayment, err error) {
	var status, ownerID string
	const qInv = `SELECT amount_kobo, status, resident_id FROM estate_dues_invoices WHERE id=$1 AND estate_id=$2`
	if err := s.db.QueryRow(ctx, qInv, invoiceID, estateID).Scan(&amount, &status, &ownerID); err != nil {
		return 0, nil, fmt.Errorf("estate: invoice not found in this estate")
	}
	if ownerID != payerID {
		return 0, nil, fmt.Errorf("estate: cannot pay another resident's invoice")
	}
	if status == "paid" {
		receipt, rerr := s.existingReceipt(ctx, estateID, invoiceID)
		if rerr != nil {
			return 0, nil, rerr
		}
		return amount, receipt, nil
	}
	if status == "waived" {
		return 0, nil, fmt.Errorf("estate: invoice has been waived")
	}
	return amount, nil, nil
}

// QuoteDuesInvoice returns the exact amount owed on invoiceID, running the
// SAME validation payDues itself runs (ownership, not paid/waived) — used
// ONLY to decide the amount to ask Paystack for. Never trusted as final:
// PayDuesPaystackFunded independently reloads and cross-checks it at
// confirmation time (see ErrDuesExternalAmountMismatch).
func (s *Service) QuoteDuesInvoice(ctx context.Context, estateID, payerID, invoiceID string) (int64, error) {
	amount, alreadyPaid, err := s.resolveDuesInvoiceAmount(ctx, estateID, payerID, invoiceID)
	if err != nil {
		return 0, err
	}
	if alreadyPaid != nil {
		return 0, fmt.Errorf("estate: invoice already paid")
	}
	return amount, nil
}

// payDues is the shared implementation behind PayDues (wallet-funded,
// KYC-tier-gated) and PayDuesPaystackFunded (funded by an ALREADY-VERIFIED
// external Paystack charge, never wallet-gated — see that function's doc
// comment for why). `external` and `verifiedAmountKobo` are NEVER settable
// by client input on any HTTP-facing request DTO — see the two exported
// wrappers below.
//
// Iron rules enforced here:
//   - Idempotency-Key required (fail-closed) — ErrIdempotencyRequired otherwise.
//   - Tier-limit check fail-closed before any money moves (skipped when external).
//   - Balanced double-entry: DEBIT payer wallet → CREDIT estate settlement account
//     (wallet-funded), or DR provider-clearing → CR settlement, no wallet leg at
//     all (externally-funded — see settlement's EscrowExternal for the sibling
//     pattern this mirrors).
//   - Immutable receipt: estate_payments row keyed on idempotency_key (unique).
//   - Audit event written in the same tx as the receipt.
//   - On success any active dues restriction for the resident is lifted.
func (s *Service) payDues(ctx context.Context, estateID, payerID string, req PayDuesRequest, external bool, verifiedAmountKobo int64) (*DuesPayment, error) {
	// 1. Fail closed if no Idempotency-Key (runs before touching the ledger).
	if req.IdempotencyKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if s.ledger == nil {
		return nil, ErrLedgerUnavailable
	}

	// 2. Membership.
	if err := s.assertResident(ctx, estateID, payerID); err != nil {
		return nil, err
	}

	// 3. Load invoice (scoped to estate + payer; immutable amount source of truth).
	amount, alreadyPaid, err := s.resolveDuesInvoiceAmount(ctx, estateID, payerID, req.InvoiceID)
	if err != nil {
		return nil, err
	}
	if alreadyPaid != nil {
		// Idempotent: already settled — return the canonical receipt.
		return alreadyPaid, nil
	}
	// Amount is the invoice amount; an override may only match (never under/over-pay).
	if req.AmountKobo != 0 && req.AmountKobo != amount {
		return nil, fmt.Errorf("estate: amount must equal the invoice amount %d kobo", amount)
	}
	method := req.Method
	if method == "" {
		method = "wallet"
	}
	// Recorded distinctly from any client-settable value, mirroring
	// transport.paymentMethodPaystackExternal — lets any future consumer of
	// estate_payments.method tell a Paystack-funded receipt apart from a
	// wallet-funded one at a glance.
	if external {
		method = "paystack"
	}

	// External-funding amount cross-check — BEFORE anything writes. The caller
	// already verified Paystack collected verifiedAmountKobo at intent-creation
	// time, from a quote against the invoice at THAT moment. The invoice amount
	// is immutable once created, so this should never actually drift — but this
	// function never trusts the caller's claim regardless, and re-validates
	// against the SAME reload payDues itself just did.
	if external && amount != verifiedAmountKobo {
		return nil, ErrDuesExternalAmountMismatch
	}

	// 4. Tier-limit check, fail-closed, before any money moves. Skipped entirely
	// when external is true: an externally-funded payment is collected by an
	// ALREADY-VERIFIED Paystack charge that never touches the payer's wallet,
	// so there is no wallet debit for this gate to price against.
	if !external && s.tiers != nil {
		if err := s.tiers.EnforceCheckoutDebitLimit(ctx, payerID, amount); err != nil {
			return nil, fmt.Errorf("estate: dues payment blocked by tier limit: %w", err)
		}
	}

	// 5. Estate collection account = settlement standing account (estate operator
	//    settles out-of-band; the estate_id is recorded on the receipt + ref).
	settle, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, fmt.Errorf("estate: settlement account: %w", err)
	}

	// 6. Balanced double-entry. Wallet-funded: DEBIT payer wallet, CREDIT
	//    settlement. Externally-funded: DR provider-clearing, CR settlement —
	//    the money already left the payer via an already-verified Paystack
	//    charge, so there is no wallet leg to post here (mirrors
	//    settlement.Service.EscrowExternal's DR-clearing/CR-escrow shape,
	//    adapted to dues' immediate-settle model — there is no hold/release
	//    step for dues to mirror). Both branches are idempotent on
	//    req.IdempotencyKey (ledger unique constraint + redis lock).
	ref := "estate_dues:" + estateID + ":" + req.InvoiceID
	if external {
		clearingAcc, cerr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
		if cerr != nil {
			return nil, fmt.Errorf("estate: provider clearing account: %w", cerr)
		}
		jerr := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       ref,
			IdempotencyKey:  req.IdempotencyKey,
			AmountKobo:      amount,
			DebitAccountID:  clearingAcc.ID,
			CreditAccountID: settle.ID,
			Description:     "Paystack-funded estate dues payment (external payment, no wallet debit)",
		})
		if jerr != nil && jerr != ledger.ErrDuplicate {
			return nil, fmt.Errorf("estate: dues external post: %w", jerr)
		}
	} else if err := s.ledger.Debit(ctx, payerID, ref, req.IdempotencyKey, settle.ID, amount); err != nil {
		return nil, fmt.Errorf("estate: dues debit: %w", err)
	}

	// 7. Immutable receipt + mark invoice paid + lift restriction + audit, one tx.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	pay := &DuesPayment{
		ID: uuid.New().String(), EstateID: estateID, InvoiceID: &req.InvoiceID,
		PayerID: payerID, AmountKobo: amount, Method: method, Status: "successful",
		Reference: ref, CreatedAt: time.Now(),
	}
	// ON CONFLICT's inference target must match uidx_estate_payments_idem
	// EXACTLY, including its WHERE predicate — it is a PARTIAL unique index
	// (idempotency_key IS NOT NULL), so a plain "ON CONFLICT (idempotency_key)"
	// cannot be resolved to it and Postgres raises 42P10 on every insert, not
	// just duplicates (caught live: even the very first, non-replayed PayDues
	// call errored). req.IdempotencyKey is always non-empty here (guarded by
	// ErrIdempotencyRequired above), so the predicate is trivially satisfied.
	const insPay = `
		INSERT INTO estate_payments (id, estate_id, invoice_id, payer_id, amount_kobo, method, status, reference, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,'successful',$7,$8)
		ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`
	res, err := tx.Exec(ctx, insPay, pay.ID, estateID, req.InvoiceID, payerID, amount, method, ref, req.IdempotencyKey)
	if err != nil {
		return nil, fmt.Errorf("estate: insert payment: %w", err)
	}
	if res.RowsAffected() == 0 {
		// Lost a race: a concurrent call with the SAME Idempotency-Key already
		// inserted the canonical row. Because idempotency_key carries a unique
		// index, that insert either already committed (this insert's conflict
		// is only detectable after it did) or is impossible to interleave any
		// other way — so the winner's row, invoice update, restriction lift,
		// and audit entry are already durably committed. Do not repeat them
		// (in particular, do not write a second DUES_PAY audit row) and do not
		// return this LOCALLY-CONSTRUCTED pay struct: pay.ID is a freshly
		// generated UUID that was never persisted, so returning it here would
		// hand the caller a phantom receipt id with no backing estate_payments
		// row. Return the real, persisted receipt instead — mirrors vendor.go
		// RequestPayout's identical "lost a race" handling.
		return s.existingReceipt(ctx, estateID, req.InvoiceID)
	}
	if _, err := tx.Exec(ctx, `UPDATE estate_dues_invoices SET status='paid' WHERE id=$1 AND estate_id=$2`, req.InvoiceID, estateID); err != nil {
		return nil, fmt.Errorf("estate: mark invoice paid: %w", err)
	}
	// Lift any active restriction for this resident (dues cleared).
	if _, err := tx.Exec(ctx,
		`UPDATE estate_dues_restrictions SET active=FALSE, lifted_at=NOW() WHERE estate_id=$1 AND resident_id=$2 AND active`,
		estateID, payerID,
	); err != nil {
		return nil, fmt.Errorf("estate: lift restriction: %w", err)
	}
	if err := s.auditTx(ctx, tx, estateID, payerID, "DUES_PAY", "invoice", req.InvoiceID, map[string]any{
		"amount_kobo": amount, "method": method, "reference": ref,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("estate: commit: %w", err)
	}
	return pay, nil
}

// PayDues settles a dues invoice from the payer's wallet. This is the only
// path reachable from client-controlled input — no HTTP request DTO has a
// field that can select the external path below.
func (s *Service) PayDues(ctx context.Context, estateID, payerID string, req PayDuesRequest) (*DuesPayment, error) {
	return s.payDues(ctx, estateID, payerID, req, false, 0)
}

// PayDuesPaystackFunded settles a dues invoice funded by an external payment
// rail (Paystack card/bank-transfer) instead of the payer's wallet — no
// KYC-tier gate applies, because no wallet debit occurs (see payDues'
// tier-gate skip and its DR-provider-clearing/CR-settlement journal post).
//
// The caller MUST have already verified, server-side, that a completed
// Paystack charge exists covering exactly verifiedAmountKobo — this function
// trusts that verification unconditionally and performs none of its own
// against the gateway. It DOES independently reload the invoice amount and
// requires it to equal verifiedAmountKobo (see payDues' cross-check) — it
// never trusts a caller's claim about what the invoice costs, only about
// what was actually collected. On ErrDuesExternalAmountMismatch, no money
// was moved and no receipt was written; the caller must reverse the
// external charge.
//
// Must only ever be invoked from a server-initiated flow (a Paystack
// initiate/verify/webhook handler) that itself carries no client-settable
// "skip KYC" switch — never from a handler that lets request input choose
// between this and PayDues.
func (s *Service) PayDuesPaystackFunded(ctx context.Context, estateID, payerID string, req PayDuesRequest, verifiedAmountKobo int64) (*DuesPayment, error) {
	return s.payDues(ctx, estateID, payerID, req, true, verifiedAmountKobo)
}

// existingReceipt returns the canonical successful payment for a settled invoice.
func (s *Service) existingReceipt(ctx context.Context, estateID, invoiceID string) (*DuesPayment, error) {
	pay := &DuesPayment{}
	const q = `
		SELECT id, estate_id, invoice_id, payer_id, amount_kobo, method, status, COALESCE(reference,''), created_at
		FROM estate_payments WHERE invoice_id=$1 AND estate_id=$2 AND status='successful'
		ORDER BY created_at LIMIT 1`
	if err := s.db.QueryRow(ctx, q, invoiceID, estateID).Scan(
		&pay.ID, &pay.EstateID, &pay.InvoiceID, &pay.PayerID, &pay.AmountKobo,
		&pay.Method, &pay.Status, &pay.Reference, &pay.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("estate: invoice already paid (receipt unavailable)")
	}
	return pay, nil
}

// ApplyRestriction places a soft/hard service restriction on a defaulting
// resident (estate admin only). Idempotent on the active partial-unique index.
func (s *Service) ApplyRestriction(ctx context.Context, estateID, adminID string, req ApplyRestrictionRequest) (*DuesRestriction, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	r := &DuesRestriction{
		ID: uuid.New().String(), EstateID: estateID, ResidentID: req.ResidentID,
		Level: req.Level, Reason: req.Reason, Active: true, CreatedAt: time.Now(),
	}
	if req.InvoiceID != "" {
		r.InvoiceID = &req.InvoiceID
	}
	const q = `
		INSERT INTO estate_dues_restrictions (id, estate_id, resident_id, invoice_id, level, reason, active, applied_by)
		VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)
		ON CONFLICT (estate_id, resident_id) WHERE active
		DO UPDATE SET level=EXCLUDED.level, reason=EXCLUDED.reason, invoice_id=EXCLUDED.invoice_id
		RETURNING id, created_at`
	if err := s.db.QueryRow(ctx, q, r.ID, estateID, req.ResidentID, r.InvoiceID, req.Level, req.Reason, adminID).Scan(&r.ID, &r.CreatedAt); err != nil {
		return nil, fmt.Errorf("estate: apply restriction: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "RESTRICTION_APPLY", "resident", req.ResidentID, map[string]any{"level": req.Level})
	// Block 30/43: tell the resident a restriction was applied. Fire-and-forget.
	s.notify(ctx, estateID, req.ResidentID, NotifRestrictionApplied, "Account restricted",
		"A "+req.Level+" restriction was applied to your account. Clear outstanding dues to restore access.",
		map[string]any{"level": req.Level})
	return r, nil
}

// LiftRestriction clears a resident's active restriction (estate admin only).
func (s *Service) LiftRestriction(ctx context.Context, estateID, adminID, residentID string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE estate_dues_restrictions SET active=FALSE, lifted_at=NOW() WHERE estate_id=$1 AND resident_id=$2 AND active`,
		estateID, residentID,
	); err != nil {
		return err
	}
	_ = s.audit(ctx, estateID, adminID, "RESTRICTION_LIFT", "resident", residentID, nil)
	// Block 30/43: tell the resident their restriction was lifted. Fire-and-forget.
	s.notify(ctx, estateID, residentID, NotifRestrictionLifted, "Access restored",
		"Your account restriction has been lifted.", nil)
	return nil
}

// activeRestriction returns the active restriction level for a resident
// ("" if none). Used to enforce dues restrictions on gated actions.
func (s *Service) activeRestriction(ctx context.Context, estateID, residentID string) (string, error) {
	var level string
	err := s.db.QueryRow(ctx,
		`SELECT level FROM estate_dues_restrictions WHERE estate_id=$1 AND resident_id=$2 AND active LIMIT 1`,
		estateID, residentID,
	).Scan(&level)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return level, err
}

// restrictionBlocks reports whether an active dues restriction at the given
// level blocks the named action. This is the Block 30 soft/hard matrix:
//
//   - "hard": blocks every gated estate action (visitor codes, voting,
//     facility booking) — a fully banned defaulter.
//   - "soft": blocks voting and facility booking, but visitor codes STILL work
//     (a soft defaulter can still let guests in, but loses community privileges).
//   - "" (no active restriction): blocks nothing.
//
// Pure function (no DB) so the policy is exhaustively unit-testable.
func restrictionBlocks(level, action string) bool {
	switch level {
	case "hard":
		return true
	case "soft":
		return action == ActionVote || action == ActionFacility
	default:
		return false
	}
}

// Gated-action identifiers for the dues-restriction matrix.
const (
	ActionVisitor  = "visitor"
	ActionVote     = "vote"
	ActionFacility = "facility"
)

// enforceNotRestricted fail-closes a gated action against the resident's active
// dues restriction. A DB lookup error blocks the action (fail-closed). Returns a
// descriptive error when the action is blocked, nil when allowed.
func (s *Service) enforceNotRestricted(ctx context.Context, estateID, residentID, action string) error {
	level, err := s.activeRestriction(ctx, estateID, residentID)
	if err != nil {
		return fmt.Errorf("estate: restriction check failed: %w", err)
	}
	if restrictionBlocks(level, action) {
		return fmt.Errorf("estate: %s blocked by active %s dues restriction — clear outstanding dues first", action, level)
	}
	return nil
}

// ── Audit helpers (immutable estate_audit_log) ───────────────────────────────

func (s *Service) auditTx(ctx context.Context, tx pgx.Tx, estateID, actorID, action, subjectType, subjectID string, meta map[string]any) error {
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return fmt.Errorf("estate: audit marshal: %w", err)
	}
	const ins = `INSERT INTO estate_audit_log (id, estate_id, actor_id, action, subject_type, subject_id, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := tx.Exec(ctx, ins, uuid.New().String(), nilUUID(estateID), actorID, action, subjectType, subjectID, metaJSON); err != nil {
		return fmt.Errorf("estate: audit: %w", err)
	}
	return nil
}

func (s *Service) audit(ctx context.Context, estateID, actorID, action, subjectType, subjectID string, meta map[string]any) error {
	metaJSON, _ := json.Marshal(meta)
	const ins = `INSERT INTO estate_audit_log (id, estate_id, actor_id, action, subject_type, subject_id, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := s.db.Exec(ctx, ins, uuid.New().String(), nilUUID(estateID), actorID, action, subjectType, subjectID, metaJSON)
	return err
}

func nilUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

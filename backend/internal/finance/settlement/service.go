package settlement

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// Service manages the escrow → settle lifecycle.
// It is the single place where all provider payouts are calculated and posted.
type Service struct {
	db     *pgxpool.Pool
	ledger *ledger.Service
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service) *Service {
	return &Service{db: db, ledger: ledger}
}

// Escrow holds funds when a payment is made, before the provider fulfils the order.
// Called by every marketplace vertical after a successful payment.
// ATOMICITY (money invariant): this posts TWO effects — a ledger DEBIT (the money
// move) and a settlements-row insert (the tracking record). The ledger API exposes
// no tx-aware Debit, so the debit runs on the ledger's own connection and cannot
// share a tx with the settlements insert here. We therefore make the pair
// crash-safe by (1) keying both effects idempotently on idempotencyKey and (2)
// ordering + retry-hardening them so a caller replay converges to exactly one
// debit and exactly one row:
//   - ledger Debit is idempotent on "<key>:escrow" (duplicate → ErrDuplicate).
//   - settlements.idempotency_key is UNIQUE; the insert is ON CONFLICT DO NOTHING.
//
// If the debit succeeds but the process dies before the insert, a retry with the
// SAME idempotencyKey sees ErrDuplicate from the ledger (funds already held) and
// falls through to ensure the tracking row exists — so escrow is never stranded
// without a row, and money is never debited twice.
func (s *Service) Escrow(ctx context.Context, payerID, reference, idempotencyKey, moduleType string, totalKobo int64) (*Settlement, error) {
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	// Post the money move first (funds-checked, idempotent). A duplicate means the
	// debit already happened on an earlier attempt — treat as success and proceed
	// to (re)ensure the tracking row below, rather than erroring the retry.
	if err := s.ledger.Debit(ctx, payerID, "escrow:"+reference, idempotencyKey+":escrow", escrowAcc.ID, totalKobo); err != nil && err != ledger.ErrDuplicate {
		return nil, fmt.Errorf("settlement: escrow debit: %w", err)
	}
	now := time.Now()
	sett := &Settlement{
		ID:             uuid.New().String(),
		Reference:      reference,
		ModuleType:     moduleType,
		PayerID:        payerID,
		TotalKobo:      totalKobo,
		Status:         StatusEscrowed,
		EscrowedAt:     now,
		IdempotencyKey: idempotencyKey,
	}
	// Idempotent insert: on a retry the row already exists (unique idempotency_key),
	// so DO NOTHING keeps this a safe no-op. We then re-load the canonical row so
	// callers always get the real settlement id (not the fresh uuid we just minted).
	const insert = `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
		VALUES ($1,$2,$3,$4,$5,'escrowed',$6,$7,'wallet')
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err = s.db.Exec(ctx, insert, sett.ID, sett.Reference, sett.ModuleType, sett.PayerID, sett.TotalKobo, sett.EscrowedAt, sett.IdempotencyKey); err != nil {
		return nil, fmt.Errorf("settlement: insert escrow row: %w", err)
	}
	// Resolve the authoritative id/status/total (handles the retry case where the
	// row was inserted by a prior attempt).
	// total_kobo is re-read, NOT echoed from the argument: on a replay the existing
	// row wins, and it may have been escrowed for a DIFFERENT amount than this
	// attempt computed (e.g. a marketplace price changed between attempts). Callers
	// persist their own copy of the amount, so handing them the argument they passed
	// would let their record diverge from the money actually held in escrow. Compare
	// the returned TotalKobo against what you intended to charge and fail closed on a
	// mismatch.
	if err = s.db.QueryRow(ctx,
		`SELECT id, status, total_kobo FROM settlements WHERE idempotency_key=$1`, idempotencyKey,
	).Scan(&sett.ID, &sett.Status, &sett.TotalKobo); err != nil {
		return nil, fmt.Errorf("settlement: resolve escrow row: %w", err)
	}
	return sett, nil
}

// EscrowExternal holds funds ALREADY COLLECTED by an external payment rail
// (a verified Paystack card/bank-transfer charge) — the money never touches
// the payer's internal wallet at all, so this deliberately does NOT run
// through any KYC-tier / daily-wallet-debit gate (see
// restaurant.PlaceOrderExternal). Everything downstream of this call
// (Settle, disputes, reconciliation) is payment-source-agnostic: it reads the
// same `settlements` row shape Escrow produces, keyed the same way.
// Posts DR AccountProviderClearing → CR AccountEscrow — the same "money an
// external processor already collected on our behalf, not yet allocated
// internally" pattern commission.postRevenue uses, rather than a debit off
// any user account (there is no wallet leg for this order at all).
// Idempotent exactly like Escrow: a duplicate journal post is treated as
// "already escrowed" and this falls through to (re)ensure the tracking row,
// so a retry converges to exactly one journal post and one settlements row.
func (s *Service) EscrowExternal(ctx context.Context, payerID, reference, idempotencyKey, moduleType string, totalKobo int64) (*Settlement, error) {
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, err
	}
	err = s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "escrow:" + reference,
		IdempotencyKey:  idempotencyKey + ":escrow",
		AmountKobo:      totalKobo,
		DebitAccountID:  clearingAcc.ID,
		CreditAccountID: escrowAcc.ID,
		Description:     "Paystack-funded order escrow (external payment, no wallet debit)",
	})
	if err != nil && err != ledger.ErrDuplicate {
		return nil, fmt.Errorf("settlement: external escrow post: %w", err)
	}
	now := time.Now()
	sett := &Settlement{
		ID:             uuid.New().String(),
		Reference:      reference,
		ModuleType:     moduleType,
		PayerID:        payerID,
		TotalKobo:      totalKobo,
		Status:         StatusEscrowed,
		EscrowedAt:     now,
		IdempotencyKey: idempotencyKey,
	}
	const insert = `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
		VALUES ($1,$2,$3,$4,$5,'escrowed',$6,$7,'external')
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err = s.db.Exec(ctx, insert, sett.ID, sett.Reference, sett.ModuleType, sett.PayerID, sett.TotalKobo, sett.EscrowedAt, sett.IdempotencyKey); err != nil {
		return nil, fmt.Errorf("settlement: insert external escrow row: %w", err)
	}
	if err = s.db.QueryRow(ctx,
		`SELECT id, status, total_kobo FROM settlements WHERE idempotency_key=$1`, idempotencyKey,
	).Scan(&sett.ID, &sett.Status, &sett.TotalKobo); err != nil {
		return nil, fmt.Errorf("settlement: resolve external escrow row: %w", err)
	}
	return sett, nil
}

// Settle releases the escrowed funds, applying the split and deducting commission.
// Called after service delivery is confirmed.
func (s *Service) Settle(ctx context.Context, settlementID string, split Split) error {
	// Fail-closed: the split must sum to exactly 1.0 before any money moves, so a
	// malformed split can never silently mis-pay a provider (or drive their share
	// negative via the remainder computation below).
	if err := split.Validate(); err != nil {
		return err
	}
	var sett Settlement
	const q = `SELECT id, reference, payer_id, total_kobo, status FROM settlements WHERE id=$1 FOR UPDATE`
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("settlement: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := tx.QueryRow(ctx, q, settlementID).Scan(
		&sett.ID, &sett.Reference, &sett.PayerID, &sett.TotalKobo, &sett.Status,
	); err != nil {
		return fmt.Errorf("settlement: fetch: %w", err)
	}
	if sett.Status != StatusEscrowed {
		return fmt.Errorf("settlement: cannot settle — current status is %s", sett.Status)
	}
	// The split arithmetic — including every fail-closed bound (fixed legs may not
	// exceed the escrowed total; no leg may go negative) — lives in ComputeLegs, so
	// that the tests exercise the same expression this moves money by rather than a
	// copy of it. See this file.
	legs, err := ComputeLegs(sett.TotalKobo, split)
	if err != nil {
		return err
	}
	providerKobo, platformKobo, riderKobo := legs.ProviderKobo, legs.PlatformKobo, legs.RiderKobo

	// ATOMICITY FIX (money invariant): previously the provider/rider credits went
	// through s.ledger.Credit (which posts on the ledger's OWN connection), while the
	// commission entries and the settlement-row status update ran on this tx. That
	// split meant a crash between the provider credit and tx.Commit could pay the
	// provider without ever marking the settlement 'settled' — and because the ledger
	// Credit is a plain INSERT (no ON CONFLICT), a retry then errored on the UNIQUE
	// idempotency_key, wedging the settlement.
	// The ledger.Service still exposes no tx-aware Credit/Debit (documented gap — a
	// future refactor should add ledger.CreditTx(tx, ...) so wallet balance
	// projections and settlement rows commit as one unit). Until then, we post EVERY
	// leg of this settlement as raw balanced ledger_entries pairs on THIS tx, so all
	// money movement + the status flip commit atomically. Wallet account rows are
	// resolved (get-or-create) OUTSIDE the tx — that only ensures the account exists
	// and moves no money — then every posting is on the tx and idempotent via
	// ON CONFLICT (idempotency_key) DO NOTHING, making the whole Settle safe to retry.
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	revAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return err
	}
	providerWallet, err := s.ledger.GetOrCreateUserWallet(ctx, split.ProviderID)
	if err != nil {
		return fmt.Errorf("settlement: resolve provider wallet: %w", err)
	}

	ref := "settle:" + sett.Reference
	idem := "settle:" + settlementID

	// Escrow → provider wallet: DEBIT escrow, CREDIT provider wallet (balanced pair).
	if providerKobo > 0 {
		if err := postPairTx(ctx, tx, escrowAcc.ID, providerWallet.ID, providerKobo,
			ref+":provider", idem+":provider"); err != nil {
			return fmt.Errorf("settlement: credit provider: %w", err)
		}
	}
	// Escrow → platform revenue (commission): DEBIT escrow, CREDIT revenue.
	if platformKobo > 0 {
		if err := postPairTx(ctx, tx, escrowAcc.ID, revAcc.ID, platformKobo,
			ref+":commission", idem+":commission"); err != nil {
			return fmt.Errorf("settlement: post commission: %w", err)
		}
	}
	// Escrow → rider wallet (if applicable): DEBIT escrow, CREDIT rider wallet.
	if split.RiderID != nil && riderKobo > 0 {
		riderWallet, err := s.ledger.GetOrCreateUserWallet(ctx, *split.RiderID)
		if err != nil {
			return fmt.Errorf("settlement: resolve rider wallet: %w", err)
		}
		if err := postPairTx(ctx, tx, escrowAcc.ID, riderWallet.ID, riderKobo,
			ref+":rider", idem+":rider"); err != nil {
			return fmt.Errorf("settlement: credit rider: %w", err)
		}
	}

	now := time.Now()
	const updateStatus = `UPDATE settlements SET status='settled', settled_at=$2, provider_kobo=$3, fee_kobo=$4 WHERE id=$1`
	if _, err := tx.Exec(ctx, updateStatus, settlementID, now, providerKobo, platformKobo); err != nil {
		return fmt.Errorf("settlement: update status: %w", err)
	}
	return tx.Commit(ctx)
}

// SettleToStandingAccounts releases an escrowed settlement whose provider is a
// standing account, not a user wallet — e.g. a stays supplier's net parks in
// AccountProviderClearing until a later payout draws it down, and the platform
// cut lands on a module-chosen account (stays uses AccountCommission).
// Split.ProviderID is annotation-only; a rider leg still resolves a real wallet.
// Same mechanics as Settle — the status flip commits in the same tx as the legs.
func (s *Service) SettleToStandingAccounts(ctx context.Context, settlementID string, split Split, providerAccount, platformAccount ledger.AccountType) error {
	if providerAccount == "" || platformAccount == "" {
		return errors.New("settlement: standing-account settle requires provider and platform accounts")
	}
	if err := split.Validate(); err != nil {
		return err
	}
	var sett Settlement
	const q = `SELECT id, reference, payer_id, total_kobo, status FROM settlements WHERE id=$1 FOR UPDATE`
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("settlement: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := tx.QueryRow(ctx, q, settlementID).Scan(
		&sett.ID, &sett.Reference, &sett.PayerID, &sett.TotalKobo, &sett.Status,
	); err != nil {
		return fmt.Errorf("settlement: fetch: %w", err)
	}
	if sett.Status != StatusEscrowed {
		return fmt.Errorf("settlement: cannot settle — current status is %s", sett.Status)
	}
	legs, err := ComputeLegs(sett.TotalKobo, split)
	if err != nil {
		return err
	}

	// Account resolution (get-or-create) happens OUTSIDE the money tx, matching
	// Settle — it moves no money and only ensures the accounts exist.
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	providerAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, providerAccount)
	if err != nil {
		return fmt.Errorf("settlement: resolve provider clearing account: %w", err)
	}
	platformAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, platformAccount)
	if err != nil {
		return fmt.Errorf("settlement: resolve platform account: %w", err)
	}

	ref := "settle:" + sett.Reference
	idem := "settle:" + settlementID

	// Escrow → provider clearing (the net owed to a non-wallet counterparty).
	if legs.ProviderKobo > 0 {
		if err := postPairTx(ctx, tx, escrowAcc.ID, providerAcc.ID, legs.ProviderKobo,
			ref+":provider", idem+":provider"); err != nil {
			return fmt.Errorf("settlement: credit provider clearing: %w", err)
		}
	}
	// Escrow → platform standing account (commission/revenue).
	if legs.PlatformKobo > 0 {
		if err := postPairTx(ctx, tx, escrowAcc.ID, platformAcc.ID, legs.PlatformKobo,
			ref+":commission", idem+":commission"); err != nil {
			return fmt.Errorf("settlement: post platform leg: %w", err)
		}
	}
	// Escrow → rider wallet (a rider is always a wallet-holding user).
	if split.RiderID != nil && legs.RiderKobo > 0 {
		riderWallet, err := s.ledger.GetOrCreateUserWallet(ctx, *split.RiderID)
		if err != nil {
			return fmt.Errorf("settlement: resolve rider wallet: %w", err)
		}
		if err := postPairTx(ctx, tx, escrowAcc.ID, riderWallet.ID, legs.RiderKobo,
			ref+":rider", idem+":rider"); err != nil {
			return fmt.Errorf("settlement: credit rider: %w", err)
		}
	}

	now := time.Now()
	const updateStatus = `UPDATE settlements SET status='settled', settled_at=$2, provider_kobo=$3, fee_kobo=$4 WHERE id=$1`
	if _, err := tx.Exec(ctx, updateStatus, settlementID, now, legs.ProviderKobo, legs.PlatformKobo); err != nil {
		return fmt.Errorf("settlement: update status: %w", err)
	}
	return tx.Commit(ctx)
}

// postPairTx posts a balanced double-entry pair (DEBIT debitAccountID,
// CREDIT creditAccountID) for amountKobo on the given tx. Both legs share the
// reference and derive a distinct-but-stable idempotency key, and both use
// ON CONFLICT (idempotency_key) DO NOTHING so a retried Settle is a safe no-op
// rather than a UNIQUE-constraint failure. Money invariant: exactly one DEBIT and
// one CREDIT of equal magnitude, both inside the caller's transaction.
func postPairTx(ctx context.Context, tx pgx.Tx, debitAccountID, creditAccountID string, amountKobo int64, reference, idempotencyKey string) error {
	const insertEntry = `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := tx.Exec(ctx, insertEntry, debitAccountID, "DEBIT", amountKobo, reference, idempotencyKey+":debit"); err != nil {
		return fmt.Errorf("settlement: post debit leg: %w", err)
	}
	if _, err := tx.Exec(ctx, insertEntry, creditAccountID, "CREDIT", amountKobo, reference, idempotencyKey+":credit"); err != nil {
		return fmt.Errorf("settlement: post credit leg: %w", err)
	}
	return nil
}

// ErrWrongRefundMethod guards the Refund/RefundExternal split: calling Refund
// (a WALLET CREDIT) on an externally-funded settlement, or RefundExternal (a
// clearing-account reversal, no wallet touched) on a wallet-funded one, is
// refused rather than silently moving money the wrong way. This is the fix
// for a real defect found while porting the Paystack-checkout pattern to a
// second module: every existing settlement.Refund call site (across several
// modules, including restaurant's own pre-existing order-cancellation path)
// unconditionally wallet-credited the payer, which for an EscrowExternal
// settlement would hand a Tier-0 customer real spendable wallet balance
// funded by an external charge — exactly the hazard EscrowExternal exists to
// avoid. Enforcing the correct method HERE protects every caller, including
// ones written before this check existed and any written after without
// knowing about the gotcha.
var ErrWrongRefundMethod = fmt.Errorf("settlement: wrong refund method for this settlement's funding source")

// Refund releases a WALLET-funded escrow back to the payer's wallet. Refuses
// (ErrWrongRefundMethod) on an externally-funded (EscrowExternal) settlement
// — see RefundExternal for that case, and ErrWrongRefundMethod's doc comment
// for why this check exists.
func (s *Service) Refund(ctx context.Context, settlementID, reason string) error {
	var sett Settlement
	var fundingSource string
	const q = `SELECT id, reference, payer_id, total_kobo, status, funding_source FROM settlements WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, settlementID).Scan(
		&sett.ID, &sett.Reference, &sett.PayerID, &sett.TotalKobo, &sett.Status, &fundingSource,
	); err != nil {
		return fmt.Errorf("settlement: fetch for refund: %w", err)
	}
	if fundingSource == "external" {
		return ErrWrongRefundMethod
	}
	if sett.Status != StatusEscrowed && sett.Status != StatusDisputed {
		return fmt.Errorf("settlement: cannot refund — current status is %s", sett.Status)
	}

	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	if err := s.ledger.Credit(ctx, sett.PayerID,
		"refund:"+sett.Reference, "refund:"+settlementID, escrowAcc.ID, sett.TotalKobo,
	); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("settlement: credit refund: %w", err)
	}
	// ErrDuplicate is tolerated — a retry after a mid-flight crash finds the leg
	// posted and proceeds to the flip (same contract as RefundExternal).
	const update = `UPDATE settlements SET status='refunded' WHERE id=$1`
	_, err = s.db.Exec(ctx, update, settlementID)
	return err
}

// RefundExternal reverses a previously-collected EscrowExternal escrow — the
// INTERNAL-LEDGER counterpart of a real external refund (e.g. a Paystack
// reversal). It knows nothing about Paystack and issues no gateway call: the
// caller (a module's *paystackcheckout package, which holds the gateway
// reference) is responsible for ALSO reversing the actual charge; this only
// keeps Spotlight's own books balanced.
// Posts the EXACT REVERSE of EscrowExternal (DR escrow / CR provider-clearing)
// rather than crediting any user wallet — crediting the payer's wallet, which
// is what Refund does for a wallet-funded escrow, would hand a Tier-0
// customer real spendable wallet balance funded by an external charge. That
// is precisely the hazard EscrowExternal exists to avoid, so this function
// must NEVER be used on a wallet-funded (Escrow) settlement, and Refund must
// NEVER be used on an EscrowExternal one — a caller mixing them up reopens
// the bypass this whole design closes.
// Idempotent like Refund: a settlement already outside {escrowed, disputed}
// is treated as already resolved and this is a safe no-op (unlike Refund,
// which errors — callers here are refund-loop cleanups over a batch of rows
// that occasionally race a concurrent resolution, and a mixed-status batch
// must not abort partway through).
func (s *Service) RefundExternal(ctx context.Context, settlementID, reason string) error {
	var sett Settlement
	var fundingSource string
	const q = `SELECT id, reference, payer_id, total_kobo, status, funding_source FROM settlements WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, settlementID).Scan(
		&sett.ID, &sett.Reference, &sett.PayerID, &sett.TotalKobo, &sett.Status, &fundingSource,
	); err != nil {
		return fmt.Errorf("settlement: fetch for external refund: %w", err)
	}
	if fundingSource != "external" {
		return ErrWrongRefundMethod
	}
	if sett.Status != StatusEscrowed && sett.Status != StatusDisputed {
		return nil
	}

	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	err = s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "refund:" + sett.Reference,
		IdempotencyKey:  "refund:" + settlementID,
		AmountKobo:      sett.TotalKobo,
		DebitAccountID:  escrowAcc.ID,
		CreditAccountID: clearingAcc.ID,
		Description:     "External refund reversal (Paystack-funded escrow): " + reason,
	})
	if err != nil && err != ledger.ErrDuplicate {
		return fmt.Errorf("settlement: post external refund: %w", err)
	}
	const update = `UPDATE settlements SET status='refunded' WHERE id=$1`
	_, err = s.db.Exec(ctx, update, settlementID)
	return err
}

// Status tracks a settlement's lifecycle.
type Status string

const (
	StatusEscrowed  Status = "escrowed"
	StatusReleasing Status = "releasing"
	StatusSettled   Status = "settled"
	StatusDisputed  Status = "disputed"
	StatusRefunded  Status = "refunded"
)

// Settlement represents a single escrowed amount that will be split on completion.
type Settlement struct {
	ID             string     `json:"id"`
	Reference      string     `json:"reference"`   // links to the originating order/event/appointment
	ModuleType     string     `json:"module_type"` // food | transport | events | telemedicine | crowdfunding
	PayerID        string     `json:"payer_id"`    // user who paid
	TotalKobo      int64      `json:"total_kobo"`
	FeeKobo        int64      `json:"fee_kobo"`      // Paymax platform commission
	ProviderKobo   int64      `json:"provider_kobo"` // amount destined to the provider (merchant/rider/doctor/etc.)
	Status         Status     `json:"status"`
	EscrowedAt     time.Time  `json:"escrowed_at"`
	SettledAt      *time.Time `json:"settled_at,omitempty"`
	IdempotencyKey string     `json:"idempotency_key"`
}

// Split defines how a settlement is divided. Validated: TotalKobo == sum of all parts.
type Split struct {
	ProviderID  string  `json:"provider_id"`  // merchant / driver / doctor user ID
	ProviderPct float64 `json:"provider_pct"` // e.g. 0.80 = 80%
	PlatformPct float64 `json:"platform_pct"` // e.g. 0.10 = 10%
	RiderID     *string `json:"rider_id,omitempty"`
	RiderPct    float64 `json:"rider_pct,omitempty"`
	// TipKobo is a fixed, whole-kobo amount paid 100% to the rider ON TOP of the
	// percentage split — it is NOT part of the percentages (those apply to the
	// non-tip base = total − tip). Defaults to 0, which reproduces the pure
	// percentage split exactly (backward-compatible for every non-tipping caller).
	// A tip requires a rider; Validate rejects a tip with no RiderID.
	TipKobo int64 `json:"tip_kobo,omitempty"`
	// DiscountKobo is a promo discount already reflected in the escrowed total (the
	// payer paid total = gross − discount [+ tip]). The percentages apply to the
	// PRE-discount gross, and the discount is borne entirely by ONE party:
	//   - DiscountFundedByPlatform == true  → subtracted from the platform leg
	//     (the marketplace ate it; provider + rider settle on the full gross).
	//   - DiscountFundedByPlatform == false → borne by the provider (it falls out of
	//     the provider remainder; platform + rider are unaffected).
	// The rider never funds a discount. Defaults to 0, reproducing the pure split.
	DiscountKobo             int64 `json:"discount_kobo,omitempty"`
	DiscountFundedByPlatform bool  `json:"discount_funded_by_platform,omitempty"`
	// ServiceFeeKobo is a fixed, whole-kobo platform service fee paid 100% to the
	// platform ON TOP of the percentage split — the mirror of TipKobo (which is 100%
	// rider). It is NOT part of the percentages (those apply to the pre-discount
	// gross = total − tip − serviceFee + discount). Defaults to 0, reproducing the
	// pure split. Non-negative; tip + serviceFee may not exceed the escrowed total.
	ServiceFeeKobo int64 `json:"service_fee_kobo,omitempty"`
	// ProviderFeeKobo is a fixed, whole-kobo amount paid 100% to the PROVIDER on top
	// of the percentage split — the provider-side mirror of ServiceFeeKobo (100%
	// platform) and TipKobo (100% rider). It is NOT part of the percentages (those
	// apply to gross = total − tip − serviceFee − providerFee + discount).
	// For a pass-through cost the provider actually bears, so that the platform and
	// the rider take no cut of it — the same reason a restaurant takes no cut of a
	// rider's tip. First caller: restaurant takeaway packaging, where the restaurant
	// buys the packs.
	// Defaults to 0, reproducing the pure split exactly for every existing caller.
	// Non-negative; tip + serviceFee + providerFee may not exceed the escrowed total.
	ProviderFeeKobo int64 `json:"provider_fee_kobo,omitempty"`
}

// SplitLegs is what each party receives from an escrowed total, in whole kobo.
type SplitLegs struct {
	ProviderKobo int64
	PlatformKobo int64
	RiderKobo    int64
}

// ComputeLegs divides an escrowed total between provider, platform and rider.
// This is the ONE definition of the split arithmetic: Service.Settle calls it to
// move the money, and the tests call it to check the money. It used to live
// inline in Settle with a second copy in split_invariant_test.go — and a formula
// that grades its own homework proves only that the copy matches, not that either
// is right, so a change to the production expression could not fail the test.
// The percentages apply to the pre-discount GROSS, not to the escrowed total.
// Three fixed legs sit inside that total and are removed before the percentages
// are taken, then handed whole to their party:
//
//	tip         → 100% rider
//	serviceFee  → 100% platform
//	providerFee → 100% provider
//	base  = total − tip − serviceFee − providerFee
//
// The provider's leg is the REMAINDER (total − platform − rider), so providerFee
// reaches it without a separate term: whatever the other two legs do not take is
// the provider's. A promo discount is borne by exactly one party — platform-funded
// comes off the platform leg, otherwise it falls out of the provider remainder.
// The rider never funds a discount.
// With every fixed leg at 0 and no discount, gross == base == total and this is
// the pure percentage split, unchanged for callers that set none of them.
func ComputeLegs(totalKobo int64, s Split) (SplitLegs, error) {
	if err := s.Validate(); err != nil {
		return SplitLegs{}, err
	}
	// Fixed legs larger than what was escrowed would drive the gross negative and
	// pay out money nobody put in. Fail closed.
	if s.TipKobo+s.ServiceFeeKobo+s.ProviderFeeKobo > totalKobo {
		return SplitLegs{}, fmt.Errorf(
			"settlement: tip %d + service fee %d + provider fee %d exceed escrowed total %d",
			s.TipKobo, s.ServiceFeeKobo, s.ProviderFeeKobo, totalKobo)
	}

	base := totalKobo - s.TipKobo - s.ServiceFeeKobo - s.ProviderFeeKobo
	gross := base + s.DiscountKobo

	platformKobo := int64(float64(gross)*s.PlatformPct) + s.ServiceFeeKobo
	if s.DiscountFundedByPlatform {
		platformKobo -= s.DiscountKobo
	}
	riderKobo := int64(0)
	if s.RiderID != nil {
		riderKobo = int64(float64(gross)*s.RiderPct) + s.TipKobo
	}
	providerKobo := totalKobo - platformKobo - riderKobo

	// A discount larger than its funder's gross share must never silently invert a
	// payout into a debt.
	if platformKobo < 0 || riderKobo < 0 || providerKobo < 0 {
		return SplitLegs{}, fmt.Errorf(
			"settlement: split produced a negative leg (provider=%d platform=%d rider=%d) — discount too large for the funder",
			providerKobo, platformKobo, riderKobo)
	}
	return SplitLegs{ProviderKobo: providerKobo, PlatformKobo: platformKobo, RiderKobo: riderKobo}, nil
}

// splitEpsilon tolerates float rounding (configs store pct as floats like 0.80).
const splitEpsilon = 1e-6

// Validate enforces the money invariant that the percentage split sums to exactly
// 1.0 (within float epsilon) at settlement time, and that no share is negative.
// The rider share only counts when a rider is present. Provider share is computed
// as the remainder in Settle (so kobo always balances), but a malformed split
// could otherwise drive the provider's kobo negative — this catches that up front.
func (s Split) Validate() error {
	if s.ProviderPct < 0 || s.PlatformPct < 0 || s.RiderPct < 0 {
		return errors.New("settlement: split percentages must be non-negative")
	}
	// The tip is a fixed rider leg: it must be non-negative and can only be paid when
	// a rider is present (there is no one else it may be attributed to). The tip ≤ total
	// bound is enforced in Settle, where the escrowed total is known.
	if s.TipKobo < 0 {
		return errors.New("settlement: tip must be non-negative")
	}
	if s.TipKobo > 0 && s.RiderID == nil {
		return errors.New("settlement: tip requires a rider")
	}
	// A promo discount is non-negative. That it does not drive any leg negative (a too-
	// large platform-funded discount, or a too-large provider-funded one) is enforced in
	// Settle, where the gross and each leg's kobo are known.
	if s.DiscountKobo < 0 {
		return errors.New("settlement: discount must be non-negative")
	}
	if s.ServiceFeeKobo < 0 {
		return errors.New("settlement: service fee must be non-negative")
	}
	// A negative provider fee would inflate the gross the percentages price and
	// quietly pay the platform and rider more than the order was worth.
	if s.ProviderFeeKobo < 0 {
		return errors.New("settlement: provider fee must be non-negative")
	}
	sum := s.ProviderPct + s.PlatformPct
	if s.RiderID != nil {
		sum += s.RiderPct
	}
	if sum < 1.0-splitEpsilon || sum > 1.0+splitEpsilon {
		return fmt.Errorf("settlement: split must sum to 1.0, got %.6f", sum)
	}
	return nil
}

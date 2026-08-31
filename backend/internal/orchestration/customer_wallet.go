package orchestration

// ── Where a customer's money actually lives (ADR-051) ──────────────
//
// FX used to keep EVERY currency, NGN included, in its own `orch_balances` pot.
// Nothing in production ever credited that pot: its only writers are a
// conversion's own destination leg, a card refund, and a test-only SeedBalance.
// So /fx reported ₦0 to every user while the wallet, checkout, food and mobility
// screens all showed the real figure out of `ledger_entries` — and a first
// conversion was unreachable, because the only way to get NGN into the FX pot
// was to have already converted into it.
//
// Two pots for one currency also breaks the iron rule that a wallet balance is a
// projection of the ledger: whichever pot a screen did not read was silently
// wrong, and "show one number, spend a different one" is the worst shape a money
// bug can take.
//
// The rule now, in ONE place so no caller can pick a different answer:
//
//	NGN      → the platform's main double-entry ledger (ledger_accounts /
//	           ledger_entries), the same pot every other NGN module reads and
//	           spends. FX reads it, debits it, and pays into it.
//	anything → the `orch_balances` pot, unchanged. The main ledger has no
//	else       per-currency user accounts (ledger_accounts is unique on
//	           (user_id, type) and every user_wallet row is NGN), so non-NGN FX
//	           holdings have nowhere else to live.
//
// The FX module's own book (`orch_ledger_entries`) is untouched and still posts
// a full per-currency balanced set for every move, so the ADR-029 invariant
// holds exactly as before. For NGN it is now an analytical mirror of a cash
// movement recorded in the main ledger rather than the record of the pot itself;
// `provider_clearing` is the bridging account on both books.

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// mainLedgerCurrency is the one currency held outside orch_balances.
const mainLedgerCurrency = "NGN"

// fxClearingAccount is the main-ledger standing account every FX NGN leg faces:
// value leaving a customer wallet into Paymax/provider float, or arriving from
// it. Using the existing provider_clearing account (rather than a new type)
// keeps the FX position in the same bucket treasury and recon already watch.
const fxClearingAccount = "provider_clearing"

// querier is the slice of *pgxpool.Pool / pgx.Tx these helpers need, so the SAME
// routing runs on the pool for reads and inside an open money transaction for
// writes. A read and a write can therefore never disagree about which pot holds
// a currency — the disagreement is precisely what produced the ₦0 screen.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func isMainLedgerCurrency(currency string) bool {
	return strings.EqualFold(strings.TrimSpace(currency), mainLedgerCurrency)
}

// mainWalletBalanceSQL must classify entry types identically to
// ledger.balanceProjectionSQL — if the two ever drift, FX and the wallet screen
// go back to showing different numbers for the same account.
const mainWalletBalanceSQL = `
	SELECT COALESCE(SUM(
		CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo
		     ELSE -amount_kobo END
	), 0)
	FROM ledger_entries
	WHERE account_id = $1`

// mainWalletAccountID resolves the customer's user_wallet account, creating it
// for a real auth user who does not have one yet (same get-or-create contract as
// ledger.Service.GetBalance).
//
// ok=false with a nil error means "this customer has no main wallet and cannot
// have one" — an FX business customer keyed by business id, or a synthetic test
// customer. Those keep using the orch_balances pot for NGN as well, which makes
// the routing DETERMINISTIC PER CUSTOMER: a given customer's NGN always lives in
// exactly one place, so no customer is ever split across both pots.
//
// The auth.users probe is load-bearing, not defensive decoration:
// ledger_accounts.user_id is FK to auth.users and a failed INSERT aborts the
// whole enclosing transaction in Postgres. Inside a money tx we cannot "try it
// and fall back" — we have to know before we write.
func mainWalletAccountID(ctx context.Context, q querier, customerID string) (string, bool, error) {
	id := strings.TrimSpace(customerID)
	if _, err := uuid.Parse(id); err != nil {
		return "", false, nil
	}

	var acct string
	err := q.QueryRow(ctx, `SELECT id FROM ledger_accounts WHERE user_id=$1 AND type='user_wallet'`, id).Scan(&acct)
	if err == nil {
		return acct, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}

	var isUser bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=$1)`, id).Scan(&isUser); err != nil {
		return "", false, err
	}
	if !isUser {
		return "", false, nil
	}
	// DO UPDATE (not DO NOTHING) so a concurrent creator still yields the id.
	if err := q.QueryRow(ctx, `
		INSERT INTO ledger_accounts (user_id, type, currency) VALUES ($1,'user_wallet','NGN')
		ON CONFLICT (user_id, type) DO UPDATE SET user_id = EXCLUDED.user_id
		RETURNING id`, id).Scan(&acct); err != nil {
		return "", false, err
	}
	return acct, true, nil
}

// standingAccountID resolves (creating if absent) a system standing account —
// no user_id, no group_id, one row per type.
func standingAccountID(ctx context.Context, q querier, accountType string) (string, error) {
	const fetch = `SELECT id FROM ledger_accounts WHERE user_id IS NULL AND group_id IS NULL AND type=$1`
	var id string
	err := q.QueryRow(ctx, fetch, accountType).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	err = q.QueryRow(ctx, `INSERT INTO ledger_accounts (type) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`, accountType).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost the create race — the winner's row is now visible.
		err = q.QueryRow(ctx, fetch, accountType).Scan(&id)
	}
	if err != nil {
		return "", err
	}
	return id, nil
}

// lockCustomerWallet serialises every money move against this customer.
//
// The key namespace ("wallet:<id>") is shared with finance/ledger and
// finance/transfers deliberately: an FX conversion and a wallet transfer for the
// same user then block each other instead of both reading a pre-debit balance
// and together overdrawing the wallet.
//
// Callers MUST take this FIRST — before any row lock — and exactly once per
// transaction. One lock, always the same key, always first: no lock cycle can
// form between FX, transfers and the ledger.
func lockCustomerWallet(ctx context.Context, tx pgx.Tx, customerID string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "wallet:"+customerID)
	return err
}

// postMainLedgerPair writes the balanced DEBIT/CREDIT pair into ledger_entries.
//
// Per-side ":debit"/":credit" suffixes and ON CONFLICT DO NOTHING mirror
// ledger.Repository.DebitWithBalanceCheck exactly, so a replay is a no-op rather
// than a unique-key error. The "fx:" prefix keeps an FX leg from ever colliding
// with a wallet or checkout leg that happens to reuse the same reference.
func postMainLedgerPair(ctx context.Context, tx pgx.Tx, debitAccountID, creditAccountID string, amountMinor int64, reference, idemKey string) error {
	if reference == "" {
		reference = "fx:" + idemKey // ledger_entries.reference is NOT NULL
	}
	const ins = `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (idempotency_key) DO NOTHING`
	key := "fx:" + idemKey
	if _, err := tx.Exec(ctx, ins, debitAccountID, "DEBIT", amountMinor, reference, key+":debit"); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, ins, creditAccountID, "CREDIT", amountMinor, reference, key+":credit")
	return err
}

// ── The four operations every FX money path goes through ────────────────────

// customerBalance reads one currency's spendable balance from whichever pot
// holds it.
//
// Read-only and UNLOCKED: fine for display and for a cheap pre-flight rejection,
// never as the sufficiency gate for a debit. debitCustomerWallet re-checks under
// the wallet lock inside the money transaction — that check is the real gate.
func customerBalance(ctx context.Context, q querier, customerID, currency string) (int64, error) {
	if isMainLedgerCurrency(currency) {
		acct, ok, err := mainWalletAccountID(ctx, q, customerID)
		if err != nil {
			return 0, err
		}
		if ok {
			var bal int64
			if err := q.QueryRow(ctx, mainWalletBalanceSQL, acct).Scan(&bal); err != nil {
				return 0, err
			}
			return bal, nil
		}
	}
	var bal int64
	err := q.QueryRow(ctx, `SELECT balance_minor FROM orch_balances WHERE customer_id=$1 AND currency=$2`,
		customerID, strings.ToUpper(currency)).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return bal, err
}

// customerBalances lists every wallet the customer holds: their main-ledger NGN
// wallet plus every orch_balances pot.
//
// The NGN entry is always present for a customer who has a main wallet, even at
// zero, so /fx can render an NGN card with a funding CTA instead of an empty
// list — the state that made the screen look broken rather than merely empty.
func customerBalances(ctx context.Context, q querier, customerID string) ([]Money, error) {
	out := make([]Money, 0, 4)

	if acct, ok, err := mainWalletAccountID(ctx, q, customerID); err != nil {
		return nil, err
	} else if ok {
		var bal int64
		if err := q.QueryRow(ctx, mainWalletBalanceSQL, acct).Scan(&bal); err != nil {
			return nil, err
		}
		out = append(out, NewMoney(bal, mainLedgerCurrency))
	}

	// Legacy NGN rows are skipped, not summed: NGN has exactly one pot now, and
	// adding a stale row on top of the ledger projection would overstate what the
	// customer can actually spend.
	rows, err := q.Query(ctx, `
		SELECT currency, balance_minor FROM orch_balances
		WHERE customer_id=$1 AND currency <> $2 ORDER BY currency`, customerID, mainLedgerCurrency)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m Money
		if err := rows.Scan(&m.Currency, &m.AmountMinor); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// debitCustomerWallet removes amountMinor from the customer's spendable balance,
// failing closed with ErrInsufficientBalance when short. The caller must already
// hold lockCustomerWallet on this transaction.
//
// NGN posts a balanced DEBIT(user_wallet) / CREDIT(provider_clearing) pair into
// the immutable main ledger, so an FX spend shows up in the wallet, in
// statements and in reconciliation like any other spend. Other currencies
// decrement the orch_balances pot under a row lock, exactly as before.
func debitCustomerWallet(ctx context.Context, tx pgx.Tx, customerID, currency string, amountMinor int64, reference, idemKey string) error {
	if amountMinor <= 0 {
		return NewError(ErrInvalidRequest, "invalid_amount", "Amount must be a positive minor-unit value.")
	}
	short := NewError(ErrInsufficientBalance, "insufficient_balance", "Insufficient "+strings.ToUpper(currency)+" balance.")

	if isMainLedgerCurrency(currency) {
		acct, ok, err := mainWalletAccountID(ctx, tx, customerID)
		if err != nil {
			return err
		}
		if ok {
			var bal int64
			if err := tx.QueryRow(ctx, mainWalletBalanceSQL, acct).Scan(&bal); err != nil {
				return err
			}
			if bal < amountMinor {
				return short
			}
			clearing, err := standingAccountID(ctx, tx, fxClearingAccount)
			if err != nil {
				return err
			}
			return postMainLedgerPair(ctx, tx, acct, clearing, amountMinor, reference, idemKey)
		}
	}

	var bal int64
	err := tx.QueryRow(ctx, `SELECT balance_minor FROM orch_balances WHERE customer_id=$1 AND currency=$2 FOR UPDATE`,
		customerID, strings.ToUpper(currency)).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return short
	}
	if err != nil {
		return err
	}
	if bal < amountMinor {
		return short
	}
	_, err = tx.Exec(ctx, `UPDATE orch_balances SET balance_minor = balance_minor - $3, updated_at=now()
		WHERE customer_id=$1 AND currency=$2`, customerID, strings.ToUpper(currency), amountMinor)
	return err
}

// creditCustomerWallet adds amountMinor to the customer's spendable balance in
// whichever pot holds that currency. Caller must hold lockCustomerWallet.
func creditCustomerWallet(ctx context.Context, tx pgx.Tx, customerID, currency string, amountMinor int64, reference, idemKey string) error {
	if amountMinor <= 0 {
		return NewError(ErrInvalidRequest, "invalid_amount", "Amount must be a positive minor-unit value.")
	}
	if isMainLedgerCurrency(currency) {
		acct, ok, err := mainWalletAccountID(ctx, tx, customerID)
		if err != nil {
			return err
		}
		if ok {
			clearing, err := standingAccountID(ctx, tx, fxClearingAccount)
			if err != nil {
				return err
			}
			return postMainLedgerPair(ctx, tx, clearing, acct, amountMinor, reference, idemKey)
		}
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO orch_balances (customer_id, currency, balance_minor) VALUES ($1,$2,$3)
		ON CONFLICT (customer_id, currency) DO UPDATE
		SET balance_minor = orch_balances.balance_minor + EXCLUDED.balance_minor, updated_at=now()`,
		customerID, strings.ToUpper(currency), amountMinor)
	return err
}

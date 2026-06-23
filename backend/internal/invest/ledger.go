package invest

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InvestLedger is the double-entry ledger for the investment cash wallet,
// logically separated from the main Paymax wallet. Every money movement is a
// balanced pair of immutable entries; balances are always projected via SUM —
// no balance column is ever mutated as a source of truth (iron rule).
//
// Account types (invest_ledger_accounts.type):
//
//	invest_cash               — user available cash
//	invest_locked_cash        — user cash locked for a pending buy
//	invest_settlement_suspense— user cash awaiting settlement after a sell
//	broker_clearing           — standing clearing account toward the broker
//	invest_fee_income         — standing Paymax fee revenue
//	invest_external_funding    — standing counter for deposits/withdrawals
//	invest_dividend_source    — standing counter for dividend credits
type InvestLedger struct {
	db *pgxpool.Pool
}

const (
	AcctCash             = "invest_cash"
	AcctLockedCash       = "invest_locked_cash"
	AcctSettlement       = "invest_settlement_suspense"
	AcctBrokerClearing   = "broker_clearing"
	AcctFeeIncome        = "invest_fee_income"
	AcctExternalFunding  = "invest_external_funding"
	AcctDividendSource   = "invest_dividend_source"
)

func NewInvestLedger(db *pgxpool.Pool) *InvestLedger { return &InvestLedger{db: db} }

// accountID returns (creating if needed) a user or standing account id.
// userID == "" denotes a standing/system account.
func (l *InvestLedger) accountID(ctx context.Context, q pgx.Tx, userID, accType, currency string) (string, error) {
	if currency == "" {
		currency = "NGN"
	}
	var id string
	if userID == "" {
		const up = `INSERT INTO invest_ledger_accounts (type, currency) VALUES ($1,$2)
			ON CONFLICT DO NOTHING RETURNING id`
		err := q.QueryRow(ctx, up, accType, currency).Scan(&id)
		if err == pgx.ErrNoRows {
			err = q.QueryRow(ctx,
				`SELECT id FROM invest_ledger_accounts WHERE user_id IS NULL AND type=$1 AND currency=$2`,
				accType, currency).Scan(&id)
		}
		if err != nil {
			return "", fmt.Errorf("invest ledger: standing account %s: %w", accType, err)
		}
		return id, nil
	}
	const up = `INSERT INTO invest_ledger_accounts (user_id, type, currency) VALUES ($1,$2,$3)
		ON CONFLICT DO NOTHING RETURNING id`
	err := q.QueryRow(ctx, up, userID, accType, currency).Scan(&id)
	if err == pgx.ErrNoRows {
		err = q.QueryRow(ctx,
			`SELECT id FROM invest_ledger_accounts WHERE user_id=$1 AND type=$2 AND currency=$3`,
			userID, accType, currency).Scan(&id)
	}
	if err != nil {
		return "", fmt.Errorf("invest ledger: user account %s/%s: %w", userID, accType, err)
	}
	return id, nil
}

// balanceOf projects an account balance from its entries (kobo).
func (l *InvestLedger) balanceOf(ctx context.Context, q queryer, accountID string) (int64, error) {
	const sql = `SELECT COALESCE(SUM(
		CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo ELSE -amount_kobo END),0)
		FROM invest_ledger_entries WHERE account_id=$1`
	var bal int64
	if err := q.QueryRow(ctx, sql, accountID).Scan(&bal); err != nil {
		return 0, err
	}
	return bal, nil
}

// queryer is satisfied by both *pgxpool.Pool and pgx.Tx.
type queryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Post writes a balanced debit+credit pair atomically inside an existing tx.
// Both legs share the idempotency key (suffixed) so a retry is rejected by the
// unique index.
func (l *InvestLedger) post(ctx context.Context, tx pgx.Tx, debitAcct, creditAcct, currency, txnType, ref, providerRef, idem string, amountKobo int64) error {
	if amountKobo <= 0 {
		return fmt.Errorf("invest ledger: amount must be positive, got %d", amountKobo)
	}
	const ins = `INSERT INTO invest_ledger_entries
		(account_id, type, amount_kobo, currency, txn_type, reference, provider_reference, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := tx.Exec(ctx, ins, debitAcct, "DEBIT", amountKobo, currency, txnType, ref, providerRef, idem+":debit"); err != nil {
		return fmt.Errorf("invest ledger: debit leg: %w", err)
	}
	if _, err := tx.Exec(ctx, ins, creditAcct, "CREDIT", amountKobo, currency, txnType, ref, providerRef, idem+":credit"); err != nil {
		return fmt.Errorf("invest ledger: credit leg: %w", err)
	}
	return nil
}

// AvailableCash returns the user's spendable invest cash (kobo).
func (l *InvestLedger) AvailableCash(ctx context.Context, userID string) (int64, error) {
	tx, err := l.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	acc, err := l.accountID(ctx, tx, userID, AcctCash, "NGN")
	if err != nil {
		return 0, err
	}
	bal, err := l.balanceOf(ctx, tx, acc)
	if err != nil {
		return 0, err
	}
	_ = tx.Commit(ctx)
	return bal, nil
}

// Balances returns the projected cash / locked / settlement balances at once.
func (l *InvestLedger) Balances(ctx context.Context, userID string) (cash, locked, settlement int64, err error) {
	tx, err := l.db.Begin(ctx)
	if err != nil {
		return 0, 0, 0, err
	}
	defer tx.Rollback(ctx)
	for _, p := range []struct {
		acct string
		dst  *int64
	}{{AcctCash, &cash}, {AcctLockedCash, &locked}, {AcctSettlement, &settlement}} {
		id, e := l.accountID(ctx, tx, userID, p.acct, "NGN")
		if e != nil {
			return 0, 0, 0, e
		}
		b, e := l.balanceOf(ctx, tx, id)
		if e != nil {
			return 0, 0, 0, e
		}
		*p.dst = b
	}
	_ = tx.Commit(ctx)
	return cash, locked, settlement, nil
}

// Deposit credits the user's invest cash from external funding (the main wallet
// debit is performed separately by the service before this call).
func (l *InvestLedger) Deposit(ctx context.Context, userID, ref, idem string, amountKobo int64) error {
	return l.tx(ctx, func(tx pgx.Tx) error {
		funding, err := l.accountID(ctx, tx, "", AcctExternalFunding, "NGN")
		if err != nil {
			return err
		}
		cash, err := l.accountID(ctx, tx, userID, AcctCash, "NGN")
		if err != nil {
			return err
		}
		// debit external funding, credit user cash
		return l.post(ctx, tx, funding, cash, "NGN", "deposit", ref, "", idem, amountKobo)
	})
}

// Withdraw debits the user's invest cash to external funding. Caller must have
// already verified sufficient withdrawable balance; we re-check inside the tx.
func (l *InvestLedger) Withdraw(ctx context.Context, userID, ref, idem string, amountKobo int64) error {
	return l.tx(ctx, func(tx pgx.Tx) error {
		cash, err := l.accountID(ctx, tx, userID, AcctCash, "NGN")
		if err != nil {
			return err
		}
		bal, err := l.balanceOf(ctx, tx, cash)
		if err != nil {
			return err
		}
		if bal < amountKobo {
			return ErrInsufficientCash
		}
		funding, err := l.accountID(ctx, tx, "", AcctExternalFunding, "NGN")
		if err != nil {
			return err
		}
		return l.post(ctx, tx, cash, funding, "NGN", "withdrawal", ref, "", idem, amountKobo)
	})
}

// LockCash moves cash → locked for a pending buy (fail-closed on low balance).
func (l *InvestLedger) LockCash(ctx context.Context, userID, ref, idem string, amountKobo int64) error {
	return l.tx(ctx, func(tx pgx.Tx) error {
		cash, err := l.accountID(ctx, tx, userID, AcctCash, "NGN")
		if err != nil {
			return err
		}
		bal, err := l.balanceOf(ctx, tx, cash)
		if err != nil {
			return err
		}
		if bal < amountKobo {
			return ErrInsufficientCash
		}
		locked, err := l.accountID(ctx, tx, userID, AcctLockedCash, "NGN")
		if err != nil {
			return err
		}
		return l.post(ctx, tx, cash, locked, "NGN", "cash_lock", ref, "", idem, amountKobo)
	})
}

// UnlockCash moves locked → cash (failed/cancelled buy releases funds).
func (l *InvestLedger) UnlockCash(ctx context.Context, userID, ref, idem string, amountKobo int64) error {
	return l.tx(ctx, func(tx pgx.Tx) error {
		locked, err := l.accountID(ctx, tx, userID, AcctLockedCash, "NGN")
		if err != nil {
			return err
		}
		cash, err := l.accountID(ctx, tx, userID, AcctCash, "NGN")
		if err != nil {
			return err
		}
		return l.post(ctx, tx, locked, cash, "NGN", "cash_unlock", ref, "", idem, amountKobo)
	})
}

// SettleBuy on fill: locked cash → broker clearing (spent) and fee → fee income.
// The remaining locked (if the fill cost less than locked) returns to cash.
func (l *InvestLedger) SettleBuy(ctx context.Context, userID, ref, providerRef, idem string, costKobo, feeKobo, lockedKobo int64) error {
	return l.tx(ctx, func(tx pgx.Tx) error {
		locked, err := l.accountID(ctx, tx, userID, AcctLockedCash, "NGN")
		if err != nil {
			return err
		}
		broker, err := l.accountID(ctx, tx, "", AcctBrokerClearing, "NGN")
		if err != nil {
			return err
		}
		feeAcc, err := l.accountID(ctx, tx, "", AcctFeeIncome, "NGN")
		if err != nil {
			return err
		}
		// locked → broker (principal). Guard >0 (CHECK amount_kobo > 0).
		if costKobo > 0 {
			if err := l.post(ctx, tx, locked, broker, "NGN", "stock_purchase", ref, providerRef, idem+":px", costKobo); err != nil {
				return err
			}
		}
		// locked → fee income
		if feeKobo > 0 {
			if err := l.post(ctx, tx, locked, feeAcc, "NGN", "fee_debit", ref, providerRef, idem+":fee", feeKobo); err != nil {
				return err
			}
		}
		// return any residual lock to cash
		residual := lockedKobo - costKobo - feeKobo
		if residual > 0 {
			cash, err := l.accountID(ctx, tx, userID, AcctCash, "NGN")
			if err != nil {
				return err
			}
			if err := l.post(ctx, tx, locked, cash, "NGN", "cash_unlock", ref, providerRef, idem+":res", residual); err != nil {
				return err
			}
		}
		return nil
	})
}

// SettleSellToPending on fill: broker clearing → user settlement suspense
// (net proceeds), and fee → fee income. Cash is released to available later.
func (l *InvestLedger) SellProceedsToPending(ctx context.Context, userID, ref, providerRef, idem string, grossKobo, feeKobo int64) error {
	net := grossKobo - feeKobo
	if net < 0 {
		net = 0
	}
	return l.tx(ctx, func(tx pgx.Tx) error {
		broker, err := l.accountID(ctx, tx, "", AcctBrokerClearing, "NGN")
		if err != nil {
			return err
		}
		settle, err := l.accountID(ctx, tx, userID, AcctSettlement, "NGN")
		if err != nil {
			return err
		}
		feeAcc, err := l.accountID(ctx, tx, "", AcctFeeIncome, "NGN")
		if err != nil {
			return err
		}
		if err := l.post(ctx, tx, broker, settle, "NGN", "stock_sale", ref, providerRef, idem+":net", net); err != nil {
			return err
		}
		if feeKobo > 0 {
			if err := l.post(ctx, tx, broker, feeAcc, "NGN", "fee_debit", ref, providerRef, idem+":fee", feeKobo); err != nil {
				return err
			}
		}
		return nil
	})
}

// ReleaseSettlement moves settlement suspense → available cash (T+N reached).
func (l *InvestLedger) ReleaseSettlement(ctx context.Context, userID, ref, idem string, amountKobo int64) error {
	return l.tx(ctx, func(tx pgx.Tx) error {
		settle, err := l.accountID(ctx, tx, userID, AcctSettlement, "NGN")
		if err != nil {
			return err
		}
		cash, err := l.accountID(ctx, tx, userID, AcctCash, "NGN")
		if err != nil {
			return err
		}
		return l.post(ctx, tx, settle, cash, "NGN", "settlement_release", ref, "", idem, amountKobo)
	})
}

// CreditDividend credits a dividend to the user's invest cash.
func (l *InvestLedger) CreditDividend(ctx context.Context, userID, ref, idem string, amountKobo int64) error {
	return l.tx(ctx, func(tx pgx.Tx) error {
		src, err := l.accountID(ctx, tx, "", AcctDividendSource, "NGN")
		if err != nil {
			return err
		}
		cash, err := l.accountID(ctx, tx, userID, AcctCash, "NGN")
		if err != nil {
			return err
		}
		return l.post(ctx, tx, src, cash, "NGN", "dividend_credit", ref, "", idem, amountKobo)
	})
}

// Transactions lists the user's invest cash-account ledger entries.
func (l *InvestLedger) Transactions(ctx context.Context, userID string, limit, offset int) ([]map[string]any, error) {
	const sql = `SELECT e.id, e.type, e.amount_kobo, e.txn_type, e.reference, e.provider_reference, e.created_at
		FROM invest_ledger_entries e
		JOIN invest_ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id = $1 AND a.type = $2
		ORDER BY e.created_at DESC LIMIT $3 OFFSET $4`
	rows, err := l.db.Query(ctx, sql, userID, AcctCash, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, typ, txnType, ref string
		var providerRef *string
		var amt int64
		var created interface{}
		if err := rows.Scan(&id, &typ, &amt, &txnType, &ref, &providerRef, &created); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "type": typ, "amount_kobo": amt, "txn_type": txnType,
			"reference": ref, "provider_reference": providerRef, "created_at": created,
		})
	}
	return out, rows.Err()
}

// tx is a helper that runs fn inside a transaction with rollback-on-error.
func (l *InvestLedger) tx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := l.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Sentinel errors.
var (
	ErrInsufficientCash = fmt.Errorf("invest: insufficient investment cash")
)

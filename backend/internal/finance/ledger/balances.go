package ledger

import (
	"context"
	"fmt"
)

// AccountBalance is a standing account with its projected balance.
type AccountBalance struct {
	AccountID   string
	Type        AccountType
	BalanceKobo int64
}

// ListPositiveBalancesByTypePrefix returns every standing (non-user) account
// whose type starts with prefix and whose projected balance (the same
// credit-minus-debit projection as GetBalance) is strictly positive, ordered by
// type. READ-ONLY: no lock, no write, no schema change. The prefix is matched
// literally (not as a LIKE pattern), so "_" in e.g. "fees_unswept:" is safe.
func (r *Repository) ListPositiveBalancesByTypePrefix(ctx context.Context, prefix string) ([]AccountBalance, error) {
	if prefix == "" {
		return nil, fmt.Errorf("ledger: list balances: prefix required")
	}
	const q = `
		SELECT a.id, a.type, SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_DEBIT') THEN e.amount_kobo
		                              ELSE -e.amount_kobo END) AS bal
		FROM ledger_accounts a
		JOIN ledger_entries e ON e.account_id = a.id
		WHERE a.user_id IS NULL AND left(a.type, length($1::text)) = $1::text
		GROUP BY a.id, a.type
		HAVING SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_DEBIT') THEN e.amount_kobo
		                ELSE -e.amount_kobo END) > 0
		ORDER BY a.type`
	rows, err := r.db.Query(ctx, q, prefix)
	if err != nil {
		return nil, fmt.Errorf("ledger: list positive balances prefix=%s: %w", prefix, err)
	}
	defer rows.Close()
	var out []AccountBalance
	for rows.Next() {
		var b AccountBalance
		var t string
		if err := rows.Scan(&b.AccountID, &t, &b.BalanceKobo); err != nil {
			return nil, err
		}
		b.Type = AccountType(t)
		out = append(out, b)
	}
	return out, rows.Err()
}

// ListPositiveBalancesByTypePrefix lists standing accounts of a type prefix
// with a strictly positive projected balance. Read-only, unlocked.
func (s *Service) ListPositiveBalancesByTypePrefix(ctx context.Context, prefix string) ([]AccountBalance, error) {
	return s.repo.ListPositiveBalancesByTypePrefix(ctx, prefix)
}

// ListAccountEntries pages an account's entries (newest first). Read-only.
func (s *Service) ListAccountEntries(ctx context.Context, accountID string, limit, offset int) ([]Entry, error) {
	return s.repo.ListEntries(ctx, accountID, limit, offset)
}

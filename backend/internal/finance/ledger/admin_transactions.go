package ledger

import (
	"context"
	"fmt"
	"time"
)

// AdminTransactionFilter narrows the centralized admin transactions list.
//
// This is a READ-ONLY reporting surface over ledger_entries — the only source
// of truth for money movement across every module (there is no per-module
// transactions table). It never writes to ledger_entries.
type AdminTransactionFilter struct {
	Type          string // CREDIT | DEBIT | REVERSAL_CREDIT | REVERSAL_DEBIT
	AccountType   string // ledger_accounts.type, e.g. user_wallet, commission, provider_clearing
	UserID        string // ledger_accounts.user_id
	Search        string // ILIKE against reference OR joined user's full_name/display_name/email
	From          time.Time
	To            time.Time
	MinAmountKobo int64
	MaxAmountKobo int64
	Limit         int
	Offset        int
}

// AdminTransactionRow is one ledger_entries row joined to its owning account
// and (when the account has one) the human user, for back-office display.
//
// SourcePrefix is a BEST-EFFORT guess at which module produced this entry,
// derived from SPLIT_PART(reference, ':', 1). There is no module/source column
// on ledger_entries and reference-naming conventions are inconsistent across
// modules (colon-namespaced like "fx:convert:<uuid>", dash-prefixed like
// "SPL-INV-...", or opaque UUIDs with no separator at all) — this field is
// NEVER an authoritative module identifier. Callers must label it
// "Source (inferred)" and never present it as a real schema field.
type AdminTransactionRow struct {
	ID           string    `json:"id"`
	Type         string    `json:"type"`
	AmountKobo   int64     `json:"amount_kobo"`
	Reference    string    `json:"reference"`
	SourcePrefix string    `json:"source_inferred"`
	Description  *string   `json:"description"`
	CreatedAt    time.Time `json:"created_at"`
	AccountID    string    `json:"account_id"`
	AccountType  string    `json:"account_type"`
	UserID       *string   `json:"user_id"`
	UserName     *string   `json:"user_name"`
	UserEmail    *string   `json:"user_email"`
}

// AdminTransactionsPage is the paginated result: the page of rows plus the
// total count of rows matching the filter (for pagination UI), computed under
// the SAME WHERE clause as the page itself.
type AdminTransactionsPage struct {
	Rows  []AdminTransactionRow `json:"rows"`
	Total int64                 `json:"total"`
}

// AdminListTransactions lists ledger_entries joined to ledger_accounts and
// user_profiles (the exact join path used by transport/admin_modes.go:
// ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id LEFT JOIN
// user_profiles up ON up.id = la.user_id). Rows where la.user_id IS NULL are
// standing/system accounts (commission pots, clearing accounts, etc.) — they
// are returned, never filtered out; callers display them as
// "System: <account type>".
//
// Total is computed via a COUNT(*) OVER() window function so it always
// reflects the SAME filter predicate as the page (no separate query to drift).
func (s *Service) AdminListTransactions(ctx context.Context, f AdminTransactionFilter) (*AdminTransactionsPage, error) {
	return s.repo.AdminListTransactions(ctx, f)
}

// AdminListTransactions is the repository-level implementation: dynamic WHERE
// building mirrors finance/transfers/admin.go's AdminListTransfers pattern.
func (r *Repository) AdminListTransactions(ctx context.Context, f AdminTransactionFilter) (*AdminTransactionsPage, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}

	q := `
		SELECT
			le.id, le.type, le.amount_kobo, le.reference,
			SPLIT_PART(le.reference, ':', 1) AS source_prefix,
			le.description, le.created_at,
			le.account_id, la.type AS account_type, la.user_id,
			COALESCE(NULLIF(up.full_name,''), up.display_name) AS user_name,
			up.email AS user_email,
			COUNT(*) OVER() AS total_count
		FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		LEFT JOIN user_profiles up ON up.id = la.user_id
		WHERE 1=1`
	args := []any{}
	i := 1

	if f.Type != "" {
		q += fmt.Sprintf(" AND le.type=$%d", i)
		args = append(args, f.Type)
		i++
	}
	if f.AccountType != "" {
		q += fmt.Sprintf(" AND la.type=$%d", i)
		args = append(args, f.AccountType)
		i++
	}
	if f.UserID != "" {
		q += fmt.Sprintf(" AND la.user_id=$%d", i)
		args = append(args, f.UserID)
		i++
	}
	if !f.From.IsZero() {
		q += fmt.Sprintf(" AND le.created_at >= $%d", i)
		args = append(args, f.From)
		i++
	}
	if !f.To.IsZero() {
		q += fmt.Sprintf(" AND le.created_at <= $%d", i)
		args = append(args, f.To)
		i++
	}
	if f.MinAmountKobo > 0 {
		q += fmt.Sprintf(" AND le.amount_kobo >= $%d", i)
		args = append(args, f.MinAmountKobo)
		i++
	}
	if f.MaxAmountKobo > 0 {
		q += fmt.Sprintf(" AND le.amount_kobo <= $%d", i)
		args = append(args, f.MaxAmountKobo)
		i++
	}
	if f.Search != "" {
		q += fmt.Sprintf(` AND (le.reference ILIKE $%d OR up.full_name ILIKE $%d OR up.display_name ILIKE $%d OR up.email ILIKE $%d)`, i, i, i, i)
		args = append(args, "%"+f.Search+"%")
		i++
	}

	q += fmt.Sprintf(" ORDER BY le.created_at DESC LIMIT $%d OFFSET $%d", i, i+1)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("ledger: admin list transactions: %w", err)
	}
	defer rows.Close()

	out := &AdminTransactionsPage{Rows: []AdminTransactionRow{}}
	for rows.Next() {
		var row AdminTransactionRow
		var total int64
		if err := rows.Scan(
			&row.ID, &row.Type, &row.AmountKobo, &row.Reference,
			&row.SourcePrefix, &row.Description, &row.CreatedAt,
			&row.AccountID, &row.AccountType, &row.UserID,
			&row.UserName, &row.UserEmail,
			&total,
		); err != nil {
			return nil, fmt.Errorf("ledger: admin list transactions scan: %w", err)
		}
		out.Total = total
		out.Rows = append(out.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ledger: admin list transactions rows: %w", err)
	}
	return out, nil
}

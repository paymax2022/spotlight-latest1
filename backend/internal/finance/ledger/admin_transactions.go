package ledger

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
)

// AdminTransactionFilter narrows the centralized admin transactions list.
//
// This is a READ-ONLY reporting surface over ledger_entries — the only source
// of truth for money movement across every module (there is no per-module
// transactions table). It never writes to ledger_entries.
type AdminTransactionFilter struct {
	Type        string // CREDIT | DEBIT | REVERSAL_CREDIT | REVERSAL_DEBIT
	AccountType string // ledger_accounts.type, e.g. user_wallet, commission, provider_clearing
	UserID      string // ledger_accounts.user_id
	Search      string // ILIKE against reference OR joined user's full_name/display_name/email
	// Module narrows rows to ONE resolver's reference convention (see
	// AdminTransactionModules / moduleReferenceFilter) — e.g. "utility_bill".
	// Empty means no module filter (every row, resolved or not).
	Module        string
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
	ID             string          `json:"id"`
	Type           string          `json:"type"`
	AmountKobo     int64           `json:"amount_kobo"`
	Reference      string          `json:"reference"`
	SourcePrefix   string          `json:"source_inferred"`
	Description    *string         `json:"description"`
	IdempotencyKey *string         `json:"idempotency_key"`
	Metadata       json.RawMessage `json:"metadata"`
	CreatedAt      time.Time       `json:"created_at"`
	AccountID      string          `json:"account_id"`
	AccountType    string          `json:"account_type"`
	Currency       string          `json:"currency"`
	UserID         *string         `json:"user_id"`
	UserName       *string         `json:"user_name"`
	UserEmail      *string         `json:"user_email"`
	UserPhone      *string         `json:"user_phone"`
	// ModuleDetail is the REAL per-module detail (service, category, what was
	// bought, payment method, real status, provider) resolved from this row's
	// reference by whichever TransactionDetailResolver (see
	// admin_transaction_resolver.go) recognizes its naming pattern first, or
	// nil when no wired resolver's pattern matches (most module/reference
	// combinations — resolvers exist for a growing subset only). Populated on
	// BOTH the list and the detail view, so the list table can show real
	// per-module columns instead of only generic ledger fields. A resolver
	// query failure is logged, not fatal.
	ModuleDetail *ModuleTransactionDetail `json:"module_detail"`
}

// AdminTransactionsPage is the paginated result: the page of rows plus the
// total count of rows matching the filter (for pagination UI), computed under
// the SAME WHERE clause as the page itself.
type AdminTransactionsPage struct {
	Rows  []AdminTransactionRow `json:"rows"`
	Total int64                 `json:"total"`
}

// AdminTransactionDetail is the comprehensive, single-transaction view: the
// full row (every column, including idempotency_key/metadata/currency the
// list view also carries) plus every OTHER ledger_entries row sharing the
// SAME reference string — i.e. the other leg(s) of the same double-entry
// movement (a balanced post is usually >=2 rows: e.g. a DEBIT off the user's
// wallet and the matching CREDIT into a standing account, both posted under
// one reference).
//
// CAVEAT, found live while building this: reference is NOT guaranteed unique
// per transaction across this codebase — some code paths (an admin
// wallet-funding seed helper, confirmed live) reuse one literal constant
// string ("admin-appt-seed") across many unrelated fundings, so "matches by
// reference" can occasionally return OTHER unrelated transactions, not just
// this one's true other leg. RelatedEntriesTotal is the real count of rows
// sharing this reference (capped at adminRelatedEntriesLimit for the returned
// list itself); when it is implausibly large for a normal 2-3-leg post,
// callers should render a caveat rather than presenting every row as
// definitely part of this one transaction.
type AdminTransactionDetail struct {
	AdminTransactionRow
	RelatedEntries      []AdminTransactionRow `json:"related_entries"`
	RelatedEntriesTotal int64                 `json:"related_entries_total"`
	// CommissionKobo is the total amount, among RelatedEntries, that landed in
	// a KNOWN platform-revenue standing account (see revenueAccountTypes) —
	// this IS a real, derivable figure (not a guess) when the commission leg
	// is among the returned related entries. It is nil when no such leg is
	// present in RelatedEntries — including the case where RelatedEntries was
	// truncated by adminRelatedEntriesLimit (see RelatedEntriesTotal) and the
	// real commission leg fell outside the returned page; callers must not
	// read a nil CommissionKobo as "no commission was ever charged."
	CommissionKobo *int64 `json:"commission_kobo"`
	// ModuleDetail is promoted from the embedded AdminTransactionRow — see its
	// doc comment. Populated the same way here as on every list row.
}

// revenueAccountTypes are the standing account types this codebase's
// commission-adjacent flows post platform revenue into — confirmed by reading
// backend/internal/finance/ledger/model.go's AccountType constants across
// every module. There is no single generic "is this a commission account?"
// flag on ledger_accounts; this list is a best-effort but CONCRETE (not
// inferred from free text) classification of the accounts that ARE revenue,
// used only to compute CommissionKobo above.
var revenueAccountTypes = map[string]bool{
	string(AccountCommission):       true,
	string(AccountPaymaxRevenue):    true,
	string(AccountFXSpreadIncome):   true,
	string(AccountPlacementRevenue): true,
	string(AccountEdtechFeesVault):  true,
	string(AccountTradingFeeIncome): true,
}

// adminRelatedEntriesLimit caps how many same-reference rows AdminGetTransaction
// returns, so a non-unique reference (see caveat above) can't blow up the
// response — the UI is told the real total via RelatedEntriesTotal regardless.
const adminRelatedEntriesLimit = 20

// ErrTransactionNotFound is returned when no ledger_entries row matches the
// requested id.
var ErrTransactionNotFound = fmt.Errorf("ledger: transaction not found")

// resolveModuleDetail tries every wired resolver in order against one
// reference string, returning the first match (or nil when none match). A
// resolver's own query failure is logged and treated as "no match" — it must
// never break the surrounding list/detail response.
func (s *Service) resolveModuleDetail(ctx context.Context, reference string) *ModuleTransactionDetail {
	for _, r := range s.resolvers {
		md, found, rerr := r.Resolve(ctx, reference)
		if rerr != nil {
			log.Printf("ledger: admin transaction module-detail resolver error (reference=%s): %v", reference, rerr)
			continue
		}
		if found {
			return md
		}
	}
	return nil
}

// AdminGetTransaction fetches the comprehensive detail view for one
// ledger_entries row by id, including every other row sharing its reference
// (the other leg(s) of the same balanced movement).
func (s *Service) AdminGetTransaction(ctx context.Context, id string) (*AdminTransactionDetail, error) {
	detail, err := s.repo.AdminGetTransaction(ctx, id)
	if err != nil {
		return nil, err
	}
	detail.ModuleDetail = s.resolveModuleDetail(ctx, detail.Reference)
	return detail, nil
}

const adminTransactionSelectCols = `
	le.id, le.type, le.amount_kobo, le.reference,
	SPLIT_PART(le.reference, ':', 1) AS source_prefix,
	le.description, le.idempotency_key, le.metadata, le.created_at,
	le.account_id, la.type AS account_type, la.currency, la.user_id,
	COALESCE(NULLIF(up.full_name,''), up.display_name) AS user_name,
	up.email AS user_email,
	NULLIF(up.phone,'') AS user_phone`

const adminTransactionFrom = `
	FROM ledger_entries le
	JOIN ledger_accounts la ON la.id = le.account_id
	LEFT JOIN user_profiles up ON up.id = la.user_id`

func scanAdminTransactionRow(row rowScanner) (AdminTransactionRow, error) {
	var r AdminTransactionRow
	err := row.Scan(
		&r.ID, &r.Type, &r.AmountKobo, &r.Reference,
		&r.SourcePrefix, &r.Description, &r.IdempotencyKey, &r.Metadata, &r.CreatedAt,
		&r.AccountID, &r.AccountType, &r.Currency, &r.UserID,
		&r.UserName, &r.UserEmail, &r.UserPhone,
	)
	return r, err
}

// rowScanner is the minimal interface both pgx.Row and pgx.Rows satisfy,
// letting scanAdminTransactionRow serve both the single-row and multi-row
// queries below without duplicating the Scan column list.
type rowScanner interface {
	Scan(dest ...any) error
}

func (r *Repository) AdminGetTransaction(ctx context.Context, id string) (*AdminTransactionDetail, error) {
	row, err := scanAdminTransactionRow(r.db.QueryRow(ctx, `SELECT `+adminTransactionSelectCols+adminTransactionFrom+` WHERE le.id = $1`, id))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrTransactionNotFound
		}
		return nil, fmt.Errorf("ledger: admin get transaction: %w", err)
	}

	var relatedTotal int64
	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger_entries WHERE reference = $1 AND id <> $2`,
		row.Reference, id).Scan(&relatedTotal); err != nil {
		return nil, fmt.Errorf("ledger: admin get transaction related count: %w", err)
	}

	related := []AdminTransactionRow{}
	rows, err := r.db.Query(ctx, `SELECT `+adminTransactionSelectCols+adminTransactionFrom+`
		WHERE le.reference = $1 AND le.id <> $2 ORDER BY le.created_at ASC LIMIT $3`,
		row.Reference, id, adminRelatedEntriesLimit)
	if err != nil {
		return nil, fmt.Errorf("ledger: admin get transaction related: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		rr, err := scanAdminTransactionRow(rows)
		if err != nil {
			return nil, fmt.Errorf("ledger: admin get transaction related scan: %w", err)
		}
		related = append(related, rr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ledger: admin get transaction related rows: %w", err)
	}

	var commissionKobo *int64
	// Also count the row itself: a transaction fetched BY its own commission
	// leg (e.g. clicking the commission credit row directly) must report its
	// own amount, not just look at its related entries.
	if revenueAccountTypes[row.AccountType] {
		v := row.AmountKobo
		commissionKobo = &v
	}
	for _, rel := range related {
		if revenueAccountTypes[rel.AccountType] {
			v := rel.AmountKobo
			if commissionKobo != nil {
				sum := *commissionKobo + v
				commissionKobo = &sum
			} else {
				commissionKobo = &v
			}
		}
	}

	return &AdminTransactionDetail{AdminTransactionRow: row, RelatedEntries: related, RelatedEntriesTotal: relatedTotal, CommissionKobo: commissionKobo}, nil
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
	page, err := s.repo.AdminListTransactions(ctx, f)
	if err != nil {
		return nil, err
	}
	// Resolved per row so the list table can show real per-module columns
	// (Service purchased / Sub service / Category / Sub category / Payment
	// method / Payment status) instead of only generic ledger fields — the
	// same resolvers already used by the single-transaction detail view.
	// Cheap for a page of this size: each resolver's own pattern check is a
	// prefix comparison before any query, so only rows actually matching a
	// wired module's reference convention run real SQL.
	for i := range page.Rows {
		page.Rows[i].ModuleDetail = s.resolveModuleDetail(ctx, page.Rows[i].Reference)
	}
	return page, nil
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

	q := `SELECT ` + adminTransactionSelectCols + `, COUNT(*) OVER() AS total_count` + adminTransactionFrom + `
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
	if f.Module != "" {
		if clause, moduleArgs := moduleReferenceFilter(f.Module, i); clause != "" {
			q += " AND " + clause
			args = append(args, moduleArgs...)
			i += len(moduleArgs)
		}
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
			&row.SourcePrefix, &row.Description, &row.IdempotencyKey, &row.Metadata, &row.CreatedAt,
			&row.AccountID, &row.AccountType, &row.Currency, &row.UserID,
			&row.UserName, &row.UserEmail, &row.UserPhone,
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

// AdminTransactionsSummaryDay is one day's real transaction volume for a
// module (or, with an empty module filter, for every ledger_entries row).
type AdminTransactionsSummaryDay struct {
	Day        string `json:"day"` // YYYY-MM-DD, UTC
	Count      int64  `json:"count"`
	AmountKobo int64  `json:"amount_kobo"`
}

// AdminTransactionsSummary backs the dashboard chart on each module tab.
type AdminTransactionsSummary struct {
	Days            []AdminTransactionsSummaryDay `json:"days"`
	TotalCount      int64                         `json:"total_count"`
	TotalAmountKobo int64                         `json:"total_amount_kobo"`
}

// AdminGetTransactionsSummary aggregates REAL transaction volume by day for
// the dashboard chart on the Transactions console.
//
// A balanced double-entry post shares one reference across >=2 ledger_entries
// rows with the SAME amount_kobo on each leg (that is what "balanced" means)
// — naively summing amount_kobo over every matching row would double- (or
// triple-)count every transaction's volume. This collapses to one row PER
// REFERENCE first (MAX(amount_kobo) — every leg shares it, so MAX picks it
// without needing to know which leg is "the" amount) before aggregating by
// day, so a day's count and amount both reflect real transactions, not raw
// ledger rows.
func (s *Service) AdminGetTransactionsSummary(ctx context.Context, module string, from, to time.Time) (*AdminTransactionsSummary, error) {
	return s.repo.AdminGetTransactionsSummary(ctx, module, from, to)
}

func (r *Repository) AdminGetTransactionsSummary(ctx context.Context, module string, from, to time.Time) (*AdminTransactionsSummary, error) {
	q := `
		WITH per_txn AS (
			SELECT le.reference, MIN(le.created_at) AS created_at, MAX(le.amount_kobo) AS amount_kobo
			FROM ledger_entries le
			WHERE 1=1`
	args := []any{}
	i := 1
	if !from.IsZero() {
		q += fmt.Sprintf(" AND le.created_at >= $%d", i)
		args = append(args, from)
		i++
	}
	if !to.IsZero() {
		q += fmt.Sprintf(" AND le.created_at <= $%d", i)
		args = append(args, to)
		i++
	}
	if module != "" {
		if clause, moduleArgs := moduleReferenceFilter(module, i); clause != "" {
			q += " AND " + clause
			args = append(args, moduleArgs...)
			i += len(moduleArgs)
		}
	}
	q += `
			GROUP BY le.reference
		)
		SELECT DATE_TRUNC('day', created_at)::date AS day, COUNT(*), SUM(amount_kobo)
		FROM per_txn
		GROUP BY day
		ORDER BY day`

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("ledger: admin transactions summary: %w", err)
	}
	defer rows.Close()

	out := &AdminTransactionsSummary{Days: []AdminTransactionsSummaryDay{}}
	for rows.Next() {
		var day time.Time
		var count, amount int64
		if err := rows.Scan(&day, &count, &amount); err != nil {
			return nil, fmt.Errorf("ledger: admin transactions summary scan: %w", err)
		}
		out.Days = append(out.Days, AdminTransactionsSummaryDay{
			Day:        day.Format("2006-01-02"),
			Count:      count,
			AmountKobo: amount,
		})
		out.TotalCount += count
		out.TotalAmountKobo += amount
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ledger: admin transactions summary rows: %w", err)
	}
	return out, nil
}

package handlers

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminStore provides data access for admin console operations.
type AdminStore struct {
	db *pgxpool.Pool
}

// tradingOrdersSQL projects the two trading-order tables the admin console's
// order views span — crypto (crypto_orders) and stocks (invest_orders) — onto a
// single shape.
//
// There is NO single `orders` table for trading: public.orders belongs to the
// restaurant module (customer_id / restaurant_id / total_kobo) and carries none
// of the columns this console needs. Earlier revisions of this file queried
// `orders.user_id` / `order_type` / `amount_kobo`, so every read that touched it
// failed with `column "amount_kobo" does not exist` and the endpoint returned
// 500 unconditionally.
//
// status is normalised onto the admin console's AdminOrderStatus union —
// Filled | PartiallyFilled | Processing | Pending | Failed | Reversed |
// ComplianceHold (mobile-app/reactnative/src/features/admin/types/admin.types.ts).
// That contract is NOT cosmetic: the client keys ORDER_STATUS_STYLE off these
// exact strings, so an unmapped value renders a blank status pill, and its
// failed/pending KPI tiles compare against 'Failed'/'Reversed' and
// 'Pending'/'Processing' literally.
//
// The two sources disagree: crypto_orders stores lower-case (pending/filled/
// failed) while invest_orders stores the 18-state invest.OrderStatus machine in
// CamelCase. invest is the wider vocabulary and the client union is modelled on
// it, so crypto is mapped UP and invest's extra in-flight and terminal states
// are folded onto the nearest union member. Anything unrecognised falls back to
// 'Processing' rather than leaking a raw value the client cannot style.
//
// amount: invest_orders carries both a requested notional (amount_kobo) and a
// settled total (total_amount_kobo, 0 until fill), so report the total once it
// exists and fall back to the request before then.
//
// side is lower-cased to match the console's OrderSide ('buy' | 'sell'). Both
// tables already store lower-case, but invest_orders has no CHECK constraint on
// the column, and OrderRow renders anything that is not exactly 'buy' as "Sell"
// — so a stray 'Buy' would silently mislabel the trade direction.
//
// symbol comes from a LEFT JOIN for crypto (crypto_orders keys an asset_id, not
// a symbol) and straight off the column for stocks. LEFT, not INNER: an order
// whose asset row was removed must still appear in an admin list rather than
// vanish from oversight.
const tradingOrdersSQL = `
	SELECT o.id::text      AS id,
	       o.user_id::text AS user_id,
	       'crypto'        AS kind,
	       o.cash_kobo     AS amount_kobo,
	       CASE lower(o.status)
	         WHEN 'pending' THEN 'Pending'
	         WHEN 'filled'  THEN 'Filled'
	         WHEN 'failed'  THEN 'Failed'
	         ELSE 'Processing'
	       END             AS status,
	       lower(o.side)             AS side,
	       COALESCE(a.symbol, '')    AS symbol,
	       COALESCE(o.reference, '') AS provider_ref,
	       o.created_at
	  FROM crypto_orders o
	  LEFT JOIN crypto_assets a ON a.id = o.asset_id
	UNION ALL
	SELECT id::text                                           AS id,
	       user_id                                            AS user_id,
	       'stock'                                            AS kind,
	       COALESCE(NULLIF(total_amount_kobo, 0), amount_kobo) AS amount_kobo,
	       CASE status
	         -- not yet at the venue
	         WHEN 'Draft'                THEN 'Pending'
	         WHEN 'PendingReview'        THEN 'Pending'
	         WHEN 'AwaitingConfirmation' THEN 'Pending'
	         WHEN 'CashLocked'           THEN 'Pending'
	         -- in flight
	         WHEN 'Submitted'         THEN 'Processing'
	         WHEN 'Accepted'          THEN 'Processing'
	         WHEN 'PendingSettlement' THEN 'Processing'
	         WHEN 'CancelRequested'   THEN 'Processing'
	         WHEN 'ReversalPending'   THEN 'Processing'
	         -- terminal
	         WHEN 'PartiallyFilled' THEN 'PartiallyFilled'
	         WHEN 'Filled'          THEN 'Filled'
	         WHEN 'Settled'         THEN 'Filled'
	         WHEN 'Cancelled'       THEN 'Failed'
	         WHEN 'Rejected'        THEN 'Failed'
	         WHEN 'Failed'          THEN 'Failed'
	         WHEN 'Reversed'        THEN 'Reversed'
	         WHEN 'ComplianceHold'  THEN 'ComplianceHold'
	         ELSE 'Processing'
	       END                                                AS status,
	       lower(side)                        AS side,
	       symbol                             AS symbol,
	       COALESCE(provider_reference, '')   AS provider_ref,
	       created_at
	  FROM invest_orders`

// NewAdminStore creates a new admin store.
func NewAdminStore(db *pgxpool.Pool) *AdminStore {
	return &AdminStore{db: db}
}

// DashboardStats represents high-level platform metrics.
type DashboardStats struct {
	TotalUsers     int64 `json:"totalUsers"`
	KYCPending     int64 `json:"kycPending"`
	ActiveOrders   int64 `json:"activeOrders"`
	TotalVolume    int64 `json:"totalVolume"`
	AvgOrderValue  int64 `json:"avgOrderValue"`
	FailedTxns     int64 `json:"failedTransactions"`
}

// GetDashboardStats retrieves platform-wide aggregates.
func (s *AdminStore) GetDashboardStats(ctx context.Context) (*DashboardStats, error) {
	// AVG() returns numeric; cast to bigint so it scans into int64 (kobo are
	// integer minor units — CLAUDE.md § Money handling).
	row := s.db.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM auth.users) as total_users,
			(SELECT COUNT(*) FROM user_profiles
			 WHERE kyc_status IN ('submitted', 'pending')) as kyc_pending,
			(SELECT COUNT(*) FROM (`+tradingOrdersSQL+`) o
			 WHERE o.status IN ('Pending', 'Processing')) as active_orders,
			(SELECT COALESCE(SUM(amount_kobo), 0) FROM ledger_entries
			 WHERE type = 'DEBIT' AND created_at > NOW() - INTERVAL '24 hours') as total_volume,
			(SELECT COALESCE(AVG(o.amount_kobo), 0)::bigint FROM (`+tradingOrdersSQL+`) o
			 WHERE o.created_at > NOW() - INTERVAL '24 hours') as avg_order_value,
			(SELECT COUNT(*) FROM ledger_entries
			 WHERE type IN ('REVERSAL_CREDIT', 'REVERSAL_DEBIT')
			 AND created_at > NOW() - INTERVAL '24 hours') as failed_txns
	`)

	var stats DashboardStats
	err := row.Scan(&stats.TotalUsers, &stats.KYCPending, &stats.ActiveOrders,
		&stats.TotalVolume, &stats.AvgOrderValue, &stats.FailedTxns)
	if err != nil {
		return nil, fmt.Errorf("query dashboard stats: %w", err)
	}

	return &stats, nil
}

// User represents a user record for admin view.
type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Phone     string `json:"phone"`
	Tier      int    `json:"tier"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	LastLogin string `json:"lastLogin"`
}

// ListUsers retrieves paginated user list.
func (s *AdminStore) ListUsers(ctx context.Context, limit int, offset int) ([]User, int64, error) {
	// Get total count
	var total int64
	err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM auth.users`).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count users: %w", err)
	}

	// Get paginated results.
	//
	// GoTrue's column is raw_user_meta_data — there is no auth.users.user_metadata
	// on Supabase or on the CI compat shim, so the earlier `u.user_metadata->>...`
	// made this query fail with `column u.user_metadata does not exist` on every
	// call. Every projected column is COALESCE'd: email and the metadata status
	// are both nullable, and a NULL scanned into a string field is a hard error.
	//
	// NULLS LAST matters: auth.users.created_at is nullable and Postgres sorts
	// NULLs FIRST on DESC, so without it every row with an unknown creation date
	// outranks every real one and the newest users fall off page 1 entirely (on
	// the local dev database 877 of 879 rows have a NULL created_at). u.id is the
	// tiebreaker — LIMIT/OFFSET paging over a column with thousands of ties is
	// otherwise non-deterministic and can repeat or skip rows between pages.
	rows, err := s.db.Query(ctx, `
		SELECT
			u.id,
			COALESCE(u.email, '') as email,
			COALESCE(p.full_name, '') as name,
			COALESCE(p.phone, '') as phone,
			COALESCE(p.kyc_tier, 0) as tier,
			COALESCE(u.raw_user_meta_data->>'status', 'active') as status,
			COALESCE(u.created_at::text, '') as created_at,
			COALESCE(u.last_sign_in_at::text, '') as last_login
		FROM auth.users u
		LEFT JOIN user_profiles p ON u.id = p.id
		ORDER BY u.created_at DESC NULLS LAST, u.id
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Phone, &u.Tier,
			&u.Status, &u.CreatedAt, &u.LastLogin); err != nil {
			return nil, 0, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}

	return users, total, rows.Err()
}

// KYCEntry represents a KYC verification queue entry.
type KYCEntry struct {
	ID       string `json:"id"`
	UserID   string `json:"userId"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Status   string `json:"status"`
	Tier     int    `json:"tier"`
	Document string `json:"document"`
	SubmittedAt string `json:"submittedAt"`
}

// GetKYCQueue retrieves pending KYC verifications.
//
// NOTE: only 'pending' can ever match — user_profiles_kyc_status_check permits
// unverified/pending/verified/failed/suspended, so the 'submitted' arm below is
// dead. It is kept because the same pair appears in GetDashboardStats and the two
// must agree; drop both together if 'submitted' is never introduced.
func (s *AdminStore) GetKYCQueue(ctx context.Context) ([]KYCEntry, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			p.id::text as id,
			p.id::text as user_id,
			COALESCE(u.email, '') as email,
			COALESCE(p.full_name, 'Unknown') as name,
			CASE COALESCE(p.kyc_requested_tier, 0)
				WHEN 1 THEN 'pending_tier1'
				WHEN 2 THEN 'pending_tier2'
				WHEN 3 THEN 'pending_tier3'
				ELSE 'pending'
			END as status,
			COALESCE(p.kyc_requested_tier, 0) as tier,
			COALESCE(p.document_type, '') as document,
			COALESCE(p.kyc_submitted_at::text, '') as submitted_at
		FROM user_profiles p
		JOIN auth.users u ON p.id = u.id
		WHERE p.kyc_status IN ('submitted', 'pending')
		ORDER BY p.kyc_submitted_at ASC NULLS LAST
	`)
	if err != nil {
		return nil, fmt.Errorf("query kyc queue: %w", err)
	}
	defer rows.Close()

	var entries []KYCEntry
	for rows.Next() {
		var e KYCEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.Email, &e.Name, &e.Status,
			&e.Tier, &e.Document, &e.SubmittedAt); err != nil {
			return nil, fmt.Errorf("scan kyc entry: %w", err)
		}
		entries = append(entries, e)
	}

	return entries, rows.Err()
}

// Order represents an order/asset for admin view.
type Order struct {
	ID          string `json:"id"`
	UserID      string `json:"userId"`
	Email       string `json:"email"`
	Type        string `json:"type"`
	Amount      int64  `json:"amount"`
	Status      string `json:"status"`
	Side        string `json:"side"`
	Symbol      string `json:"symbol"`
	ProviderRef string `json:"providerRef"`
	CreatedAt   string `json:"createdAt"`
}

// ListOrders retrieves orders/assets.
func (s *AdminStore) ListOrders(ctx context.Context) ([]Order, error) {
	// invest_orders.user_id is text (not uuid), so the email join compares
	// auth.users.id cast to text rather than casting the order's id to uuid —
	// a non-uuid value there would abort the whole query.
	rows, err := s.db.Query(ctx, `
		SELECT
			o.id,
			o.user_id,
			COALESCE((SELECT u.email FROM auth.users u WHERE u.id::text = o.user_id), '') as email,
			o.kind,
			o.amount_kobo,
			o.status,
			o.side,
			o.symbol,
			o.provider_ref,
			o.created_at::text
		FROM (`+tradingOrdersSQL+`) o
		WHERE o.created_at > NOW() - INTERVAL '30 days'
		ORDER BY o.created_at DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, fmt.Errorf("query orders: %w", err)
	}
	defer rows.Close()

	var orders []Order
	for rows.Next() {
		var o Order
		if err := rows.Scan(&o.ID, &o.UserID, &o.Email, &o.Type, &o.Amount,
			&o.Status, &o.Side, &o.Symbol, &o.ProviderRef, &o.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan order: %w", err)
		}
		orders = append(orders, o)
	}

	return orders, rows.Err()
}

// Withdrawal represents a withdrawal request for admin view.
type Withdrawal struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	Email     string `json:"email"`
	Amount    int64  `json:"amount"`
	Status    string `json:"status"`
	Bank      string `json:"bank"`
	Account   string `json:"account"`
	CreatedAt string `json:"createdAt"`
}

// ListWithdrawals retrieves pending/recent withdrawals.
func (s *AdminStore) ListWithdrawals(ctx context.Context) ([]Withdrawal, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			id,
			user_id,
			COALESCE((SELECT email FROM auth.users WHERE id = payouts.user_id), '') as email,
			amount_kobo,
			status,
			COALESCE(bank_name, 'N/A') as bank,
			COALESCE(account_number, 'N/A') as account,
			created_at::text
		FROM payouts
		WHERE status IN ('pending', 'processing', 'failed')
		   OR created_at > NOW() - INTERVAL '7 days'
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query withdrawals: %w", err)
	}
	defer rows.Close()

	var withdrawals []Withdrawal
	for rows.Next() {
		var w Withdrawal
		if err := rows.Scan(&w.ID, &w.UserID, &w.Email, &w.Amount, &w.Status,
			&w.Bank, &w.Account, &w.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan withdrawal: %w", err)
		}
		withdrawals = append(withdrawals, w)
	}

	return withdrawals, rows.Err()
}

// AuditLog represents a single audit event.
type AuditLog struct {
	ID           string `json:"id"`
	UserID       string `json:"userId"`
	Action       string `json:"action"`
	Module       string `json:"module"`
	ResourceID   string `json:"resourceId"`
	OldValues    map[string]interface{} `json:"oldValues"`
	NewValues    map[string]interface{} `json:"newValues"`
	Timestamp    string `json:"timestamp"`
	Severity     string `json:"severity"`
}

// ListAuditLogs retrieves recent audit events.
func (s *AdminStore) ListAuditLogs(ctx context.Context, limit int) ([]AuditLog, error) {
	// actor_user_id and resource_id are both nullable (system-generated events
	// have no actor); a NULL scanned into a string field errors out and would
	// 500 the whole audit read.
	rows, err := s.db.Query(ctx, `
		SELECT
			id,
			COALESCE(actor_user_id::text, '') as actor_user_id,
			action,
			module,
			COALESCE(resource_id, '') as resource_id,
			old_values,
			new_values,
			created_at::text,
			severity
		FROM audit_logs
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("query audit logs: %w", err)
	}
	defer rows.Close()

	var logs []AuditLog
	for rows.Next() {
		var log AuditLog
		if err := rows.Scan(&log.ID, &log.UserID, &log.Action, &log.Module,
			&log.ResourceID, &log.OldValues, &log.NewValues, &log.Timestamp, &log.Severity); err != nil {
			return nil, fmt.Errorf("scan audit log: %w", err)
		}
		logs = append(logs, log)
	}

	return logs, rows.Err()
}

// FeesReport represents fees collected.
type FeesReport struct {
	Date         string `json:"date"`
	TotalFees    int64  `json:"totalFees"`
	Transactions int64  `json:"transactions"`
	AverageFee   int64  `json:"averageFee"`
}

// GetFeesReport retrieves fee aggregates by day.
func (s *AdminStore) GetFeesReport(ctx context.Context) ([]FeesReport, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			DATE(created_at)::text as date,
			COALESCE(SUM(amount_kobo), 0) as total_fees,
			COUNT(*) as transactions,
			COALESCE(AVG(amount_kobo), 0)::bigint as average_fee
		FROM ledger_entries
		WHERE type = 'CREDIT'
		  AND account_id IN (SELECT id FROM ledger_accounts WHERE type = 'paymax_revenue')
		  AND created_at > NOW() - INTERVAL '30 days'
		GROUP BY DATE(created_at)
		ORDER BY date DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query fees report: %w", err)
	}
	defer rows.Close()

	var report []FeesReport
	for rows.Next() {
		var r FeesReport
		if err := rows.Scan(&r.Date, &r.TotalFees, &r.Transactions, &r.AverageFee); err != nil {
			return nil, fmt.Errorf("scan fees report: %w", err)
		}
		report = append(report, r)
	}

	return report, rows.Err()
}

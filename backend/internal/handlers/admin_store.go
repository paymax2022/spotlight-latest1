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
	row := s.db.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM auth.users) as total_users,
			(SELECT COUNT(*) FROM kyc_profiles WHERE tier = 0) as kyc_pending,
			(SELECT COUNT(*) FROM orders WHERE status = 'active') as active_orders,
			(SELECT COALESCE(SUM(amount_kobo), 0) FROM ledger_entries
			 WHERE type = 'DEBIT' AND created_at > NOW() - INTERVAL '24 hours') as total_volume,
			(SELECT COALESCE(AVG(amount_kobo), 0) FROM orders
			 WHERE created_at > NOW() - INTERVAL '24 hours') as avg_order_value,
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

	// Get paginated results
	rows, err := s.db.Query(ctx, `
		SELECT
			u.id,
			u.email,
			COALESCE(p.name, '') as name,
			COALESCE(p.phone, '') as phone,
			COALESCE(k.tier, 0) as tier,
			u.user_metadata->>'status' as status,
			u.created_at::text,
			COALESCE(u.last_sign_in_at::text, '') as last_login
		FROM auth.users u
		LEFT JOIN profiles p ON u.id = p.user_id
		LEFT JOIN kyc_profiles k ON u.id = k.user_id
		ORDER BY u.created_at DESC
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
func (s *AdminStore) GetKYCQueue(ctx context.Context) ([]KYCEntry, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			k.id,
			k.user_id,
			u.email,
			COALESCE(p.name, 'Unknown') as name,
			CASE k.tier
				WHEN 1 THEN 'pending_tier1'
				WHEN 2 THEN 'pending_tier2'
				WHEN 3 THEN 'pending_tier3'
				ELSE 'unknown'
			END as status,
			k.tier,
			COALESCE(k.document_type, '') as document,
			k.created_at::text
		FROM kyc_profiles k
		JOIN auth.users u ON k.user_id = u.id
		LEFT JOIN profiles p ON k.user_id = p.user_id
		WHERE k.status = 'pending'
		ORDER BY k.created_at ASC
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
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	Email     string `json:"email"`
	Type      string `json:"type"`
	Amount    int64  `json:"amount"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

// ListOrders retrieves orders/assets.
func (s *AdminStore) ListOrders(ctx context.Context) ([]Order, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			id,
			user_id,
			(SELECT email FROM auth.users WHERE id = orders.user_id) as email,
			order_type,
			amount_kobo,
			status,
			created_at::text
		FROM orders
		WHERE created_at > NOW() - INTERVAL '30 days'
		ORDER BY created_at DESC
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
			&o.Status, &o.CreatedAt); err != nil {
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
			(SELECT email FROM auth.users WHERE id = payouts.user_id) as email,
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
	rows, err := s.db.Query(ctx, `
		SELECT
			id,
			actor_user_id,
			action,
			module,
			resource_id,
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

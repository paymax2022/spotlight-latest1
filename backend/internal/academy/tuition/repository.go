package tuition

// repository.go is the ONLY file in this package that talks to Postgres. It reads
// and writes the REAL academy tables created across many migrations (see
// supabase/migrations/20260405400000_audition_academy_media.sql,
// 20260603000000_academy_installment_payments.sql,
// 20260603100000_academy_batch_fee_config.sql,
// 20260603200000_academy_payment_preference.sql,
// 20261220000000_academy_application_tuition_total.sql,
// 20270210000000_academy_installment_plan_completed_at.sql):
//
//   academy_batches               (training_fee_ngn, installments_count, fee_frequency,
//                                   one_off_discount_pct, fee_start_offset_days, status)
//   academy_applications          (user_id, batch_id, tuition_total_ngn, application_fee_paid,
//                                   payment_preference, payment_status)
//   academy_installment_plans     (application_id, batch_id, total_amount_ngn, installments_count,
//                                   frequency, status, plan_type, discounted_amount_ngn, completed_at)
//   academy_installment_payments  (plan_id, installment_number, amount_ngn, due_date, paid_at,
//                                   payment_reference, status)
//
// Neither installment_plans nor installment_payments has a user_id column — ownership is
// resolved by joining through academy_applications. Money columns are NUMERIC(12,2) in
// Postgres but always hold whole-naira values by business rule, so every read casts to
// ::bigint and every write passes an int64 naira value directly (Postgres accepts an
// integer into a NUMERIC column exactly).
//
// Access is via the pgx pool, never the Supabase REST client. All monetary amounts in Go
// are whole NAIRA (int64), never kobo or floats.

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a requested row does not exist. Handlers map it to 404.
var ErrNotFound = errors.New("tuition: not found")

// pgUniqueViolation is Postgres's unique_violation SQLSTATE. Used to detect
// idempotency-key collisions on replay.
const pgUniqueViolation = "23505"

// isUniqueViolation reports whether err is a Postgres unique-constraint failure.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation
}

// Repository owns all academy tuition table access.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the repository over the pgx pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// GetBatch retrieves a batch by ID.
func (r *Repository) GetBatch(ctx context.Context, batchID string) (*Batch, error) {
	row := r.db.QueryRow(ctx, `
		SELECT id, COALESCE(training_fee_ngn, 0)::bigint, COALESCE(installments_count, 1),
		       COALESCE(fee_frequency, 'monthly'), COALESCE(one_off_discount_pct, 0)::int,
		       status::text, created_at
		FROM academy_batches
		WHERE id = $1
	`, batchID)

	var b Batch
	err := row.Scan(&b.ID, &b.FeeNGN, &b.InstallmentsCount, &b.FeeFrequency,
		&b.DiscountPct, &b.Status, &b.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// BatchFeeStartOffsetDays returns the batch's fee_start_offset_days (days after
// approval before the first installment is due). Separate from GetBatch since
// Batch (Phase 0 domain type) doesn't carry this field.
func (r *Repository) BatchFeeStartOffsetDays(ctx context.Context, batchID string) (int, error) {
	var days int
	err := r.db.QueryRow(ctx,
		`SELECT COALESCE(fee_start_offset_days, 0) FROM academy_batches WHERE id = $1`,
		batchID).Scan(&days)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return days, err
}

// GetApplication retrieves an application by ID.
func (r *Repository) GetApplication(ctx context.Context, appID string) (*Application, error) {
	row := r.db.QueryRow(ctx, `
		SELECT id, user_id, batch_id, COALESCE(tuition_total_ngn, 0)::bigint,
		       (COALESCE(application_fee_paid, 0) > 0), COALESCE(payment_preference, 'installment'),
		       COALESCE(payment_status, 'pending'), created_at
		FROM academy_applications
		WHERE id = $1
	`, appID)

	var a Application
	err := row.Scan(&a.ID, &a.UserID, &a.BatchID, &a.TuitionTotalNGN, &a.ApplicationFeePaid,
		&a.PaymentPreference, &a.PaymentStatus, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// GetApplicationByUserAndBatch retrieves an application for a specific user and batch.
func (r *Repository) GetApplicationByUserAndBatch(ctx context.Context, userID, batchID string) (*Application, error) {
	row := r.db.QueryRow(ctx, `
		SELECT id, user_id, batch_id, COALESCE(tuition_total_ngn, 0)::bigint,
		       (COALESCE(application_fee_paid, 0) > 0), COALESCE(payment_preference, 'installment'),
		       COALESCE(payment_status, 'pending'), created_at
		FROM academy_applications
		WHERE user_id = $1 AND batch_id = $2
	`, userID, batchID)

	var a Application
	err := row.Scan(&a.ID, &a.UserID, &a.BatchID, &a.TuitionTotalNGN, &a.ApplicationFeePaid,
		&a.PaymentPreference, &a.PaymentStatus, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// GetInstallmentPlan retrieves a plan by ID. UserID is resolved via the owning application.
func (r *Repository) GetInstallmentPlan(ctx context.Context, planID string) (*InstallmentPlan, error) {
	row := r.db.QueryRow(ctx, `
		SELECT p.id, p.application_id, a.user_id, p.total_amount_ngn::bigint,
		       COALESCE(p.discounted_amount_ngn, p.total_amount_ngn)::bigint,
		       p.installments_count, p.frequency, p.status, p.created_at, p.completed_at
		FROM academy_installment_plans p
		JOIN academy_applications a ON a.id = p.application_id
		WHERE p.id = $1
	`, planID)

	var p InstallmentPlan
	var completedAt *time.Time
	err := row.Scan(&p.ID, &p.ApplicationID, &p.UserID, &p.TotalAmountNGN, &p.DiscountedAmountNGN,
		&p.InstallmentsCount, &p.Frequency, &p.Status, &p.CreatedAt, &completedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.CompletedAt = completedAt
	return &p, nil
}

// GetPlanByApplicationID retrieves the active plan for an application (one plan
// per application — enforced by a UNIQUE constraint on application_id).
func (r *Repository) GetPlanByApplicationID(ctx context.Context, appID string) (*InstallmentPlan, error) {
	row := r.db.QueryRow(ctx, `
		SELECT p.id, p.application_id, a.user_id, p.total_amount_ngn::bigint,
		       COALESCE(p.discounted_amount_ngn, p.total_amount_ngn)::bigint,
		       p.installments_count, p.frequency, p.status, p.created_at, p.completed_at
		FROM academy_installment_plans p
		JOIN academy_applications a ON a.id = p.application_id
		WHERE p.application_id = $1
	`, appID)

	var p InstallmentPlan
	var completedAt *time.Time
	err := row.Scan(&p.ID, &p.ApplicationID, &p.UserID, &p.TotalAmountNGN, &p.DiscountedAmountNGN,
		&p.InstallmentsCount, &p.Frequency, &p.Status, &p.CreatedAt, &completedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.CompletedAt = completedAt
	return &p, nil
}

// CreateInstallmentPlan inserts a new plan (and its full payment schedule, in the
// same transaction) and returns the created plan. batchID is required by the
// schema's NOT NULL-adjacent FK; planType is "one_off" or "installment".
func (r *Repository) CreateInstallmentPlan(ctx context.Context, appID, batchID string,
	totalNaira, discountedNaira int64, count int32, frequency, planType string) (*InstallmentPlan, error) {
	if !IsValidFrequency(frequency) {
		return nil, ErrInvalidFrequency
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	row := tx.QueryRow(ctx, `
		INSERT INTO academy_installment_plans
		(application_id, batch_id, total_amount_ngn, discounted_amount_ngn, installments_count,
		 frequency, status, plan_type, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
		RETURNING id, application_id, total_amount_ngn::bigint, discounted_amount_ngn::bigint,
		          installments_count, frequency, status, created_at, completed_at
	`, appID, batchID, totalNaira, discountedNaira, count, frequency, PlanStatusActive, planType)

	var p InstallmentPlan
	var completedAt *time.Time
	if err := row.Scan(&p.ID, &p.ApplicationID, &p.TotalAmountNGN, &p.DiscountedAmountNGN,
		&p.InstallmentsCount, &p.Frequency, &p.Status, &p.CreatedAt, &completedAt); err != nil {
		return nil, err
	}
	p.CompletedAt = completedAt

	// Generate the full payment schedule now, inside the same transaction as plan
	// creation, so a plan can never exist with zero or partial installment rows.
	amountPerInstallment, err := CalculateInstallmentAmount(discountedNaira, count)
	if err != nil {
		return nil, err
	}
	startDate := time.Now()
	for i := int32(0); i < count; i++ {
		dueDate := CalculateDueDate(startDate, i, frequency)
		amount := amountPerInstallment
		if i == count-1 {
			// Remainder (from integer division) goes to the last installment.
			amount = discountedNaira - amountPerInstallment*int64(count-1)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO academy_installment_payments
			(plan_id, installment_number, amount_ngn, due_date, status, created_at)
			VALUES ($1, $2, $3, $4, $5, NOW())
		`, p.ID, i+1, amount, dueDate, PaymentStatusPending); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &p, nil
}

// ListInstallmentPayments retrieves all payments for a plan, ordered by installment_number.
// UserID is resolved via the plan's owning application.
func (r *Repository) ListInstallmentPayments(ctx context.Context, planID string) ([]InstallmentPayment, error) {
	rows, err := r.db.Query(ctx, `
		SELECT ip.id, ip.plan_id, a.user_id, ip.amount_ngn::bigint, ip.due_date, ip.status,
		       ip.payment_reference, ip.paid_at, ip.created_at
		FROM academy_installment_payments ip
		JOIN academy_installment_plans p ON p.id = ip.plan_id
		JOIN academy_applications a ON a.id = p.application_id
		WHERE ip.plan_id = $1
		ORDER BY ip.installment_number ASC
	`, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var payments []InstallmentPayment
	for rows.Next() {
		var p InstallmentPayment
		var ref *string
		var paidAt *time.Time
		err := rows.Scan(&p.ID, &p.InstallmentPlanID, &p.UserID, &p.AmountNGN, &p.DueDate,
			&p.Status, &ref, &paidAt, &p.CreatedAt)
		if err != nil {
			return nil, err
		}
		p.PaymentReference = ref
		p.PaidAt = paidAt
		payments = append(payments, p)
	}
	return payments, rows.Err()
}

// GetPaymentByID retrieves a single payment. UserID is resolved via the plan's
// owning application.
func (r *Repository) GetPaymentByID(ctx context.Context, paymentID string) (*InstallmentPayment, error) {
	row := r.db.QueryRow(ctx, `
		SELECT ip.id, ip.plan_id, a.user_id, ip.amount_ngn::bigint, ip.due_date, ip.status,
		       ip.payment_reference, ip.paid_at, ip.created_at
		FROM academy_installment_payments ip
		JOIN academy_installment_plans p ON p.id = ip.plan_id
		JOIN academy_applications a ON a.id = p.application_id
		WHERE ip.id = $1
	`, paymentID)

	var p InstallmentPayment
	var ref *string
	var paidAt *time.Time
	err := row.Scan(&p.ID, &p.InstallmentPlanID, &p.UserID, &p.AmountNGN, &p.DueDate,
		&p.Status, &ref, &paidAt, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.PaymentReference = ref
	p.PaidAt = paidAt
	return &p, nil
}

// RecordPaymentWithReference marks a payment paid with a ledger reference.
//
// LAYER 2 IDEMPOTENCY: the UPDATE is conditioned on status = 'pending', so a
// replayed call (Redis claim lost, retried request) that reaches this after the
// first call already succeeded affects zero rows instead of double-posting. The
// caller (service.go) checks RowsAffected: 0 rows means "already processed" and
// re-fetches the existing (now-paid) row rather than treating it as failure.
func (r *Repository) RecordPaymentWithReference(ctx context.Context, paymentID string,
	paidAtTime time.Time, ledgerRef string) (applied bool, err error) {
	result, err := r.db.Exec(ctx, `
		UPDATE academy_installment_payments
		SET status = $1, paid_at = $2, payment_reference = $3, updated_at = NOW()
		WHERE id = $4 AND status = $5
	`, PaymentStatusPaid, paidAtTime, ledgerRef, paymentID, PaymentStatusPending)
	if err != nil {
		if isUniqueViolation(err) {
			return false, nil
		}
		return false, err
	}
	return result.RowsAffected() > 0, nil
}

// WaivePayment updates the status of a payment to 'waived'. Only a pending or
// overdue payment can be waived (guarded by the caller via IsTerminalStatus).
func (r *Repository) WaivePayment(ctx context.Context, paymentID string) error {
	result, err := r.db.Exec(ctx, `
		UPDATE academy_installment_payments
		SET status = $1, updated_at = NOW()
		WHERE id = $2
	`, PaymentStatusWaived, paymentID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkPlanCompleted updates a plan status to 'completed'.
func (r *Repository) MarkPlanCompleted(ctx context.Context, planID string) error {
	result, err := r.db.Exec(ctx, `
		UPDATE academy_installment_plans
		SET status = $1, completed_at = NOW(), updated_at = NOW()
		WHERE id = $2
	`, PlanStatusCompleted, planID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// IsPaymentReferenceUsed reports whether reference already settles a DIFFERENT
// installment than excludePaymentID. Guards against a reference being replayed
// across installments (e.g. a small charge's reference reused against a larger one).
func (r *Repository) IsPaymentReferenceUsed(ctx context.Context, reference, excludePaymentID string) (bool, error) {
	var id string
	err := r.db.QueryRow(ctx,
		`SELECT id FROM academy_installment_payments WHERE payment_reference = $1 LIMIT 1`,
		reference).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return id != excludePaymentID, nil
}

// UpdateApplicationPaymentStatus updates the payment_status of an application.
func (r *Repository) UpdateApplicationPaymentStatus(ctx context.Context, appID, status string) error {
	result, err := r.db.Exec(ctx, `
		UPDATE academy_applications
		SET payment_status = $1, updated_at = NOW()
		WHERE id = $2
	`, status, appID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

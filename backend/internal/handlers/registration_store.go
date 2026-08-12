package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RegistrationStore provides data access for contest registration.
type RegistrationStore struct {
	db *pgxpool.Pool
}

// NewRegistrationStore creates a new registration store.
func NewRegistrationStore(db *pgxpool.Pool) *RegistrationStore {
	return &RegistrationStore{db: db}
}

// Contest represents a contest for registration.
type Contest struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	Slug                string `json:"slug"`
	Description         string `json:"description"`
	Category            string `json:"category"`
	RegistrationFeeNgn  int64  `json:"registrationFeeNgn"`
	IsPaid              bool   `json:"isPaid"`
	StartDate           string `json:"startDate"`
	EndDate             string `json:"endDate"`
	MaxParticipants     int64  `json:"maxParticipants"`
	RegisteredCount     int64  `json:"registeredCount"`
}

// ListContests retrieves all contests available for registration.
func (s *RegistrationStore) ListContests(ctx context.Context) ([]Contest, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			id,
			title,
			slug,
			COALESCE(description, '') as description,
			COALESCE(category, '') as category,
			COALESCE(registration_fee_ngn, 0) as registration_fee_ngn,
			COALESCE(is_paid, false) as is_paid,
			start_date::text,
			end_date::text,
			COALESCE(max_participants, 0) as max_participants,
			(SELECT COUNT(*) FROM registrations WHERE contest_slug = contests.slug AND status != 'withdrawn') as registered_count
		FROM contests
		WHERE is_active = true
		ORDER BY start_date DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query contests: %w", err)
	}
	defer rows.Close()

	var contests []Contest
	for rows.Next() {
		var c Contest
		if err := rows.Scan(&c.ID, &c.Title, &c.Slug, &c.Description, &c.Category,
			&c.RegistrationFeeNgn, &c.IsPaid, &c.StartDate, &c.EndDate,
			&c.MaxParticipants, &c.RegisteredCount); err != nil {
			return nil, fmt.Errorf("scan contest: %w", err)
		}
		contests = append(contests, c)
	}

	return contests, rows.Err()
}

// Application represents a contest application.
type Application struct {
	ID               string                 `json:"id"`
	Reference        string                 `json:"reference"`
	ContestSlug      string                 `json:"contestSlug"`
	Status           string                 `json:"status"`
	Role             string                 `json:"role"`
	CreatedAt        string                 `json:"createdAt"`
	UpdatedAt        string                 `json:"updatedAt"`
	SubmittedAt      sql.NullString         `json:"submittedAt"`
	CompletionPercent int                   `json:"completionPercent"`
	CurrentStep      string                 `json:"currentStep"`
	FraudFlags       []string               `json:"fraudFlags"`
	FormData         map[string]interface{} `json:"formData"`
}

// ListApplications retrieves user's applications (paginated).
func (s *RegistrationStore) ListApplications(ctx context.Context, userID string, cursor string, limit int) ([]Application, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			id,
			reference,
			contest_slug,
			status,
			COALESCE(role, 'public_user') as role,
			created_at::text,
			updated_at::text,
			submitted_at::text,
			COALESCE(completion_percent, 0) as completion_percent,
			COALESCE(current_step, '') as current_step,
			COALESCE(fraud_flags, '[]'::jsonb) as fraud_flags,
			COALESCE(form_data, '{}'::jsonb) as form_data
		FROM registrations
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("query applications: %w", err)
	}
	defer rows.Close()

	var applications []Application
	for rows.Next() {
		var app Application
		var fraudFlagsJSON []byte
		var formDataJSON []byte

		if err := rows.Scan(&app.ID, &app.Reference, &app.ContestSlug, &app.Status, &app.Role,
			&app.CreatedAt, &app.UpdatedAt, &app.SubmittedAt, &app.CompletionPercent,
			&app.CurrentStep, &fraudFlagsJSON, &formDataJSON); err != nil {
			return nil, fmt.Errorf("scan application: %w", err)
		}

		if err := json.Unmarshal(fraudFlagsJSON, &app.FraudFlags); err != nil {
			app.FraudFlags = []string{}
		}
		if err := json.Unmarshal(formDataJSON, &app.FormData); err != nil {
			app.FormData = make(map[string]interface{})
		}

		applications = append(applications, app)
	}

	return applications, rows.Err()
}

// CreateApplication creates a new draft application.
func (s *RegistrationStore) CreateApplication(ctx context.Context, userID string, contestSlug string, reference string) (*Application, error) {
	now := time.Now().UTC()

	row := s.db.QueryRow(ctx, `
		INSERT INTO registrations (
			id, user_id, contest_slug, reference, status, role,
			form_data, current_step, completion_percent, fraud_flags,
			created_at, updated_at
		) VALUES (
			gen_random_uuid(), $1, $2, $3, 'draft', 'public_user',
			'{}'::jsonb, 'contest_selection', 0, '[]'::jsonb,
			$4, $4
		)
		RETURNING id, reference, contest_slug, status, role,
		          created_at::text, updated_at::text, completion_percent,
		          current_step, fraud_flags, form_data
	`, userID, contestSlug, reference, now)

	var app Application
	var fraudFlagsJSON []byte
	var formDataJSON []byte

	err := row.Scan(&app.ID, &app.Reference, &app.ContestSlug, &app.Status, &app.Role,
		&app.CreatedAt, &app.UpdatedAt, &app.CompletionPercent, &app.CurrentStep,
		&fraudFlagsJSON, &formDataJSON)
	if err != nil {
		return nil, fmt.Errorf("insert application: %w", err)
	}

	if err := json.Unmarshal(fraudFlagsJSON, &app.FraudFlags); err != nil {
		app.FraudFlags = []string{}
	}
	if err := json.Unmarshal(formDataJSON, &app.FormData); err != nil {
		app.FormData = make(map[string]interface{})
	}

	return &app, nil
}

// GetApplication retrieves a single application by ID.
func (s *RegistrationStore) GetApplication(ctx context.Context, userID string, appID string) (*Application, error) {
	row := s.db.QueryRow(ctx, `
		SELECT
			id, reference, contest_slug, status, role,
			created_at::text, updated_at::text, completion_percent,
			current_step, fraud_flags, form_data
		FROM registrations
		WHERE id = $1 AND user_id = $2
	`, appID, userID)

	var app Application
	var fraudFlagsJSON []byte
	var formDataJSON []byte

	err := row.Scan(&app.ID, &app.Reference, &app.ContestSlug, &app.Status, &app.Role,
		&app.CreatedAt, &app.UpdatedAt, &app.CompletionPercent, &app.CurrentStep,
		&fraudFlagsJSON, &formDataJSON)
	if err == sql.ErrNoRows {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("query application: %w", err)
	}

	if err := json.Unmarshal(fraudFlagsJSON, &app.FraudFlags); err != nil {
		app.FraudFlags = []string{}
	}
	if err := json.Unmarshal(formDataJSON, &app.FormData); err != nil {
		app.FormData = make(map[string]interface{})
	}

	return &app, nil
}

// SaveStep updates form_data and step progress.
func (s *RegistrationStore) SaveStep(ctx context.Context, userID string, appID string, stepKey string, values map[string]interface{}, newPercent int) (*Application, error) {
	// Merge new values into form_data
	row := s.db.QueryRow(ctx, `
		UPDATE registrations
		SET
			form_data = form_data || $1::jsonb,
			current_step = $2,
			completion_percent = $3,
			updated_at = NOW()
		WHERE id = $4 AND user_id = $5
		RETURNING id, reference, contest_slug, status, role,
		          created_at::text, updated_at::text, completion_percent,
		          current_step, fraud_flags, form_data
	`, json.RawMessage(mustMarshal(values)), stepKey, newPercent, appID, userID)

	var app Application
	var fraudFlagsJSON []byte
	var formDataJSON []byte

	err := row.Scan(&app.ID, &app.Reference, &app.ContestSlug, &app.Status, &app.Role,
		&app.CreatedAt, &app.UpdatedAt, &app.CompletionPercent, &app.CurrentStep,
		&fraudFlagsJSON, &formDataJSON)
	if err != nil {
		return nil, fmt.Errorf("update step: %w", err)
	}

	if err := json.Unmarshal(fraudFlagsJSON, &app.FraudFlags); err != nil {
		app.FraudFlags = []string{}
	}
	if err := json.Unmarshal(formDataJSON, &app.FormData); err != nil {
		app.FormData = make(map[string]interface{})
	}

	return &app, nil
}

// SubmitApplication updates status to 'submitted'.
func (s *RegistrationStore) SubmitApplication(ctx context.Context, userID string, appID string) (*Application, error) {
	row := s.db.QueryRow(ctx, `
		UPDATE registrations
		SET
			status = 'submitted',
			submitted_at = NOW(),
			updated_at = NOW()
		WHERE id = $1 AND user_id = $2
		RETURNING id, reference, contest_slug, status, role,
		          created_at::text, updated_at::text, submitted_at::text,
		          completion_percent, current_step, fraud_flags, form_data
	`, appID, userID)

	var app Application
	var fraudFlagsJSON []byte
	var formDataJSON []byte

	err := row.Scan(&app.ID, &app.Reference, &app.ContestSlug, &app.Status, &app.Role,
		&app.CreatedAt, &app.UpdatedAt, &app.SubmittedAt, &app.CompletionPercent,
		&app.CurrentStep, &fraudFlagsJSON, &formDataJSON)
	if err != nil {
		return nil, fmt.Errorf("submit application: %w", err)
	}

	if err := json.Unmarshal(fraudFlagsJSON, &app.FraudFlags); err != nil {
		app.FraudFlags = []string{}
	}
	if err := json.Unmarshal(formDataJSON, &app.FormData); err != nil {
		app.FormData = make(map[string]interface{})
	}

	return &app, nil
}

// WithdrawApplication updates status to 'withdrawn'.
func (s *RegistrationStore) WithdrawApplication(ctx context.Context, userID string, appID string, note string) (*Application, error) {
	row := s.db.QueryRow(ctx, `
		UPDATE registrations
		SET
			status = 'withdrawn',
			form_data = form_data || jsonb_build_object('withdrawal_note', $1::text),
			withdrawn_at = NOW(),
			updated_at = NOW()
		WHERE id = $2 AND user_id = $3
		RETURNING id, reference, contest_slug, status, role,
		          created_at::text, updated_at::text, completion_percent,
		          current_step, fraud_flags, form_data
	`, note, appID, userID)

	var app Application
	var fraudFlagsJSON []byte
	var formDataJSON []byte

	err := row.Scan(&app.ID, &app.Reference, &app.ContestSlug, &app.Status, &app.Role,
		&app.CreatedAt, &app.UpdatedAt, &app.CompletionPercent, &app.CurrentStep,
		&fraudFlagsJSON, &formDataJSON)
	if err != nil {
		return nil, fmt.Errorf("withdraw application: %w", err)
	}

	if err := json.Unmarshal(fraudFlagsJSON, &app.FraudFlags); err != nil {
		app.FraudFlags = []string{}
	}
	if err := json.Unmarshal(formDataJSON, &app.FormData); err != nil {
		app.FormData = make(map[string]interface{})
	}

	return &app, nil
}

// StatusEvent represents a status change in the timeline.
type StatusEvent struct {
	ID            string `json:"id"`
	ApplicationID string `json:"applicationId"`
	OldStatus     string `json:"oldStatus"`
	NewStatus     string `json:"newStatus"`
	Note          string `json:"note"`
	ActorRole     string `json:"actorRole"`
	CreatedAt     string `json:"createdAt"`
}

// GetStatusTimeline retrieves the timeline of status changes for an application.
func (s *RegistrationStore) GetStatusTimeline(ctx context.Context, userID string, appID string) ([]StatusEvent, error) {
	// First verify user owns the application
	var owned bool
	err := s.db.QueryRow(ctx, "SELECT true FROM registrations WHERE id = $1 AND user_id = $2", appID, userID).Scan(&owned)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("application not found")
	}
	if err != nil {
		return nil, fmt.Errorf("verify ownership: %w", err)
	}

	rows, err := s.db.Query(ctx, `
		SELECT
			id, registration_id, old_status, new_status,
			COALESCE(note, '') as note, COALESCE(actor_role, '') as actor_role,
			created_at::text
		FROM registration_status_events
		WHERE registration_id = $1
		ORDER BY created_at ASC
	`, appID)
	if err != nil {
		return nil, fmt.Errorf("query timeline: %w", err)
	}
	defer rows.Close()

	var events []StatusEvent
	for rows.Next() {
		var e StatusEvent
		if err := rows.Scan(&e.ID, &e.ApplicationID, &e.OldStatus, &e.NewStatus,
			&e.Note, &e.ActorRole, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		events = append(events, e)
	}

	return events, rows.Err()
}

// RecordStatusChange records a status change event in the audit trail.
func (s *RegistrationStore) RecordStatusChange(ctx context.Context, appID string, oldStatus string, newStatus string, note string, actorRole string) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO registration_status_events (
			id, registration_id, old_status, new_status, note, actor_role, created_at
		) VALUES (
			gen_random_uuid(), $1, $2, $3, $4, $5, NOW()
		)
	`, appID, oldStatus, newStatus, note, actorRole)
	if err != nil {
		return fmt.Errorf("record status change: %w", err)
	}
	return nil
}

// PaymentTransaction represents a payment for an application.
type PaymentTransaction struct {
	ID                 string `json:"id"`
	ApplicationID      string `json:"applicationId"`
	Reference          string `json:"reference"`
	Amount             int64  `json:"amount"`
	Currency           string `json:"currency"`
	Method             string `json:"method"`
	PaystackReference  string `json:"paystackReference"`
	Status             string `json:"status"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

// CreatePaymentTransaction records a payment attempt.
func (s *RegistrationStore) CreatePaymentTransaction(ctx context.Context, appID string, reference string, amount int64, method string, idemKey string) (*PaymentTransaction, error) {
	row := s.db.QueryRow(ctx, `
		INSERT INTO registration_payment_intents (
			id, application_id, reference, amount_kobo, method,
			idempotency_key, status, created_at, updated_at
		) VALUES (
			gen_random_uuid(), $1, $2, $3, $4, $5, 'initiated', NOW(), NOW()
		)
		RETURNING id, application_id, reference, amount_kobo, 'NGN' as currency,
		          method, COALESCE(paystack_reference, '') as paystack_reference,
		          status, created_at::text, updated_at::text
	`, appID, reference, amount, method, idemKey)

	var pt PaymentTransaction
	err := row.Scan(&pt.ID, &pt.ApplicationID, &pt.Reference, &pt.Amount, &pt.Currency,
		&pt.Method, &pt.PaystackReference, &pt.Status, &pt.CreatedAt, &pt.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create payment: %w", err)
	}

	return &pt, nil
}

// UpdatePaymentStatus updates payment status after verification.
func (s *RegistrationStore) UpdatePaymentStatus(ctx context.Context, appID string, reference string, status string, paystackRef string) error {
	_, err := s.db.Exec(ctx, `
		UPDATE registration_payment_intents
		SET
			status = $1,
			paystack_reference = COALESCE(NULLIF($2, ''), paystack_reference),
			updated_at = NOW()
		WHERE application_id = $3 AND reference = $4
	`, status, paystackRef, appID, reference)
	if err != nil {
		return fmt.Errorf("update payment status: %w", err)
	}
	return nil
}

// Helper to marshal to JSON bytes
func mustMarshal(v interface{}) []byte {
	b, _ := json.Marshal(v)
	return b
}

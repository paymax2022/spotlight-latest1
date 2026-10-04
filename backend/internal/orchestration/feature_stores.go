package orchestration

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

// collection_store.go — read path for the FX collections / virtual-accounts
// vertical (mobile src/features/fx/api/fx.api.ts getVirtualAccounts/getCollections).
// Virtual accounts already PERSIST to orch_collections (repository.go
// SaveCollection, written by the real CreateCollection handler). This store adds
// the object-scoped LIST reads. No new table is
// created for virtual accounts — we reuse orch_collections, which keys on
// customer_id (= the business/tenant id, the authenticated customer).
// Collection EVENTS (inbound credits into a virtual account) persist to
// orch_collection_events, written inside the crediting transaction by
// Store.ApplyCollection (webhooks.go applyCollectionEvent). A row here therefore
// always corresponds to money that actually moved — the feed cannot show a
// deposit the balance does not reflect, or vice versa.
// A nil store makes the handlers fall back to the empty-slice stubs.

// CollectionMoney is the { amount, currency } money object (minor units),
// mirroring the mobile Money shape embedded in a CollectionEvent.
type CollectionMoney struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

// CollectionEvent mirrors the mobile CollectionEvent contract.
type CollectionEvent struct {
	ID               string          `json:"id"`
	VirtualAccountID string          `json:"virtualAccountId"`
	Amount           CollectionMoney `json:"amount"`
	SenderName       *string         `json:"senderName"`
	Reference        *string         `json:"reference"`
	CreatedAt        string          `json:"createdAt"`
}

// CollectionStore reads the collections / virtual-accounts persistence.
type CollectionStore interface {
	ListVirtualAccounts(ctx context.Context, business string) ([]VirtualAccount, error)
	ListCollectionEvents(ctx context.Context, business string) ([]CollectionEvent, error)
}

// sqlCollectionStore is the Postgres-backed implementation.
type sqlCollectionStore struct {
	db *pgxpool.Pool
}

// NewCollectionStore returns a Postgres-backed collections store.
func NewCollectionStore(db *pgxpool.Pool) CollectionStore { return &sqlCollectionStore{db: db} }

// ListVirtualAccounts lists the business's virtual accounts from orch_collections
// (object-scoped by customer_id = business/tenant id).
func (s *sqlCollectionStore) ListVirtualAccounts(ctx context.Context, business string) ([]VirtualAccount, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, currency, type, provider, status, details, created_at
		FROM orch_collections WHERE customer_id=$1
		ORDER BY created_at DESC`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]VirtualAccount, 0)
	for rows.Next() {
		var va VirtualAccount
		var details []byte
		var created time.Time
		if err := rows.Scan(&va.ID, &va.Currency, &va.Type, &va.Provider, &va.Status, &details, &created); err != nil {
			return nil, err
		}
		va.CreatedAt = created
		if len(details) > 0 {
			_ = json.Unmarshal(details, &va.Details)
		}
		if va.Details == nil {
			va.Details = map[string]any{}
		}
		out = append(out, va)
	}
	return out, rows.Err()
}

// ListCollectionEvents returns inbound collection credits. Not yet persisted (no
// provider collection feed wired) → empty non-nil slice so the screen renders.
func (s *sqlCollectionStore) ListCollectionEvents(ctx context.Context, business string) ([]CollectionEvent, error) {
	// id breaks created_at ties so the ordering is total — two deposits landing in
	// the same millisecond must not be able to swap places between reads.
	rows, err := s.db.Query(ctx, `
		SELECT id, virtual_account_id, amount_minor, currency, sender_name, reference, created_at
		FROM orch_collection_events
		WHERE customer_id=$1
		ORDER BY created_at DESC, id DESC`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]CollectionEvent, 0)
	for rows.Next() {
		var e CollectionEvent
		var created time.Time
		if err := rows.Scan(&e.ID, &e.VirtualAccountID, &e.Amount.Amount, &e.Amount.Currency,
			&e.SenderName, &e.Reference, &created); err != nil {
			return nil, err
		}
		e.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, e)
	}
	return out, rows.Err()
}

// secondary_store.go — persistence for the FX "secondary" features that are not
// money-path: saved beneficiaries and rate alerts. Backed by the same pgx pool as
// the orch_* money tables, but these tables hold metadata only (no ledger, no
// balances). AuthZ is enforced by scoping every query on customer_id.
// Requires migration 20260826000000_fx_beneficiaries_rate_alerts.sql.

// SecondaryStore persists beneficiaries + rate alerts. An interface so handlers
// can be unit-tested with an in-memory fake (see secondary_store_test.go); the
// production impl is Postgres-backed. A nil store makes handlers fall back to stubs.
type SecondaryStore interface {
	ListBeneficiaries(ctx context.Context, customer string) ([]Beneficiary, error)
	CreateBeneficiary(ctx context.Context, customer string, b Beneficiary) (Beneficiary, error)
	UpdateBeneficiary(ctx context.Context, customer, id string, b Beneficiary) (Beneficiary, bool, error)
	SetBeneficiaryFavorite(ctx context.Context, customer, id string, favorite bool) error
	DeleteBeneficiary(ctx context.Context, customer, id string) error

	ListRateAlerts(ctx context.Context, customer string) ([]RateAlert, error)
	CreateRateAlert(ctx context.Context, customer string, a RateAlert) (RateAlert, error)
	DeleteRateAlert(ctx context.Context, customer, id string) error
}

// sqlSecondaryStore is the Postgres-backed implementation.
type sqlSecondaryStore struct {
	db *pgxpool.Pool
}

// NewSecondaryStore returns a Postgres-backed secondary store.
func NewSecondaryStore(db *pgxpool.Pool) SecondaryStore { return &sqlSecondaryStore{db: db} }

// Beneficiary mirrors the mobile contract (camelCase JSON) so handlers can return
// records directly. bankName is nullable.
type Beneficiary struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Rail          string  `json:"rail"`
	Scheme        string  `json:"scheme"`
	Currency      string  `json:"currency"`
	AccountNumber string  `json:"accountNumber"`
	BankName      *string `json:"bankName"`
	CountryCode   string  `json:"countryCode"`
	Validated     bool    `json:"validated"`
	Favorite      bool    `json:"favorite"`
	CreatedAt     string  `json:"createdAt"`
}

func (s *sqlSecondaryStore) ListBeneficiaries(ctx context.Context, customer string) ([]Beneficiary, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, name, rail, scheme, currency, account_number, bank_name, country_code, validated, favorite, created_at
		FROM orch_beneficiaries WHERE customer_id=$1
		ORDER BY favorite DESC, created_at DESC`, customer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Beneficiary, 0)
	for rows.Next() {
		var b Beneficiary
		var created time.Time
		if err := rows.Scan(&b.ID, &b.Name, &b.Rail, &b.Scheme, &b.Currency, &b.AccountNumber,
			&b.BankName, &b.CountryCode, &b.Validated, &b.Favorite, &created); err != nil {
			return nil, err
		}
		b.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, b)
	}
	return out, rows.Err()
}

// CreateBeneficiary inserts a new record and returns the persisted row.
func (s *sqlSecondaryStore) CreateBeneficiary(ctx context.Context, customer string, b Beneficiary) (Beneficiary, error) {
	var created time.Time
	err := s.db.QueryRow(ctx, `
		INSERT INTO orch_beneficiaries
			(id, customer_id, name, rail, scheme, currency, account_number, bank_name, country_code, validated, favorite)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING created_at`,
		b.ID, customer, b.Name, b.Rail, b.Scheme, b.Currency, b.AccountNumber, b.BankName, b.CountryCode, b.Validated, b.Favorite,
	).Scan(&created)
	if err != nil {
		return Beneficiary{}, err
	}
	b.CreatedAt = created.UTC().Format(time.RFC3339)
	return b, nil
}

// UpdateBeneficiary edits an existing record (customer-scoped). Returns ok=false
// when the id doesn't belong to the customer.
func (s *sqlSecondaryStore) UpdateBeneficiary(ctx context.Context, customer, id string, b Beneficiary) (Beneficiary, bool, error) {
	var created time.Time
	err := s.db.QueryRow(ctx, `
		UPDATE orch_beneficiaries
		SET name=$3, rail=$4, scheme=$5, currency=$6, account_number=$7, bank_name=$8, country_code=$9, validated=$10, updated_at=now()
		WHERE id=$1 AND customer_id=$2
		RETURNING created_at`,
		id, customer, b.Name, b.Rail, b.Scheme, b.Currency, b.AccountNumber, b.BankName, b.CountryCode, b.Validated,
	).Scan(&created)
	if errors.Is(err, pgx.ErrNoRows) {
		return Beneficiary{}, false, nil
	}
	if err != nil {
		return Beneficiary{}, false, err
	}
	b.ID = id
	b.CreatedAt = created.UTC().Format(time.RFC3339)
	return b, true, nil
}

func (s *sqlSecondaryStore) SetBeneficiaryFavorite(ctx context.Context, customer, id string, favorite bool) error {
	_, err := s.db.Exec(ctx, `UPDATE orch_beneficiaries SET favorite=$3, updated_at=now() WHERE id=$1 AND customer_id=$2`, id, customer, favorite)
	return err
}

func (s *sqlSecondaryStore) DeleteBeneficiary(ctx context.Context, customer, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM orch_beneficiaries WHERE id=$1 AND customer_id=$2`, id, customer)
	return err
}

// RateAlert mirrors the mobile contract. triggeredAt is null until fired.
type RateAlert struct {
	ID          string  `json:"id"`
	Pair        string  `json:"pair"`
	From        string  `json:"from"`
	To          string  `json:"to"`
	Direction   string  `json:"direction"`
	Target      float64 `json:"target"`
	Active      bool    `json:"active"`
	CreatedAt   string  `json:"createdAt"`
	TriggeredAt *string `json:"triggeredAt"`
}

func (s *sqlSecondaryStore) ListRateAlerts(ctx context.Context, customer string) ([]RateAlert, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, pair, from_currency, to_currency, direction, target, active, created_at, triggered_at
		FROM orch_rate_alerts WHERE customer_id=$1 ORDER BY created_at DESC`, customer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RateAlert, 0)
	for rows.Next() {
		var a RateAlert
		var created time.Time
		var triggered *time.Time
		if err := rows.Scan(&a.ID, &a.Pair, &a.From, &a.To, &a.Direction, &a.Target, &a.Active, &created, &triggered); err != nil {
			return nil, err
		}
		a.CreatedAt = created.UTC().Format(time.RFC3339)
		if triggered != nil {
			t := triggered.UTC().Format(time.RFC3339)
			a.TriggeredAt = &t
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *sqlSecondaryStore) CreateRateAlert(ctx context.Context, customer string, a RateAlert) (RateAlert, error) {
	var created time.Time
	err := s.db.QueryRow(ctx, `
		INSERT INTO orch_rate_alerts (id, customer_id, pair, from_currency, to_currency, direction, target, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,true)
		RETURNING created_at`,
		a.ID, customer, a.Pair, a.From, a.To, a.Direction, a.Target,
	).Scan(&created)
	if err != nil {
		return RateAlert{}, err
	}
	a.Active = true
	a.CreatedAt = created.UTC().Format(time.RFC3339)
	return a, nil
}

func (s *sqlSecondaryStore) DeleteRateAlert(ctx context.Context, customer, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM orch_rate_alerts WHERE id=$1 AND customer_id=$2`, id, customer)
	return err
}

// verification_store.go — Postgres persistence for FX customer KYC verification.
// Replaces the stub in handler_stubs.go: submissions are now durably recorded and
// status transitions persist. Customer-scoped (the row key is the authenticated
// customer id). A nil store makes the handlers fall back to the stub so a DB-less
// dev setup still renders.
// Requires migration 20261008000000_fx_customer_verification.sql.

// VerificationRecord mirrors the mobile Verification type (fx.types.ts) — camelCase.
type VerificationRecord struct {
	Status          string  `json:"status"`      // unstarted|pending|review|approved|rejected
	AccountType     string  `json:"accountType"` // individual|business
	Tier            int     `json:"tier"`
	SubmittedAt     *string `json:"submittedAt,omitempty"`
	ReviewedAt      *string `json:"reviewedAt,omitempty"`
	RejectionReason *string `json:"rejectionReason,omitempty"`
}

// defaultVerificationRecord is the "never started" state for a customer with no row.
func defaultVerificationRecord() VerificationRecord {
	return VerificationRecord{Status: "unstarted", AccountType: "individual", Tier: 0}
}

// VerificationStore persists FX customer KYC verification.
type VerificationStore interface {
	Get(ctx context.Context, customerID string) (VerificationRecord, error)
	Submit(ctx context.Context, customerID, accountType string, submission []byte) (VerificationRecord, error)
	Restart(ctx context.Context, customerID string) (VerificationRecord, error)
	// SetStatus is the admin/back-office review decision (approve/reject). Approving
	// lifts the tier; rejecting records a reason. Returns the updated record.
	SetStatus(ctx context.Context, customerID, status, reason string) (VerificationRecord, error)
}

type sqlVerificationStore struct{ db *pgxpool.Pool }

// NewVerificationStore returns a Postgres-backed verification store.
func NewVerificationStore(db *pgxpool.Pool) VerificationStore { return &sqlVerificationStore{db: db} }

const verificationCols = `status, account_type, tier, submitted_at, reviewed_at, rejection_reason`

func scanVerification(row pgx.Row) (VerificationRecord, error) {
	var r VerificationRecord
	var submitted, reviewed *time.Time
	var reason *string
	if err := row.Scan(&r.Status, &r.AccountType, &r.Tier, &submitted, &reviewed, &reason); err != nil {
		return VerificationRecord{}, err
	}
	r.SubmittedAt = tsPtr(submitted)
	r.ReviewedAt = tsPtr(reviewed)
	r.RejectionReason = reason
	return r, nil
}

func (s *sqlVerificationStore) Get(ctx context.Context, customerID string) (VerificationRecord, error) {
	rec, err := scanVerification(s.db.QueryRow(ctx,
		`SELECT `+verificationCols+` FROM orch_fx_customer_verifications WHERE customer_id=$1`, customerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultVerificationRecord(), nil
	}
	if err != nil {
		return VerificationRecord{}, err
	}
	return rec, nil
}

// Submit records a KYC submission: individuals route to 'pending', businesses to
// manual 'review'. Idempotent upsert on customer_id; a re-submit refreshes the
// payload + submitted_at and clears any prior rejection.
func (s *sqlVerificationStore) Submit(ctx context.Context, customerID, accountType string, submission []byte) (VerificationRecord, error) {
	if accountType != "business" {
		accountType = "individual"
	}
	status := "pending"
	if accountType == "business" {
		status = "review"
	}
	if len(submission) == 0 {
		submission = []byte("{}")
	}
	rec, err := scanVerification(s.db.QueryRow(ctx, `
		INSERT INTO orch_fx_customer_verifications
			(customer_id, status, account_type, tier, submission, submitted_at, rejection_reason, reviewed_at)
		VALUES ($1,$2,$3,1,$4,now(),NULL,NULL)
		ON CONFLICT (customer_id) DO UPDATE SET
			status=EXCLUDED.status, account_type=EXCLUDED.account_type, tier=1,
			submission=EXCLUDED.submission, submitted_at=now(),
			rejection_reason=NULL, reviewed_at=NULL, updated_at=now()
		RETURNING `+verificationCols,
		customerID, status, accountType, submission))
	if err != nil {
		return VerificationRecord{}, err
	}
	return rec, nil
}

// Restart resets a customer to 'unstarted' so they can resubmit after a rejection.
func (s *sqlVerificationStore) Restart(ctx context.Context, customerID string) (VerificationRecord, error) {
	rec, err := scanVerification(s.db.QueryRow(ctx, `
		INSERT INTO orch_fx_customer_verifications (customer_id, status, account_type, tier)
		VALUES ($1,'unstarted','individual',0)
		ON CONFLICT (customer_id) DO UPDATE SET
			status='unstarted', tier=0, submission=NULL, rejection_reason=NULL,
			submitted_at=NULL, reviewed_at=NULL, updated_at=now()
		RETURNING `+verificationCols, customerID))
	if err != nil {
		return VerificationRecord{}, err
	}
	return rec, nil
}

// SetStatus applies a review decision. 'approved' lifts the tier to 2; 'rejected'
// records the reason. reviewed_at is stamped. Returns ErrNoVerification if the
// customer has no submission on file.
func (s *sqlVerificationStore) SetStatus(ctx context.Context, customerID, status, reason string) (VerificationRecord, error) {
	tier := 1
	if status == "approved" {
		tier = 2
	}
	var reasonArg *string
	if status == "rejected" && reason != "" {
		reasonArg = &reason
	}
	rec, err := scanVerification(s.db.QueryRow(ctx, `
		UPDATE orch_fx_customer_verifications
		SET status=$2, tier=$3, rejection_reason=$4, reviewed_at=now(), updated_at=now()
		WHERE customer_id=$1
		RETURNING `+verificationCols, customerID, status, tier, reasonArg))
	if errors.Is(err, pgx.ErrNoRows) {
		return VerificationRecord{}, ErrNoVerification
	}
	if err != nil {
		return VerificationRecord{}, err
	}
	return rec, nil
}

// ErrNoVerification is returned when a status change targets a customer with no row.
var ErrNoVerification = errors.New("no verification on file for customer")

package orchestration

// secondary_store.go — persistence for the FX "secondary" features that are not
// money-path: saved beneficiaries and rate alerts. Backed by the same pgx pool as
// the orch_* money tables, but these tables hold metadata only (no ledger, no
// balances). AuthZ is enforced by scoping every query on customer_id.
//
// Requires migration 20260826000000_fx_beneficiaries_rate_alerts.sql.

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

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

// ─── Beneficiaries ────────────────────────────────────────────────────────────

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

// ─── Rate alerts ──────────────────────────────────────────────────────────────

// RateAlert mirrors the mobile contract. triggeredAt is null until fired.
type RateAlert struct {
	ID          string   `json:"id"`
	Pair        string   `json:"pair"`
	From        string   `json:"from"`
	To          string   `json:"to"`
	Direction   string   `json:"direction"`
	Target      float64  `json:"target"`
	Active      bool     `json:"active"`
	CreatedAt   string   `json:"createdAt"`
	TriggeredAt *string  `json:"triggeredAt"`
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

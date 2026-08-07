package embedded

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the read side the embedded engine needs that IB0 did not expose:
// resolving the active EMBEDDED product for a product_line, and a fast
// source_event_id idempotency pre-check against insurance_policy. All queries are
// read-only + parameterized; the engine writes policies via policy.Repository.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the embedded repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// EmbeddedProduct is the slice of the catalog the engine needs to resolve cover.
type EmbeddedProduct struct {
	Code                string
	Provider            string
	ProviderProductCode string
	UnderwriterDisplay  string
	Currency            string
	SumInsuredRules     map[string]any
}

// ErrNoMapping is returned when no active embedded product exists for a line.
var ErrNoMapping = errors.New("embedded: no active product mapped for line")

// ResolveCoverByLine returns the active EMBEDDED product for a product_line. The
// catalog is the single source of truth for product → provider routing; this
// query never branches on the event type. When multiple embedded products exist
// for a line, the most recently updated active one wins.
func (r *Repository) ResolveCoverByLine(ctx context.Context, line string) (*EmbeddedProduct, error) {
	if r.db == nil {
		return nil, ErrNoMapping
	}
	var p EmbeddedProduct
	var sumRules []byte
	err := r.db.QueryRow(ctx, `
		SELECT code, provider, provider_product_code, underwriter_display, sum_insured_rules
		FROM public.insurance_products
		WHERE product_line = $1 AND binding_mode = 'embedded' AND active = true
		ORDER BY updated_at DESC
		LIMIT 1`, line).Scan(&p.Code, &p.Provider, &p.ProviderProductCode, &p.UnderwriterDisplay, &sumRules)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoMapping
		}
		return nil, err
	}
	_ = json.Unmarshal(sumRules, &p.SumInsuredRules)
	p.Currency = "NGN"
	return &p, nil
}

// PolicyForSourceEvent returns (policyID, found) for an existing embedded policy
// bound off a source_event_id. This is the fast idempotency pre-check; the DB
// unique index (uq_insurance_policy_source_event) is the hard guard.
func (r *Repository) PolicyForSourceEvent(ctx context.Context, sourceEventID string) (string, bool, error) {
	if r.db == nil || sourceEventID == "" {
		return "", false, nil
	}
	var id string
	err := r.db.QueryRow(ctx, `
		SELECT id FROM public.insurance_policy WHERE source_event_id = $1 LIMIT 1`, sourceEventID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return id, true, nil
}

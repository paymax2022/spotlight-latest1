package providerimport

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx-backed Store.
type Repository struct{ db *pgxpool.Pool }

// NewRepository constructs the repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

func nullTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

func nullString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Upsert is idempotent on (provider, provider_policy_ref): a re-run refreshes the
// row and last_seen_at, and never creates a duplicate.
func (r *Repository) Upsert(ctx context.Context, provider string, s Summary) (bool, error) {
	var inserted bool
	err := r.db.QueryRow(ctx, `
		INSERT INTO insurance_provider_policy
		  (provider, provider_policy_ref, policy_number, provider_product_id, product_name,
		   underwriter, status, premium_kobo, starts_at, expires_at, certificate_url, provider_created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (provider, provider_policy_ref) DO UPDATE SET
		  policy_number       = EXCLUDED.policy_number,
		  provider_product_id = EXCLUDED.provider_product_id,
		  product_name        = EXCLUDED.product_name,
		  underwriter         = EXCLUDED.underwriter,
		  status              = EXCLUDED.status,
		  premium_kobo        = EXCLUDED.premium_kobo,
		  starts_at           = EXCLUDED.starts_at,
		  expires_at          = EXCLUDED.expires_at,
		  certificate_url     = EXCLUDED.certificate_url,
		  provider_created_at = EXCLUDED.provider_created_at,
		  last_seen_at        = now()
		RETURNING (xmax = 0)`,
		provider, s.ProviderPolicyRef, nullString(s.PolicyNumber), nullString(s.ProductID), s.ProductName,
		s.Underwriter, s.Status, s.PremiumKobo, nullTime(s.StartsAt), nullTime(s.ExpiresAt),
		nullString(s.CertificateURL), nullTime(s.ProviderCreatedAt),
	).Scan(&inserted)
	return inserted, err
}

// List returns mirrored policies, newest at the provider first. inPaymax filters
// to policies that do (true) or do not (false) exist in insurance_policy.
func (r *Repository) List(ctx context.Context, provider string, inPaymax *bool, limit, offset int) ([]Row, error) {
	rows, err := r.db.Query(ctx, `
		SELECT p.provider_policy_ref, COALESCE(p.policy_number,''), COALESCE(p.provider_product_id,''),
		       p.product_name, p.underwriter, p.status, p.premium_kobo,
		       p.starts_at, p.expires_at, COALESCE(p.certificate_url,''), p.provider_created_at,
		       p.first_seen_at, p.last_seen_at,
		       lp.id IS NOT NULL, COALESCE(lp.id::text,''), COALESCE(lp.state,'')
		  FROM insurance_provider_policy p
		  LEFT JOIN insurance_policy lp
		         ON lp.provider = p.provider AND lp.provider_policy_ref = p.provider_policy_ref
		 WHERE p.provider = $1
		   AND ($2::boolean IS NULL OR ($2 = (lp.id IS NOT NULL)))
		 ORDER BY p.provider_created_at DESC NULLS LAST, p.first_seen_at DESC
		 LIMIT $3 OFFSET $4`, provider, inPaymax, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Row{}
	for rows.Next() {
		var x Row
		var starts, expires, created *time.Time
		if err := rows.Scan(&x.ProviderPolicyRef, &x.PolicyNumber, &x.ProductID,
			&x.ProductName, &x.Underwriter, &x.Status, &x.PremiumKobo,
			&starts, &expires, &x.CertificateURL, &created,
			&x.FirstSeenAt, &x.LastSeenAt,
			&x.InPaymax, &x.PaymaxPolicy, &x.PaymaxState); err != nil {
			return nil, err
		}
		if starts != nil {
			x.StartsAt = *starts
		}
		if expires != nil {
			x.ExpiresAt = *expires
		}
		if created != nil {
			x.ProviderCreatedAt = *created
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// Overview counts the mirror against Paymax's own book.
func (r *Repository) Overview(ctx context.Context, provider string) (Overview, error) {
	ov := Overview{Provider: provider}
	var last *time.Time
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE lp.id IS NOT NULL),
		       COUNT(*) FILTER (WHERE lp.id IS NULL),
		       COALESCE(SUM(p.premium_kobo) FILTER (WHERE lp.id IS NULL), 0),
		       MAX(p.last_seen_at)
		  FROM insurance_provider_policy p
		  LEFT JOIN insurance_policy lp
		         ON lp.provider = p.provider AND lp.provider_policy_ref = p.provider_policy_ref
		 WHERE p.provider = $1`, provider,
	).Scan(&ov.Total, &ov.InPaymax, &ov.NotInPaymax, &ov.NotInPaymaxKobo, &last)
	ov.LastSyncedAt = last
	return ov, err
}

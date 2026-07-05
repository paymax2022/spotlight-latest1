package merchant

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for merchant tables.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const merchantCols = `id, owner_user_id, name, slug, status, funding_wallet_user_id, created_at`

func scanMerchant(row pgx.Row) (*Merchant, error) {
	var (
		m            Merchant
		owner, wallet *string
	)
	if err := row.Scan(&m.ID, &owner, &m.Name, &m.Slug, &m.Status, &wallet, &m.CreatedAt); err != nil {
		return nil, err
	}
	if owner != nil {
		m.OwnerUserID = *owner
	}
	if wallet != nil {
		m.FundingWalletUserID = *wallet
	}
	return &m, nil
}

// CreateMerchant inserts a merchant (admin).
func (r *Repository) CreateMerchant(ctx context.Context, in CreateMerchantInput) (*Merchant, error) {
	const q = `
		INSERT INTO referral_merchants (owner_user_id, name, slug, status, funding_wallet_user_id)
		VALUES ($1,$2,$3,'active',$4)
		RETURNING ` + merchantCols
	return scanMerchant(r.db.QueryRow(ctx, q,
		nullable(in.OwnerUserID), in.Name, in.Slug, nullable(in.FundingWalletUserID)))
}

// GetMerchant returns one merchant.
func (r *Repository) GetMerchant(ctx context.Context, id string) (*Merchant, error) {
	q := `SELECT ` + merchantCols + ` FROM referral_merchants WHERE id = $1`
	return scanMerchant(r.db.QueryRow(ctx, q, id))
}

// ListMerchants returns all merchants (admin).
func (r *Repository) ListMerchants(ctx context.Context) ([]Merchant, error) {
	q := `SELECT ` + merchantCols + ` FROM referral_merchants ORDER BY created_at DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("merchant: list: %w", err)
	}
	defer rows.Close()
	var out []Merchant
	for rows.Next() {
		m, err := scanMerchant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

const mcCols = `id, merchant_id, campaign_id, name, funded_kobo, settled_kobo, status, created_at`

func scanMC(row pgx.Row) (*MerchantCampaign, error) {
	var (
		mc   MerchantCampaign
		camp *string
	)
	if err := row.Scan(&mc.ID, &mc.MerchantID, &camp, &mc.Name, &mc.FundedKobo, &mc.SettledKobo,
		&mc.Status, &mc.CreatedAt); err != nil {
		return nil, err
	}
	if camp != nil {
		mc.CampaignID = *camp
	}
	return &mc, nil
}

// CreateMC inserts a merchant campaign envelope.
func (r *Repository) CreateMC(ctx context.Context, in CreateMCInput) (*MerchantCampaign, error) {
	const q = `
		INSERT INTO referral_merchant_campaigns (merchant_id, campaign_id, name, status)
		VALUES ($1,$2,$3,'draft')
		RETURNING ` + mcCols
	return scanMC(r.db.QueryRow(ctx, q, in.MerchantID, nullable(in.CampaignID), in.Name))
}

// GetMC returns one merchant campaign.
func (r *Repository) GetMC(ctx context.Context, id string) (*MerchantCampaign, error) {
	q := `SELECT ` + mcCols + ` FROM referral_merchant_campaigns WHERE id = $1`
	return scanMC(r.db.QueryRow(ctx, q, id))
}

// ListMCByMerchant returns a merchant's campaign envelopes.
func (r *Repository) ListMCByMerchant(ctx context.Context, merchantID string) ([]MerchantCampaign, error) {
	q := `SELECT ` + mcCols + ` FROM referral_merchant_campaigns WHERE merchant_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, merchantID)
	if err != nil {
		return nil, fmt.Errorf("merchant: list campaigns: %w", err)
	}
	defer rows.Close()
	var out []MerchantCampaign
	for rows.Next() {
		mc, err := scanMC(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *mc)
	}
	return out, rows.Err()
}

// AddFunding increments funded_kobo and flips status to 'funded'.
func (r *Repository) AddFunding(ctx context.Context, mcID string, amountKobo int64) (*MerchantCampaign, error) {
	const q = `
		UPDATE referral_merchant_campaigns
		SET funded_kobo = funded_kobo + $2,
		    status = CASE WHEN status = 'draft' THEN 'funded' ELSE status END,
		    updated_at = now()
		WHERE id = $1
		RETURNING ` + mcCols
	return scanMC(r.db.QueryRow(ctx, q, mcID, amountKobo))
}

// AddSettlement increments settled_kobo (used by the settlement hook).
func (r *Repository) AddSettlement(ctx context.Context, mcID string, amountKobo int64) error {
	_, err := r.db.Exec(ctx,
		`UPDATE referral_merchant_campaigns SET settled_kobo = settled_kobo + $2, updated_at = now() WHERE id = $1`,
		mcID, amountKobo)
	if err != nil {
		return fmt.Errorf("merchant: add settlement: %w", err)
	}
	return nil
}

// InsertPartnerKey stores a hashed, scoped partner key.
func (r *Repository) InsertPartnerKey(ctx context.Context, merchantID, prefix, hash string, scopes []string) (string, error) {
	raw, err := json.Marshal(scopes)
	if err != nil {
		return "", fmt.Errorf("merchant: marshal scopes: %w", err)
	}
	if len(raw) == 0 || string(raw) == "null" {
		raw = []byte("[]")
	}
	const q = `
		INSERT INTO referral_partner_keys (merchant_id, key_prefix, key_hash, scopes, status)
		VALUES ($1,$2,$3,$4,'active')
		RETURNING id`
	var id string
	if err := r.db.QueryRow(ctx, q, merchantID, prefix, hash, raw).Scan(&id); err != nil {
		return "", fmt.Errorf("merchant: insert partner key: %w", err)
	}
	return id, nil
}

// ListPartnerKeys returns a merchant's keys (never the hash/plaintext) for admin.
func (r *Repository) ListPartnerKeys(ctx context.Context, merchantID string) ([]PartnerKey, error) {
	const q = `
		SELECT id, merchant_id, key_prefix, scopes, status, last_used_at, created_at
		FROM referral_partner_keys WHERE merchant_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, merchantID)
	if err != nil {
		return nil, fmt.Errorf("merchant: list partner keys: %w", err)
	}
	defer rows.Close()
	var out []PartnerKey
	for rows.Next() {
		var (
			k   PartnerKey
			raw []byte
		)
		if err := rows.Scan(&k.ID, &k.MerchantID, &k.KeyPrefix, &raw, &k.Status, &k.LastUsedAt, &k.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(raw, &k.Scopes)
		out = append(out, k)
	}
	return out, rows.Err()
}

// RevokePartnerKey revokes a key by id.
func (r *Repository) RevokePartnerKey(ctx context.Context, id string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE referral_partner_keys SET status = 'revoked', revoked_at = now() WHERE id = $1 AND status = 'active'`, id)
	if err != nil {
		return fmt.Errorf("merchant: revoke partner key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("merchant: key not found or already revoked")
	}
	return nil
}

// LookupActiveKeyByPrefix returns the stored hash + scopes for an active key
// prefix (partner-API auth: hash the presented key and compare in the service).
func (r *Repository) LookupActiveKeyByPrefix(ctx context.Context, prefix string) (merchantID, hash string, scopes []string, err error) {
	const q = `
		SELECT merchant_id, key_hash, scopes FROM referral_partner_keys
		WHERE key_prefix = $1 AND status = 'active'`
	var raw []byte
	if e := r.db.QueryRow(ctx, q, prefix).Scan(&merchantID, &hash, &raw); e != nil {
		if e == pgx.ErrNoRows {
			return "", "", nil, nil
		}
		return "", "", nil, fmt.Errorf("merchant: lookup key: %w", e)
	}
	_ = json.Unmarshal(raw, &scopes)
	return merchantID, hash, scopes, nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

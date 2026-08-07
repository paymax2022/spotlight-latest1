package crypto

import (
	"context"
	"crypto/subtle"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// This file makes crypto reconciliation REAL. Previously AdminReconciliation
// reported onchain_units == ledger_units (drift always 0, status always "ok"),
// which can never surface a break. Here we add a stored on-chain balance entity
// (crypto_onchain_balances — see migration 20260919000500_crypto_onchain_balances.sql)
// that a CUSTODIAN reports into, and reconciliation diffs that stored on-chain total
// against the ledger-side projection (Repository.AdminHeldUnitsByAsset).
//
// Two seams live here:
//  1. Repository.UpsertOnchainBalance / OnchainUnitsByAsset — the persistence for the
//     custodian-reported totals (write on feed, read on recon).
//  2. The custody-webhook stub (POST /api/v1/crypto/internal/onchain-balance) — the
//     integration seam a real custody provider (Fireblocks / BitGo / Anchorage) would
//     call to report balances. Guarded by a shared secret, fail-closed when unset.
//
// Reconciliation is READ-ONLY: it reports drift, it NEVER moves money. Nothing in
// this file mutates holdings, the ledger, or withdrawals. On-chain totals are
// custodian-reported facts, not a member balance source of truth. All amounts are
// integer minor units (asset minor units; matching crypto_assets.minor_unit_scale).

// custodyWebhookSecretEnv is the env var holding the shared secret the custodian
// signs its balance reports with. Kept local to the crypto module (file scope) rather
// than threading through config: the guard reads it at request time so an unset secret
// fails closed. Set CRYPTO_CUSTODY_WEBHOOK_SECRET in the backend environment to enable
// the seam; leave it unset to disable the endpoint entirely (503).
const custodyWebhookSecretEnv = "CRYPTO_CUSTODY_WEBHOOK_SECRET"

// custodyWebhookSecretHeader is the header the custodian presents its shared secret in.
const custodyWebhookSecretHeader = "X-Crypto-Custody-Secret"

// OnchainBalance is the custodian-reported on-chain total for a single asset. It is
// NOT a projection of the ledger — it is the independent "on-chain side" that
// reconciliation diffs against the ledger side. Money is integer minor units.
type OnchainBalance struct {
	AssetID      string    `json:"asset_id"`
	OnchainUnits int64     `json:"onchain_units"`
	Source       string    `json:"source"`
	AsOf         time.Time `json:"as_of"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// ── Repository: on-chain balance store ───────────────────────────────────────

// UpsertOnchainBalance idempotently records the custodian-reported on-chain total for
// one asset (one row per asset; PRIMARY KEY asset_id). Repeated reports for the same
// asset overwrite the stored total — this is a "latest custody snapshot" store, not an
// append-only ledger, so a replayed webhook is a safe no-op-equivalent (same values in
// → same row). It NEVER touches holdings, withdrawals, or the ledger: it only writes
// the on-chain side that reconciliation reads. If source is blank it defaults to
// 'stub'; if asOf is zero it defaults to now().
func (r *Repository) UpsertOnchainBalance(ctx context.Context, assetID string, units int64, source string, asOf time.Time) (*OnchainBalance, error) {
	if source == "" {
		source = "stub"
	}
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	const q = `
		INSERT INTO crypto_onchain_balances (asset_id, onchain_units, source, as_of, updated_at)
		VALUES ($1,$2,$3,$4, now())
		ON CONFLICT (asset_id) DO UPDATE
		  SET onchain_units = EXCLUDED.onchain_units,
		      source        = EXCLUDED.source,
		      as_of         = EXCLUDED.as_of,
		      updated_at    = now()
		RETURNING asset_id, onchain_units, source, as_of, updated_at`
	var b OnchainBalance
	if err := r.db.QueryRow(ctx, q, assetID, units, source, asOf).
		Scan(&b.AssetID, &b.OnchainUnits, &b.Source, &b.AsOf, &b.UpdatedAt); err != nil {
		// FK violation (unknown asset) surfaces as a generic error → 400 upstream.
		return nil, err
	}
	return &b, nil
}

// OnchainUnitsByAsset returns, per asset_id, the stored custodian-reported on-chain
// total plus the source/as_of provenance. Assets with NO stored row are ABSENT from
// the map — reconciliation treats absence as "no_feed" (no custody data yet) rather
// than falsely reporting drift 0 / ok. Read-only.
func (r *Repository) OnchainUnitsByAsset(ctx context.Context) (map[string]OnchainBalance, error) {
	out := map[string]OnchainBalance{}
	const q = `SELECT asset_id, onchain_units, source, as_of, updated_at
	           FROM crypto_onchain_balances`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var b OnchainBalance
		if err := rows.Scan(&b.AssetID, &b.OnchainUnits, &b.Source, &b.AsOf, &b.UpdatedAt); err != nil {
			return nil, err
		}
		out[b.AssetID] = b
	}
	return out, rows.Err()
}

// ── Service: custody feed ingestion ──────────────────────────────────────────

// IngestOnchainBalance validates and stores one custodian-reported on-chain balance.
// It resolves the asset by SYMBOL (what a custodian speaks) or by asset UUID, records
// the total via the idempotent upsert, and emits an immutable audit event (the on-chain
// side changing is worth an audit trail even though no money moved). READ-of-catalogue
// + WRITE-of-onchain-store only — never mutates holdings/ledger/withdrawals.
func (s *Service) IngestOnchainBalance(ctx context.Context, assetRef string, units int64, source string, asOf time.Time) (*OnchainBalance, error) {
	assetRef = strings.TrimSpace(assetRef)
	if assetRef == "" || units < 0 {
		return nil, ErrBadRequest
	}
	assetID, err := s.resolveAssetID(ctx, assetRef)
	if err != nil {
		return nil, err
	}
	b, err := s.repo.UpsertOnchainBalance(ctx, assetID, units, source, asOf)
	if err != nil {
		return nil, err
	}
	// Audit the custody report (actor = the custody source, not a user).
	if err := s.audit.log(ctx, "custody:"+b.Source, "crypto.custody.onchain_balance",
		"crypto_onchain_balance", assetID, "custodian on-chain balance report",
		nil, map[string]any{"onchain_units": b.OnchainUnits, "source": b.Source, "as_of": b.AsOf}); err != nil {
		return nil, err
	}
	return b, nil
}

// resolveAssetID maps a custodian-supplied asset reference (symbol or UUID) to the
// catalogue asset id. Symbol match is case-insensitive on the trimmed value.
func (s *Service) resolveAssetID(ctx context.Context, ref string) (string, error) {
	// Try direct id first (custodians that echo our UUIDs).
	if a, err := s.repo.GetAsset(ctx, ref); err == nil {
		return a.ID, nil
	} else if err != ErrNotFound {
		return "", err
	}
	// Fall back to symbol match.
	assets, err := s.repo.ListAssets(ctx, false)
	if err != nil {
		return "", err
	}
	up := strings.ToUpper(ref)
	for _, a := range assets {
		if strings.ToUpper(a.Symbol) == up {
			return a.ID, nil
		}
	}
	return "", ErrNotFound
}

// ── Custody webhook stub (integration seam for a real custody provider) ───────

// custodyWebhookGuard enforces the shared-secret header. FAIL-CLOSED: if the secret
// env var is unset/empty the endpoint is disabled (503) — an unconfigured custody seam
// must never accept unauthenticated writes to the on-chain store. Uses a constant-time
// compare to avoid leaking the secret via timing. This is the ONLY auth on the internal
// route (it is NOT behind member/admin RBAC — a custodian is a machine caller).
func custodyWebhookGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		secret := strings.TrimSpace(os.Getenv(custodyWebhookSecretEnv))
		if secret == "" {
			// Not configured → seam disabled, fail closed.
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"error":   "custody webhook not configured",
			})
			return
		}
		presented := strings.TrimSpace(c.GetHeader(custodyWebhookSecretHeader))
		if presented == "" ||
			subtle.ConstantTimeCompare([]byte(presented), []byte(secret)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error":   "invalid custody secret",
			})
			return
		}
		c.Next()
	}
}

// CustodyOnchainBalance is the custody-webhook stub handler. A real custody provider
// (Fireblocks / BitGo / Anchorage) would POST the current on-chain total for an asset
// here on a schedule or on balance change; we store it so reconciliation can diff it
// against the ledger projection. This is the DOCUMENTED integration seam — swap the
// guard for the provider's real signature scheme (mirror the HMAC pattern in
// backend/internal/webhooks/paystack.go) and map the provider's payload to this shape.
//
// POST /api/v1/crypto/internal/onchain-balance
// Header: X-Crypto-Custody-Secret: <shared secret>
// Body:   {"asset":"BTC","onchain_units":123456789,"source":"fireblocks","as_of":"2026-07-09T00:00:00Z"}
//
//	(asset may be a symbol or the asset UUID; as_of is optional → defaults to now)
func (h *Handler) CustodyOnchainBalance(c *gin.Context) {
	var req struct {
		Asset        string     `json:"asset"`
		OnchainUnits int64      `json:"onchain_units"`
		Source       string     `json:"source"`
		AsOf         *time.Time `json:"as_of"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	asOf := time.Time{}
	if req.AsOf != nil {
		asOf = *req.AsOf
	}
	b, err := h.svc.IngestOnchainBalance(c.Request.Context(),
		req.Asset, req.OnchainUnits, strings.TrimSpace(req.Source), asOf)
	if err != nil {
		httpErrExt(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "onchain_balance": b})
}

// registerCustodyWebhook mounts the custody-webhook stub on the member router group's
// sibling path. It is guarded ONLY by the shared secret (custodyWebhookGuard) — NOT by
// member/admin RBAC — because the caller is a custodian machine, not a logged-in user.
// Mounted relative to the member group (/api/v1/crypto) as /internal/onchain-balance
// → full path /api/v1/crypto/internal/onchain-balance.
func registerCustodyWebhook(member *gin.RouterGroup, h *Handler) {
	member.POST("/internal/onchain-balance", custodyWebhookGuard(), h.CustodyOnchainBalance)
}

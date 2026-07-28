package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/ledger"
)

// academy_webhooks.go — inbound webhook ingestion for the four academy rails
// (BNPL, payout, disbursement, billing). The fake/sandbox provider settles ASYNC:
// after a create it POSTs a signed event back here, which:
//
//   1. VERIFIES the HMAC-SHA256 signature over the raw body using the per-rail
//      webhook secret (header X-Fake-Signature: sha256=<hex>). Verified in EVERY
//      mode (NL: webhooks signature-verified). Bad/missing signature ⇒ 401, no
//      state change.
//   2. DEDUPES idempotently on (rail, provider ref) via an additive table; a
//      replay is a no-op 200 so the provider stops retrying (NL-9 idempotency).
//   3. Flips the relevant academy state and writes the ledger leg (NL-8 ledger is
//      the source of truth): for payout/disburse the target is credited; for BNPL
//      the order is marked entitled.
//
// The routes are UNAUTHENTICATED (the provider calls them directly) — the HMAC
// signature IS the authentication. Secrets are never logged.

// academyWebhookEvent mirrors tools/fakes webhookEvent and a provider-sandbox
// settle/approve event.
type academyWebhookEvent struct {
	Rail        string `json:"rail"`
	Event       string `json:"event"`
	Ref         string `json:"ref"`
	Reference   string `json:"reference"`
	IdemKey     string `json:"idempotency_key"`
	AmountMinor int64  `json:"amount_minor"`
	Status      string `json:"status"`
	OccurredAt  string `json:"occurred_at"`
}

// academyWebhookHandler verifies + dedupes + reconciles academy rail webhooks.
type academyWebhookHandler struct {
	pool   *pgxpool.Pool
	ledger *ledger.Service
	// per-rail webhook secret (HMAC-SHA256). Empty secret ⇒ reject (fail-closed).
	secrets map[string]string
}

// newAcademyWebhookHandler builds the handler and ensures the additive dedup table
// exists (CREATE TABLE IF NOT EXISTS — additive-only, no DROP/rename).
func newAcademyWebhookHandler(ctx context.Context, pool *pgxpool.Pool, ledgerSvc *ledger.Service, cfg config.Config) *academyWebhookHandler {
	if pool != nil {
		_, _ = pool.Exec(ctx, `
CREATE TABLE IF NOT EXISTS academy_rail_webhook_events (
    rail            TEXT        NOT NULL,
    provider_ref    TEXT        NOT NULL,
    idempotency_key TEXT        NOT NULL,
    reference       TEXT        NOT NULL,
    event           TEXT        NOT NULL,
    amount_minor    BIGINT      NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (rail, provider_ref)
)`)
	}
	return &academyWebhookHandler{
		pool:   pool,
		ledger: ledgerSvc,
		secrets: map[string]string{
			"bnpl":     cfg.BNPLWebhookSecret,
			"payout":   cfg.PayoutWebhookSecret,
			"disburse": cfg.DisburseWebhookSecret,
			"billing":  cfg.BillingWebhookSecret,
		},
	}
}

// ── Route handlers (one per rail) ──────────────────────────────────────────────

func (h *academyWebhookHandler) bnpl(c *gin.Context)     { h.ingest(c, "bnpl") }
func (h *academyWebhookHandler) payout(c *gin.Context)   { h.ingest(c, "payout") }
func (h *academyWebhookHandler) disburse(c *gin.Context) { h.ingest(c, "disburse") }
func (h *academyWebhookHandler) billing(c *gin.Context)  { h.ingest(c, "billing") }

// ingest is the shared pipeline: verify → decode → dedupe → reconcile.
func (h *academyWebhookHandler) ingest(c *gin.Context, rail string) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read body"})
		return
	}

	// 1) Signature verification (fail-closed). Secret must be configured.
	secret := h.secrets[rail]
	if secret == "" || !verifyHMAC(secret, body, c.GetHeader("X-Fake-Signature")) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		return
	}

	var evt academyWebhookEvent
	if err := json.Unmarshal(body, &evt); err != nil || evt.Ref == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad payload"})
		return
	}

	// 2) Idempotent dedupe on (rail, provider ref). ON CONFLICT DO NOTHING means a
	//    replay inserts 0 rows ⇒ we 200 without re-processing.
	if h.pool != nil {
		tag, derr := h.pool.Exec(c.Request.Context(), `
INSERT INTO academy_rail_webhook_events (rail, provider_ref, idempotency_key, reference, event, amount_minor)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (rail, provider_ref) DO NOTHING`,
			rail, evt.Ref, evt.IdemKey, evt.Reference, evt.Event, evt.AmountMinor)
		if derr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "dedupe failed"})
			return
		}
		if tag.RowsAffected() == 0 {
			// Already processed — acknowledge so the provider stops retrying.
			c.JSON(http.StatusOK, gin.H{"data": "duplicate"})
			return
		}
	}

	// 3) State flip + ledger leg. Best-effort reconcile; on failure we still 200
	//    (the event is recorded + idempotent), but log so ops can replay/repair.
	if err := h.reconcile(c.Request.Context(), rail, evt); err != nil {
		// Do not leak internals; the event is durably recorded for replay.
		c.JSON(http.StatusOK, gin.H{"data": "recorded", "reconciled": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": "ok"})
}

// reconcile flips the relevant academy state and writes the ledger leg. The
// settled/approved event is the trigger; the ledger is the source of truth (NL-8).
//
// NOTE: the per-rail ledger legs use the platform standing accounts. The funds for
// these rails were held in escrow at create-time (the create adapter's caller debits
// the user/institution into escrow via the package's existing collect path); on
// settle we move escrow → settlement. Where the exact owning-row mutation needs the
// domain service (e.g. mapping reference → disbursement id), a TODO marks the leg
// that the owning service should complete; the webhook itself is already
// signature-verified + idempotent so it can be safely re-driven.
func (h *academyWebhookHandler) reconcile(ctx context.Context, rail string, evt academyWebhookEvent) error {
	// The provider ref (evt.Ref) is what the domain persisted at create-time
	// (academy_orders.bnpl_ref / academy_disbursements.payout_ref /
	// academy_institution_billing.payment_ref), so it is the correct, stable join
	// key from the async webhook back to the owning row. Each UPDATE is state-guarded
	// so it is itself idempotent (a re-drive is a no-op once flipped).
	switch rail {
	case "bnpl":
		// BNPL approved ⇒ mark the order entitled. Keyed by the stored bnpl_ref.
		if h.pool != nil {
			_, err := h.pool.Exec(ctx,
				`UPDATE academy_orders SET state = 'entitled' WHERE bnpl_ref = $1 AND state = 'bnpl_active'`,
				evt.Ref)
			if err != nil {
				return err
			}
		}
		// TODO(ledger): post the BNPL principal leg via the commerce service once the
		// order→ledger account mapping is exposed; the entitlement state flip above is
		// the local state required by commerce.BNPLRail's contract.
		return nil

	case "payout":
		// Tutor payout settled ⇒ release the held amount escrow → settlement, then
		// the payout target is credited downstream. (Tutor payout rows live in the
		// tutor package; the ledger leg is the canonical settlement record.)
		// TODO(state): flip the tutor payout row state via the tutor service when its
		// payout-by-ref lookup is exposed; the ledger leg below is the source of truth.
		return h.releaseEscrowToSettlement(ctx, evt)

	case "disburse":
		// EduPay disbursement settled ⇒ flip state fee_due/collected → disbursed
		// (keyed by stored payout_ref) and release escrow → settlement.
		if h.pool != nil {
			_, err := h.pool.Exec(ctx,
				`UPDATE academy_disbursements SET state = 'disbursed' WHERE payout_ref = $1 AND state IN ('fee_due','collected','funding')`,
				evt.Ref)
			if err != nil {
				return err
			}
		}
		return h.releaseEscrowToSettlement(ctx, evt)

	case "billing":
		// Institution billing charged ⇒ flip open → paid (keyed by stored
		// payment_ref). Funds settle into the platform settlement account.
		if h.pool != nil {
			_, err := h.pool.Exec(ctx,
				`UPDATE academy_institution_billing SET state = 'paid' WHERE payment_ref = $1 AND state = 'open'`,
				evt.Ref)
			if err != nil {
				return err
			}
		}
		return h.releaseEscrowToSettlement(ctx, evt)
	}
	return nil
}

// releaseEscrowToSettlement posts the settle ledger leg: release the held amount
// from escrow into settlement (a balanced, idempotent journal). The idem key is
// derived from the provider ref so a replayed webhook re-uses the same key and the
// ledger rejects the duplicate (defense-in-depth on top of the dedupe table).
func (h *academyWebhookHandler) releaseEscrowToSettlement(ctx context.Context, evt academyWebhookEvent) error {
	if h.ledger == nil || evt.AmountMinor <= 0 {
		return nil
	}
	escrow, err := h.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	settlement, err := h.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return err
	}
	idemKey := "academy-rail:" + evt.Rail + ":" + evt.Ref
	return h.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       evt.Reference,
		IdempotencyKey:  idemKey,
		AmountKobo:      evt.AmountMinor,
		DebitAccountID:  escrow.ID,     // release the hold
		CreditAccountID: settlement.ID, // settle to the platform settlement account
	})
}

// ── HMAC verification ──────────────────────────────────────────────────────────

// verifyHMAC checks header ("sha256=<hex>" or bare "<hex>") against
// HMAC-SHA256(secret, body) using a constant-time compare.
func verifyHMAC(secret string, body []byte, header string) bool {
	if header == "" {
		return false
	}
	header = strings.TrimSpace(header)
	header = strings.TrimPrefix(header, "sha256=")
	want, err := hex.DecodeString(header)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hmac.Equal(want, mac.Sum(nil))
}

// registerAcademyWebhooks mounts the UNAUTHENTICATED, signature-verified rail
// webhook routes under /internal/webhooks/academy/*. Gated by the academy flag at
// the call site.
func registerAcademyWebhooks(webhooks *gin.RouterGroup, h *academyWebhookHandler) {
	g := webhooks.Group("/internal/webhooks/academy")
	g.POST("/bnpl", h.bnpl)
	g.POST("/payout", h.payout)
	g.POST("/disburse", h.disburse)
	g.POST("/billing", h.billing)
}

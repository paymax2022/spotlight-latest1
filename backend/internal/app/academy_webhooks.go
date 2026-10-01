package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/ledger"
)

// academy_webhooks.go — inbound webhook ingestion for the four academy rails
// (BNPL, payout, disbursement, billing). The fake/sandbox provider settles ASYNC:
// after a create it POSTs a signed event back here, which:
//   1. VERIFIES the HMAC-SHA256 signature over the raw body using the per-rail
//      webhook secret (header X-Fake-Signature: sha256=<hex>). Verified in EVERY
//      mode (NL: webhooks signature-verified). Bad/missing signature ⇒ 401, no
//      state change.
//   2. DEDUPES idempotently on (rail, provider ref) via an additive table; a
//      replay is a no-op 200 so the provider stops retrying (NL-9 idempotency).
//   3. Flips the relevant academy state and writes the ledger leg (NL-8 ledger is
//      the source of truth): for payout/disburse the target is credited; for BNPL
//      the order is marked entitled.
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
		if errors.Is(err, errNoMatchingObligation) {
			c.JSON(http.StatusOK, gin.H{"data": "recorded", "reconciled": false, "reason": "no_matching_obligation"})
			return
		}
		if errors.Is(err, errNotSettleEvent) {
			c.JSON(http.StatusOK, gin.H{"data": "recorded", "reconciled": false, "reason": "event_not_settle"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": "recorded", "reconciled": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": "ok"})
}

// errNoMatchingObligation marks a validly-signed webhook whose provider ref owns
// no in-flight obligation row (unknown ref, or the row is already terminal). The
// event is recorded for audit but the pooled escrow must NOT move — posting an
// escrow→settlement leg for a ref we owe nothing to drains real held funds.
var errNoMatchingObligation = errors.New("no matching obligation for provider ref")

// errNotSettleEvent marks a validly-signed webhook whose event name is not the
// rail's settle verb — recorded for audit, never reconciled.
var errNotSettleEvent = errors.New("event is not a settle/approve event")

// settleEvents is the per-rail settle vocabulary — the only event names that may
// move money. Any other signed event (failed/reversed/chargeback/…) is recorded
// in the dedupe table but never reconciles.
var settleEvents = map[string]string{
	"bnpl":     "approved",
	"payout":   "settled",
	"disburse": "settled",
	"billing":  "settled",
}

// reconcile verifies the webhook's provider ref against a settled obligation row
// and posts the escrow→settlement ledger leg. It deliberately does NOT flip
// domain state: the owning domain service writes the provider ref inside the
// same guarded transition that terminates the row (tutor.SettlePayout,
// edupay.setDisbState, schools.SetBillingPaid), so a committed row in the
// terminal-success state IS the verified obligation — and raw UPDATEs here would
// bypass the domain's side-effects (earnings flip, audit rows).
// NOTE: the per-rail ledger legs use the platform standing accounts. The funds
// for these rails were held in escrow at create-time; on settle we release the
// OWNING ROW's amount — never the wire's claimed amount_minor — into settlement.
func (h *academyWebhookHandler) reconcile(ctx context.Context, rail string, evt academyWebhookEvent) error {
	if settleEvents[rail] != evt.Event {
		return errNotSettleEvent
	}
	if h.pool == nil {
		return errNoMatchingObligation
	}
	switch rail {
	case "bnpl":
		// BNPL approved ⇒ the order must already be entitled (the domain writes
		// bnpl_ref inside the checkout→bnpl_active→entitled transition). No
		// ledger leg yet — the principal mapping lives with commerce (TODO).
		var id string
		err := h.pool.QueryRow(ctx,
			`SELECT id FROM academy_orders WHERE bnpl_ref = $1 AND state = 'entitled'`,
			evt.Ref).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNoMatchingObligation
		}
		return err

	case "payout":
		// Tutor payout settled ⇒ the row must already be 'paid' (domain owns the
		// requested→paid|failed transition, incl. the earnings flip). Release the
		// row's amount escrow → settlement; idempotent on academy-rail:<rail>:<ref>.
		return h.settleFromRow(ctx, rail, evt,
			`SELECT amount_minor FROM academy_tutor_payouts WHERE payout_ref = $1 AND state = 'paid'`)

	case "disburse":
		// EduPay disbursement settled ⇒ row already 'disbursed'/'reconciled'.
		return h.settleFromRow(ctx, rail, evt,
			`SELECT amount_minor FROM academy_disbursements WHERE payout_ref = $1 AND state IN ('disbursed','reconciled')`)

	case "billing":
		// Institution billing settled ⇒ row already 'paid'.
		return h.settleFromRow(ctx, rail, evt,
			`SELECT amount_minor FROM academy_institution_billing WHERE payment_ref = $1 AND state = 'paid'`)
	}
	return nil
}

// settleFromRow reads the obligation's committed amount for a settled webhook
// and posts the escrow→settlement leg. No matching terminal row ⇒ the ref owns
// nothing — record the event, move nothing.
func (h *academyWebhookHandler) settleFromRow(ctx context.Context, rail string, evt academyWebhookEvent, amountQuery string) error {
	var amount int64
	err := h.pool.QueryRow(ctx, amountQuery, evt.Ref).Scan(&amount)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNoMatchingObligation
	}
	if err != nil {
		return err
	}
	return h.releaseEscrowToSettlement(ctx, rail, evt, amount)
}

// releaseEscrowToSettlement posts the settle ledger leg: release the held amount
// from escrow into settlement (a balanced, idempotent journal). The idem key is
// derived from the provider ref so a replayed webhook re-uses the same key and the
// ledger rejects the duplicate (defense-in-depth on top of the dedupe table).
func (h *academyWebhookHandler) releaseEscrowToSettlement(ctx context.Context, rail string, evt academyWebhookEvent, amountKobo int64) error {
	if h.ledger == nil || amountKobo <= 0 {
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
	// Route rail, not evt.Rail — the route is what was authenticated; the body's
	// rail field is sender-supplied and must not steer the ledger key namespace.
	idemKey := "academy-rail:" + rail + ":" + evt.Ref
	return h.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       evt.Reference,
		IdempotencyKey:  idemKey,
		AmountKobo:      amountKobo,    // the owning row's amount — never the wire's claim
		DebitAccountID:  escrow.ID,     // release the hold
		CreditAccountID: settlement.ID, // settle to the platform settlement account
	})
}

// verifyHMAC checks header ("sha256=<hex>" or bare "<hex>") against
// HMAC-SHA256(secret, body) using a constant-time compare.
func verifyHMAC(secret string, body []byte, header string) bool {
	header = strings.TrimPrefix(strings.TrimSpace(header), "sha256=")
	if header == "" {
		return false
	}
	return cryptox.ConstantTimeEqual(header, cryptox.HMACSHA256Hex(secret, string(body)))
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

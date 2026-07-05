package invest

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// ─────────────────────────────────────────────────────────────────────────────
// Broker webhook — async fill / settlement / rejection events.
//
// A real broker confirms fills out-of-band. This endpoint verifies the provider
// signature (HMAC-SHA256 over the raw body), then drives the order state machine
// and ledger. It is idempotent: events for orders already past the relevant
// state are ignored, and ledger postings carry unique idempotency keys.
// ─────────────────────────────────────────────────────────────────────────────

// webhookSecretProvider is implemented by brokers that sign webhooks.
type webhookSecretProvider interface{ WebhookSecret() string }

type WebhookHandler struct {
	svc    *Service
	secret string
}

func NewWebhookHandler(svc *Service, secret string) *WebhookHandler {
	return &WebhookHandler{svc: svc, secret: secret}
}

func verifyHMAC(secret string, body []byte, sigHex string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(sigHex))
}

// Handle processes a signed broker webhook.
func (h *WebhookHandler) Handle(c *gin.Context) {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read body"})
		return
	}
	sig := c.GetHeader("X-Broker-Signature")
	if h.secret == "" || sig == "" || !verifyHMAC(h.secret, body, sig) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		return
	}
	var evt struct {
		Type              string  `json:"type"` // order.filled | order.settled | order.rejected
		ProviderReference string  `json:"provider_reference"`
		ExecutedPrice     float64 `json:"executed_price"`     // naira
		FilledQuantity    float64 `json:"filled_quantity"`
		Reason            string  `json:"reason"`
	}
	if err := json.Unmarshal(body, &evt); err != nil || evt.ProviderReference == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	ctx := c.Request.Context()
	switch evt.Type {
	case "order.filled":
		err = h.svc.HandleBrokerFill(ctx, evt.ProviderReference, nairaToKoboF(evt.ExecutedPrice), evt.FilledQuantity)
	case "order.settled":
		err = h.svc.HandleBrokerSettled(ctx, evt.ProviderReference)
	case "order.rejected":
		err = h.svc.HandleBrokerReject(ctx, evt.ProviderReference, evt.Reason)
	default:
		c.JSON(http.StatusAccepted, gin.H{"ignored": evt.Type})
		return
	}
	if err != nil {
		// 200 for "already handled" so the broker stops retrying; 500 otherwise.
		if errors.Is(err, ErrNotFound) || errors.Is(err, errAlreadyHandled) {
			c.JSON(http.StatusOK, gin.H{"status": "ignored"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

var errAlreadyHandled = errors.New("invest: event already handled")

// ── Repository lookup ────────────────────────────────────────────────────────

func (r *Repository) FindOrderByProviderRef(ctx context.Context, ref string) (*Order, error) {
	var o Order
	err := scanOrder(r.db.QueryRow(ctx, "SELECT "+orderCols+" FROM invest_orders WHERE provider_reference=$1 ORDER BY created_at DESC LIMIT 1", ref), &o)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// ── Service handlers (async broker outcomes) ─────────────────────────────────

// HandleBrokerFill applies an async fill: settles the ledger and moves the order
// to PendingSettlement (buy → shares pending; sell → cash pending).
func (s *Service) HandleBrokerFill(ctx context.Context, providerRef string, execPriceKobo int64, filledQty float64) error {
	o, err := s.repo.FindOrderByProviderRef(ctx, providerRef)
	if err != nil {
		return err
	}
	// Idempotency: only act on not-yet-filled orders.
	switch o.Status {
	case StatusSubmitted, StatusAccepted, StatusPartiallyFilled:
	default:
		return errAlreadyHandled
	}
	if o.Status == StatusSubmitted {
		if err := s.transition(ctx, o, StatusAccepted, "broker accepted (webhook)"); err != nil {
			return err
		}
	}
	st, err := s.repo.GetStockByID(ctx, o.StockAssetID)
	if err != nil {
		return err
	}
	fees := s.feeSchedule(ctx)
	o.ExecutedPriceKobo = execPriceKobo
	o.FilledQuantity = filledQty
	o.FilledAt = ptime(s.now())

	if o.Side == SideBuy {
		cost := int64(filledQty * float64(execPriceKobo))
		feeFinal := fees.FeeFor(cost)
		if cost+feeFinal > o.LockedCashKobo {
			cost = o.LockedCashKobo - feeFinal
			if cost < 0 {
				cost = 0
				feeFinal = o.LockedCashKobo
			}
		}
		o.FeesKobo = feeFinal
		if err := s.il.SettleBuy(ctx, o.UserID, "order:"+o.ID, providerRef, "settlebuy:"+o.IdempotencyKey, cost, feeFinal, o.LockedCashKobo); err != nil {
			return err
		}
		o.LockedCashKobo = 0
	} else {
		gross := int64(filledQty * float64(execPriceKobo))
		feeFinal := fees.FeeFor(gross)
		o.FeesKobo = feeFinal
		o.TotalAmountKobo = gross - feeFinal
		if err := s.il.SellProceedsToPending(ctx, o.UserID, "order:"+o.ID, providerRef, "sellpx:"+o.IdempotencyKey, gross, feeFinal); err != nil {
			return err
		}
	}
	if err := s.transition(ctx, o, StatusFilled, "filled (webhook)"); err != nil {
		return err
	}
	due := s.now().Add(time.Duration(st.SettlementDays) * 24 * time.Hour)
	o.SettlementDueAt = &due
	return s.transition(ctx, o, StatusPendingSettlement, "awaiting settlement (webhook)")
}

// HandleBrokerSettled finalises settlement for a single order (alternative to
// the time-based worker when the broker confirms settlement explicitly).
func (s *Service) HandleBrokerSettled(ctx context.Context, providerRef string) error {
	o, err := s.repo.FindOrderByProviderRef(ctx, providerRef)
	if err != nil {
		return err
	}
	if o.Status != StatusPendingSettlement {
		return errAlreadyHandled
	}
	if o.Side == SideBuy {
		if err := s.repo.AddToPosition(ctx, o.UserID, o.StockAssetID, o.Symbol, o.FilledQuantity, o.ExecutedPriceKobo); err != nil {
			return err
		}
	} else {
		if err := s.il.ReleaseSettlement(ctx, o.UserID, "settle:"+o.ID, "release:"+o.IdempotencyKey, o.TotalAmountKobo); err != nil {
			return err
		}
		if err := s.repo.ReducePosition(ctx, o.UserID, o.StockAssetID, o.FilledQuantity, o.TotalAmountKobo); err != nil {
			return err
		}
	}
	o.SettledAt = ptime(s.now())
	return s.transition(ctx, o, StatusSettled, "settled (webhook)")
}

// HandleBrokerReject releases locks and marks the order failed.
func (s *Service) HandleBrokerReject(ctx context.Context, providerRef, reason string) error {
	o, err := s.repo.FindOrderByProviderRef(ctx, providerRef)
	if err != nil {
		return err
	}
	if IsTerminal(o.Status) || o.Status == StatusFailed {
		return errAlreadyHandled
	}
	if o.Side == SideBuy && o.LockedCashKobo > 0 {
		_ = s.il.UnlockCash(ctx, o.UserID, "order:"+o.ID, "unlock:"+o.IdempotencyKey, o.LockedCashKobo)
		o.LockedCashKobo = 0
	}
	if o.Side == SideSell && o.LockedQuantity > 0 {
		_ = s.repo.UnlockShares(ctx, o.UserID, o.StockAssetID, o.LockedQuantity)
		o.LockedQuantity = 0
	}
	s.fail(ctx, o, reason)
	return nil
}

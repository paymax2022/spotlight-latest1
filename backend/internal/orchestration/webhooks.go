package orchestration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// WebhookEmitter delivers signed, normalized Paymax events to a caller endpoint
// (spec §5.7). Signature header: `Paymax-Signature: t=<unix>,v1=<hmac_sha256>`.
type WebhookEmitter struct {
	endpoint string
	secret   string
	client   *http.Client
}

// NewWebhookEmitter builds an emitter for a single caller endpoint. A nil-safe
// no-op is returned (Emit becomes a no-op) when endpoint or secret is empty.
func NewWebhookEmitter(endpoint, secret string) *WebhookEmitter {
	return &WebhookEmitter{endpoint: endpoint, secret: secret, client: &http.Client{Timeout: 10 * time.Second}}
}

// OutboundEndpoint returns the configured outbound webhook URL, or "" when no
// emitter is configured (nil-safe). Used by the business-admin webhooks
// settings read (handler_business.go) to surface the current subscription.
func (e *WebhookEmitter) OutboundEndpoint() string {
	if e == nil {
		return ""
	}
	return e.endpoint
}

// SignPayload returns the hex HMAC-SHA256 of `t.payload` under secret.
func SignPayload(secret string, t int64, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", t)))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

// Event is the normalized outbound webhook envelope (spec §5.7).
type Event struct {
	ID      string      `json:"id"`
	Type    string      `json:"type"`
	Created string      `json:"created"`
	Data    interface{} `json:"data"`
}

// Emit signs and POSTs a normalized event. No-op when unconfigured.
func (e *WebhookEmitter) Emit(ctx context.Context, eventType string, data interface{}) error {
	if e == nil || e.endpoint == "" || e.secret == "" {
		return nil
	}
	evt := Event{ID: newID("evt"), Type: eventType, Created: time.Now().UTC().Format(time.RFC3339), Data: data}
	payload, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	ts := time.Now().Unix()
	sig := SignPayload(e.secret, ts, payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Paymax-Signature", fmt.Sprintf("t=%d,v1=%s", ts, sig))
	resp, err := e.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("orchestration: webhook delivery to %s returned %d", e.endpoint, resp.StatusCode)
	}
	return nil
}

// VerifyProviderWebhook verifies an inbound provider webhook signature.
func (s *Service) VerifyProviderWebhook(providerName string, payload []byte, signature string) bool {
	p, ok := s.providers[providerName]
	if !ok {
		return false
	}
	return p.VerifyWebhookSignature(payload, signature)
}

// canonTransferStatus maps a provider-native status to the canonical transfer state.
func canonTransferStatus(raw string) string {
	switch strings.ToLower(raw) {
	case "success", "successful", "paid", "completed", "settled":
		return string(TransferPaid)
	case "failed", "declined", "error":
		return string(TransferFailed)
	case "reversed", "refunded":
		return string(TransferReversed)
	default:
		return string(TransferProcessing)
	}
}

// canonConversionStatus maps a provider-native status to the canonical conversion state.
func canonConversionStatus(raw string) string {
	switch strings.ToLower(raw) {
	case "success", "successful", "settled", "completed", "paid":
		return string(ConvSettled)
	case "failed", "declined", "error":
		return string(ConvFailed)
	default:
		return string(ConvPending)
	}
}

// HandleProviderEvent normalizes an inbound provider webhook into the unified
// ledger: it maps the provider status to canonical, updates the record, and
// re-emits a normalized Paymax event to the caller (spec §5.7, §8). Idempotent.
func (s *Service) HandleProviderEvent(ctx context.Context, providerName string, payload []byte) error {
	var ev struct {
		Event  string `json:"event"`
		Type   string `json:"type"`
		Status string `json:"status"`
		Data   struct {
			Reference string `json:"reference"`
			Status    string `json:"status"`
			Type      string `json:"type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &ev); err != nil {
		return err
	}
	// A collection is an inbound DEPOSIT into a virtual account we provisioned —
	// money arriving, not a status change on something we initiated — so it is
	// matched and credited before the status branches below.
	if isCollectionEvent(eventName(ev.Event, ev.Type)) {
		return s.applyCollectionEvent(ctx, providerName, payload)
	}

	ref := ev.Data.Reference
	if ref == "" {
		return nil // nothing actionable
	}
	raw := ev.Data.Status
	if raw == "" {
		raw = ev.Status
	}
	isTransfer := strings.HasPrefix(ref, "PMX-TR") || ev.Data.Type == "transfer"
	if isTransfer {
		canon := canonTransferStatus(raw)
		_ = s.store.UpdateTransferStatus(ctx, ref, canon)
		s.emit(ctx, "transfer."+canon, map[string]interface{}{"reference": ref, "status": canon, "provider": providerName})
	} else {
		canon := canonConversionStatus(raw)
		_ = s.store.UpdateConversionStatus(ctx, ref, canon)
		s.emit(ctx, "conversion."+canon, map[string]interface{}{"reference": ref, "status": canon, "provider": providerName})
	}
	return nil
}

// SetEmitter attaches the outbound webhook emitter used to fan out events.
func (s *Service) SetEmitter(e *WebhookEmitter) { s.emitter = e }

// emit is an internal helper that fans out an event if an emitter is configured.
func (s *Service) emit(ctx context.Context, eventType string, data interface{}) {
	if s.emitter != nil {
		_ = s.emitter.Emit(ctx, eventType, data)
	}
}

// ─── Inbound collections (deposits into a provisioned virtual account) ───────
//
// This is the last link of the Maplerad/Eversend collections rail. Everything
// ahead of it already existed — live adapters, credential-gated wiring,
// Service.CreateCollection provisioning the account, the mobile Receive screen,
// and the signature-checked webhook endpoint — but HandleProviderEvent only
// mapped transfer/conversion STATUS. A real deposit was verified, acknowledged
// 200, and dropped, which is why a customer's FX balance never moved.

// eventName picks the event label out of whichever envelope field carries it.
func eventName(event, typ string) string {
	if strings.TrimSpace(event) != "" {
		return strings.ToLower(strings.TrimSpace(event))
	}
	return strings.ToLower(strings.TrimSpace(typ))
}

// isCollectionEvent recognises an inbound credit. The vocabulary is exactly the
// set the Maplerad client already maps to Type="collection"
// (internal/provider/maplerad/maplerad.go ParseWebhook) — kept in sync
// deliberately rather than invented here.
func isCollectionEvent(name string) bool {
	switch name {
	case "collection.successful", "collection.success", "virtual_account.credit", "collection":
		return true
	}
	return false
}

// applyCollectionEvent matches a deposit to the account it was paid into and
// credits the owner.
//
// Fail-closed in three places, because every one of them is a way to invent
// money that nobody sent:
//   - a non-positive amount is refused;
//   - an unmatched reference credits NOTHING and is merely acknowledged, so a
//     stray or spoofed reference cannot mint an orphan credit (QA WH-INT-003);
//   - a payload currency that disagrees with the account's own currency is
//     refused rather than resolved by guessing which one is right.
//
// The account row — not the payload — is the authority on WHO owns the deposit
// and in WHICH currency. The payload is only trusted for the amount and the
// dedupe id.
func (s *Service) applyCollectionEvent(ctx context.Context, providerName string, payload []byte) error {
	var ev struct {
		ID   string `json:"id"`
		Data struct {
			ID            string `json:"id"`
			Reference     string `json:"reference"`
			AccountNumber string `json:"account_number"`
			Currency      string `json:"currency"`
			Amount        int64  `json:"amount"`
			SenderName    string `json:"sender_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &ev); err != nil {
		return err
	}

	if ev.Data.Amount <= 0 {
		return NewError(ErrInvalidRequest, "invalid_amount", "Collection amount must be a positive minor-unit value.")
	}

	// Candidate handles, most specific first. All three are fields the provider
	// adapter itself already reads or writes — no speculative key names.
	var va *VirtualAccount
	for _, cand := range []string{ev.Data.AccountNumber, ev.Data.Reference, ev.Data.ID} {
		found, ok, err := s.store.VirtualAccountByProviderRef(ctx, providerName, cand)
		if err != nil {
			return err
		}
		if ok {
			va = found
			break
		}
	}
	if va == nil {
		// Acknowledged, never credited: we have no owner for this money.
		log.Printf("[fx] collection webhook from %s matched no virtual account (ref=%q acct=%q) — acknowledged, not credited",
			providerName, ev.Data.Reference, ev.Data.AccountNumber)
		return nil
	}

	if c := strings.ToUpper(strings.TrimSpace(ev.Data.Currency)); c != "" && !strings.EqualFold(c, va.Currency) {
		return NewError(ErrInvalidRequest, "currency_mismatch",
			"Collection currency "+c+" does not match the "+strings.ToUpper(va.Currency)+" account it was paid into.")
	}

	eventID := ev.Data.ID
	if eventID == "" {
		eventID = ev.ID
	}
	if eventID == "" {
		// Without a dedupe id a redelivery would credit twice. Refuse rather than
		// synthesise a key that a retry could never reproduce.
		return NewError(ErrInvalidRequest, "missing_event_id", "Collection webhook carries no event id to deduplicate on.")
	}

	credit := &CollectionCredit{
		ID:               newID("col"),
		CustomerID:       va.CustomerID,
		VirtualAccountID: va.ID,
		Currency:         strings.ToUpper(va.Currency),
		AmountMinor:      ev.Data.Amount,
		Provider:         providerName,
		ProviderEventID:  eventID,
		ProviderRef:      va.ProviderRef,
		SenderName:       ev.Data.SenderName,
		Reference:        ev.Data.Reference,
		CreatedAt:        s.now(),
	}
	applied, err := s.store.ApplyCollection(ctx, credit)
	if err != nil {
		return err
	}
	if applied {
		s.emit(ctx, "collection.received", credit)
	}
	return nil
}

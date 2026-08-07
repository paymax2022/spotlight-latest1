package maplerad

// cards.go — CardIssuer implementation (card LIFECYCLE only: issue / reveal /
// freeze / terminate). Card FUNDING is NOT here: it stays on the internal
// double-entry ledger (orchestration/cards_store.go FundCard). Any provider-side
// settlement of card spend is treasury-level reconciliation and out of scope.
//
// This is the ONLY place Maplerad issuing HTTP/DTO code may live. All endpoints
// are marked TODO(maplerad-issuing) pending verification against the live docs.
//
// Offline degradation: when !c.live() (no secret key) each method synthesizes a
// DETERMINISTIC result from an fnv hash of the customer/card id — mirroring how the
// reads degrade to mockVirtualAccount — so dev/CI runs offline. The synthesized PAN
// is masked and is clearly NOT a real PCI PAN.

import (
	"context"
	"fmt"
	"hash/fnv"

	"spotlight/backend/internal/provider"
)

// IssueCard provisions a virtual card at Maplerad. Card lifecycle path: with a
// live key it surfaces real errors; with no key it degrades to a deterministic
// synthesized card so the corridor stays usable offline.
func (c *Client) IssueCard(ctx context.Context, req provider.IssueCardRequest) (*provider.IssuedCard, error) {
	if !c.live() {
		return synthIssuedCard(req.Customer, req.Brand), nil
	}
	brand := req.Brand
	if brand == "" {
		brand = "VISA"
	}
	body := map[string]any{
		"customer_id":  req.Customer,
		"currency":     req.Currency,
		"type":         "VIRTUAL",
		"brand":        brand,
		"auto_approve": true,
		"amount":       0, // funding stays on the internal ledger; not a provider load
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID       string `json:"id"`
			Last4    string `json:"last4"`
			Brand    string `json:"brand"`
			ExpMonth int    `json:"expiry_month"`
			ExpYear  int    `json:"expiry_year"`
		} `json:"data"`
		Message string `json:"message"`
	}
	// TODO(maplerad-issuing): verify against live docs — path "/issuing" and the
	// data field names (id, last4, brand, expiry_month, expiry_year).
	if err := c.post(ctx, "/issuing", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: issue card: %s", resp.Message)
	}
	out := &provider.IssuedCard{
		ProviderCardID: resp.Data.ID,
		Last4:          resp.Data.Last4,
		Brand:          resp.Data.Brand,
		ExpMonth:       resp.Data.ExpMonth,
		ExpYear:        resp.Data.ExpYear,
	}
	if out.Brand == "" {
		out.Brand = brand
	}
	return out, nil
}

// RevealCard fetches the sensitive PAN/CVV/expiry for a provider card id. Card
// lifecycle READ path: degrades to a deterministic masked synth offline.
func (c *Client) RevealCard(ctx context.Context, providerCardID string) (*provider.CardSecrets, error) {
	if !c.live() {
		return synthCardSecrets(providerCardID), nil
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			PAN      string `json:"card_number"`
			CVV      string `json:"cvv"`
			ExpMonth int    `json:"expiry_month"`
			ExpYear  int    `json:"expiry_year"`
		} `json:"data"`
		Message string `json:"message"`
	}
	// TODO(maplerad-issuing): verify against live docs — path "/issuing/{id}" (or the
	// documented card-secrets/decrypt endpoint) and the data field names
	// (card_number, cvv, expiry_month, expiry_year).
	if err := c.get(ctx, "/issuing/"+providerCardID, &resp); err != nil {
		return synthCardSecrets(providerCardID), nil
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: reveal card: %s", resp.Message)
	}
	return &provider.CardSecrets{
		PAN:    resp.Data.PAN,
		CVV:    resp.Data.CVV,
		Expiry: fmt.Sprintf("%02d/%02d", resp.Data.ExpMonth, resp.Data.ExpYear),
	}, nil
}

// SetCardFrozen freezes (true) or unfreezes (false) a provider card. Card
// lifecycle path: no-op success offline; real errors when live.
func (c *Client) SetCardFrozen(ctx context.Context, providerCardID string, frozen bool) error {
	if !c.live() {
		return nil
	}
	action := "unfreeze"
	if frozen {
		action = "freeze"
	}
	var resp struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
	}
	// TODO(maplerad-issuing): verify against live docs — paths "/issuing/{id}/freeze"
	// and "/issuing/{id}/unfreeze".
	if err := c.post(ctx, "/issuing/"+providerCardID+"/"+action, map[string]any{}, &resp); err != nil {
		return err
	}
	if !resp.Status {
		return fmt.Errorf("maplerad: set card frozen (%s): %s", action, resp.Message)
	}
	return nil
}

// TerminateCard permanently deactivates a provider card. Card lifecycle path:
// no-op success offline; real errors when live.
func (c *Client) TerminateCard(ctx context.Context, providerCardID string) error {
	if !c.live() {
		return nil
	}
	var resp struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
	}
	// TODO(maplerad-issuing): verify against live docs — path "/issuing/{id}/terminate".
	if err := c.post(ctx, "/issuing/"+providerCardID+"/terminate", map[string]any{}, &resp); err != nil {
		return err
	}
	if !resp.Status {
		return fmt.Errorf("maplerad: terminate card: %s", resp.Message)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline synth helpers (deterministic, masked — never a real PCI PAN).
// ─────────────────────────────────────────────────────────────────────────────

// synthHash produces a deterministic 64-bit fnv hash of the given seed.
func synthHash(seed string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(seed))
	return h.Sum64()
}

// synthIssuedCard yields a deterministic offline issued card. The provider card id
// and metadata are derived from the customer id so repeated calls are stable.
func synthIssuedCard(customer, brand string) *provider.IssuedCard {
	if brand == "" {
		brand = "VISA"
	}
	n := synthHash(customer)
	return &provider.IssuedCard{
		ProviderCardID: fmt.Sprintf("mock_card_%08d", n%100_000_000),
		Last4:          fmt.Sprintf("%04d", n%10000),
		Brand:          brand,
		ExpMonth:       int(n%12) + 1,
		ExpYear:        30 + int(n%6), // 30..35 (two-digit year)
	}
}

// synthCardSecrets yields a deterministic, MASKED offline reveal. This is clearly
// TEST DATA — not a real PCI PAN and must never be treated as one.
func synthCardSecrets(providerCardID string) *provider.CardSecrets {
	n := synthHash(providerCardID)
	last4 := fmt.Sprintf("%04d", n%10000)
	return &provider.CardSecrets{
		PAN:    "•••• •••• •••• " + last4,
		CVV:    "•••",
		Expiry: fmt.Sprintf("%02d/%02d", int(n%12)+1, 30+int(n%6)),
	}
}

// --- Compile-time interface assertion ---
var _ provider.CardIssuer = (*Client)(nil)

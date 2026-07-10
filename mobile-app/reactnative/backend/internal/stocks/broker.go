package stocks

import "paymax/crypto-backend/internal/engine"

// Broker is the equities execution-venue seam — the "brokerage provider" the audit
// found missing (fills were computed inline, so a real venue could not be plugged
// in). Implementations decide ONLY the resulting order state; all pre-trade checks,
// pricing, persistence and idempotency stay in Service.
//
//   - MockBroker fills market orders instantly (today's behavior, unchanged).
//   - A real venue (e.g. Alpaca) returns an accepted order and drives fills
//     asynchronously via webhooks; that adapter implements this same interface and
//     is injected with Service.WithBroker — no change to the execution path.
type Broker interface {
	// Place submits an order to the venue and reports the resulting state.
	Place(BrokerRequest) BrokerResult
}

// BrokerRequest is the venue-facing order, built AFTER Service's pre-trade checks.
type BrokerRequest struct {
	Symbol          string
	Side            string // buy | sell
	OrderType       string // market | limit
	Quantity        int64
	SettlementCycle string // T+2 | T+3
}

// BrokerResult is the venue's response: the order's resulting lifecycle state.
type BrokerResult struct {
	Status         string        // Filled | Submitted | …
	FilledQuantity int64         // filled units (market fills fully; limit = 0 until filled)
	SettlementDate string        // "" when not yet settling
	Provider       string        // venue name recorded on the order
	History        []StatusEvent // append-only lifecycle trail
}

// MockBroker reproduces the historical in-house fill behavior exactly: market
// orders fill immediately (T+2/T+3 settlement), limit orders rest as Submitted.
type MockBroker struct{}

// Place implements Broker.
func (MockBroker) Place(req BrokerRequest) BrokerResult {
	now := engine.Now()
	if req.OrderType == "market" {
		days := 3
		if req.SettlementCycle == "T+2" {
			days = 2
		}
		return BrokerResult{
			Status:         "Filled",
			FilledQuantity: req.Quantity,
			SettlementDate: daysFromNow(days),
			Provider:       "mock-broker",
			History: []StatusEvent{
				{Status: "Submitted", At: now},
				{Status: "AcceptedByProvider", At: now},
				{Status: "Filled", At: now},
			},
		}
	}
	return BrokerResult{
		Status:   "Submitted",
		Provider: "mock-broker",
		History: []StatusEvent{
			{Status: "AwaitingUserConfirmation", At: now},
			{Status: "Submitted", At: now},
		},
	}
}

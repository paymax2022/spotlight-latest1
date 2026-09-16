package vtpass

// health.go implements the OPTIONAL provider.HealthChecker capability, ported
// from frontend-web/src/server/utility/adapters/vtpass.ts's healthCheck():
//
//	async healthCheck() {
//	  try {
//	    const payload = await vtpassFetch('balance', 'GET');
//	    if (String(payload.code) === '1' && typeof payload.contents?.balance === 'number') {
//	      return { status: 'healthy', message: `Balance: ${payload.contents.balance}` };
//	    }
//	    return { status: 'degraded', message: payload.response_description || 'Unable to confirm VTPass balance.' };
//	  } catch (error) {
//	    return { status: 'down', message: ... };
//	  }
//	}
//
// Two details of that source are load-bearing and easy to get wrong:
//
//   - the success code here is "1", NOT the "000" that the purchase/requery
//     endpoints use. VTpass's balance endpoint has its own code vocabulary.
//   - the balance lives under `contents` (plural), not the `content` key every
//     other VTpass endpoint uses — which is why this file decodes the raw body
//     itself rather than reusing vtpassResponse.Content.
//
// It also must be a number. A VTpass balance arriving as the STRING "1500.00"
// is not a confirmed balance, and the TS source's `typeof === 'number'` guard
// rejects it into 'degraded'; that guard is reproduced exactly.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"

	"spotlight/backend/internal/provider"
)

// compile-time proof the client satisfies the optional capability. Without this
// a signature drift would only surface as a silent type-assertion miss at
// runtime, which presents as "this provider does not support health checks" —
// a wrong answer that looks like a configuration problem.
var _ provider.HealthChecker = (*Client)(nil)

// vtpassBalance is the balance endpoint's envelope. Deliberately local to this
// file: `contents` is unique to this one endpoint, and adding it to the shared
// vtpassResponse would imply every other response carries it.
type vtpassBalance struct {
	Contents struct {
		// Balance is kept as RAW JSON, deliberately, so the wire TYPE survives
		// to be inspected.
		//
		// json.Number is the obvious choice here and it is WRONG: Go's decoder
		// accepts a quoted numeric string into a json.Number field (it only
		// validates the digits, not the JSON type), so `"balance":"1500.00"`
		// would decode cleanly and be reported healthy — silently defeating the
		// TS source's `typeof payload.contents?.balance === 'number'` guard.
		// Keeping the raw bytes lets isJSONNumber below reject the quoted form.
		Balance json.RawMessage `json:"balance"`
	} `json:"contents"`
}

// isJSONNumber reports whether raw is a JSON NUMBER literal — not a quoted
// string, not null, not a boolean. This is the Go equivalent of the TS source's
// `typeof balance === 'number'`.
func isJSONNumber(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] == '"' {
		return false
	}
	var n json.Number
	return json.Unmarshal(trimmed, &n) == nil
}

// HealthCheck asks VTpass for the merchant balance and classifies the answer.
//
// It never returns a non-nil error alongside a nil result for a provider that
// merely answered badly — per the provider.HealthChecker contract, a bad answer
// is a RESULT ('degraded'/'down'), not an error. The only error path is the
// adapter refusing to send at all, which is what missing credentials produce:
// authHeaders returns ErrMissingAPIKey / ErrMissingPublicKey before any socket
// is opened. That is surfaced as 'down' rather than an error, matching the TS
// source — vtpassFetch throws on missing credentials and healthCheck's catch
// turns it into 'down'.
//
// NOTE: unlike PurchaseBill and GetBill, this has NO sandbox short-circuit. The
// TS source's sandbox stubs cover purchase and requery only; healthCheck always
// went to the network in every environment, so a sandbox-mode client really
// does call sandbox.vtpass.com here. Anything that needs a hermetic health
// check must inject its own adapter rather than rely on sandbox mode.
func (c *Client) HealthCheck(ctx context.Context) (*provider.HealthCheckResult, error) {
	payload, raw, err := c.do(ctx, http.MethodGet, "/balance", nil)
	if err != nil {
		// Transport failure, or the adapter refusing to send for want of
		// credentials. The TS catch block folds both into 'down'.
		return &provider.HealthCheckResult{Status: HealthDown, Message: err.Error()}, nil
	}

	if codeString(payload.Code) == balanceSuccessCode {
		var balance vtpassBalance
		if json.Unmarshal(raw, &balance) == nil && isJSONNumber(balance.Contents.Balance) {
			// The literal digits from the wire, never a reformatted float — the
			// balance is money and this adapter does not round-trip money through
			// a float64 even for a log message. (One cosmetic consequence: JSON
			// `1500.50` renders as "1500.50" where JS template interpolation
			// would have produced "1500.5". A display-only difference in a
			// human-readable string, and the safer direction to err in.)
			return &provider.HealthCheckResult{
				Status:  HealthHealthy,
				Message: "Balance: " + string(bytes.TrimSpace(balance.Contents.Balance)),
			}, nil
		}
	}

	message := payload.ResponseDescription
	if message == "" {
		message = "Unable to confirm VTPass balance."
	}
	return &provider.HealthCheckResult{Status: HealthDegraded, Message: message}, nil
}

const (
	// balanceSuccessCode is the balance endpoint's own success code — "1", not
	// the "000" the transaction endpoints use. Taken from the TS source's
	// `String(payload.code) === '1'`, not inferred.
	balanceSuccessCode = "1"

	// The three health values the adapter can report. Mirrors
	// utilitybills.HealthStatus without importing it (provider adapters never
	// depend on a domain package — the dependency runs the other way).
	HealthHealthy  = "healthy"
	HealthDegraded = "degraded"
	HealthDown     = "down"
)

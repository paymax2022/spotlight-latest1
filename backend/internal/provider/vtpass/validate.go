package vtpass

// Customer verification (VTpass POST /merchant-verify), implementing
// provider.BillsValidator.
//
// Phase 0 built PurchaseBill/GetBill (provider.BillsProvider) but NOT this — the
// Phase-1 brief assumed it existed, so it is added here rather than worked around.
// It is a port of the same TS adapter as the rest of this package
// (frontend-web/src/server/utility/adapters/vtpass.ts's validateCustomer, L327-367
// plus the sandboxVerify table at L70-90), following the same rules the rest of
// this file does: sandbox is simulated locally, live calls the real endpoint.

import (
	"context"
	"encoding/json"
	"strings"

	"spotlight/backend/internal/provider"
)

// Sandbox verification only recognises the two documented EKEDC meters. VTpass's
// own sandbox behaves the same way ("use any number apart from the one provided
// to simulate a failed meter number validation"), so a "valid" answer for
// anything else would be a lie that only shows up as a failed purchase later.
const (
	sandboxVerifiedCustomerName = "Eko Electric Customer"
	sandboxVerifiedAddress      = "21a New Road Avenue"
)

// ValidateCustomer implements provider.BillsValidator.
//
// Three branches, in the TS source's order:
//
//  1. Categories VTpass does not verify (airtime / data / education) short-circuit
//     to Valid=true with an explanatory Raw payload. This is NOT a permissive
//     fallback — VTpass genuinely has no merchant-verify for a phone number, and
//     refusing those purchases would break every airtime top-up.
//  2. Sandbox verifies against the documented test meters locally, so end-to-end
//     testing works with no credentials and no network.
//  3. Live posts /merchant-verify and reads code=='000' AND NOT
//     content.WrongBillersCode — VTpass answers 000 with WrongBillersCode=true for
//     a syntactically fine but non-existent meter, so checking the code alone
//     would wave through a meter that does not exist.
func (c *Client) ValidateCustomer(ctx context.Context, req provider.BillValidationRequest) (*provider.BillValidation, error) {
	switch req.Type {
	case "airtime", "data", "education":
		return &provider.BillValidation{
			Valid:   true,
			Message: "VTPass does not require merchant verification for this category.",
			Raw:     json.RawMessage(`{"skipped":true,"reason":"VTPass does not require merchant verification for this category."}`),
		}, nil
	}

	if c.environment == EnvironmentSandbox {
		return sandboxVerify(req.CustomerReference), nil
	}

	// TS: metadataString(metadata, ['type','payment_type','paymentType'])
	//     || (category === 'electricity' ? 'prepaid' : undefined)
	meterType := metadataString(req.Params, "type", "payment_type", "paymentType")
	if meterType == "" && req.Type == "electricity" {
		meterType = "prepaid"
	}

	body := map[string]any{
		"billersCode": req.CustomerReference,
		"serviceID":   serviceID(provider.BillRequest{Params: req.Params}),
	}
	if meterType != "" {
		body["type"] = meterType
	}

	payload, raw, err := c.post(ctx, "/merchant-verify", body)
	if err != nil {
		return nil, err
	}

	valid := codeString(payload.Code) == "000" &&
		!(payload.Content != nil && payload.Content.WrongBillersCode)

	name := ""
	if payload.Content != nil {
		// TS: payload.content?.Customer_Name || payload.content?.Customer_Number
		name = firstNonEmpty(payload.Content.CustomerName, payload.Content.CustomerNumber)
	}
	message := "Customer verified."
	if !valid {
		message = payload.ResponseDescription
		if strings.TrimSpace(message) == "" {
			message = "Customer verification failed."
		}
	}

	return &provider.BillValidation{
		Valid:        valid,
		CustomerName: name,
		Message:      message,
		Raw:          raw,
	}, nil
}

// sandboxVerify ports the TS sandboxVerify() table: a doc-accurate merchant-verify
// response for the two valid sandbox meters, and an explicit failure (code 012,
// WrongBillersCode) for anything else.
func sandboxVerify(billersCode string) *provider.BillValidation {
	if billersCode == sandboxMeterPrepaid || billersCode == sandboxMeterPostpaid {
		meterType := "PREPAID"
		if billersCode == sandboxMeterPostpaid {
			meterType = "POSTPAID"
		}
		raw, _ := json.Marshal(map[string]any{
			"code":                 "000",
			"response_description": "Customer verified.",
			"sandbox":              true,
			"content": map[string]any{
				"Customer_Name":    sandboxVerifiedCustomerName,
				"Customer_Number":  billersCode,
				"Customer_Type":    meterType,
				"Address":          sandboxVerifiedAddress,
				"Meter_Number":     billersCode,
				"Meter_Type":       meterType,
				"WrongBillersCode": false,
			},
		})
		return &provider.BillValidation{
			Valid:        true,
			CustomerName: sandboxVerifiedCustomerName,
			Message:      "Customer verified.",
			Raw:          raw,
		}
	}
	return &provider.BillValidation{
		Valid:   false,
		Message: "Meter number could not be validated. (Sandbox: use " + sandboxMeterPrepaid + " for prepaid or " + sandboxMeterPostpaid + " for postpaid.)",
		Raw:     json.RawMessage(`{"code":"012","sandbox":true,"content":{"WrongBillersCode":true}}`),
	}
}

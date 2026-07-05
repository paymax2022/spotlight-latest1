package dojah

import (
	"encoding/json"
	"fmt"
	"strings"

	"spotlight/backend/internal/provider"
)

// idNumberPath resolves the Dojah KYC lookup endpoint + query param for an ID type.
// Mirrors the capability matrix: GET /api/v1/kyc/{bvn/full,nin,vnin,passport,...}.
func idNumberPath(idType, idNumber string) (string, bool) {
	switch strings.ToLower(idType) {
	case "bvn":
		return "/api/v1/kyc/bvn/full?bvn=" + idNumber, true
	case "nin":
		return "/api/v1/kyc/nin?nin=" + idNumber, true
	case "vnin":
		return "/api/v1/kyc/vnin?vnin=" + idNumber, true
	case "passport":
		return "/api/v1/kyc/passport?passport_number=" + idNumber, true
	case "drivers_license", "dl":
		return "/api/v1/kyc/dl?license_number=" + idNumber, true
	case "pvc":
		return "/api/v1/kyc/pvc?vin=" + idNumber, true
	case "phone", "phone_number":
		return "/api/v1/kyc/phone_number?phone_number=" + idNumber, true
	default:
		return "", false
	}
}

// dojahEnvelope is the common Dojah response shape: {"entity": {...}}.
type dojahEnvelope struct {
	Entity json.RawMessage `json:"entity"`
}

// mapIDNumber normalizes a Dojah KYC data-match response. Data-match is
// authoritative and synchronous — a returned entity means the record exists
// (Match=true). PII fields are surfaced into ExtractedFields (never logged here).
func mapIDNumber(raw []byte, clientRef string) provider.KycCheckResult {
	var env dojahEnvelope
	res := provider.KycCheckResult{
		ExtractedFields: map[string]string{},
		Raw:             raw,
		ProviderRef:     clientRef,
	}
	if err := json.Unmarshal(raw, &env); err != nil || len(env.Entity) == 0 || string(env.Entity) == "null" {
		res.Status = provider.KycFailed
		res.Terminal = true
		res.Reason = "dojah: no matching record"
		return res
	}
	fields := flatten(env.Entity)
	res.ExtractedFields = fields
	res.Match = true
	res.Confidence = 100
	res.Status = provider.KycPassed
	res.Terminal = true
	return res
}

// mapLiveness normalizes a Dojah Liveness Check response
// ({"entity":{"liveness":{"liveness_check":true,"liveness_probability":97.3}}}).
func mapLiveness(raw []byte, clientRef string) provider.KycCheckResult {
	var env struct {
		Entity struct {
			Liveness struct {
				LivenessCheck       bool    `json:"liveness_check"`
				LivenessProbability float64 `json:"liveness_probability"`
			} `json:"liveness"`
		} `json:"entity"`
	}
	res := provider.KycCheckResult{
		ExtractedFields: map[string]string{},
		Raw:             raw,
		ProviderRef:     clientRef,
		Terminal:        true,
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		res.Status = provider.KycFailed
		res.Reason = "dojah: malformed liveness response"
		return res
	}
	res.Match = env.Entity.Liveness.LivenessCheck
	res.Confidence = env.Entity.Liveness.LivenessProbability
	if res.Match {
		res.Status = provider.KycPassed
	} else {
		res.Status = provider.KycReview
		res.Reason = "dojah: liveness not confirmed"
	}
	return res
}

// mapDocument normalizes a Dojah Document Analysis response. Confidence rides on
// document_type/text_data availability; the DOMAIN gates PASS vs REVIEW so the
// adapter returns a provisional status only.
func mapDocument(raw []byte, clientRef string) provider.KycCheckResult {
	var env struct {
		Entity struct {
			DocumentType string  `json:"document_type"`
			Confidence   float64 `json:"confidence"`
			TextData     struct {
				DocumentNumber json.RawMessage `json:"document_number"`
				FirstName      json.RawMessage `json:"first_name"`
				LastName       json.RawMessage `json:"last_name"`
			} `json:"text_data"`
		} `json:"entity"`
	}
	res := provider.KycCheckResult{
		ExtractedFields: map[string]string{},
		Raw:             raw,
		ProviderRef:     clientRef,
		Terminal:        true,
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		res.Status = provider.KycFailed
		res.Reason = "dojah: malformed document response"
		return res
	}
	if env.Entity.DocumentType != "" {
		res.ExtractedFields["document_type"] = env.Entity.DocumentType
	}
	putRaw(res.ExtractedFields, "document_number", env.Entity.TextData.DocumentNumber)
	putRaw(res.ExtractedFields, "first_name", env.Entity.TextData.FirstName)
	putRaw(res.ExtractedFields, "last_name", env.Entity.TextData.LastName)
	res.Confidence = env.Entity.Confidence
	res.Match = env.Entity.DocumentType != ""
	if res.Match {
		res.Status = provider.KycPassed
	} else {
		res.Status = provider.KycReview
		res.Reason = "dojah: document not recognized"
	}
	return res
}

// mapAML normalizes a Dojah AML Screening response. A hit (any watchlist match)
// routes to REVIEW; a clean screen PASSes.
func mapAML(raw []byte, clientRef string) provider.KycCheckResult {
	var env struct {
		Entity struct {
			Status       string          `json:"status"`
			WatchlistHit json.RawMessage `json:"watchlist"`
			PEP          json.RawMessage `json:"pep"`
			Sanctions    json.RawMessage `json:"sanction"`
		} `json:"entity"`
	}
	res := provider.KycCheckResult{
		ExtractedFields: map[string]string{},
		Raw:             raw,
		ProviderRef:     clientRef,
		Terminal:        true,
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		res.Status = provider.KycFailed
		res.Reason = "dojah: malformed aml response"
		return res
	}
	hit := hasContent(env.Entity.WatchlistHit) || hasContent(env.Entity.PEP) || hasContent(env.Entity.Sanctions)
	if env.Entity.Status != "" {
		res.ExtractedFields["aml_status"] = env.Entity.Status
	}
	if hit {
		res.Match = true // Match=true means "screening surfaced a hit"
		res.Status = provider.KycReview
		res.Reason = "dojah: AML/PEP/sanctions hit"
		res.ExtractedFields["aml_hit"] = "true"
	} else {
		res.Status = provider.KycPassed
		res.ExtractedFields["aml_hit"] = "false"
	}
	return res
}

// sandboxPending is returned when credentials are missing so the flow stays usable
// with dummy creds (SANDBOX-FIRST rule).
func sandboxPending(clientRef string) provider.KycCheckResult {
	return provider.KycCheckResult{
		Status:          provider.KycPending,
		Terminal:        false,
		Reason:          "sandbox: dojah not configured",
		ExtractedFields: map[string]string{},
		ProviderRef:     clientRef,
	}
}

// mapWebhook normalizes a Dojah webhook envelope into a KycWebhookEvent.
func mapWebhook(raw []byte) (*provider.KycWebhookEvent, error) {
	var env struct {
		ReferenceID string          `json:"reference_id"`
		Reference   string          `json:"reference"`
		EventType   string          `json:"event_type"`
		Status      string          `json:"status"`
		Data        json.RawMessage `json:"data"`
		Entity      json.RawMessage `json:"entity"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, fmt.Errorf("dojah: parse webhook: %w", err)
	}
	clientRef := env.Reference
	providerRef := env.ReferenceID
	ev := &provider.KycWebhookEvent{
		Provider:    "dojah",
		EventID:     providerRef,
		ClientRef:   clientRef,
		ProviderRef: providerRef,
		Status:      mapWebhookStatus(env.Status),
		Raw:         raw,
	}
	if ev.EventID == "" {
		ev.EventID = clientRef
	}
	return ev, nil
}

func mapWebhookStatus(s string) provider.KycCheckStatus {
	switch strings.ToLower(s) {
	case "completed", "success", "successful", "passed", "verified", "approved":
		return provider.KycPassed
	case "failed", "rejected", "declined":
		return provider.KycFailed
	case "review", "pending_review", "manual_review":
		return provider.KycReview
	default:
		return provider.KycPending
	}
}

// --- small helpers ---

// flatten turns a shallow JSON object into a string map for ExtractedFields.
func flatten(raw json.RawMessage) map[string]string {
	out := map[string]string{}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return out
	}
	for k, v := range m {
		out[k] = rawToString(v)
	}
	return out
}

func putRaw(dst map[string]string, key string, v json.RawMessage) {
	if s := rawToString(v); s != "" {
		dst[key] = s
	}
}

func rawToString(v json.RawMessage) string {
	if len(v) == 0 || string(v) == "null" {
		return ""
	}
	var s string
	if err := json.Unmarshal(v, &s); err == nil {
		return s
	}
	return strings.Trim(string(v), `"`)
}

func hasContent(v json.RawMessage) bool {
	s := strings.TrimSpace(string(v))
	switch s {
	case "", "null", "false", "[]", "{}", `""`, "0":
		return false
	default:
		return true
	}
}

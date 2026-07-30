package youverify

import (
	"encoding/json"
	"fmt"
	"strings"

	"spotlight/backend/internal/provider"
)

// idNumberPath resolves the Youverify identity endpoint for an ID type:
// POST /v2/api/identity/ng/{bvn,nin,vnin,passport,drivers_license,pvc}.
func idNumberPath(idType string) (string, bool) {
	switch strings.ToLower(idType) {
	case "bvn":
		return "/v2/api/identity/ng/bvn", true
	case "nin":
		return "/v2/api/identity/ng/nin", true
	case "vnin":
		return "/v2/api/identity/ng/vnin", true
	case "passport":
		return "/v2/api/identity/ng/passport", true
	case "drivers_license", "dl":
		return "/v2/api/identity/ng/drivers_license", true
	case "pvc":
		return "/v2/api/identity/ng/pvc", true
	default:
		return "", false
	}
}

// facialType maps an ID type to the Youverify facial variant.
func facialType(idType string) (string, bool) {
	switch strings.ToLower(idType) {
	case "bvn":
		return "bvn_facial", true
	case "nin":
		return "nin_facial", true
	case "passport":
		return "passport_facial", true
	default:
		return "", false
	}
}

// yvEnvelope is the common Youverify response shape:
// {"success":true,"statusCode":200,"message":"...","data":{...}}.
type yvEnvelope struct {
	Success    bool            `json:"success"`
	StatusCode int             `json:"statusCode"`
	Message    string          `json:"message"`
	Data       json.RawMessage `json:"data"`
}

// mapIDNumber normalizes a Youverify identity data-match response. Synchronous +
// authoritative: success + a found data object => Match.
func mapIDNumber(raw []byte, clientRef string) provider.KycCheckResult {
	res := provider.KycCheckResult{
		ExtractedFields: map[string]string{},
		Raw:             raw,
		ProviderRef:     clientRef,
		Terminal:        true,
	}
	var env yvEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		res.Status = provider.KycFailed
		res.Reason = "youverify: malformed response"
		return res
	}
	res.ProviderRef = pickRef(env.Data, clientRef)
	if !env.Success || len(env.Data) == 0 || string(env.Data) == "null" {
		res.Status = provider.KycFailed
		res.Reason = "youverify: " + firstNonEmpty(env.Message, "no matching record")
		return res
	}
	res.ExtractedFields = flatten(env.Data)
	res.Match = true
	res.Confidence = 100
	res.Status = provider.KycPassed
	return res
}

// mapFacial normalizes a Youverify facial match response. The provider returns
// data.face_details.confidence vs the routing threshold. The DOMAIN gates PASS vs
// REVIEW; the adapter just returns Match + Confidence + a provisional status.
func mapFacial(raw []byte, clientRef string, threshold int) provider.KycCheckResult {
	res := provider.KycCheckResult{
		ExtractedFields: map[string]string{},
		Raw:             raw,
		ProviderRef:     clientRef,
		Terminal:        true,
	}
	var env struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			ID          string `json:"id"`
			FaceDetails struct {
				Confidence float64 `json:"confidence"`
			} `json:"face_details"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		res.Status = provider.KycFailed
		res.Reason = "youverify: malformed facial response"
		return res
	}
	if env.Data.ID != "" {
		res.ProviderRef = env.Data.ID
	}
	res.Confidence = env.Data.FaceDetails.Confidence
	res.Match = env.Success && res.Confidence >= float64(threshold)
	if !env.Success {
		res.Status = provider.KycFailed
		res.Reason = "youverify: " + firstNonEmpty(env.Message, "facial check failed")
		return res
	}
	if res.Match {
		res.Status = provider.KycPassed
	} else {
		res.Status = provider.KycReview
		res.Reason = fmt.Sprintf("youverify: confidence %.1f below threshold %d", res.Confidence, threshold)
	}
	return res
}

// mapLiveness normalizes a Youverify liveness response.
func mapLiveness(raw []byte, clientRef string) provider.KycCheckResult {
	res := provider.KycCheckResult{
		ExtractedFields: map[string]string{},
		Raw:             raw,
		ProviderRef:     clientRef,
		Terminal:        true,
	}
	var env struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			ID       string `json:"id"`
			Liveness struct {
				Passed     bool    `json:"passed"`
				Confidence float64 `json:"confidence"`
			} `json:"liveness"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		res.Status = provider.KycFailed
		res.Reason = "youverify: malformed liveness response"
		return res
	}
	if env.Data.ID != "" {
		res.ProviderRef = env.Data.ID
	}
	res.Confidence = env.Data.Liveness.Confidence
	res.Match = env.Success && env.Data.Liveness.Passed
	if res.Match {
		res.Status = provider.KycPassed
	} else {
		res.Status = provider.KycReview
		res.Reason = "youverify: liveness not confirmed"
	}
	return res
}

// mapDocument normalizes a Youverify document/candidate verification response.
func mapDocument(raw []byte, clientRef string) provider.KycCheckResult {
	res := provider.KycCheckResult{
		ExtractedFields: map[string]string{},
		Raw:             raw,
		ProviderRef:     clientRef,
		Terminal:        true,
	}
	var env struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			ID           string          `json:"id"`
			Status       string          `json:"status"`
			DocumentType string          `json:"documentType"`
			Confidence   float64         `json:"confidence"`
			FirstName    json.RawMessage `json:"firstName"`
			LastName     json.RawMessage `json:"lastName"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		res.Status = provider.KycFailed
		res.Reason = "youverify: malformed document response"
		return res
	}
	if env.Data.ID != "" {
		res.ProviderRef = env.Data.ID
	}
	if env.Data.DocumentType != "" {
		res.ExtractedFields["document_type"] = env.Data.DocumentType
	}
	putRaw(res.ExtractedFields, "first_name", env.Data.FirstName)
	putRaw(res.ExtractedFields, "last_name", env.Data.LastName)
	res.Confidence = env.Data.Confidence
	res.Match = env.Success
	if res.Match {
		res.Status = provider.KycPassed
	} else {
		res.Status = provider.KycReview
		res.Reason = "youverify: " + firstNonEmpty(env.Message, "document not verified")
	}
	return res
}

// mapAML normalizes a Youverify AML screening response.
func mapAML(raw []byte, clientRef string) provider.KycCheckResult {
	res := provider.KycCheckResult{
		ExtractedFields: map[string]string{},
		Raw:             raw,
		ProviderRef:     clientRef,
		Terminal:        true,
	}
	var env struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			ID    string          `json:"id"`
			Hits  json.RawMessage `json:"hits"`
			Match json.RawMessage `json:"match"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		res.Status = provider.KycFailed
		res.Reason = "youverify: malformed aml response"
		return res
	}
	if env.Data.ID != "" {
		res.ProviderRef = env.Data.ID
	}
	hit := hasContent(env.Data.Hits) || hasContent(env.Data.Match)
	if hit {
		res.Match = true // hit surfaced
		res.Status = provider.KycReview
		res.Reason = "youverify: AML/PEP/sanctions hit"
		res.ExtractedFields["aml_hit"] = "true"
	} else {
		res.Status = provider.KycPassed
		res.ExtractedFields["aml_hit"] = "false"
	}
	return res
}

// sandboxPending is returned when the token is missing (SANDBOX-FIRST rule).
func sandboxPending(clientRef string) provider.KycCheckResult {
	return provider.KycCheckResult{
		Status:          provider.KycPending,
		Terminal:        false,
		Reason:          "sandbox: youverify not configured",
		ExtractedFields: map[string]string{},
		ProviderRef:     clientRef,
	}
}

// mapWebhook normalizes a Youverify webhook envelope into a KycWebhookEvent.
func mapWebhook(raw []byte) (*provider.KycWebhookEvent, error) {
	var env struct {
		Event string `json:"event"`
		Data  struct {
			ID              string          `json:"id"`
			RequestedByID   string          `json:"requestedById"`
			Reference       string          `json:"reference"`
			MetadataRequest json.RawMessage `json:"metadata"`
			Status          string          `json:"status"`
			FaceDetails     struct {
				Confidence float64 `json:"confidence"`
			} `json:"face_details"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, fmt.Errorf("youverify: parse webhook: %w", err)
	}
	ev := &provider.KycWebhookEvent{
		Provider:    "youverify",
		EventID:     env.Data.ID,
		ClientRef:   env.Data.Reference,
		ProviderRef: env.Data.ID,
		Status:      mapWebhookStatus(env.Data.Status),
		Confidence:  env.Data.FaceDetails.Confidence,
		Raw:         raw,
	}
	if ev.EventID == "" {
		ev.EventID = env.Data.Reference
	}
	return ev, nil
}

func mapWebhookStatus(s string) provider.KycCheckStatus {
	switch strings.ToLower(s) {
	case "found", "verified", "completed", "success", "successful", "passed", "approved":
		return provider.KycPassed
	case "not_found", "failed", "rejected", "declined":
		return provider.KycFailed
	case "pending_review", "review", "manual_review":
		return provider.KycReview
	default:
		return provider.KycPending
	}
}

// --- small helpers ---

func pickRef(data json.RawMessage, fallback string) string {
	var d struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &d); err == nil && d.ID != "" {
		return d.ID
	}
	return fallback
}

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

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

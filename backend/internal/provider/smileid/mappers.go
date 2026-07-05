package smileid

import (
	"encoding/json"
	"fmt"
	"strings"

	"spotlight/backend/internal/provider"
)

// Smile ID job types (subset used here).
const (
	jobTypeBiometricKYC = 1  // biometric KYC (enhanced_kyc + SmartSelfie / liveness)
	jobTypeDocVerify    = 11 // document verification
)

// mapSubmitAccepted builds the PENDING result returned when a Smile ID job is
// accepted. Smile ID is callback-based, so the sync response is NEVER terminal;
// the authoritative verdict arrives via ParseKycWebhook. ClientRef is echoed on
// ProviderRef so the callback can correlate.
func mapSubmitAccepted(raw []byte, clientRef string) provider.KycCheckResult {
	res := provider.KycCheckResult{
		Status:          provider.KycPending,
		Terminal:        false,
		ExtractedFields: map[string]string{},
		Raw:             raw,
		ProviderRef:     clientRef,
		Reason:          "smileid: job submitted, awaiting callback",
	}
	// Smile ID sync ack may carry a smile_job_id; prefer it as ProviderRef.
	var ack struct {
		SmileJobID string `json:"SmileJobID"`
		JobID      string `json:"job_id"`
		Success    bool   `json:"success"`
		Error      string `json:"error"`
	}
	if err := json.Unmarshal(raw, &ack); err == nil {
		if ack.SmileJobID != "" {
			res.ProviderRef = ack.SmileJobID
		} else if ack.JobID != "" {
			res.ProviderRef = ack.JobID
		}
		if ack.Error != "" {
			res.Reason = "smileid: " + ack.Error
		}
	}
	return res
}

// sandboxPending is returned when credentials are missing (SANDBOX-FIRST rule).
func sandboxPending(clientRef string) provider.KycCheckResult {
	return provider.KycCheckResult{
		Status:          provider.KycPending,
		Terminal:        false,
		Reason:          "sandbox: smileid not configured",
		ExtractedFields: map[string]string{},
		ProviderRef:     clientRef,
	}
}

// smileResultCodes: 0810/1020/... — we key off ResultCode families and the
// Actions block rather than hardcoding every code. Authoritative on the callback.
//
// duplicate-identity fraud signal: IDNumberPreviouslyRegistered ("true"/"false")
// + UserIDsOfPreviousRegistrants (list) are surfaced into ExtractedFields so the
// admin fraud queue can flag a reused ID.
func mapCallback(raw []byte) (*provider.KycWebhookEvent, error) {
	var cb struct {
		SmileJobID   string          `json:"SmileJobID"`
		PartnerParams struct {
			JobID  string `json:"job_id"`
			UserID string `json:"user_id"`
		} `json:"PartnerParams"`
		ResultCode string          `json:"ResultCode"`
		ResultText string          `json:"ResultText"`
		Actions    map[string]any  `json:"Actions"`
		Confidence json.RawMessage `json:"ConfidenceValue"`

		// Fraud signal (duplicate identity).
		IDNumberPreviouslyRegistered json.RawMessage `json:"IDNumberPreviouslyRegistered"`
		UserIDsOfPreviousRegistrants json.RawMessage `json:"UserIDsOfPreviousRegistrants"`

		ConfirmSignature string `json:"confirm_signature"`
		Timestamp        string `json:"timestamp"`
	}
	if err := json.Unmarshal(raw, &cb); err != nil {
		return nil, fmt.Errorf("smileid: parse callback: %w", err)
	}

	status, match := classifyResult(cb.ResultCode, cb.Actions)

	ev := &provider.KycWebhookEvent{
		Provider:    "smileid",
		EventID:     cb.SmileJobID,
		ClientRef:   cb.PartnerParams.JobID,
		ProviderRef: cb.SmileJobID,
		Status:      status,
		Match:       match,
		Confidence:  parseConfidence(cb.Confidence),
		Reason:      cb.ResultText,
		Raw:         raw,
	}
	if ev.EventID == "" {
		ev.EventID = cb.PartnerParams.JobID
	}
	return ev, nil
}

// classifyResult maps a Smile ID ResultCode + Actions block to a normalized
// status + facial match. Smile ID success codes for verification are in the
// 1012/0810/2814 families; the Actions block ("Verify_ID_Number":"Passed",
// "Selfie_To_ID_Card_Compare":"Passed"/"Failed") is the reliable signal.
func classifyResult(resultCode string, actions map[string]any) (provider.KycCheckStatus, bool) {
	match := false
	anyFailed := false
	anyPassed := false
	for _, v := range actions {
		s, ok := v.(string)
		if !ok {
			continue
		}
		switch strings.ToLower(s) {
		case "passed", "verified", "approved", "exact match", "provisional":
			anyPassed = true
			match = true
		case "failed", "rejected", "declined", "no match", "not applicable":
			if strings.ToLower(s) != "not applicable" {
				anyFailed = true
			}
		}
	}
	switch {
	case anyFailed:
		return provider.KycFailed, match
	case anyPassed:
		return provider.KycPassed, match
	}
	// Fall back to result code prefixes when Actions are absent.
	switch {
	case strings.HasPrefix(resultCode, "08") || strings.HasPrefix(resultCode, "10") || strings.HasPrefix(resultCode, "28"):
		return provider.KycPassed, true
	case resultCode == "":
		return provider.KycPending, false
	default:
		return provider.KycReview, false
	}
}

// applyFraudSignal writes the duplicate-identity fraud fields into a result's
// ExtractedFields when Smile ID reports a previously-registered ID.
func applyFraudSignal(fields map[string]string, prevRegistered, prevUserIDs json.RawMessage) {
	if b := boolish(prevRegistered); b != "" {
		fields["id_previously_registered"] = b
	}
	if ids := stringifyList(prevUserIDs); ids != "" {
		fields["previous_registrant_user_ids"] = ids
	}
}

// mapCallbackResult produces a KycCheckResult (used by tests / any sync-callback
// bridge) from a raw Smile ID callback, including the fraud signal.
func mapCallbackResult(raw []byte) provider.KycCheckResult {
	ev, err := mapCallback(raw)
	res := provider.KycCheckResult{
		ExtractedFields: map[string]string{},
		Raw:             raw,
		Terminal:        true,
	}
	if err != nil {
		res.Status = provider.KycFailed
		res.Reason = err.Error()
		return res
	}
	res.Status = ev.Status
	res.Match = ev.Match
	res.Confidence = ev.Confidence
	res.Reason = ev.Reason
	res.ProviderRef = ev.ProviderRef

	var cb struct {
		IDNumberPreviouslyRegistered json.RawMessage `json:"IDNumberPreviouslyRegistered"`
		UserIDsOfPreviousRegistrants json.RawMessage `json:"UserIDsOfPreviousRegistrants"`
	}
	if json.Unmarshal(raw, &cb) == nil {
		applyFraudSignal(res.ExtractedFields, cb.IDNumberPreviouslyRegistered, cb.UserIDsOfPreviousRegistrants)
	}
	return res
}

// --- helpers ---

func parseConfidence(v json.RawMessage) float64 {
	if len(v) == 0 || string(v) == "null" {
		return 0
	}
	var f float64
	if err := json.Unmarshal(v, &f); err == nil {
		return f
	}
	var s string
	if err := json.Unmarshal(v, &s); err == nil {
		var g float64
		if _, e := fmt.Sscanf(s, "%f", &g); e == nil {
			return g
		}
	}
	return 0
}

func boolish(v json.RawMessage) string {
	s := strings.Trim(strings.TrimSpace(string(v)), `"`)
	switch strings.ToLower(s) {
	case "true", "1", "yes":
		return "true"
	case "false", "0", "no":
		return "false"
	case "", "null":
		return ""
	default:
		return s
	}
}

func stringifyList(v json.RawMessage) string {
	if len(v) == 0 || string(v) == "null" {
		return ""
	}
	var list []string
	if err := json.Unmarshal(v, &list); err == nil {
		if len(list) == 0 {
			return ""
		}
		return strings.Join(list, ",")
	}
	s := strings.Trim(strings.TrimSpace(string(v)), `"`)
	if s == "[]" {
		return ""
	}
	return s
}

package doctor

import (
	"context"
	"encoding/json"
)

// service_clinical.go — Wave 3a (human-side CLINICAL) business logic.
//
// Mirrors the Wave 2 service style: reads delegate to the repository scoped to the
// authenticated doctor; mutations that target a table with a UNIQUE idempotency_key,
// or that transition an existing row, require the Idempotency-Key header
// (ErrIdempotencyRequired) and rely on the repository's ON CONFLICT replay /
// status-guarded UPDATE. None of these touch the money ledger — they are clinical
// state transitions / document writes. Monetary fields stay int64 kobo (no floats).
//
// The free-form `Generic` request bodies are passed through as json.RawMessage; the
// few typed knobs the OpenAPI summaries imply (status verbs, message body, decision)
// are pulled out of the raw patch via small helpers below.

// clinicalAction extracts a known status/decision verb and a free body from a raw
// patch. e.g. {"status":"approved","detail":{...}} or {"decision":"reject"}.
type clinicalPatch struct {
	Status         *string         `json:"status,omitempty"`
	Decision       *string         `json:"decision,omitempty"`
	Body           *string         `json:"body,omitempty"`
	Author         *string         `json:"author,omitempty"`
	Reason         *string         `json:"reason,omitempty"`
	SpecialistID   *string         `json:"specialistId,omitempty"`
	PatientID      *string         `json:"patientId,omitempty"`
	AppointmentID  *string         `json:"appointmentId,omitempty"`
	PrescriptionID *string         `json:"prescriptionId,omitempty"`
	SharedWith     *string         `json:"sharedWith,omitempty"`
	Question       *string         `json:"question,omitempty"`
	Title          *string         `json:"title,omitempty"`
	Condition      *string         `json:"condition,omitempty"`
	Interpretation *string         `json:"interpretation,omitempty"`
	Kind           *string         `json:"kind,omitempty"`
	AmountKobo     int64           `json:"amountKobo,omitempty"`
	Plan           json.RawMessage `json:"plan,omitempty"`
	Readings       json.RawMessage `json:"readings,omitempty"`
}

func parseClinicalPatch(raw json.RawMessage) clinicalPatch {
	var p clinicalPatch
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &p)
	}
	return p
}

// ══ PHARMACY ════════════════════════════════════════════════════════════════

func (s *Service) ListPharmacyFulfilments(ctx context.Context, userID string) ([]PharmacyFulfilment, error) {
	return s.repo.ListPharmacyFulfilments(ctx, userID)
}

func (s *Service) GetPharmacyFulfilment(ctx context.Context, userID, id string) (*PharmacyFulfilment, error) {
	return s.repo.GetPharmacyFulfilment(ctx, userID, id)
}

func (s *Service) GetFulfilmentDelivery(ctx context.Context, userID, fulfilmentID string) (*DrugDelivery, error) {
	return s.repo.GetDeliveryForFulfilment(ctx, userID, fulfilmentID)
}

func (s *Service) ConfirmFulfilmentReceived(ctx context.Context, userID, fulfilmentID, idemKey string, detail json.RawMessage) (*PharmacyFulfilment, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.ConfirmFulfilmentReceived(ctx, userID, fulfilmentID, detail)
}

// ReviewSubstitute decides on a proposed substitution. The decision verb (approve|
// reject) comes from the body ("status" or "decision"); we normalise to approved/rejected.
func (s *Service) ReviewSubstitute(ctx context.Context, userID, fulfilmentID, idemKey string, raw json.RawMessage) (*PharmacySubstitute, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	status := normaliseDecision(strOrDefault(p.Status, strOrDefault(p.Decision, "approved")))
	return s.repo.ReviewSubstitute(ctx, userID, fulfilmentID, status, raw)
}

func (s *Service) ListDrugDeliveries(ctx context.Context, userID string) ([]DrugDelivery, error) {
	return s.repo.ListDrugDeliveries(ctx, userID)
}

func (s *Service) ListRefillRequests(ctx context.Context, userID string) ([]RefillRequest, error) {
	return s.repo.ListRefillRequests(ctx, userID)
}

func (s *Service) GetRefillRequest(ctx context.Context, userID, id string) (*RefillRequest, error) {
	return s.repo.GetRefillRequest(ctx, userID, id)
}

// ReviewRefill approves / rejects / marks-consultation-required a refill request.
func (s *Service) ReviewRefill(ctx context.Context, userID, refillID, idemKey string, raw json.RawMessage) (*RefillRequest, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	status := strOrDefault(p.Status, strOrDefault(p.Decision, "approved"))
	switch status {
	case "approve", "approved":
		status = "approved"
	case "reject", "rejected":
		status = "rejected"
	case "consultation", "consultation_required", "consultation-required":
		status = "consultation_required"
	}
	return s.repo.ReviewRefill(ctx, userID, refillID, status, raw)
}

func (s *Service) ListPharmacyMessages(ctx context.Context, userID, fulfilmentID string) ([]PharmacyMessage, error) {
	return s.repo.ListPharmacyMessages(ctx, userID, fulfilmentID)
}

func (s *Service) SendPharmacyMessage(ctx context.Context, userID, fulfilmentID, idemKey string, raw json.RawMessage) (*PharmacyMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	return s.repo.InsertPharmacyMessage(ctx, userID, fulfilmentID, strOrDefault(p.Author, "doctor"), p.Body, idemKey)
}

// ── Pharmacy reference directories (no backing table → empty projection) ──────

func (s *Service) ListPharmacies(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

func (s *Service) GetPreferredPharmacy(ctx context.Context, userID string) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func (s *Service) GetPharmacyStock(ctx context.Context, userID, pharmacyID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

// ReportPharmacy records a pharmacy report. There is no doctor_pharmacy_reports table;
// the report is captured as a safety issue (existing append-only table) for follow-up.
func (s *Service) ReportPharmacy(ctx context.Context, userID, pharmacyID, idemKey string, raw json.RawMessage) (*SafetyIssue, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	subject := "pharmacy_report:" + pharmacyID
	return s.repo.InsertSafetyIssue(ctx, userID, idemKey, ReportSafetyIssueRequest{
		Severity: "medium",
		Subject:  &subject,
		Detail:   raw,
	})
}

func (s *Service) ListDeliveryAlerts(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

// ══ LABS (extended) ═════════════════════════════════════════════════════════

// Reference catalogues have no backing table → empty projections.
func (s *Service) ListLabCatalogue(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}
func (s *Service) ListLabPackages(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}
func (s *Service) ListLabProviders(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}
func (s *Service) ListLabValueComparisons(ctx context.Context, userID, resultID string) ([]json.RawMessage, error) {
	// Confirms ownership of the result, then returns the (currently empty) trend set.
	if _, err := s.repo.GetLabResultRich(ctx, userID, resultID); err != nil {
		return nil, err
	}
	return []json.RawMessage{}, nil
}

func (s *Service) GetLabOrderRich(ctx context.Context, userID, orderID string) (*LabOrder, error) {
	return s.repo.TouchLabOrder(ctx, userID, orderID)
}

func (s *Service) CancelLabOrder(ctx context.Context, userID, orderID, idemKey string) (*LabOrder, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.CancelLabOrder(ctx, userID, orderID)
}

func (s *Service) ShareLabOrder(ctx context.Context, userID, orderID, idemKey string, raw json.RawMessage) (*LabOrder, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.TouchLabOrder(ctx, userID, orderID)
}

func (s *Service) ListLabResultInbox(ctx context.Context, userID string) ([]LabResultInbox, error) {
	return s.repo.ListLabResultInbox(ctx, userID)
}

func (s *Service) GetLabResultRich(ctx context.Context, userID, resultID string) (*LabResult, error) {
	return s.repo.GetLabResultRich(ctx, userID, resultID)
}

func (s *Service) AddLabInterpretation(ctx context.Context, userID, resultID, idemKey string, raw json.RawMessage) (*LabInterpretation, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	return s.repo.AddLabInterpretation(ctx, userID, resultID, strOrDefault(p.Interpretation, ""), raw, idemKey)
}

func (s *Service) ShareLabExplanation(ctx context.Context, userID, resultID, idemKey string, raw json.RawMessage) (*LabResult, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.TouchLabResult(ctx, userID, resultID)
}

// ReportSuspiciousResult files a suspicious-result report as a safety issue (append-only).
func (s *Service) ReportSuspiciousResult(ctx context.Context, userID, resultID, idemKey string, raw json.RawMessage) (*SafetyIssue, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	subject := "suspicious_lab_result:" + resultID
	return s.repo.InsertSafetyIssue(ctx, userID, idemKey, ReportSafetyIssueRequest{
		Severity: "high",
		Subject:  &subject,
		Detail:   raw,
	})
}

// ══ REFERRALS & COLLABORATION ═══════════════════════════════════════════════

func (s *Service) ListReferrals(ctx context.Context, userID string) ([]Referral, error) {
	return s.repo.ListReferrals(ctx, userID)
}

func (s *Service) GetReferral(ctx context.Context, userID, id string) (*Referral, error) {
	return s.repo.GetReferral(ctx, userID, id)
}

func (s *Service) CreateReferral(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*Referral, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	return s.repo.InsertReferral(ctx, userID, p.SpecialistID, p.PatientID, p.Reason, raw, idemKey)
}

func (s *Service) ListIncomingReferrals(ctx context.Context, userID string) ([]IncomingReferral, error) {
	return s.repo.ListIncomingReferrals(ctx, userID)
}

func (s *Service) GetIncomingReferral(ctx context.Context, userID, id string) (*IncomingReferral, error) {
	return s.repo.GetIncomingReferral(ctx, userID, id)
}

func (s *Service) AcceptIncomingReferral(ctx context.Context, userID, referralID, idemKey string, raw json.RawMessage) (*IncomingReferral, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.ReviewIncomingReferral(ctx, userID, referralID, "accepted", raw)
}

func (s *Service) RejectIncomingReferral(ctx context.Context, userID, referralID, idemKey string, raw json.RawMessage) (*IncomingReferral, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.ReviewIncomingReferral(ctx, userID, referralID, "rejected", raw)
}

func (s *Service) ListOpinionRequests(ctx context.Context, userID string) ([]OpinionRequest, error) {
	return s.repo.ListOpinionRequests(ctx, userID)
}

func (s *Service) GetOpinionRequest(ctx context.Context, userID, id string) (*OpinionRequest, error) {
	return s.repo.GetOpinionRequest(ctx, userID, id)
}

func (s *Service) CreateOpinionRequest(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*OpinionRequest, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	return s.repo.InsertOpinionRequest(ctx, userID, p.PatientID, p.Question, raw, idemKey)
}

func (s *Service) ListCareTeamMessages(ctx context.Context, userID, threadID string) ([]CareTeamMessage, error) {
	return s.repo.ListCareTeamMessages(ctx, userID, threadID)
}

func (s *Service) SendCareTeamMessage(ctx context.Context, userID, threadID, idemKey string, raw json.RawMessage) (*CareTeamMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	return s.repo.InsertCareTeamMessage(ctx, userID, threadID, strOrDefault(p.Author, "doctor"), p.Body, idemKey)
}

// GetSharedCaseSummary projects a care-team thread by its caseRef (used as thread id).
func (s *Service) GetSharedCaseSummary(ctx context.Context, userID, caseRef string) ([]CareTeamMessage, error) {
	return s.repo.ListCareTeamMessages(ctx, userID, caseRef)
}

// ListSpecialists has no backing table → empty directory.
func (s *Service) ListSpecialists(ctx context.Context, userID string) ([]json.RawMessage, error) {
	return []json.RawMessage{}, nil
}

// ══ FOLLOW-UP CARE ══════════════════════════════════════════════════════════

func (s *Service) ListFollowUps(ctx context.Context, userID string) ([]FollowUpPlan, error) {
	return s.repo.ListFollowUps(ctx, userID)
}

func (s *Service) GetFollowUp(ctx context.Context, userID, id string) (*FollowUpPlan, error) {
	return s.repo.GetFollowUp(ctx, userID, id)
}

func (s *Service) CreateFollowUp(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*FollowUpPlan, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	return s.repo.InsertFollowUp(ctx, userID, p.PatientID, p.AppointmentID, strOrDefault(p.Kind, "standard"), raw, idemKey)
}

func (s *Service) ApproveFollowUp(ctx context.Context, userID, followUpID, idemKey string, raw json.RawMessage) (*FollowUpPlan, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.ReviewFollowUp(ctx, userID, followUpID, "scheduled", raw)
}

func (s *Service) RejectFollowUp(ctx context.Context, userID, followUpID, idemKey string, raw json.RawMessage) (*FollowUpPlan, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.ReviewFollowUp(ctx, userID, followUpID, "rejected", raw)
}

// ReviewFollowUp backs POST /follow-ups/:followUpId/review — decision in the body.
func (s *Service) ReviewFollowUp(ctx context.Context, userID, followUpID, idemKey string, raw json.RawMessage) (*FollowUpPlan, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	decision := normaliseDecision(strOrDefault(p.Status, strOrDefault(p.Decision, "scheduled")))
	if decision == "approved" {
		decision = "scheduled"
	}
	return s.repo.ReviewFollowUp(ctx, userID, followUpID, decision, raw)
}

func (s *Service) CompleteFollowUp(ctx context.Context, userID, followUpID, idemKey string, raw json.RawMessage) (*FollowUpPlan, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.CompleteFollowUp(ctx, userID, followUpID, raw)
}

func (s *Service) SetFollowUpReminder(ctx context.Context, userID, followUpID, idemKey string, raw json.RawMessage) (*FollowUpPlan, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.SetFollowUpReminder(ctx, userID, followUpID, raw)
}

// GetFollowUpEligibility derives eligibility for a patient from prior follow-ups.
func (s *Service) GetFollowUpEligibility(ctx context.Context, userID, patientID string) (map[string]any, error) {
	plans, err := s.repo.ListFollowUps(ctx, userID)
	if err != nil {
		return nil, err
	}
	open := 0
	for _, p := range plans {
		if p.PatientID != nil && *p.PatientID == patientID && p.Status != "completed" && p.Status != "rejected" {
			open++
		}
	}
	return map[string]any{
		"patientId":     patientID,
		"eligible":      open == 0,
		"openFollowUps": open,
	}, nil
}

func (s *Service) ListCarePlans(ctx context.Context, userID string) ([]CarePlan, error) {
	return s.repo.ListCarePlans(ctx, userID)
}

func (s *Service) GetCarePlan(ctx context.Context, userID, id string) (*CarePlan, error) {
	return s.repo.GetCarePlan(ctx, userID, id)
}

func (s *Service) SaveCarePlan(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*CarePlan, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	plan := p.Plan
	if len(plan) == 0 {
		plan = raw
	}
	return s.repo.InsertCarePlan(ctx, userID, p.PatientID, p.Title, plan, idemKey)
}

func (s *Service) ListChronicMonitoring(ctx context.Context, userID string) ([]ChronicMonitoringEntry, error) {
	return s.repo.ListChronicMonitoring(ctx, userID)
}

// SaveChronicMonitoring writes a chronic-monitoring entry. The table has NO
// idempotency_key column, so the Idempotency-Key header is not required here.
func (s *Service) SaveChronicMonitoring(ctx context.Context, userID string, raw json.RawMessage) (*ChronicMonitoringEntry, error) {
	p := parseClinicalPatch(raw)
	return s.repo.InsertChronicMonitoring(ctx, userID, p.PatientID, p.Condition, p.Readings, raw)
}

func (s *Service) ListAdherenceChecks(ctx context.Context, userID string) ([]AdherenceCheck, error) {
	return s.repo.ListAdherenceChecks(ctx, userID)
}

func (s *Service) RecordAdherenceCheck(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*AdherenceCheck, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	return s.repo.InsertAdherenceCheck(ctx, userID, p.PatientID, p.PrescriptionID, strOrDefault(p.Status, "pending"), raw, idemKey)
}

// ══ HMO ═════════════════════════════════════════════════════════════════════

func (s *Service) GetHMOCoverage(ctx context.Context, userID, patientID string) (*HMOPlanCoverage, error) {
	return s.repo.GetHMOCoverageForPatient(ctx, userID, patientID)
}

func (s *Service) ListPreAuthRequests(ctx context.Context, userID string) ([]HMOPreAuthRequest, error) {
	return s.repo.ListPreAuthRequests(ctx, userID)
}

func (s *Service) GetPreAuthRequest(ctx context.Context, userID, id string) (*HMOPreAuthRequest, error) {
	return s.repo.GetPreAuthRequest(ctx, userID, id)
}

// RequestPreAuth records a pre-authorisation request. amountKobo is captured for
// context only — this is NOT a wallet movement, so no ledger entry is posted.
func (s *Service) RequestPreAuth(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*HMOPreAuthRequest, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	return s.repo.InsertPreAuthRequest(ctx, userID, p.PatientID, p.AppointmentID, p.AmountKobo, raw, idemKey)
}

func (s *Service) ListCoveredServices(ctx context.Context, userID string) ([]HMOCoveredService, error) {
	return s.repo.ListCoveredServices(ctx, userID)
}

func (s *Service) ListHMOClaims(ctx context.Context, userID string) ([]HMOClaim, error) {
	return s.repo.ListHMOClaims(ctx, userID)
}

func (s *Service) GetHMOClaim(ctx context.Context, userID, id string) (*HMOClaim, error) {
	return s.repo.GetHMOClaim(ctx, userID, id)
}

func (s *Service) ListHMOSupportMessages(ctx context.Context, userID, threadID string) ([]HMOSupportMessage, error) {
	return s.repo.ListHMOSupportMessages(ctx, userID, threadID)
}

func (s *Service) SendHMOSupportMessage(ctx context.Context, userID, threadID, idemKey string, raw json.RawMessage) (*HMOSupportMessage, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	return s.repo.InsertHMOSupportMessage(ctx, userID, threadID, strOrDefault(p.Author, "doctor"), p.Body, idemKey)
}

func (s *Service) ListFraudWarnings(ctx context.Context, userID string) ([]HMOFraudWarning, error) {
	return s.repo.ListFraudWarnings(ctx, userID)
}

func (s *Service) AckFraudWarning(ctx context.Context, userID, warningID, idemKey string) (*HMOFraudWarning, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.AckFraudWarning(ctx, userID, warningID)
}

// ══ MEDICAL RECORDS ═════════════════════════════════════════════════════════

// GetRecordsDashboard projects a summary across the doctor's record shares + access log.
func (s *Service) GetRecordsDashboard(ctx context.Context, userID string) (map[string]any, error) {
	shares, err := s.repo.ListRecordShares(ctx, userID)
	if err != nil {
		return nil, err
	}
	active := 0
	for _, sh := range shares {
		if sh.Status == "active" {
			active++
		}
	}
	return map[string]any{
		"totalShares":  len(shares),
		"activeShares": active,
		"shares":       shares,
	}, nil
}

// GetPatientRecordIndex returns the access log for a patient as the record index,
// after writing a 'view' access-log entry (append-only audit of the access).
func (s *Service) GetPatientRecordIndex(ctx context.Context, userID, patientID string) ([]RecordAccessEntry, error) {
	if _, err := s.repo.InsertRecordAccess(ctx, userID, patientID, "view", nil); err != nil {
		return nil, err
	}
	return s.repo.ListRecordAccessLog(ctx, userID, patientID)
}

func (s *Service) ListRecordRestrictions(ctx context.Context, userID, patientID string) ([]RecordRestriction, error) {
	return s.repo.ListRecordRestrictions(ctx, userID, patientID)
}

// ListRestrictedWarnings projects only the restricted=true rows as warnings.
func (s *Service) ListRestrictedWarnings(ctx context.Context, userID, patientID string) ([]RecordRestriction, error) {
	all, err := s.repo.ListRecordRestrictions(ctx, userID, patientID)
	if err != nil {
		return nil, err
	}
	out := []RecordRestriction{}
	for _, rr := range all {
		if rr.Restricted {
			out = append(out, rr)
		}
	}
	return out, nil
}

func (s *Service) ListRecordShares(ctx context.Context, userID string) ([]RecordShare, error) {
	return s.repo.ListRecordShares(ctx, userID)
}

func (s *Service) ShareRecord(ctx context.Context, userID, patientID, idemKey string, raw json.RawMessage) (*RecordShare, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	p := parseClinicalPatch(raw)
	share, err := s.repo.InsertRecordShare(ctx, userID, patientID, p.SharedWith, raw, idemKey)
	if err != nil {
		return nil, err
	}
	_, _ = s.repo.InsertRecordAccess(ctx, userID, patientID, "share", raw)
	return share, nil
}

// RequestRecordAccess logs an access request (append-only).
func (s *Service) RequestRecordAccess(ctx context.Context, userID, patientID, idemKey string, raw json.RawMessage) (*RecordAccessEntry, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertRecordAccess(ctx, userID, patientID, "access_request", raw)
}

// ExportRecord returns a download descriptor and logs an 'export' access entry.
func (s *Service) ExportRecord(ctx context.Context, userID, patientID, idemKey string, raw json.RawMessage) (map[string]any, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	entry, err := s.repo.InsertRecordAccess(ctx, userID, patientID, "export", raw)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"patientId": patientID,
		"status":    "ready",
		"exportId":  entry.ID,
		"format":    "pdf",
	}, nil
}

// normaliseDecision maps approve/accept verbs → "approved", reject verbs → "rejected".
func normaliseDecision(v string) string {
	switch v {
	case "approve", "approved", "accept", "accepted":
		return "approved"
	case "reject", "rejected", "decline", "declined":
		return "rejected"
	default:
		return v
	}
}

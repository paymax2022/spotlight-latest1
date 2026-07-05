// Package care is the Paymax AI Symptom Checker CARE-ROUTING + ESCALATION layer
// (PRD §6 care-loop, §11 SC-5/SC-8). It turns a triage disposition into a concrete
// next step — book a pharmacist/lab/telemed consult, or for an emergency surface
// the nearest ER + ambulance + first-aid AND raise a human-in-loop escalation.
//
// SAFETY (SC-5): high-risk dispositions are NEVER auto-resolved by the machine — an
// escalation is raised and a human clinician must acknowledge/resolve, with a clear
// hand-off (patient + clinician notified). SC-8: the emergency shortcut (nearest ER)
// is always available, independent of any session/payment state.
//
// MONEY: paid routes (telemed/lab/pharmacy) charge the wallet via the Payment port
// (ledger-backed, idempotent on the Idempotency-Key); emergency + self_care never
// charge. Amounts are integers in minor units (kobo). State changes go through the
// guarded transitions in the parent `triage` package (CanReferral / CanEscalation).
package care

import (
	"time"

	triage "spotlight/backend/internal/health/triage"
)

// CareReferral is the routed next-step for a triage session (DB:
// health_triage_care_referrals). It is the CareReferral state machine carrier:
//
//	created → routed(pharmacy|lab|telemed|emergency|self_care) → paid → fulfilled
//	        → follow_up → closed   (emergency/self_care need no payment)
//
// AmountMinor is in kobo; PaymentRef pins the ledger charge once paid; TargetRef
// pins the downstream booking/order id once booked.
type CareReferral struct {
	ID               string               `json:"id"`
	SessionID        string               `json:"session_id"`
	UserID           string               `json:"user_id"`
	DispositionLevel int                  `json:"disposition_level"`
	Route            string               `json:"route"` // pharmacy|lab|telemed|emergency|self_care
	TargetRef        *string              `json:"target_ref,omitempty"`
	State            triage.ReferralState `json:"state"`
	AmountMinor      int64                `json:"amount_minor"`
	PaymentRef       *string              `json:"payment_ref,omitempty"`
	IdempotencyKey   *string              `json:"idempotency_key,omitempty"`
	CreatedAt        time.Time            `json:"created_at"`
	UpdatedAt        time.Time            `json:"updated_at"`
}

// Escalation is a human-in-loop case raised for a high-risk/emergency disposition
// (DB: health_triage_escalations). SC-5: a machine never closes it — a licensed
// clinician acknowledges then resolves. State machine:
//
//	raised → notified → acknowledged → resolved
type Escalation struct {
	ID          string                 `json:"id"`
	SessionID   string                 `json:"session_id"`
	UserID      string                 `json:"user_id"`
	State       triage.EscalationState `json:"state"`
	Reason      string                 `json:"reason"`
	ClinicianID *string                `json:"clinician_id,omitempty"`
	RaisedAt    time.Time              `json:"raised_at"`
	AckAt       *time.Time             `json:"ack_at,omitempty"`
	ResolvedAt  *time.Time             `json:"resolved_at,omitempty"`
}

// EmergencyInfo is the SC-8 emergency-screen payload: nearest ER + ambulance hint
// + first-aid guidance. It carries no PII and is always available.
type EmergencyInfo struct {
	FacilityName    string  `json:"facility_name"`
	FacilityAddress string  `json:"facility_address"`
	DistanceM       float64 `json:"distance_m"`
	AmbulanceNumber string  `json:"ambulance_number"`
	FirstAid        string  `json:"first_aid"`
}

// ReferResult is what Refer returns: the referral, plus (for emergency) the
// always-available emergency payload and the raised escalation so the caller can
// drive the SC-8 emergency screen + SC-5 hand-off in one round-trip.
type ReferResult struct {
	Referral   *CareReferral  `json:"referral"`
	Emergency  *EmergencyInfo `json:"emergency,omitempty"`
	Escalation *Escalation    `json:"escalation,omitempty"`
}

// NigeriaAmbulanceNumber is the national emergency line surfaced on the emergency
// screen. It is a constant (no PII) and always returned with EmergencyInfo.
const NigeriaAmbulanceNumber = "112"

// defaultFirstAid is the conservative, non-diagnostic first-aid guidance shown on
// the emergency screen while help is on the way (SC-1: navigation, not diagnosis).
const defaultFirstAid = "Stay with the patient. Keep them still and calm. " +
	"If unconscious and not breathing normally, begin CPR if trained. " +
	"Do not give food or drink. Call the ambulance number now."

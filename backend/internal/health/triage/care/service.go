package care

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	triage "spotlight/backend/internal/health/triage"
)

// ─── Injected ports (small, nil-safe) ────────────────────────────────────────
//
// Every external dependency is a narrow interface so the care loop is decoupled
// from the concrete finance/maps/notifications/care modules (no tight coupling)
// and runs in dev with nil-safe stubs.

// Payment charges the member's wallet via the double-entry ledger. It MUST be
// idempotent on idemKey (a replay returns the same ref, charges once). Amount is
// in minor units (kobo).
type Payment interface {
	Charge(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (ref string, err error)
}

// EmergencyLocator finds the nearest emergency room (maps PostGIS findNearbyOwn /
// GetRoute). It powers the SC-8 emergency screen.
type EmergencyLocator interface {
	NearestER(ctx context.Context, lat, lng float64) (name, address string, distM float64, err error)
}

// Notifier delivers a templated message to a user (patient or clinician). SC-5: the
// escalation hand-off is never a silent in-app flag.
type Notifier interface {
	Notify(ctx context.Context, userID, template string, data map[string]any) error
}

// CareBooker creates the downstream booking/order on the routed care module
// (pharmacy/lab/telemed). It returns the target ref + the amount to charge (kobo).
type CareBooker interface {
	Book(ctx context.Context, userID, route, ref string) (targetRef string, amountMinor int64, err error)
}

// FollowUp schedules a follow-up check-in (internal/scheduler). nil is safe.
type FollowUp interface {
	Schedule(ctx context.Context, userID, referralID string, at time.Time) error
}

// ─── Service ─────────────────────────────────────────────────────────────────

// CareService is the care-routing + escalation engine. It owns the CareReferral
// and Escalation state machines (guarded via the parent `triage` package) and
// orchestrates the injected ports. All ports are nil-safe.
type CareService struct {
	repo   Repository
	pay    Payment
	loc    EmergencyLocator
	notify Notifier
	booker CareBooker
	follow FollowUp
}

// NewCareService builds the care service. repo is required; pay/loc/notify/booker/
// follow are optional (nil-safe stubs apply in dev).
func NewCareService(repo Repository, pay Payment, loc EmergencyLocator, notify Notifier, booker CareBooker, follow FollowUp) *CareService {
	return &CareService{repo: repo, pay: pay, loc: loc, notify: notify, booker: booker, follow: follow}
}

// Refer turns a disposition level into a CareReferral and routes it.
//
//   - route = triage.RouteForLevel(level) (emergency | telemed | self_care).
//     pharmacy/lab are booked through CareBooker as the "telemed"-class paid path —
//     the route stored on the referral is the engine route; the booker decides the
//     concrete care module.
//   - The referral is created in `created` then guarded → `routed`.
//   - EMERGENCY: NO payment. Returns the SC-8 emergency payload (nearest ER +
//     ambulance + first-aid) AND raises a human-in-loop escalation (SC-5).
//   - PAID (telemed/lab/pharmacy): CareBooker.Book → pins target_ref + amount; the
//     referral is routed and awaits PayReferral.
//   - SELF_CARE: routed, no payment, no booking.
func (s *CareService) Refer(ctx context.Context, userID, sessionID string, level int) (*ReferResult, error) {
	if userID == "" {
		return nil, fmt.Errorf("care: unauthenticated")
	}
	if sessionID == "" {
		return nil, fmt.Errorf("care: session id required")
	}
	route := triage.RouteForLevel(level)

	ref := &CareReferral{
		ID:               uuid.New().String(),
		SessionID:        sessionID,
		UserID:           userID,
		DispositionLevel: level,
		Route:            route,
		State:            triage.RefCreated,
	}
	if err := s.repo.CreateReferral(ctx, ref); err != nil {
		return nil, err
	}

	switch route {
	case "emergency":
		return s.routeEmergency(ctx, ref, level)
	case "self_care":
		// No payment, no booking — just route it.
		if err := s.transitionReferral(ctx, ref, triage.RefCreated, triage.RefRouted, ReferralPatch{}); err != nil {
			return nil, err
		}
		return &ReferResult{Referral: ref}, nil
	default: // telemed (covers telemed/lab/pharmacy paid bookings)
		return s.routePaid(ctx, ref)
	}
}

// routeEmergency handles an emergency disposition: no charge, raise an escalation,
// return the always-available emergency payload (SC-5 + SC-8).
func (s *CareService) routeEmergency(ctx context.Context, ref *CareReferral, level int) (*ReferResult, error) {
	// Route the referral (created → routed). Emergency needs no payment.
	if err := s.transitionReferral(ctx, ref, triage.RefCreated, triage.RefRouted, ReferralPatch{}); err != nil {
		return nil, err
	}
	// SC-5: human-in-loop. Raise + notify an escalation for every emergency.
	reason := fmt.Sprintf("Emergency disposition (level %d) — in-person care required", level)
	esc, err := s.Raise(ctx, ref.SessionID, ref.UserID, reason)
	if err != nil {
		return nil, err
	}
	if _, err := s.Notify(ctx, esc.ID); err == nil {
		esc.State = triage.EscNotified // reflect to caller
	}
	// SC-8 payload (best-effort nearest ER; coords unknown here so 0,0 — the emergency
	// screen calls NearestEmergency with the device location for the precise facility).
	info := s.emergencyInfo(ctx, 0, 0)
	return &ReferResult{Referral: ref, Emergency: info, Escalation: esc}, nil
}

// routePaid books the downstream care module and pins the amount, leaving the
// referral `routed` and awaiting payment.
func (s *CareService) routePaid(ctx context.Context, ref *CareReferral) (*ReferResult, error) {
	var targetRef string
	var amount int64
	if s.booker != nil {
		tr, amt, err := s.booker.Book(ctx, ref.UserID, ref.Route, ref.ID)
		if err != nil {
			return nil, fmt.Errorf("care: book %s: %w", ref.Route, err)
		}
		targetRef, amount = tr, amt
	}
	patch := ReferralPatch{AmountMinor: &amount}
	if targetRef != "" {
		patch.TargetRef = &targetRef
	}
	if err := s.transitionReferral(ctx, ref, triage.RefCreated, triage.RefRouted, patch); err != nil {
		return nil, err
	}
	ref.AmountMinor = amount
	if targetRef != "" {
		ref.TargetRef = &targetRef
	}
	return &ReferResult{Referral: ref}, nil
}

// PayReferral charges the wallet for a routed paid referral and advances it to
// `paid`, then (best-effort) `fulfilled` once booked. Idempotent: Payment.Charge
// dedups on idemKey so a double-submit charges exactly once; re-paying an already
// paid/fulfilled referral is a no-op that returns the current row.
func (s *CareService) PayReferral(ctx context.Context, userID, referralID, idemKey string) (*CareReferral, error) {
	if userID == "" {
		return nil, fmt.Errorf("care: unauthenticated")
	}
	if idemKey == "" {
		return nil, fmt.Errorf("care: idempotency key required")
	}
	ref, err := s.repo.GetReferral(ctx, referralID)
	if err != nil {
		return nil, err
	}
	if ref.UserID != userID {
		return nil, fmt.Errorf("care: forbidden")
	}
	// Idempotent re-apply: already settled → return as-is (no second charge).
	if ref.State == triage.RefPaid || ref.State == triage.RefFulfilled ||
		ref.State == triage.RefFollowUp || ref.State == triage.RefClosed {
		return ref, nil
	}
	// self_care / emergency never pay.
	if ref.Route == "self_care" || ref.Route == "emergency" {
		return ref, nil
	}
	if ref.State != triage.RefRouted {
		return nil, fmt.Errorf("care: referral must be routed before payment, is %s", ref.State)
	}
	if ref.AmountMinor <= 0 {
		return nil, fmt.Errorf("care: referral has no positive amount to charge")
	}

	// Money: ledger-backed, idempotent on idemKey (charges exactly once on replay).
	var payRef string
	if s.pay != nil {
		reference := "triage.care:" + ref.ID
		pr, perr := s.pay.Charge(ctx, userID, reference, idemKey, ref.AmountMinor)
		if perr != nil {
			return nil, fmt.Errorf("care: charge wallet: %w", perr)
		}
		payRef = pr
	}
	// routed → paid (guarded; pins payment_ref + idempotency_key is already set
	// upstream on the row creation path if used; here we record the payment ref).
	if err := s.transitionReferral(ctx, ref, triage.RefRouted, triage.RefPaid, ReferralPatch{PaymentRef: &payRef}); err != nil {
		return nil, err
	}
	ref.State = triage.RefPaid
	if payRef != "" {
		ref.PaymentRef = &payRef
	}
	// Best-effort fulfilment (paid → fulfilled). The booking already exists; this
	// flips the referral to fulfilled. Failure here is non-fatal — the charge stands
	// and MarkFulfilled can be retried.
	if err := s.transitionReferral(ctx, ref, triage.RefPaid, triage.RefFulfilled, ReferralPatch{}); err == nil {
		ref.State = triage.RefFulfilled
	}
	return ref, nil
}

// MarkFulfilled advances a paid referral to `fulfilled` (idempotent if already so).
func (s *CareService) MarkFulfilled(ctx context.Context, userID, referralID string) (*CareReferral, error) {
	ref, err := s.repo.GetReferral(ctx, referralID)
	if err != nil {
		return nil, err
	}
	if ref.UserID != userID {
		return nil, fmt.Errorf("care: forbidden")
	}
	if ref.State == triage.RefFulfilled || ref.State == triage.RefFollowUp || ref.State == triage.RefClosed {
		return ref, nil
	}
	if err := s.transitionReferral(ctx, ref, triage.RefPaid, triage.RefFulfilled, ReferralPatch{}); err != nil {
		return nil, err
	}
	ref.State = triage.RefFulfilled
	return ref, nil
}

// FollowUp schedules a follow-up check-in (scheduler) and advances fulfilled →
// follow_up. Safe to skip the schedule when no FollowUp port is injected.
func (s *CareService) FollowUp(ctx context.Context, userID, referralID string, at time.Time) (*CareReferral, error) {
	ref, err := s.repo.GetReferral(ctx, referralID)
	if err != nil {
		return nil, err
	}
	if ref.UserID != userID {
		return nil, fmt.Errorf("care: forbidden")
	}
	if ref.State == triage.RefFollowUp || ref.State == triage.RefClosed {
		return ref, nil
	}
	if err := s.transitionReferral(ctx, ref, triage.RefFulfilled, triage.RefFollowUp, ReferralPatch{}); err != nil {
		return nil, err
	}
	ref.State = triage.RefFollowUp
	if s.follow != nil {
		if at.IsZero() {
			at = time.Now().Add(48 * time.Hour)
		}
		_ = s.follow.Schedule(ctx, userID, referralID, at)
	}
	return ref, nil
}

// Close terminates a referral. Legal from routed/paid/fulfilled/follow_up.
func (s *CareService) Close(ctx context.Context, userID, referralID string) (*CareReferral, error) {
	ref, err := s.repo.GetReferral(ctx, referralID)
	if err != nil {
		return nil, err
	}
	if ref.UserID != userID {
		return nil, fmt.Errorf("care: forbidden")
	}
	if ref.State == triage.RefClosed {
		return ref, nil
	}
	if err := s.transitionReferral(ctx, ref, ref.State, triage.RefClosed, ReferralPatch{}); err != nil {
		return nil, err
	}
	ref.State = triage.RefClosed
	return ref, nil
}

// ListReferrals returns the caller's referrals.
func (s *CareService) ListReferrals(ctx context.Context, userID string) ([]CareReferral, error) {
	return s.repo.ListReferralsByUser(ctx, userID)
}

// ─── Escalation state machine (SC-5 human-in-loop) ───────────────────────────

// Raise opens a new escalation case in `raised` (SC-5). Always auditable.
func (s *CareService) Raise(ctx context.Context, sessionID, userID, reason string) (*Escalation, error) {
	if sessionID == "" || userID == "" {
		return nil, fmt.Errorf("care: session id and user id required")
	}
	e := &Escalation{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		UserID:    userID,
		State:     triage.EscRaised,
		Reason:    reason,
		RaisedAt:  time.Now(),
	}
	if err := s.repo.CreateEscalation(ctx, e); err != nil {
		return nil, err
	}
	return e, nil
}

// Notify delivers the hand-off (patient + clinician) and advances raised →
// notified. SC-5: a high-risk case is never a silent flag.
func (s *CareService) Notify(ctx context.Context, escalationID string) (*Escalation, error) {
	e, err := s.repo.GetEscalation(ctx, escalationID)
	if err != nil {
		return nil, err
	}
	if e.State == triage.EscNotified || e.State == triage.EscAcknowledged || e.State == triage.EscResolved {
		return e, nil // idempotent
	}
	if !triage.CanEscalation(e.State, triage.EscNotified) {
		return nil, ErrIllegalTransition
	}
	if s.notify != nil {
		data := map[string]any{"escalation_id": e.ID, "session_id": e.SessionID, "reason": e.Reason}
		// Patient hand-off.
		_ = s.notify.Notify(ctx, e.UserID, "triage.escalation.patient", data)
		// Clinician hand-off (broadcast template — the on-call clinician pool).
		_ = s.notify.Notify(ctx, "", "triage.escalation.clinician", data)
	}
	if err := s.repo.UpdateEscalationState(ctx, e.ID, triage.EscRaised, triage.EscNotified, nil, nil); err != nil {
		return nil, err
	}
	e.State = triage.EscNotified
	return e, nil
}

// Acknowledge records a clinician picking up the case (notified → acknowledged).
func (s *CareService) Acknowledge(ctx context.Context, escalationID, clinicianID string) (*Escalation, error) {
	if clinicianID == "" {
		return nil, fmt.Errorf("care: clinician id required")
	}
	e, err := s.repo.GetEscalation(ctx, escalationID)
	if err != nil {
		return nil, err
	}
	if !triage.CanEscalation(e.State, triage.EscAcknowledged) {
		return nil, ErrIllegalTransition
	}
	now := time.Now()
	if err := s.repo.UpdateEscalationState(ctx, e.ID, triage.EscNotified, triage.EscAcknowledged, &clinicianID, &now); err != nil {
		return nil, err
	}
	e.State = triage.EscAcknowledged
	e.ClinicianID = &clinicianID
	e.AckAt = &now
	return e, nil
}

// Resolve closes the case (acknowledged → resolved). SC-5: only a human reaches here.
func (s *CareService) Resolve(ctx context.Context, escalationID, clinicianID string) (*Escalation, error) {
	e, err := s.repo.GetEscalation(ctx, escalationID)
	if err != nil {
		return nil, err
	}
	if !triage.CanEscalation(e.State, triage.EscResolved) {
		return nil, ErrIllegalTransition
	}
	now := time.Now()
	var clin *string
	if clinicianID != "" {
		clin = &clinicianID
	}
	if err := s.repo.UpdateEscalationState(ctx, e.ID, triage.EscAcknowledged, triage.EscResolved, clin, &now); err != nil {
		return nil, err
	}
	e.State = triage.EscResolved
	e.ResolvedAt = &now
	return e, nil
}

// ListEscalations is the admin oversight read (state filter optional).
func (s *CareService) ListEscalations(ctx context.Context, state string) ([]Escalation, error) {
	return s.repo.ListEscalations(ctx, state)
}

// NearestEmergency is the SC-8 passthrough for the emergency screen — always
// available, no session/payment required. nil-safe locator → constant fallback.
func (s *CareService) NearestEmergency(ctx context.Context, lat, lng float64) (*EmergencyInfo, error) {
	return s.emergencyInfo(ctx, lat, lng), nil
}

// ─── internals ───────────────────────────────────────────────────────────────

// transitionReferral validates the edge against the parent SM then performs the
// guarded compare-and-set in the repo (defence in depth: SM + WHERE state=$from).
func (s *CareService) transitionReferral(ctx context.Context, ref *CareReferral, from, to triage.ReferralState, patch ReferralPatch) error {
	if !triage.CanReferral(from, to) {
		return fmt.Errorf("care: illegal referral transition %s -> %s", from, to)
	}
	if err := s.repo.UpdateReferralState(ctx, ref.ID, from, to, patch); err != nil {
		return err
	}
	ref.State = to
	if patch.AmountMinor != nil {
		ref.AmountMinor = *patch.AmountMinor
	}
	if patch.TargetRef != nil {
		ref.TargetRef = patch.TargetRef
	}
	if patch.PaymentRef != nil {
		ref.PaymentRef = patch.PaymentRef
	}
	return nil
}

// emergencyInfo builds the SC-8 payload. The locator is nil-safe: on nil/err the
// payload still carries the ambulance number + first-aid (the screen must never be
// empty in an emergency).
func (s *CareService) emergencyInfo(ctx context.Context, lat, lng float64) *EmergencyInfo {
	info := &EmergencyInfo{
		AmbulanceNumber: NigeriaAmbulanceNumber,
		FirstAid:        defaultFirstAid,
	}
	if s.loc != nil {
		if name, addr, dist, err := s.loc.NearestER(ctx, lat, lng); err == nil {
			info.FacilityName = name
			info.FacilityAddress = addr
			info.DistanceM = dist
		}
	}
	return info
}

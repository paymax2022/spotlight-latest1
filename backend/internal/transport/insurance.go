package transport

import (
	"context"
	"log"
	"time"
)

// ─── Real parcel Goods-in-Transit insurance (MyCover-backed) ──────────────────
//
// Replaces the earlier in-house percentage premium: the "insurance" shown on a
// parcel estimate is now the CURRENT real rate on our synced product catalog
// (no PII sent, no consent needed — a display-only figure), and a real policy
// is bound with the real MyCover product once a courier + vehicle are actually
// known (AcceptParcel), using the proven quote→debit→bind saga in
// backend/internal/insurance/policy. See docs/adr/ for the design rationale.
//
// InsuranceBinder is the minimal seam into that saga — mirrors tierLimiter /
// MapsAdapter / CommissionRecorder: transport never imports insurance/policy,
// insurance/catalog, or insurance/consent at compile time. app-wiring supplies
// a thin adapter; nil here means "insurance unavailable", which every caller
// in this file treats as "proceed without cover", never as a hard failure —
// a parcel must never fail to book or fail to be picked up because a
// third-party insurer integration is unavailable.
type InsuranceBinder interface {
	// IndicativeRateBps returns the CURRENT display-only premium rate (basis
	// points of declared value) for productCode, read from our own already-
	// synced catalog — no provider call, no PII, safe to call on every estimate.
	IndicativeRateBps(ctx context.Context, productCode string) (bps int64, err error)
	// GrantConsent records NDPA provider-data-share consent for userID on
	// productCode. Idempotent (safe to call repeatedly).
	GrantConsent(ctx context.Context, userID, productCode string) error
	// CreateQuote gets a real, priced quote from the provider. inputs must match
	// the product's published form schema exactly (PII goes to the provider here
	// — GrantConsent must already have been called for this productCode).
	CreateQuote(ctx context.Context, userID, productCode string, sumInsuredKobo int64, inputs map[string]any) (quoteID string, premiumKobo int64, err error)
	// BindFromQuote purchases the policy for a previously created quote. On
	// failure the underlying saga has ALREADY auto-reversed any premium debit —
	// the caller only needs to decide what to do about the parcel, never retry
	// a refund itself.
	BindFromQuote(ctx context.Context, userID, quoteID, idempotencyKey string) (policyID string, premiumKobo int64, err error)
	// CancelPolicy best-effort cancels a bound policy (e.g. parcel cancelled
	// before pickup). Errors are for logging only.
	CancelPolicy(ctx context.Context, userID, policyID, reason string) error
}

// WithInsurance injects the insurance seam. Optional: a nil binder (the
// default) simply means every parcel books and delivers with no cover, exactly
// as before this feature existed — never a startup requirement.
func (s *Service) WithInsurance(b InsuranceBinder) *Service {
	s.insurance = b
	return s
}

// parcelInsuranceProductCode is our catalog code for the on-demand (single-
// shipment) Goods-in-Transit product — NOT the annual one (a parcel is one
// shipment, not a year of continuous cover), and NOT "mycover:sti-goods-in-
// transit" (a similarly-named but differently-configured product on the same
// provider that our own catalog sync marks unpurchasable — verified against
// the live catalog on 2026-09-02, see docs/adr/).
const parcelInsuranceProductCode = "mycover:sti-git-on-demand"

// parcelIndicativeInsurance returns a DISPLAY-ONLY premium estimate for the
// estimate screen: current real catalog rate × declared value, no provider
// call, no PII shared, no consent required. Falls back to the admin-configured
// transport_pricing_config rate (parcelInsurance/PricingConfig.InsuranceRateBps)
// when the insurance module isn't wired or the product lookup fails — never
// lets an unrelated outage block a fare estimate.
//
// KNOWN LIMITATION, deliberate trade-off: this is rate_bps × declared value
// only. A real live quote for mycover:sti-git-on-demand against a ₦10,000
// declared value returned a ₦2,000 premium (verified 2026-09-02) — 40× the
// ₦50 this pure-percentage estimate would show — because the provider applies
// a minimum premium floor the synced catalog does not expose. The indicative
// figure can therefore understate the real bound premium, especially for
// small declared values. Getting an exact figure would mean a live, PII-
// sharing, consent-gated quote call on every estimate request, which is the
// wrong trade for a screen the sender may never submit. The real premium is
// always shown once bound (AcceptParcel/bindParcelInsurance) — this value is
// explicitly an estimate, and should be labelled as such in the UI.
func (s *Service) parcelIndicativeInsurance(ctx context.Context, declaredValueKobo int64, cfg *PricingConfig) int64 {
	if declaredValueKobo <= 0 {
		return 0
	}
	if s.insurance != nil {
		if bps, err := s.insurance.IndicativeRateBps(ctx, parcelInsuranceProductCode); err == nil && bps > 0 {
			return roundBps(declaredValueKobo, bps)
		}
	}
	return parcelInsurance(declaredValueKobo, cfg)
}

// parcelSenderProfile is the minimal identity data a real MyCover bind needs
// beyond what BookParcel already collects. Sourced from user_profiles by the
// app-wiring adapter (not every field is guaranteed populated for every user
// — see bindParcelInsurance).
type parcelSenderProfile struct {
	FirstName   string
	LastName    string
	Email       string
	Phone       string
	Gender      string // MyCover expects "Male" | "Female"
	DateOfBirth string // YYYY-MM-DD
	Address     string
}

// parcelDriverVehicle is the assigned courier's vehicle, known only once
// AcceptParcel has run.
type parcelDriverVehicle struct {
	PlateNumber string
	VehicleType string // our enum: car | bike | tricycle
}

// mycoverVehicleType maps our constrained vehicle_type enum to MyCover's real,
// live options for this product (fetched from its options_url and verified on
// 2026-09-02: Bus, Car, Jeep - Suv, Suv, Truck, Mini-Van, Bike, Tricycle).
func mycoverVehicleType(ourType string) string {
	switch ourType {
	case "car":
		return "Car"
	case "bike":
		return "Bike"
	case "tricycle":
		return "Tricycle"
	default:
		return "Car" // conservative default; never send an empty/unmapped value
	}
}

// buildParcelInsuranceInputs builds the exact field set the live
// mycover:sti-git-on-demand form schema requires, from data this parcel and
// its assigned courier already have. Pure function — no I/O — so it is
// directly unit-testable without a database or a live API call.
func buildParcelInsuranceInputs(p *parcelRow, pickupAddr, dropoffAddr, category string, declaredValueKobo int64, sender parcelSenderProfile, vehicle parcelDriverVehicle, now time.Time) map[string]any {
	holder := map[string]any{
		"first_name":    sender.FirstName,
		"last_name":     sender.LastName,
		"email":         sender.Email,
		"phone_number":  sender.Phone,
		"gender":        sender.Gender,
		"date_of_birth": sender.DateOfBirth,
		"address":       sender.Address,
	}
	return map[string]any{
		"first_name":            sender.FirstName,
		"last_name":             sender.LastName,
		"email":                 sender.Email,
		"phone_number":          sender.Phone,
		"gender":                sender.Gender,
		"date_of_birth":         sender.DateOfBirth,
		"address":               sender.Address,
		"pickup_location":       pickupAddr,
		"drop_off_location":     dropoffAddr,
		"shipping_date":         now.Format("2006-01-02"),
		"vehicle_plate_number":  vehicle.PlateNumber,
		"vehicle_type":          mycoverVehicleType(vehicle.VehicleType),
		"total_value":           declaredValueKobo, // schema type "money", unit kobo — the gateway adapter rescales to naira
		"bought_for_self":       true,
		"policy_holder":         holder,
		"item_details": []map[string]any{
			{
				"value":       declaredValueKobo,
				"quantity":    1,
				"description": parcelItemDescription(category),
				// The live API rejects a missing key here even though the
				// published form_schema marks it "required": false — verified
				// against the real sandbox on 2026-09-02 (400: "/item_details/0
				// must have required property 'image_url'"). We have no real
				// item photo at booking time, so send the key with an empty
				// value rather than omit it.
				"image_url": "",
			},
		},
	}
}

func parcelItemDescription(category string) string {
	if category == "" {
		return "Parcel shipment"
	}
	return "Parcel shipment (" + category + ")"
}

// senderMissingProfileFields reports which required identity fields are absent
// so a bind attempt can be skipped cleanly (with a clear reason) instead of
// being sent to the provider and rejected there.
func senderMissingProfileFields(s parcelSenderProfile) []string {
	var missing []string
	if s.FirstName == "" {
		missing = append(missing, "first_name")
	}
	if s.LastName == "" {
		missing = append(missing, "last_name")
	}
	if s.Email == "" {
		missing = append(missing, "email")
	}
	if s.Phone == "" {
		missing = append(missing, "phone")
	}
	if s.Gender == "" {
		missing = append(missing, "gender")
	}
	if s.DateOfBirth == "" {
		missing = append(missing, "date_of_birth")
	}
	if s.Address == "" {
		missing = append(missing, "address")
	}
	return missing
}

// bindParcelInsurance runs the REAL quote→bind saga for one parcel, once a
// courier + vehicle are known (called from AcceptParcel). Best-effort by
// design: any failure here — missing profile data, provider rejection,
// insufficient wallet balance — is logged/notified and returned to the caller
// as a non-fatal outcome; it must NEVER block courier assignment or delivery.
// Returns (policyID, premiumKobo, ok). ok=false means "proceed uninsured".
func (s *Service) bindParcelInsurance(ctx context.Context, p *parcelRow, pickupAddr, dropoffAddr, category string, sender parcelSenderProfile, vehicle parcelDriverVehicle) (string, int64, bool) {
	if s.insurance == nil || p.DeclaredValueKobo <= 0 {
		return "", 0, false
	}
	if missing := senderMissingProfileFields(sender); len(missing) > 0 {
		log.Printf("[transport] parcel %s: skipping real insurance bind — sender profile missing %v", p.ID, missing)
		return "", 0, false
	}
	if vehicle.PlateNumber == "" {
		log.Printf("[transport] parcel %s: skipping real insurance bind — assigned courier has no vehicle plate on file", p.ID)
		return "", 0, false
	}

	if err := s.insurance.GrantConsent(ctx, p.SenderID, parcelInsuranceProductCode); err != nil {
		log.Printf("[transport] parcel %s: insurance consent grant failed, proceeding uninsured: %v", p.ID, err)
		return "", 0, false
	}

	inputs := buildParcelInsuranceInputs(p, pickupAddr, dropoffAddr, category, p.DeclaredValueKobo, sender, vehicle, time.Now())
	quoteID, _, err := s.insurance.CreateQuote(ctx, p.SenderID, parcelInsuranceProductCode, p.DeclaredValueKobo, inputs)
	if err != nil {
		log.Printf("[transport] parcel %s: insurance quote failed, proceeding uninsured: %v", p.ID, err)
		return "", 0, false
	}

	idemKey := "parcel:insurance:" + p.ID
	policyID, premiumKobo, err := s.insurance.BindFromQuote(ctx, p.SenderID, quoteID, idemKey)
	if err != nil {
		// The saga has ALREADY auto-reversed any premium debit — nothing further
		// to undo here. The sender keeps their wallet balance; the parcel proceeds.
		log.Printf("[transport] parcel %s: insurance bind failed (premium auto-reversed by the saga), proceeding uninsured: %v", p.ID, err)
		return "", 0, false
	}
	return policyID, premiumKobo, true
}

// cancelParcelInsurance best-effort cancels a bound policy. Never blocks or
// fails the parcel cancellation it's called from.
func (s *Service) cancelParcelInsurance(ctx context.Context, senderID, policyID string) {
	if s.insurance == nil || policyID == "" {
		return
	}
	if err := s.insurance.CancelPolicy(ctx, senderID, policyID, "parcel_cancelled"); err != nil {
		log.Printf("[transport] insurance policy %s cancel failed (parcel already cancelled, not blocking): %v", policyID, err)
	}
}

func roundBps(amountKobo, bps int64) int64 {
	return int64((float64(amountKobo)*float64(bps))/10000.0 + 0.5)
}

// loadParcelSenderProfile reads the identity fields a real MyCover bind needs
// from user_profiles. Not every field is guaranteed populated (this table
// backs many unrelated flows — contest entry, academy, etc. — and gender/DOB/
// address are commonly left blank); an empty result is valid and is caught by
// senderMissingProfileFields, never dereferenced blindly.
func (s *Service) loadParcelSenderProfile(ctx context.Context, userID string) parcelSenderProfile {
	var p parcelSenderProfile
	var firstName, lastName, phone, gender, address *string
	var dob *time.Time
	err := s.db.QueryRow(ctx, `
		SELECT first_name, last_name, email, phone, gender, date_of_birth, address
		FROM user_profiles WHERE id = $1`, userID,
	).Scan(&firstName, &lastName, &p.Email, &phone, &gender, &dob, &address)
	if err != nil {
		return parcelSenderProfile{} // all-empty -> caught by senderMissingProfileFields
	}
	if firstName != nil {
		p.FirstName = *firstName
	}
	if lastName != nil {
		p.LastName = *lastName
	}
	if phone != nil {
		p.Phone = *phone
	}
	if gender != nil {
		p.Gender = *gender
	}
	if address != nil {
		p.Address = *address
	}
	if dob != nil {
		p.DateOfBirth = dob.Format("2006-01-02")
	}
	return p
}

// loadParcelDriverVehicle reads the assigned courier's vehicle. Errors are
// swallowed — an empty PlateNumber is checked explicitly by the caller
// (bindParcelInsurance) before attempting a bind.
func (s *Service) loadParcelDriverVehicle(ctx context.Context, courierID string) parcelDriverVehicle {
	var v parcelDriverVehicle
	_ = s.db.QueryRow(ctx, `SELECT vehicle_reg, vehicle_type FROM drivers WHERE id = $1`, courierID).
		Scan(&v.PlateNumber, &v.VehicleType)
	return v
}

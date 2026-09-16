package mycover

import (
	"encoding/json"
	"testing"
	"time"

	"spotlight/backend/internal/insurance/gateway"
)

// Parsing tests built from a REAL, captured POST /v2/products/buy response.
//
// Every other test in this package uses a hand-written body. This one does not:
// the JSON below is the actual payload MyCover returned for a live test-mode
// purchase of "Surgery and Outpatient Hospicash Mini" (policy
// 1c4b771a-…, policy_number TESTGCM/OP/26/00434725/HO, ₦600), captured on
// 2026-08-31 — the first successful bind this integration has ever made. It was
// blocked until then on an unfunded distributor wallet, so no test could be
// written against the real shape.
//
// Person-shaped fields (email, names, phone, date_of_birth) are stripped; every
// remaining value is verbatim. The point of the fixture is precisely the keys
// that are NOT here — the adapter's pick-lists name several fields the provider
// never sends, and only a real response proves which fallback actually fires.
//
// ⚠️ Bind spends real money from a prefunded wallet and MyCover exposes no
// idempotency, so this must never become a live-calling test. It is a pure
// parse test over a stored body.
const capturedBuyResponse = `{
  "id": "1c4b771a-4730-438b-89f0-f7748b69b762",
  "policy_number": "TESTGCM/OP/26/00434725/HO",
  "amount": "600.0000",
  "certificate_url": null,
  "start_date": "2026-08-31T16:40:13.000Z",
  "expiration_date": "2027-08-26T16:40:13.000Z",
  "activation_date": "2026-08-31T16:40:13.000Z",
  "is_active": true,
  "is_submitted_to_provider": true,
  "product_id": "c4f710e9-3f86-4983-b27a-4476532626bc",
  "customer_id": "4d097514-113e-498c-9b7a-abec9b51fb0a",
  "purchase_id": "23ef5682-8489-4472-9366-125c74a16dd5",
  "reference_id": "eosKZJ1WBhYsmIi_AjIR4",
  "provider_id": "e4947116-1a7a-438e-a9fe-900c74c4df38",
  "distributor_id": "f8a42afc-12dc-4897-8583-adc66b707cb0",
  "currency_id": "6b3147f9-aa5b-4fd9-934d-ee5a179db989"
}`

func parseCaptured(t *testing.T) gateway.Policy {
	t.Helper()
	c := New("k", "", "", "")
	return c.policyFromData(json.RawMessage(capturedBuyResponse), gateway.ProviderProduct{
		Code:          "outpatient-hospicash-mini",
		Underwriter:   "Goxi MicroInsurance Company Ltd",
		CommissionBps: 1000,
	})
}

func TestCapturedBuy_PolicyRefComesFromID(t *testing.T) {
	// The adapter's pick-list tries "policy_id" FIRST. A real buy response has no
	// such key — the identifier is plain "id". If that fallback were ever dropped
	// the ref would be empty, and BindPolicy treats an empty ref as a hard
	// failure ("a purchase we cannot reference is a purchase we cannot service"),
	// so a successful, already-charged purchase would be reported as failed.
	got := parseCaptured(t)
	if got.ProviderPolicyRef != "1c4b771a-4730-438b-89f0-f7748b69b762" {
		t.Fatalf("ProviderPolicyRef = %q, want the value of `id`", got.ProviderPolicyRef)
	}
}

func TestCapturedBuy_AmountConvertsNairaToKobo(t *testing.T) {
	// THE MONEY SEAM. MyCover states money in NAIRA as a decimal string; Paymax's
	// iron rule is integer kobo. "600.0000" is ₦600 and must become 60_000 kobo.
	// Reading it as though it were already kobo understates by 100x; forwarding
	// our kobo to the provider overstates by 100x. The captured value is the one
	// that was really charged, so this pins the conversion against reality.
	got := parseCaptured(t)
	if got.PremiumKobo != 60_000 {
		t.Fatalf("PremiumKobo = %d, want 60000 (₦600 from the string \"600.0000\")", got.PremiumKobo)
	}
}

func TestCapturedBuy_ExpiryFallsBackToExpirationDate(t *testing.T) {
	// The pick-list tries end_date/expiry_date/expires_at before
	// expiration_date. Only the last one is actually present.
	got := parseCaptured(t)
	if got.ExpiresAt.IsZero() {
		t.Fatal("ExpiresAt is unset — expiration_date was not picked up")
	}
	if got.EffectiveAt.IsZero() {
		t.Fatal("EffectiveAt is unset — start_date was not picked up")
	}
}

func TestCapturedBuy_NullCertificateIsNotAFailure(t *testing.T) {
	// certificate_url comes back null here, and stayed null on a later
	// GET /v2/policies/{id}. Of five products bound live, THREE returned a
	// certificate and TWO never did — so an absent certificate is a normal
	// outcome, not an error, and the UI must render the policy without one.
	got := parseCaptured(t)
	if got.CertificateRef != "" {
		t.Fatalf("CertificateRef = %q, want empty for a null certificate_url", got.CertificateRef)
	}
}

func TestCapturedBuy_StatusComesFromIsActive(t *testing.T) {
	// This USED to assert an empty status, pinning a defect: policyFromData read
	// Status from "status"/"policy_status"/"state", and a real MyCover policy
	// carries none of them — liveness is the boolean `is_active`, which the
	// adapter parsed on the CATALOG struct but never on the policy path. Every
	// bound policy was therefore recorded with an empty status.
	//
	// Verified live 2026-08-31: is_active was true on all five bound policies and
	// on GET /v2/policies/{id}, and no status field appeared anywhere.
	got := parseCaptured(t)
	if got.Status != "active" {
		t.Fatalf("Status = %q, want \"active\" derived from is_active:true", got.Status)
	}
	// Guard the premise: if the provider ever starts sending a real status field,
	// the fallback stops being exercised and this test silently proves nothing.
	var raw map[string]any
	if err := json.Unmarshal([]byte(capturedBuyResponse), &raw); err != nil {
		t.Fatal(err)
	}
	if _, hasStatus := raw["status"]; hasStatus {
		t.Fatal("fixture drifted: the captured response now HAS a status field, so this no longer tests the is_active fallback")
	}
}

func TestCapturedBuy_InactiveInsideCoverWindowIsNotNamed(t *testing.T) {
	// `is_active:false` while the cover window is still OPEN stays "inactive",
	// deliberately outside the five normalised tokens. MyCover does not
	// distinguish cancelled from lapsed, and those two differ in whether money is
	// owed back — naming either from a bare boolean would invent a fact about
	// someone's cover, with a refund attached to the guess.
	c := New("k", "", "", "")
	future := time.Now().Add(90 * 24 * time.Hour).Format(time.RFC3339)
	body := `{"id":"p1","amount":"600.0000","is_active":false,"expiration_date":"` + future + `"}`
	got := c.policyFromData(json.RawMessage(body), gateway.ProviderProduct{})
	if got.Status != "inactive" {
		t.Fatalf("Status = %q, want \"inactive\" for a not-live policy still inside its cover window", got.Status)
	}
}

func TestCapturedBuy_InactiveAfterCoverWindowIsExpired(t *testing.T) {
	// When the window HAS closed, the dates do tell us why, so "expired" is read
	// from evidence rather than guessed. This is the one inactive case that can
	// be named.
	c := New("k", "", "", "")
	past := time.Now().Add(-24 * time.Hour).Format(time.RFC3339)
	body := `{"id":"p1","amount":"600.0000","is_active":false,"expiration_date":"` + past + `"}`
	got := c.policyFromData(json.RawMessage(body), gateway.ProviderProduct{})
	if got.Status != "expired" {
		t.Fatalf("Status = %q, want \"expired\" once the cover window has closed", got.Status)
	}
}

func TestCapturedBuy_AbsentIsActiveLeavesStatusEmpty(t *testing.T) {
	// A MISSING is_active must not read as false. An absent field means we were
	// told nothing, and "inactive" is a claim — hence pickBool returns a
	// found/not-found flag rather than a bare bool.
	c := New("k", "", "", "")
	got := c.policyFromData(json.RawMessage(`{"id":"p1","amount":"600.0000"}`), gateway.ProviderProduct{})
	if got.Status != "" {
		t.Fatalf("Status = %q, want empty when is_active is absent entirely", got.Status)
	}
}

func TestCapturedBuy_ExplicitStatusStillWins(t *testing.T) {
	// The is_active fallback must only apply when no real status field exists,
	// so a provider that starts sending one is not overridden by the boolean.
	c := New("k", "", "", "")
	got := c.policyFromData(json.RawMessage(`{"id":"p1","status":"cancelled","is_active":true}`), gateway.ProviderProduct{})
	if got.Status != "cancelled" {
		t.Fatalf("Status = %q, want \"cancelled\" — an explicit status outranks is_active", got.Status)
	}
}

package mycover

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

// A row shaped like a real GET /v2/policies item (field names verified live
// 2026-10-09), with invented personal data so the test can prove it is dropped.
const sampleActiveRow = `{
  "id": "5d3f0a6e-0000-4000-8000-000000000001",
  "first_name": "Test", "last_name": "Person", "email": "test.person@example.com",
  "phone_number": "+2348000000000", "date_of_birth": "1990-01-01",
  "start_date": "2026-09-17T00:00:00.000Z", "expiration_date": "2099-10-17T00:00:00.000Z",
  "amount": "100.0000", "total_premium": 0, "is_active": true,
  "product_id": "prod-uuid-1", "policy_number": "TESTGCM/OP/26/00000001/HO",
  "certificate_url": null, "created_at": "2026-09-17T10:00:00.000Z",
  "provider": {"id": "p1", "organization_name": "Test Underwriter"},
  "product": {"id": "prod-uuid-1", "name": "Surgery and Outpatient Hospicash", "cover_period": "1 month"},
  "mca_payload": {"price": 100, "email": "test.person@example.com"}
}`

func TestPolicySummaryFromData_MapsFieldsAndConvertsNairaToKobo(t *testing.T) {
	s, ok := policySummaryFromData(json.RawMessage(sampleActiveRow))
	if !ok {
		t.Fatal("row with an id must map")
	}
	if s.ProviderPolicyRef != "5d3f0a6e-0000-4000-8000-000000000001" {
		t.Errorf("ref = %q", s.ProviderPolicyRef)
	}
	if s.PremiumKobo != 10000 {
		t.Errorf("amount 100.0000 naira must be 10000 kobo, got %d", s.PremiumKobo)
	}
	if s.ProductName != "Surgery and Outpatient Hospicash" || s.Underwriter != "Test Underwriter" {
		t.Errorf("product/underwriter = %q / %q", s.ProductName, s.Underwriter)
	}
	if s.PolicyNumber != "TESTGCM/OP/26/00000001/HO" {
		t.Errorf("policy number = %q", s.PolicyNumber)
	}
	if s.Status != "active" {
		t.Errorf("is_active true must be active, got %q", s.Status)
	}
	if !s.StartsAt.Equal(time.Date(2026, 9, 17, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("starts_at = %v", s.StartsAt)
	}
}

func TestPolicySummaryFromData_InactivePastExpiryIsExpired(t *testing.T) {
	row := strings.Replace(sampleActiveRow, `"is_active": true`, `"is_active": false`, 1)
	row = strings.Replace(row, `2099-10-17`, `2026-10-01`, 1)
	s, _ := policySummaryFromData(json.RawMessage(row))
	if s.Status != "expired" {
		t.Errorf("inactive + past expiry must be expired, got %q", s.Status)
	}
}

func TestPolicySummaryFromData_SkipsRowWithoutID(t *testing.T) {
	if _, ok := policySummaryFromData(json.RawMessage(`{"amount":"100.0000"}`)); ok {
		t.Fatal("a row with no id has nothing to key the mirror on")
	}
}

// The mirror must never be able to hold the policyholder's personal data.
func TestPolicySummary_HasNoPersonalDataFields(t *testing.T) {
	banned := []string{"email", "phone", "firstname", "lastname", "dob", "dateofbirth", "address", "bvn", "nin"}
	typ := reflect.TypeOf(PolicySummary{})
	for i := 0; i < typ.NumField(); i++ {
		name := strings.ToLower(typ.Field(i).Name)
		for _, b := range banned {
			if strings.Contains(name, b) {
				t.Errorf("PolicySummary must not carry personal data, found field %q", typ.Field(i).Name)
			}
		}
	}
}

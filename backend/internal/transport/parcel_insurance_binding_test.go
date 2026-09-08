package transport

// Pure-logic unit tests for the real MyCover-backed parcel insurance bind:
// building the provider's required Inputs, vehicle-type mapping, and the
// missing-profile-field guard that keeps a bind attempt from ever being sent
// with data the provider would reject anyway.

import (
	"testing"
	"time"
)

func TestMycoverVehicleType_MapsRealDriverEnum(t *testing.T) {
	cases := map[string]string{"car": "Car", "bike": "Bike", "tricycle": "Tricycle", "": "Car", "unknown": "Car"}
	for in, want := range cases {
		if got := mycoverVehicleType(in); got != want {
			t.Errorf("mycoverVehicleType(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSenderMissingProfileFields_CatchesEachRequiredField(t *testing.T) {
	full := parcelSenderProfile{
		FirstName: "Ada", LastName: "Okafor", Email: "ada@example.com", Phone: "2348012345678",
		Gender: "Female", DateOfBirth: "1990-01-01", Address: "12 Marina Rd, Lagos",
	}
	if missing := senderMissingProfileFields(full); len(missing) != 0 {
		t.Fatalf("complete profile flagged missing fields: %v", missing)
	}

	cases := []struct {
		name   string
		mutate func(*parcelSenderProfile)
		want   string
	}{
		{"first name", func(p *parcelSenderProfile) { p.FirstName = "" }, "first_name"},
		{"last name", func(p *parcelSenderProfile) { p.LastName = "" }, "last_name"},
		{"email", func(p *parcelSenderProfile) { p.Email = "" }, "email"},
		{"phone", func(p *parcelSenderProfile) { p.Phone = "" }, "phone"},
		{"gender", func(p *parcelSenderProfile) { p.Gender = "" }, "gender"},
		{"date of birth", func(p *parcelSenderProfile) { p.DateOfBirth = "" }, "date_of_birth"},
		{"address", func(p *parcelSenderProfile) { p.Address = "" }, "address"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := full
			c.mutate(&p)
			missing := senderMissingProfileFields(p)
			if len(missing) != 1 || missing[0] != c.want {
				t.Fatalf("senderMissingProfileFields() = %v, want exactly [%q]", missing, c.want)
			}
		})
	}
}

func TestBuildParcelInsuranceInputs_MatchesLiveMyCoverSchema(t *testing.T) {
	p := &parcelRow{ID: "parcel-1", SenderID: "sender-1"}
	sender := parcelSenderProfile{
		FirstName: "Ada", LastName: "Okafor", Email: "ada@example.com", Phone: "2348012345678",
		Gender: "Female", DateOfBirth: "1990-01-01", Address: "12 Marina Rd, Lagos",
	}
	vehicle := parcelDriverVehicle{PlateNumber: "LND-123-AB", VehicleType: "bike"}
	now := time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)

	got := buildParcelInsuranceInputs(p, "32 Ozumba Mbadiwe Ave, Lagos", "18 Simeon Akinlonu Cres, Lagos", "medium", 1_000_000, sender, vehicle, now)

	// Every field the live sti-git-on-demand form_schema marks required (verified
	// against the real synced catalog on 2026-09-02) must be present.
	required := []string{
		"first_name", "last_name", "email", "phone_number", "gender", "date_of_birth", "address",
		"pickup_location", "drop_off_location", "shipping_date", "vehicle_plate_number", "vehicle_type",
		"item_details", "total_value", "bought_for_self",
	}
	for _, k := range required {
		if _, ok := got[k]; !ok {
			t.Errorf("missing required schema field %q", k)
		}
	}

	if got["vehicle_type"] != "Bike" {
		t.Errorf("vehicle_type = %v, want Bike (mapped from our 'bike' enum)", got["vehicle_type"])
	}
	if got["vehicle_plate_number"] != "LND-123-AB" {
		t.Errorf("vehicle_plate_number = %v, want the assigned courier's real plate", got["vehicle_plate_number"])
	}
	if got["shipping_date"] != "2026-09-02" {
		t.Errorf("shipping_date = %v, want 2026-09-02 (YYYY-MM-DD)", got["shipping_date"])
	}
	if got["total_value"] != int64(1_000_000) {
		t.Errorf("total_value = %v, want 1000000 (kobo, unrescaled — the gateway adapter converts to naira)", got["total_value"])
	}
	if got["bought_for_self"] != true {
		t.Errorf("bought_for_self = %v, want true", got["bought_for_self"])
	}

	holder, ok := got["policy_holder"].(map[string]any)
	if !ok {
		t.Fatalf("policy_holder is not a map: %T", got["policy_holder"])
	}
	if holder["email"] != "ada@example.com" || holder["first_name"] != "Ada" {
		t.Errorf("policy_holder identity mismatch: %+v", holder)
	}

	items, ok := got["item_details"].([]map[string]any)
	if !ok || len(items) != 1 {
		t.Fatalf("item_details = %v, want exactly one item row", got["item_details"])
	}
	if items[0]["value"] != int64(1_000_000) || items[0]["quantity"] != 1 {
		t.Errorf("item_details[0] = %+v, want value=1000000 quantity=1", items[0])
	}
	if _, ok := items[0]["image_url"]; !ok {
		// The live API rejects a missing key here despite the schema marking it
		// optional — verified against the real sandbox on 2026-09-02.
		t.Error("item_details[0] is missing the image_url key (live API requires it present even when empty)")
	}
}

func TestRoundBps_MatchesLiveOnDemandGITRate(t *testing.T) {
	// mycover:sti-git-on-demand's real synced rate is 50 bps (0.5%), verified
	// against the live catalog on 2026-09-02.
	got := roundBps(1_000_000, 50)
	if got != 5_000 {
		t.Fatalf("roundBps(1000000, 50bps) = %d, want 5000", got)
	}
}

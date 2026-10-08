package estate

import (
	"reflect"
	"testing"
)

// TestUpdateMemberSettingsAllPointers enforces the partial-update contract: every
// field of UpdateMemberSettingsRequest must be a pointer, so an omitted field
// (nil) is preserved via COALESCE rather than being reset to a zero value.
func TestUpdateMemberSettingsAllPointers(t *testing.T) {
	rt := reflect.TypeFor[UpdateMemberSettingsRequest]()
	for f := range rt.Fields() {
		f := f
		if f.Type.Kind() != reflect.Pointer {
			t.Errorf("field %s must be a pointer for partial update, got %s", f.Name, f.Type.Kind())
		}
	}
}

// TestMemberSettingsRoundTripFields documents that the response struct exposes the
// privacy + security preferences added in Block 45.
func TestMemberSettingsRoundTripFields(t *testing.T) {
	m := MemberSettings{PrivacyShowUnit: true, BiometricEnabled: true, TwoFactorEnabled: true, DefaultCodeType: "one_time"}
	if !m.PrivacyShowUnit || !m.BiometricEnabled || !m.TwoFactorEnabled || m.DefaultCodeType != "one_time" {
		t.Error("Block 45 settings fields must be present and settable")
	}
}

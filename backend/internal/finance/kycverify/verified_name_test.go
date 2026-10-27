package kycverify

import "testing"

func TestLegalNameFromFields(t *testing.T) {
	cases := []struct {
		fields map[string]string
		want   string
	}{
		{map[string]string{"full_name": "John Adewale Smith", "first_name": "John"}, "John Adewale Smith"},
		{map[string]string{"first_name": "John", "middle_name": "Adewale", "last_name": "Smith"}, "John Adewale Smith"},
		{map[string]string{"firstName": "John", "surname": "Smith"}, "John Smith"},
		{map[string]string{"dob": "1990-01-02"}, ""},
		{nil, ""},
	}
	for _, tc := range cases {
		if got := legalNameFromFields(tc.fields); got != tc.want {
			t.Errorf("legalNameFromFields(%v) = %q, want %q", tc.fields, got, tc.want)
		}
	}
}

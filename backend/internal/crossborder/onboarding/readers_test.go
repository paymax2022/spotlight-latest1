package onboarding

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type fakeRow struct{ vals []any }

func (r fakeRow) Scan(dst ...any) error {
	for i, d := range dst {
		switch p := d.(type) {
		case *string:
			*p = r.vals[i].(string)
		case *bool:
			*p = r.vals[i].(bool)
		}
	}
	return nil
}

type fakeDB struct{ row pgx.Row }

func (f fakeDB) QueryRow(context.Context, string, ...any) pgx.Row { return f.row }

// The stored profile has no address line or nationality, so activation must
// fail closed rather than invent them.
func TestProfileStore_NoStoredAddressOrNationality_FailsClosed(t *testing.T) {
	ps := NewProfileStore(fakeDB{fakeRow{[]any{"Ada", "Obi", "1990-01-02", "ng", "Lagos", true, false}}})
	v, err := ps.GetKYCView(context.Background(), "u1")
	if err != nil {
		t.Fatal(err)
	}
	if v.FirstName != "Ada" || v.DateOfBirth != "1990-01-02" || !v.HasBVN || v.HasNIN {
		t.Fatalf("stored fields not carried: %+v", v)
	}
	if v.Nationality != "" || v.Address.Line1 != "" {
		t.Fatalf("reader must not invent nationality/address: %+v", v)
	}
	if v.Address.Country != "NG" || v.Address.City != "Lagos" {
		t.Fatalf("country/city should be carried: %+v", v.Address)
	}
	_, err = BuildOnboardingData(SubjectIndividual, Profile{Email: "a@b.co", Phone: "+234"}, v, ActivateExtras{})
	if err == nil || !strings.Contains(err.Error(), "nationality") {
		t.Fatalf("mapper must fail closed on missing nationality, got %v", err)
	}
}

func TestProfileStore_FreeTextCountryNotReinterpreted(t *testing.T) {
	ps := NewProfileStore(fakeDB{fakeRow{[]any{"A", "B", "", "Nigeria", "", false, false}}})
	v, _ := ps.GetKYCView(context.Background(), "u1")
	if v.Address.Country != "" {
		t.Fatalf("free-text country must not be carried: %q", v.Address.Country)
	}
}

func TestProfileStore_GetProfile(t *testing.T) {
	ps := NewProfileStore(fakeDB{fakeRow{[]any{"a@b.co", "+234"}}})
	p, err := ps.GetProfile(context.Background(), "u1")
	if err != nil || p.Email != "a@b.co" || p.Phone != "+234" || p.Business != nil {
		t.Fatalf("got %+v %v", p, err)
	}
}

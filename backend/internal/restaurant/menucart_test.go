package restaurant

import (
	"strings"
	"testing"
)

func TestValidateItemPriceKobo(t *testing.T) {
	if err := validateItemPriceKobo(-1); err == nil {
		t.Error("negative price must be rejected")
	}
	if err := validateItemPriceKobo(maxItemPriceKobo + 1); err == nil {
		t.Error("over-max price must be rejected")
	}
	if err := validateItemPriceKobo(0); err != nil {
		t.Errorf("zero price is allowed, got %v", err)
	}
	if err := validateItemPriceKobo(maxItemPriceKobo); err != nil {
		t.Errorf("max price is allowed, got %v", err)
	}
}

func TestSanitizeInstructions(t *testing.T) {
	// Control chars stripped, whitespace collapsed, trimmed.
	if got := sanitizeInstructions("  extra\tpepper\n\nplease\x00  "); got != "extra pepper please" {
		t.Errorf("got %q", got)
	}
	// A NUL / escape injection attempt is neutralized.
	if got := sanitizeInstructions("no onions\x1b[31m"); got != "no onions[31m" {
		t.Errorf("control byte should be stripped, got %q", got)
	}
	// Length cap.
	long := strings.Repeat("a", maxInstructionsLen+50)
	if got := sanitizeInstructions(long); len(got) > maxInstructionsLen {
		t.Errorf("length not capped: %d", len(got))
	}
	if got := sanitizeInstructions("   "); got != "" {
		t.Errorf("whitespace-only should be empty, got %q", got)
	}
}

func TestNormalizeDietaryTags(t *testing.T) {
	got := normalizeDietaryTags([]string{"Vegan", " vegan ", "Gluten Free", "", "HALAL"})
	// lower-cased, spaces→_, de-duped, sorted.
	want := []string{"gluten_free", "halal", "vegan"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("got %v, want %v", got, want)
	}
	// Count cap.
	many := make([]string, 0, 20)
	for i := 0; i < 20; i++ {
		many = append(many, string(rune('a'+i)))
	}
	if len(normalizeDietaryTags(many)) > maxDietaryTags {
		t.Error("tag count not capped")
	}
}
